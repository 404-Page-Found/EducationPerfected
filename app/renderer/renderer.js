// Window logic for the desktop app. Talks only to the allowlisted preload API.
// Status wording mirrors the in-browser control panel (kept in sync by hand; the
// panel is self-contained page-injected code and cannot share a module).
'use strict';

const api = window.educationPerfected;
const $ = id => document.getElementById(id);

const screens = {
    loading: $('loading-screen'),
    setup: $('setup-screen'),
    main: $('main-screen'),
    failed: $('failed-screen'),
};

let latest = null;
let startedOnce = false;
let reflectionId = null;
let updateCheckedOnce = false;
const uninstallLogLines = [];

// --- Wiring ---

// --- Plain-language status, same wording as the browser control panel ---
function describeStatus(status) {
    const lines = [];
    const states = {
        stopped: 'Stopped.', running: 'Running.', stopping: 'Stopping...',
        closing: 'Closing...', updating: 'Applying a change...', closed: 'Browser closed.',
        error: 'Stopped after an error.', completed: 'Task finished.',
    };
    lines.push(states[status.state] || `State: ${status.state}.`);
    if (status.mode) lines.push(status.mode === 'auto'
        ? 'Auto mode: answers are submitted for you.'
        : 'Semi-auto mode: answers are filled in, you submit them.');
    const a = status.accuracy || {};
    if (status.accuracy) {
        if (!a.enabled) lines.push('Accuracy: every answer goes in correct (accuracy control off).');
        else {
            const target = a.target ?? a.fixedTarget;
            lines.push(target != null
                ? `Accuracy: aiming for about ${target}% correct.`
                : `Accuracy: aiming for about ${a.min}-${a.max}% correct; the exact target is picked each run.`);
            if (a.attempts > 0 && a.accuracy != null) {
                lines.push(`So far this run: ${Math.round(a.accuracy)}% correct over ${a.attempts} answers (${a.mistakes} intentional mistake${a.mistakes === 1 ? '' : 's'}).`);
            }
        }
    }
    const p = status.pacing;
    if (p) {
        if (!p.enabled) lines.push('Pacing: off, answers are submitted at full speed.');
        else if (p.override) lines.push(`Pacing: waiting ${p.override[0] / 1000}-${p.override[1] / 1000}s before each answer.`);
        else lines.push('Pacing: a short human-like pause before each answer (varies by question type).');
    }
    return lines;
}

function describeWordList(wordList) {
    if (!wordList) return 'No word list loaded yet. Open the task starter page in the browser, then press Refresh words.';
    const time = wordList.at ? new Date(wordList.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    if (wordList.outcome === 'refreshed') {
        const changed = wordList.changed ? ' New task list; the previous task\'s learned answers were reset.' : ' Same list as before.';
        return `Word list loaded: ${wordList.entries} entries (refreshed ${time}).${changed}`;
    }
    if (wordList.outcome === 'empty') {
        return 'No word lists found on the page. Open the task starter page with the word lists visible, then press Refresh words.';
    }
    if (wordList.outcome === 'mismatch') {
        return `Word lists do not line up (${wordList.base} base vs ${wordList.target} target entries). Pairing them would teach wrong answers; fix the lists in the browser before starting.`;
    }
    return 'Word list state unknown.';
}

// --- Rendering ---
function show(name) {
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function render(state) {
    latest = state;
    $('version').textContent = state.version ? `v${state.version}` : '';
    // The embedded browser view takes over the pane once a session is opening;
    // the placeholder covers it before that and after it closes.
    $('browser-placeholder').hidden = state.session === 'starting' || state.session === 'ready';
    if (!state.setup || state.setup.browserReady === null) { show('loading'); return; }
    if (state.session === 'failed') {
        show('failed');
        $('failed-error').textContent = state.sessionError || 'Unknown startup failure.';
        return;
    }
    if (!state.setup.wizardDone || state.session === 'idle' || state.session === 'closed') {
        show('setup');
        renderSetup(state);
        return;
    }
    if (state.session === 'starting') {
        show('loading');
        screens.loading.querySelector('p').textContent = 'Opening the browser…';
        return;
    }
    show('main');
    renderMain(state);
}

function renderSetup(state) {
    const loginCard = $('setup-login-card');
    const doneCard = $('setup-done-card');
    if (!state.setup.wizardDone && !state.setup.hasLogin && state.session === 'idle') {
        loginCard.hidden = false; doneCard.hidden = true;
        return;
    }
    loginCard.hidden = true; doneCard.hidden = false;
}

function renderMain(state) {
    const status = state.status;
    $('status-bar').textContent = status ? describeStatus(status).join('\n') : 'Connecting…';
    $('word-list-status').textContent = status ? describeWordList(status.wordList) : '…';
    const busy = !status || ['stopping', 'closing', 'updating'].includes(status.state);
    $('start').disabled = busy;
    $('stop').disabled = busy;
    $('refresh-words').disabled = busy;
    $('apply-mode').disabled = busy;
    $('apply-accuracy').disabled = busy;
    $('apply-delay').disabled = busy;
    // Don't clobber an unapplied mode choice with the one-second poll.
    if (status && status.mode && document.activeElement !== $('mode')) $('mode').value = status.mode;
    $('login-status').textContent = state.setup.hasLogin
        ? 'A login is saved in your OS credential store.'
        : 'No login saved. You sign in manually in the browser.';
    $('browser-status').textContent = state.setup.browserReady
        ? 'The app drives its own embedded browser. The terminal CLI\u2019s separate pinned Chrome is downloaded.'
        : 'The app drives its own embedded browser. The terminal CLI downloads its separate pinned Chrome on first run.';
    renderMaintenance(state);
}

// Update and uninstall, driven by the same state the session publishes.
function renderMaintenance(state) {
    const maintenance = state.maintenance || { install: null, update: {}, uninstalling: false };
    const update = maintenance.update || {};
    // The two operations are serialized: each disables the other's controls.
    $('open-uninstall').disabled = !maintenance.install || maintenance.uninstalling || update.applying;
    $('check-update').disabled = !maintenance.install || maintenance.uninstalling || update.checking || update.applying;
    const lines = [];
    if (update.lastResult) lines.push(`Last update result: ${update.lastResult}.`);
    if (!maintenance.install) {
        lines.push('This copy was not installed by an OS installer; update or uninstall it from the terminal CLI or by reinstalling.');
    } else if (update.applying) {
        lines.push('Updating…');
    } else if (update.checking) {
        lines.push('Checking for updates…');
    } else if (update.error) {
        lines.push(`Update failed: ${update.error}`);
    } else if (update.plan) {
        const size = update.plan.size === null || update.plan.size === undefined ? 'unknown size' : `${(update.plan.size / 1048576).toFixed(1)} MB`;
        lines.push(`Update available: v${update.plan.version} (${size}). The app and the educationperfected command are updated together.`);
    } else if (update.upToDate) {
        lines.push(`Up to date${update.latest ? ` (latest release: v${update.latest})` : ''}.`);
    } else {
        lines.push('The app updates through the same verified OS installer that installed it.');
    }
    $('update-status').textContent = lines.join(' ');
    $('apply-update').hidden = !update.plan || update.applying || maintenance.uninstalling;
    if (update.plan) $('apply-update').textContent = `Update to v${update.plan.version}`;
    $('update-log').hidden = !(update.log && update.log.length);
    $('update-log').textContent = (update.log || []).join('\n');
    $('update-manual').hidden = !update.manual;
    $('update-manual').textContent = update.manual ? `Run this in a terminal, then relaunch the app: ${update.manual}` : '';
    $('maintenance-log').hidden = !uninstallLogLines.length;
    $('maintenance-log').textContent = uninstallLogLines.join('\n');
    // One quiet background check per app run once the main screen is up.
    if (maintenance.install && !updateCheckedOnce && !update.checking && !update.applying && !update.plan && !update.upToDate && !update.error) {
        updateCheckedOnce = true;
        api.checkUpdate().catch(() => {});
    }
}

api.onMaintenanceProgress(payload => {
    if (payload && payload.kind === 'uninstall') uninstallLogLines.push(String(payload.line));
    if (latest) renderMaintenance(latest);
});

// --- Uninstall dialog ---
// While the command runs, nothing re-enables the confirm button.
let uninstallRunning = false;
function refreshUninstallConfirm() {
    if (uninstallRunning) { $('confirm-uninstall').disabled = true; return; }
    const method = latest && latest.maintenance && latest.maintenance.install && latest.maintenance.install.method;
    $('confirm-uninstall').disabled = method === 'setup-exe' ? false
        : !['uninstall-login', 'uninstall-data', 'uninstall-browsers', 'uninstall-program'].some(box => $(box).checked);
}

function openUninstallDialog() {
    const maintenance = (latest && latest.maintenance) || {};
    const method = maintenance.install && maintenance.install.method;
    $('uninstall-error').hidden = true;
    for (const id of ['uninstall-login', 'uninstall-data', 'uninstall-browsers', 'uninstall-program']) $(id).checked = false;
    if (method === 'setup-exe') {
        $('uninstall-choices').hidden = true;
        $('uninstall-intro').textContent = 'The EducationPerfected uninstaller removes the program, its Start-menu shortcuts and the PATH entry, then asks about the saved login and app data. The app closes and the uninstaller starts.';
        $('confirm-uninstall').textContent = 'Start the uninstaller';
    } else {
        $('uninstall-choices').hidden = false;
        $('uninstall-intro').textContent = 'Choose what to remove. Each item stays unless you choose it.';
        $('uninstall-program-label').textContent = method === 'pkg'
            ? 'Remove the program itself (the app and the educationperfected command; macOS asks for your administrator password)'
            : 'Remove the program itself (the package manager removes the app and the educationperfected command; your desktop asks for your password)';
        $('confirm-uninstall').textContent = 'Uninstall';
    }
    refreshUninstallConfirm();
    $('uninstall-modal').hidden = false;
    $('confirm-uninstall').focus();
}

function closeUninstallDialog() {
    $('uninstall-modal').hidden = true;
    $('open-uninstall').focus();
}

$('open-uninstall').addEventListener('click', openUninstallDialog);
for (const id of ['uninstall-login', 'uninstall-data', 'uninstall-browsers', 'uninstall-program']) {
    $(id).addEventListener('change', refreshUninstallConfirm);
}
$('cancel-uninstall').addEventListener('click', closeUninstallDialog);
$('confirm-uninstall').addEventListener('click', async () => {
    $('uninstall-error').hidden = true;
    uninstallRunning = true;
    refreshUninstallConfirm();
    const method = latest && latest.maintenance && latest.maintenance.install && latest.maintenance.install.method;
    const choices = method === 'setup-exe' ? null : {
        login: $('uninstall-login').checked,
        data: $('uninstall-data').checked,
        browsers: $('uninstall-browsers').checked,
        program: $('uninstall-program').checked,
    };
    try {
        const result = await api.uninstall(choices);
        closeUninstallDialog();
        if (result && result.quitRequired) uninstallLogLines.push('Closing so the removal can finish.');
    } catch (error) {
        $('uninstall-error').textContent = String(error && error.message ? error.message : error);
        $('uninstall-error').hidden = false;
    } finally {
        uninstallRunning = false;
        refreshUninstallConfirm();
    }
});

// --- Update buttons ---
$('check-update').addEventListener('click', () => {
    api.checkUpdate().catch(error => showMessage(String(error && error.message ? error.message : error), true));
});
$('apply-update').addEventListener('click', async () => {
    try {
        const result = await api.applyUpdate();
        if (result && result.quitRequired && latest) {
            latest.maintenance.update.log.push('Closing so the installer can finish.');
            renderMaintenance(latest);
        }
    } catch (error) {
        showMessage(String(error && error.message ? error.message : error), true);
    }
});

function showMessage(text, isError) {
    const el = $('action-message');
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('error', Boolean(isError));
}

// --- Actions ---
async function run(action, value, okMessage) {
    showMessage('', false);
    try {
        await api.action(action, value);
        if (okMessage) showMessage(okMessage, false);
    } catch (error) {
        showMessage(String(error && error.message ? error.message : error), true);
    }
}

$('start').addEventListener('click', () => run('start'));
$('stop').addEventListener('click', () => run('stop'));
$('refresh-words').addEventListener('click', () => run('refresh'));
$('apply-mode').addEventListener('click', () => run('mode', $('mode').value));
$('apply-accuracy').addEventListener('click', () => run('accuracy', $('accuracy').value));
$('apply-delay').addEventListener('click', () => run('delay', $('delay').value));

$('save-login').addEventListener('click', async () => {
    $('login-error').hidden = true;
    try {
        await api.saveLogin($('login-email').value, $('login-password').value);
    } catch (error) {
        $('login-error').textContent = String(error && error.message ? error.message : error);
        $('login-error').hidden = false;
        return;
    }
    $('login-email').value = '';
    $('login-password').value = '';
});
$('skip-login').addEventListener('click', () => { void startFromSetup(); });
$('finish-setup').addEventListener('click', () => { void startFromSetup(); });

async function startFromSetup() {
    const errorBox = $('setup-error');
    errorBox.hidden = true;
    try {
        await api.completeWizard();
        await api.startSession();
    } catch (error) {
        errorBox.textContent = String(error && error.message ? error.message : error);
        errorBox.hidden = false;
    }
}

$('retry-session').addEventListener('click', async () => {
    try { await api.refreshSetup(); await api.startSession(); }
    catch { /* the failed screen shows the new error via state */ }
});

$('forget-login').addEventListener('click', async () => {
    try { await api.forgetLogin(); render(latest); }
    catch (error) { showMessage(String(error && error.message ? error.message : error), true); }
});

// --- Reflection dialog ---
api.onReflectionRequest(request => {
    reflectionId = request.id;
    $('reflection-question').textContent = request.key ? `Question: ${request.key}` : '';
    $('reflection-text').value = '';
    $('reflection-error').hidden = true;
    $('reflection-modal').hidden = false;
    $('reflection-text').focus();
});
api.onReflectionSettled(() => {
    reflectionId = null;
    $('reflection-modal').hidden = true;
});
$('reflection-fill').addEventListener('click', () => {
    if (reflectionId === null) return;
    try {
        api.respondReflection(reflectionId, $('reflection-text').value)
            .catch(error => {
                $('reflection-error').textContent = String(error && error.message ? error.message : error);
                $('reflection-error').hidden = false;
            });
    } catch (error) {
        $('reflection-error').textContent = String(error && error.message ? error.message : error);
        $('reflection-error').hidden = false;
    }
});
$('reflection-cancel').addEventListener('click', () => {
    if (reflectionId !== null) api.respondReflection(reflectionId, false).catch(() => {});
});

// --- State flow: pushed updates plus a slow poll for run progress ---
api.onState(state => render(state));
setInterval(async () => {
    try { render(await api.getState()); } catch { /* window closing */ }
}, 1000);

void (async () => {
    try {
        const state = await api.getState();
        render(state);
        // Same behaviour as running the CLI: once the wizard has been completed,
        // the browser opens for sign-in without another click.
        const probed = state.setup && state.setup.browserReady === null ? await api.refreshSetup() : state;
        render(probed);
        if (probed.setup.wizardDone && probed.session === 'idle' && !startedOnce) {
            startedOnce = true;
            await api.startSession();
        }
    } catch (error) {
        show('failed');
        $('failed-error').textContent = String(error && error.message ? error.message : error);
    }
})();
