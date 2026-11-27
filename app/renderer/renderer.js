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
const pendingSettings = new Set();

// --- Wiring ---

// Master-pane collapse: hide the pane down to a quick rail. The toggle stays
// at the top; the rail below carries status, stop/start, refresh, the logo and
// the version. Session-only; the pane starts expanded on every launch.
$('pane-toggle').addEventListener('click', () => {
    const pane = $('app');
    const collapsed = pane.classList.toggle('collapsed');
    const toggle = $('pane-toggle');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Show the pane' : 'Hide this pane';
    toggle.setAttribute('aria-label', toggle.title);
    // SVG elements do not reflect the hidden IDL property, so the attribute
    // itself has to move (renderer styles hide svg[hidden] explicitly).
    if (collapsed) {
        toggle.querySelector('.icon-collapse').setAttribute('hidden', '');
        toggle.querySelector('.icon-expand').removeAttribute('hidden');
    } else {
        toggle.querySelector('.icon-collapse').removeAttribute('hidden');
        toggle.querySelector('.icon-expand').setAttribute('hidden', '');
    }
});

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
    if (status.accuracy) lines.push(...describeAccuracy(status.accuracy));
    if (status.pacing) lines.push(describePacing(status.pacing));
    return lines;
}

function describeAccuracy(a) {
    if (!a.enabled) return ['Accuracy: off, no intentional mistakes.'];
    const lines = [];
    const target = a.target ?? a.fixedTarget;
    lines.push(target != null
        ? `Accuracy: aiming for about ${target}% correct.`
        : `Accuracy: aiming for about ${a.min}-${a.max}% correct; the exact target is picked each run.`);
    if (a.attempts > 0 && a.accuracy != null) {
        lines.push(`So far this run: ${Math.round(a.accuracy)}% correct over ${a.attempts} answers (${a.mistakes} intentional mistake${a.mistakes === 1 ? '' : 's'}).`);
    }
    return lines;
}

function describePacing(p) {
    if (!p.enabled) return 'Pacing: off, answers are submitted at full speed.';
    return 'Pacing: a short human-like pause before each answer (varies by question type).';
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
    renderRail(state);
    // The embedded browser view takes over the pane once a session is opening;
    // the placeholder covers it before that and after it closes.
    $('browser-placeholder').hidden = state.session === 'starting' || state.session === 'ready';
    renderMaintenance(state);
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
        // Once the engine reports it is parked on the login wait, the browser is
        // open: say so, so a stuck or broken page is not read as still loading.
        screens.loading.querySelector('p').textContent = state.startupPhase === 'waiting-for-sign-in'
            ? 'The browser is open. Sign in to Education Perfect on the right.'
            : 'Opening the browser\u2026';
        return;
    }
    show('main');
    renderMain(state);
}

// Collapsed quick rail: the same status, start/stop and refresh state as the
// main screen, compressed to a status dot with a short label and icon buttons.
function renderRail(state) {
    const status = state.status;
    const s = status ? status.state : 'idle';
    const busy = !status || s === 'stopping' || s === 'closing' || s === 'updating';
    let tone = '';
    if (s === 'running') tone = 'running';
    else if (s === 'stopping' || s === 'closing' || s === 'updating') tone = 'busy';
    else if (s === 'error') tone = 'error';
    $('rail-status-dot').className = 'rail-dot' + (tone ? ` ${tone}` : '');
    $('rail-status-label').className = tone;
    $('rail-status-label').textContent = {
        running: 'RUN', stopping: 'WAIT', closing: 'WAIT', updating: 'WAIT',
        error: 'ERR', completed: 'DONE', stopped: 'IDLE', closed: 'IDLE',
    }[s] || 'IDLE';
    $('rail-status').title = status ? describeStatus(status).join('\n') : 'Connecting…';
    // Once the session is closed, start() and refresh() silently no-op or
    // reject, so lock both until the setup screen reopens the browser.
    const locked = busy || s === 'closed';
    $('rail-stop').hidden = s !== 'running';
    $('rail-start').hidden = s === 'running';
    $('rail-stop').disabled = busy;
    $('rail-start').disabled = locked;
    $('rail-refresh').disabled = locked || s === 'running';
    $('rail-version').textContent = state.version ? `v${state.version}` : '';
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
    $('refresh-words').disabled = busy || status?.state === 'running';
    $('apply-mode').disabled = busy;
    const settingsBusy = busy || !['stopped', 'completed', 'error'].includes(status?.state);
    for (const [id, enabled] of [['accuracy', status?.accuracy?.enabled], ['delay', status?.pacing?.enabled], ['reports', status?.supportReports?.enabled]]) {
        const pending = pendingSettings.has(id);
        $(id).disabled = settingsBusy || pending || typeof enabled !== 'boolean';
        if (!pending) $(id).checked = enabled === true;
        $(id + '-value').textContent = $(id).checked ? 'On' : 'Off';
        $(id).setAttribute('aria-checked', String($(id).checked));
    }
    // Don't clobber an unapplied mode choice with the one-second poll.
    if (status && status.mode && document.activeElement !== $('mode')) $('mode').value = status.mode;
    $('login-status').textContent = state.setup.hasLogin
        ? 'A login is saved in your OS credential store.'
        : 'No login saved. You sign in manually in the browser.';
    $('browser-status').textContent = state.setup.browserReady
        ? 'The app drives its own embedded browser. The terminal CLI\u2019s separate pinned Chrome is downloaded.'
        : 'The app drives its own embedded browser. The terminal CLI downloads its separate pinned Chrome on first run.';
}

// Update, driven by the state the session publishes.
function renderMaintenance(state) {
    const maintenance = state.maintenance || { install: null, update: {} };
    const update = maintenance.update || {};
    $('check-update').disabled = !maintenance.install || update.checking || update.applying;
    $('update-status').textContent = updateStatusLines(maintenance, update).join(' ');
    $('apply-update').hidden = !update.plan || update.applying;
    if (update.plan) $('apply-update').textContent = `Update to v${update.plan.version}`;
    $('update-log').hidden = !(update.log && update.log.length);
    $('update-log').textContent = (update.log || []).join('\n');
    $('update-manual').hidden = !update.manual;
    $('update-manual').textContent = update.manual ? `Run this in a terminal, then relaunch the app: ${update.manual}` : '';
    // One quiet background check per app run once the main screen is up.
    if (state.session === 'ready') maybeCheckUpdateOnce(maintenance, update);
}

function updateStatusLines(maintenance, update) {
    const lines = [];
    if (update.lastResult) lines.push(`Last update result: ${update.lastResult}.`);
    if (!maintenance.install) {
        lines.push('This copy was not installed by an OS installer; update it from the terminal CLI or by reinstalling.');
        return lines;
    }
    if (update.applying) lines.push('Updating…');
    else if (update.checking) lines.push('Checking for updates…');
    else if (update.error) lines.push(`Update failed: ${update.error}`);
    else if (update.plan) {
        const size = update.plan.size === null || update.plan.size === undefined ? 'unknown size' : `${(update.plan.size / 1048576).toFixed(1)} MB`;
        lines.push(`Update available: v${update.plan.version} (${size}). The app and the educationperfected command are updated together.`);
    } else if (update.upToDate) {
        lines.push(`Up to date${update.latest ? ` (latest release: v${update.latest})` : ''}.`);
    } else {
        lines.push('The app updates through the same verified OS installer that installed it.');
    }
    return lines;
}

function maybeCheckUpdateOnce(maintenance, update) {
    if (maintenance.install && !updateCheckedOnce && !update.checking && !update.applying && !update.plan && !update.upToDate && !update.error) {
        updateCheckedOnce = true;
        api.checkUpdate().catch(() => {});
    }
}

// Update progress means the session's log grew; pull fresh state so the
// lines show as they land instead of at the next one-second poll.
api.onMaintenanceProgress(() => {
    api.getState().then(state => render(state)).catch(() => { /* window closing */ });
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
    // #action-message hides with the collapsed pane, so rail action failures
    // also surface as a small alert icon whose tooltip carries the message.
    const railMessage = $('rail-message');
    const showInRail = Boolean(text && isError);
    railMessage.hidden = !showInRail;
    railMessage.title = showInRail ? text : '';
    $('rail-message-text').textContent = showInRail ? text : '';
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
$('rail-start').addEventListener('click', () => run('start'));
$('rail-stop').addEventListener('click', () => run('stop'));
$('rail-refresh').addEventListener('click', () => run('refresh'));
$('apply-mode').addEventListener('click', () => run('mode', $('mode').value));
async function toggleSetting(id) {
    if (pendingSettings.has(id)) return;
    const stateKey = { accuracy: 'accuracy', delay: 'pacing', reports: 'supportReports' }[id];
    const status = latest?.status;
    if (!status || !['stopped', 'completed', 'error'].includes(status.state)) {
        if (latest) renderMain(latest);
        return;
    }
    pendingSettings.add(id);
    const enabled = $(id).checked;
    $(id).disabled = true;
    $(id + '-value').textContent = enabled ? 'On' : 'Off';
    $(id).setAttribute('aria-checked', String(enabled));
    showMessage('', false);
    try {
        await api.action(id, enabled ? 'on' : 'off');
    } catch (error) {
        $(id).checked = status[stateKey]?.enabled === true;
        $(id).setAttribute('aria-checked', String($(id).checked));
        showMessage(String(error?.message || error), true);
    } finally {
        pendingSettings.delete(id);
        try { render(await api.getState()); }
        catch { if (latest) renderMain(latest); }
    }
}
$('accuracy').addEventListener('change', () => toggleSetting('accuracy'));
$('delay').addEventListener('change', () => toggleSetting('delay'));
$('reports').addEventListener('change', () => toggleSetting('reports'));

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

// The embedded page recovery control: a hard reload of the guest, bypassing its
// cache. Offered while the session opens (a broken or stale page is the visible
// failure there) and while it runs. It reloads the same page the engine drives;
// nothing is submitted by reloading.
for (const id of ['reload-browser', 'reload-browser-settings']) {
    const button = $(id);
    if (button) button.addEventListener('click', () => {
        try { $('browser').reloadIgnoringCache(); } catch { /* guest not attached yet */ }
    });
}

// --- State flow: pushed updates plus a slow poll for run progress ---
api.onState(state => render(state));
const statePoll = setInterval(async () => {
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
