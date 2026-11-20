// Desktop app session orchestration. Electron-free and dependency-injected so the
// whole flow is unit-testable without a display; app/main.js wires the real
// BrowserWindow and IPC onto this.
//
// Owns:
//  - first-run setup probing (pinned browser install + saved OS-credential login)
//  - the pinned Chrome download with progress (same ensureBrowser path as the
//    packaged CLI; the window's Download button click is the consent)
//  - the engine session on the shared core (index.js launchProgram), with the
//    packaged app's browser resolution (PUPPETEER_EXECUTABLE_PATH) and an owned
//    runtime directory
//  - the allowlisted control action set, mirroring the in-browser panel
//    (start/stop/status/mode/refresh/accuracy/delay; no developer commands, #283)
//  - the Reflection fill text approval as a window dialog flow
'use strict';

const ACTIONS = new Set(['status', 'start', 'stop', 'mode', 'refresh', 'accuracy', 'delay']);
const MODES = new Set(['auto', 'semi']);

function createAppSession({
    launchProgram = require('../index').launchProgram,
    ensureBrowser = require('../packaging/download-browser').ensureBrowser,
    installedBrowser = require('../packaging/download-browser').installedBrowser,
    store = require('../lib/credential-store').createCredentialStore(),
    createRuntimeDirectory = require('../lib/runtime-directory').createRuntimeDirectory,
    validateReflection = require('../lib/reflection-handler').validReflectionText,
    storageRoot = require('../lib/storage-maintenance').storageRoot,
    fs = require('node:fs'),
    path = require('node:path'),
    env = process.env,
    home = require('node:os').homedir(),
    accuracy = {},
    onEvent = () => {},
} = {}) {
    let setup = { browserReady: null, hasLogin: null, wizardDone: false };
    let sessionState = 'idle'; // idle | starting | ready | failed | closed
    let sessionError = null;
    let controls = null;
    let runtime = null;
    let downloading = false;
    let pendingReflection = null;
    let reflectionSeq = 0;

    const emit = (name, payload) => onEvent(name, payload);
    const emitState = () => emit('state', getState());

    function getState() {
        return {
            setup: { ...setup },
            session: sessionState,
            sessionError,
            status: controls ? safeStatus() : null,
            version: require('../package.json').version,
        };
    }
    function safeStatus() {
        try { return controls.status(); } catch { return null; }
    }

    function settlePendingReflection(value, answered) {
        const pending = pendingReflection;
        if (!pending) return;
        pendingReflection = null;
        try { pending.unregister?.(); } catch { /* the core's cancel hook is best-effort */ }
        pending.resolve(value);
        emit('reflection-settled', { id: pending.id, answered });
    }

    // The core asks for Reflection text with its two-phase approval contract:
    // nothing is typed until the window confirms, and Stop/browser-close cancels.
    function reflectionTextProvider(approval, onCancel) {
        return new Promise(resolve => {
            if (sessionState !== 'ready' || pendingReflection) { resolve(false); return; }
            const id = ++reflectionSeq;
            pendingReflection = { id, resolve, unregister: null };
            pendingReflection.unregister = typeof onCancel === 'function'
                ? onCancel(() => settlePendingReflection(false, false))
                : null;
            emit('reflection-request', { id, key: approval && approval.key });
        });
    }

    function resetSession(state, error) {
        sessionState = state;
        sessionError = error || null;
        controls = null;
        settlePendingReflection(false, false);
        emitState();
    }

    async function cleanupRuntime(confirmed) {
        const owned = runtime;
        runtime = null;
        if (owned) {
            try { owned.remove(confirmed); } catch { /* retained files are swept on next launch */ }
        }
    }

    // The first-run wizard runs once per install; afterwards the app opens the
    // browser straight away, like running the CLI. A tiny marker file in the app
    // data root records that (config.json stays limited to its versioned schema).
    const wizardFile = () => path.join(storageRoot(home), 'app-setup.json');
    function readWizardDone() {
        try {
            const record = JSON.parse(fs.readFileSync(wizardFile(), 'utf8'));
            return record && record.version === 1 && record.wizardDone === true;
        } catch { return false; }
    }
    function markWizardDone() {
        fs.writeFileSync(wizardFile(), JSON.stringify({ version: 1, wizardDone: true, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
        setup = { ...setup, wizardDone: true };
        emitState();
    }

    return {
        getState,

        async refreshSetup() {
            let browserReady = false;
            try { browserReady = Boolean(await installedBrowser({ home })); } catch { browserReady = false; }
            let hasLogin = false;
            try { hasLogin = Boolean(await store.read()); } catch { hasLogin = false; }
            setup = { browserReady, hasLogin, wizardDone: readWizardDone() };
            emitState();
            return getState();
        },

        completeWizard() {
            markWizardDone();
            return getState();
        },

        async downloadBrowser() {
            if (downloading) throw new Error('The browser download is already running.');
            downloading = true;
            try {
                const output = { write: line => emit('setup-progress', String(line)) };
                // The window's Download button click is the recorded consent, so the
                // terminal prompt is bypassed here.
                await ensureBrowser({ consent: async () => true, output, home });
                setup = { ...setup, browserReady: true };
                emitState();
                return getState();
            } finally { downloading = false; }
        },

        async saveLogin(record) {
            await store.save(record); // the store validates email/password
            setup = { ...setup, hasLogin: true };
            emitState();
            return getState();
        },

        async forgetLogin() {
            await store.remove();
            setup = { ...setup, hasLogin: false };
            emitState();
            return getState();
        },

        async startSession() {
            if (sessionState === 'starting' || sessionState === 'ready') return getState();
            if (!setup.browserReady) throw new Error('Finish first-run setup before starting.');
            sessionState = 'starting';
            sessionError = null;
            emitState();
            try {
                // Same browser resolution as the packaged CLI: the pinned Chrome
                // from the first-run download, never a Puppeteer cache or a
                // system browser. The install was consented to in setup, so the
                // consent callback here only covers a deleted cache.
                env.PUPPETEER_BROWSER = 'chrome';
                env.PUPPETEER_EXECUTABLE_PATH = await ensureBrowser({ consent: async () => true, output: { write: line => emit('setup-progress', String(line)) }, home });
                runtime = createRuntimeDirectory();
                env.PUPPETEER_TMP_DIR = runtime.directory;
                const launched = await launchProgram({
                    onBrowserClosed: () => { cleanupRuntime(true); resetSession('closed'); },
                    onBrowserDisconnected: () => { cleanupRuntime(true); resetSession('closed'); },
                    reflectionTextProvider,
                    accuracy,
                });
                controls = launched;
                sessionState = 'ready';
                emitState();
                return getState();
            } catch (error) {
                await cleanupRuntime(true);
                resetSession('failed', String(error && error.message ? error.message : error));
                throw error;
            }
        },

        async action(name, value) {
            if (!ACTIONS.has(name)) throw new Error('Unknown app control.');
            if (!controls) throw new Error('The browser session is not running.');
            let result;
            switch (name) {
                case 'status': return controls.status();
                case 'start': result = controls.start(); break;
                case 'stop': result = await controls.stop(); break;
                case 'mode':
                    if (!MODES.has(value)) throw new Error('Mode must be auto or semi.');
                    result = await controls.mode(value); break;
                case 'refresh': result = await controls.refresh(); break;
                case 'accuracy': result = await controls.setAccuracy(String(value ?? '')); break;
                case 'delay':
                    result = controls.delay(value === undefined || value === null || value === '' ? undefined : String(value));
                    if (result && result.error) throw new Error(result.error);
                    break;
            }
            emitState();
            return result;
        },

        // The renderer dialog resolves the core's pending request: confirmed text
        // (re-validated against the core's own rule) or false for cancel.
        respondReflection(id, text) {
            if (!pendingReflection || pendingReflection.id !== id) throw new Error('No reflection request is waiting for an answer.');
            if (text === false || text === null || text === undefined) {
                settlePendingReflection(false, false);
                return getState();
            }
            const value = String(text);
            if (!validateReflection(value)) throw new Error('Reflection text not supported; use a single line of 1-2000 characters.');
            settlePendingReflection(value, true);
            return getState();
        },

        async close() {
            const current = controls;
            if (current) {
                try { await current.close(); } catch { /* closing is best-effort on app quit */ }
            }
            settlePendingReflection(false, false);
            controls = null;
            await cleanupRuntime(true);
            if (sessionState !== 'failed') { sessionState = 'closed'; sessionError = null; }
            emitState();
            return getState();
        },
    };
}

module.exports = { createAppSession };
