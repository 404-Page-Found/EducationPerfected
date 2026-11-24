// Desktop app session orchestration. Electron-free and dependency-injected so the
// whole flow is unit-testable without a display; app/main.js wires the real
// BrowserWindow and IPC onto this.
//
// Owns:
//  - first-run setup probing (saved OS-credential login + the wizard marker)
//  - the engine session on the shared core (index.js launchProgram), driving
//    the window's own embedded browser view over the app's loopback debugging
//    endpoint (connectBrowser), never a separate downloaded browser
//  - the allowlisted control action set, mirroring the in-browser panel
//    (start/stop/status/mode/refresh/accuracy/delay; no developer commands, #283)
//  - the Reflection fill text approval as a window dialog flow
//  - in-app update for the installed app: the update downloads and verifies
//    the release's OS installer and hands off to it (the app and CLI upgrade
//    together). The app carries no uninstaller: graphical users uninstall from
//    the OS or package manager; the terminal CLI keeps `educationperfected
//    uninstall`.
'use strict';

const ACTIONS = new Set(['status', 'start', 'stop', 'mode', 'refresh', 'accuracy', 'delay']);
const MODES = new Set(['auto', 'semi']);

function createAppSession({
    // The core import must stay lazy: requiring index.js loads Puppeteer.
    launchProgram = (...args) => require('../index').launchProgram(...args),
    installedBrowser = require('../packaging/download-browser').installedBrowser,
    store = require('../lib/credential-store').createCredentialStore(),
    validateReflection = require('../lib/reflection-handler').validReflectionText,
    storageRoot = require('../lib/storage-maintenance').storageRoot,
    detectInstall = require('../lib/install-record').detectInstall,
    resolveCliExecutable = require('../packaging/app-maintenance').resolveCliExecutable,
    appUpdate = require('../packaging/app-update'),
    fs = require('node:fs'),
    path = require('node:path'),
    env = process.env,
    home = require('node:os').homedir(),
    platform = process.platform,
    arch = process.arch,
    execPath = process.execPath,
    pid = process.pid,
    tmpDir = require('node:os').tmpdir(),
    fetchImpl = globalThis.fetch,
    accuracy = {},
    onEvent = () => {},
    // The loopback WebSocket endpoint of the app's own browser shell, supplied
    // by main.js from Chromium's DevToolsActivePort file.
    devtoolsEndpoint = null,
    // The engine attaches to the embedded browser view instead of launching a
    // browser: Puppeteer connects over the endpoint, and the automation page
    // is the webview guest - never the app's own control page (a file:// URL).
    connectBrowser = null,
    selectPage = null,
} = {}) {
    // The live connection launchProgram is using, kept so close() can cut a
    // launch parked on its unbounded manual-sign-in wait: that wait only
    // rejects once the connection drops.
    let embeddedConnection = null;
    const connectEmbeddedBrowser = async () => {
        const connect = connectBrowser || (async () => {
            if (typeof devtoolsEndpoint !== 'function') throw new Error('The embedded browser is not available in this copy.');
            const endpoint = await devtoolsEndpoint();
            return require('puppeteer').connect({ browserWSEndpoint: endpoint, defaultViewport: null });
        });
        embeddedConnection = await connect();
        return embeddedConnection;
    };
    const pickAutomationPage = selectPage || ((_pages, browser) => require('./embedded-browser').selectEmbeddedPage(browser));
    let setup = { browserReady: null, hasLogin: null, wizardDone: false };
    let sessionState = 'idle'; // idle | starting | ready | failed | closed
    let sessionError = null;
    // Engine-reported startup phase (index.js onStartupPhase). 'waiting-for-sign-in'
    // means the page is open and the program waits for a manual login; the window
    // says so instead of showing an indefinite "opening" message.
    let startupPhase = null;
    let controls = null;
    let pendingReflection = null;
    let reflectionSeq = 0;
    let launching = null;
    let teardown = null; // the post-launch shutdown of a close-requested launch
    let closeRequested = false;
    let lastCloseError = null; // set when the browser itself failed to close
    // undefined until probed, then null (unrecognized layout) or the info.
    let installInfoCache;
    let pendingPlan = null; // the full update plan (URLs); state shows only display fields
    const maintenance = {
        update: { checking: false, applying: false, plan: null, upToDate: false, latest: null, error: null, manual: null, log: [], lastResult: null },
    };

    const emit = (name, payload) => onEvent(name, payload);
    const emitState = () => emit('state', getState());

    // The api.close below is best-effort by design (it is also the app-quit
    // path). Maintenance closes through this guard instead: a browser that
    // failed to close aborts the update handoff before any file it still holds
    // is replaced.
    async function closeForMaintenance() {
        await api.close();
        if (lastCloseError) {
            throw new Error('The browser session could not be closed (' + (lastCloseError.message || lastCloseError) + '); close its Chrome window and retry.');
        }
    }

    function getState() {
        const install = installInfo();
        return {
            setup: { ...setup },
            session: sessionState,
            sessionError,
            startupPhase,
            status: controls ? safeStatus() : null,
            version: require('../package.json').version,
            maintenance: {
                install: install ? { method: install.method, inferred: install.inferred } : null,
                update: { ...maintenance.update, log: [...maintenance.update.log] },
            },
        };
    }

    // The CLI the OS installer placed next to this app, and the install record
    // it carries. Probed once: install layout does not change under a running app.
    function installInfo() {
        if (installInfoCache !== undefined) return installInfoCache;
        let info = null;
        const cliExecutable = resolveCliExecutable({ platform, execPath });
        if (cliExecutable) {
            try {
                const detected = detectInstall({ executable: cliExecutable, platform, env });
                info = { cliExecutable, method: detected.method, inferred: Boolean(detected.inferred) };
            } catch { info = null; }
        }
        installInfoCache = info;
        return info;
    }

    // The Windows installer helper's receipt from the previous update, shown
    // once and removed. macOS/Linux update results are visible in their own
    // installer/package-manager UI, so only Windows needs the file handoff.
    const receiptFile = () => path.join(storageRoot(home), 'app-update-result.txt');
    function takeUpdateReceipt() {
        try {
            const text = fs.readFileSync(receiptFile(), 'utf8').trim();
            fs.rmSync(receiptFile(), { force: true });
            return text || null;
        } catch { return null; }
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
        startupPhase = null;
        controls = null;
        settlePendingReflection(false, false);
        emitState();
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

    const api = {
        getState,

        async refreshSetup() {
            let browserReady = false;
            try { browserReady = Boolean(await installedBrowser({ home })); } catch { browserReady = false; }
            let hasLogin = false;
            try { hasLogin = Boolean(await store.read()); } catch { hasLogin = false; }
            setup = { browserReady, hasLogin, wizardDone: readWizardDone() };
            const receipt = takeUpdateReceipt();
            if (receipt) maintenance.update.lastResult = receipt;
            emitState();
            return getState();
        },

        // Release check for the installed app: same releases, same stable-only
        // rules as the CLI update, with the OS installer's asset for this
        // install method. A draft release is never offered.
        async checkUpdate() {
            const info = installInfo();
            if (!info) throw new Error('Update from the app needs the app installed by an OS installer; this copy has no recognized install layout.');
            if (maintenance.update.checking || maintenance.update.applying) return getState();
            maintenance.update = { ...maintenance.update, checking: true, error: null, manual: null };
            emitState();
            try {
                const plan = await appUpdate.fetchAppUpdatePlan({ method: info.method, arch, currentVersion: getState().version, fetchImpl });
                if (plan.newer) {
                    pendingPlan = plan;
                    maintenance.update = { ...maintenance.update, checking: false, plan: { version: plan.version, name: plan.asset.name, size: plan.asset.size }, upToDate: false, latest: plan.version };
                } else {
                    pendingPlan = null;
                    maintenance.update = { ...maintenance.update, checking: false, plan: null, upToDate: true, latest: plan.latest };
                }
            } catch (error) {
                maintenance.update = { ...maintenance.update, checking: false, error: String(error && error.message ? error.message : error) };
            }
            emitState();
            return getState();
        },

        // Download, verify and hand off the planned installer. The browser
        // session closes first so nothing holds the files being replaced.
        // quitRequired tells the shell to close the app for the handoff.
        async applyUpdate() {
            const info = installInfo();
            if (!info) throw new Error('Update from the app needs the app installed by an OS installer; this copy has no recognized install layout.');
            if (!pendingPlan) throw new Error('Check for an update first; nothing has been planned.');
            if (maintenance.update.applying) return { ...getState().maintenance.update, quitRequired: false };
            maintenance.update.applying = true;
            maintenance.update.error = null;
            maintenance.update.log = [];
            emitState();
            const write = line => { maintenance.update.log.push(line); emit('maintenance-progress', { kind: 'update', line }); };
            try {
                const result = await appUpdate.applyAppUpdate(pendingPlan, {
                    method: info.method,
                    platform,
                    arch,
                    pid,
                    stagingParent: tmpDir,
                    receipt: receiptFile(),
                    fetchImpl,
                    // The browser session closes only once the download verified
                    // and a real handoff is next, so a failed verification or a
                    // manual-only outcome keeps the window on the main screen.
                    beforeHandoff: () => closeForMaintenance(),
                    write,
                });
                pendingPlan = null;
                maintenance.update.applying = false;
                maintenance.update.plan = null;
                maintenance.update.manual = result.manual || null;
                emitState();
                if (!result.quitRequired && sessionState === 'closed') {
                    // A Linux install that could not run: the app is unchanged,
                    // so reopen the browser and keep the outcome on screen.
                    try { await api.startSession(); } catch { /* the failed screen offers retry */ }
                }
                return { ...result, state: getState() };
            } catch (error) {
                pendingPlan = null;
                maintenance.update.applying = false;
                maintenance.update.plan = null;
                maintenance.update.error = String(error && error.message ? error.message : error);
                emitState();
                throw error;
            }
        },

        completeWizard() {
            markWizardDone();
            return getState();
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
            if (!setup.wizardDone) throw new Error('Finish first-run setup before starting.');
            closeRequested = false;
            sessionState = 'starting';
            sessionError = null;
            startupPhase = null;
            emitState();
            try {
                // The engine attaches to the embedded browser view: no separate
                // browser download, no Puppeteer cache, no system browser. The
                // guest page is selected for it (never the app's control page).
                launching = Promise.resolve().then(() => launchProgram({
                    connectBrowser: connectEmbeddedBrowser,
                    selectPage: pickAutomationPage,
                    onStartupPhase: phase => { startupPhase = phase; emitState(); },
                    onBrowserClosed: () => { resetSession('closed'); },
                    onBrowserDisconnected: () => { resetSession('closed'); },
                    reflectionTextProvider,
                    accuracy,
                }));
                const launched = await launching;
                launching = null;
                // A close that landed mid-launch still wins: shut what started.
                // Tracked so api.close() can await the teardown and a failure
                // reaches closeForMaintenance instead of passing silently.
                if (closeRequested) {
                    teardown = (async () => {
                        try { await launched.close(); } catch (error) { lastCloseError = error; }
                        resetSession('closed');
                    })();
                    try { await teardown; } finally { teardown = null; }
                    return getState();
                }
                controls = launched;
                sessionState = 'ready';
                startupPhase = null;
                emitState();
                return getState();
            } catch (error) {
                launching = null;
                // A close requested mid-launch wins over the launch: a cancelled
                // startup settles closed, not failed (there is nothing to retry).
                if (closeRequested) { resetSession('closed'); return getState(); }
                resetSession('failed', String(error && error.message ? error.message : error));
                throw error;
            }
        },

        async action(name, value) {
            if (!ACTIONS.has(name)) throw new Error('Unknown app control.');
            if (!controls) throw new Error('The browser session is not running.');
            const settingValue = String(value ?? '').trim().toLowerCase();
            const settingRead = name === 'accuracy' ? ['', 'show', 'status'].includes(settingValue) : name === 'delay' && settingValue === '';
            if (['accuracy', 'delay'].includes(name) && !settingRead && !['stopped', 'completed', 'error'].includes(controls.status()?.state)) {
                throw new Error('Stop the run before changing settings.');
            }
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
            closeRequested = true;
            // Wait out an in-flight launch first; its continuation sees
            // closeRequested and shuts the fresh browser instead of going ready.
            // A launch parked on the manual-sign-in wait never settles on its
            // own: cut its browser connection so the wait rejects instead of
            // hanging the close (an update would never start, with the
            // maintenance button stuck disabled and no error shown).
            if (launching) {
                try { if (embeddedConnection) await embeddedConnection.disconnect(); } catch { /* the connection is already gone */ }
                try { await launching; } catch { /* startup failure state already recorded */ }
            }
            if (teardown) { try { await teardown; } catch { /* the teardown itself recorded any close failure */ } }
            const current = controls;
            lastCloseError = null;
            if (current) {
                try { await current.close(); } catch (error) { lastCloseError = error; /* closing is best-effort on app quit */ }
            }
            settlePendingReflection(false, false);
            controls = null;
            if (sessionState !== 'failed') { sessionState = 'closed'; sessionError = null; }
            emitState();
            return getState();
        },
    };
    return api;
}

module.exports = { createAppSession };
