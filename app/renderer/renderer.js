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
    if (!state.setup || state.setup.browserReady === null) { show('loading'); return; }
    if (state.session === 'failed') {
        show('failed');
        $('failed-error').textContent = state.sessionError || 'Unknown startup failure.';
        return;
    }
    if (!state.setup.browserReady || !state.setup.wizardDone || state.session === 'idle' || state.session === 'closed') {
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
    const browserCard = $('setup-browser-card');
    const loginCard = $('setup-login-card');
    const doneCard = $('setup-done-card');
    if (!state.setup.browserReady) {
        browserCard.hidden = false; loginCard.hidden = true; doneCard.hidden = true;
        return;
    }
    browserCard.hidden = true;
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
    if (status && status.mode) $('mode').value = status.mode;
    $('login-status').textContent = state.setup.hasLogin
        ? 'A login is saved in your OS credential store.'
        : 'No login saved. You sign in manually in the browser.';
    $('browser-status').textContent = state.setup.browserReady
        ? 'Pinned Chrome is downloaded and shared with the CLI.'
        : 'Pinned Chrome is not downloaded.';
}

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

$('download-browser').addEventListener('click', async () => {
    $('download-error').hidden = true;
    $('download-browser').disabled = true;
    $('download-progress').hidden = false;
    try { await api.downloadBrowser(); }
    catch (error) {
        $('download-error').textContent = String(error && error.message ? error.message : error);
        $('download-error').hidden = false;
        $('download-browser').disabled = false;
    }
});

api.onSetupProgress(line => {
    $('download-line').textContent = line;
    const match = /(\d+)\s*%/.exec(line);
    if (match) $('download-fill').style.width = `${match[1]}%`;
});

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
$('skip-login').addEventListener('click', () => { startFromSetup(); });
$('finish-setup').addEventListener('click', () => { startFromSetup(); });

async function startFromSetup() {
    try {
        await api.completeWizard();
        await api.startSession();
    } catch (error) { showMessage(String(error && error.message ? error.message : error), true); }
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

(async () => {
    try {
        const state = await api.getState();
        render(state);
        // Same behaviour as running the CLI: once the wizard has been completed,
        // the browser opens for sign-in without another click.
        const probed = state.setup && state.setup.browserReady === null ? await api.refreshSetup() : state;
        render(probed);
        if (probed.setup.browserReady && probed.setup.wizardDone && probed.session === 'idle' && !startedOnce) {
            startedOnce = true;
            await api.startSession();
        }
    } catch (error) {
        show('failed');
        $('failed-error').textContent = String(error && error.message ? error.message : error);
    }
})();
