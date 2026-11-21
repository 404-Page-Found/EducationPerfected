// Electron entry for the desktop app. All orchestration lives in session.js; this
// file only wires the window and the allowlisted IPC surface onto it. Testable
// without the Electron binary via createElectronApp (scripts/app-shell-test.js).
'use strict';

const path = require('node:path');

const IPC = {
    getState: 'ep:get-state',
    refreshSetup: 'ep:refresh-setup',
    downloadBrowser: 'ep:download-browser',
    saveLogin: 'ep:save-login',
    forgetLogin: 'ep:forget-login',
    startSession: 'ep:start-session',
    completeWizard: 'ep:complete-wizard',
    action: 'ep:action',
    reflectionRespond: 'ep:reflection-respond',
};

function createElectronApp({ electron, session }) {
    const { app, BrowserWindow, ipcMain } = electron;
    let window = null;
    let quitting = false;

    const send = (channel, payload) => {
        if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
    };
    const onEvent = (name, payload) => {
        if (name === 'state') send('ep:state', payload);
        else if (name === 'setup-progress') send('ep:setup-progress', payload);
        else if (name === 'reflection-request') send('ep:reflection-request', payload);
        else if (name === 'reflection-settled') send('ep:reflection-settled', payload);
    };
    // Session events must reach the window; session was created with our forwarder.
    if (typeof session.setOnEvent === 'function') session.setOnEvent(onEvent);

    function createWindow() {
        window = new BrowserWindow({
            width: 540,
            height: 780,
            minWidth: 420,
            minHeight: 600,
            title: 'EducationPerfected',
            icon: path.join(__dirname, '..', 'branding', 'icon-256.png'),
            backgroundColor: '#0f1826',
            autoHideMenuBar: true,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                spellcheck: false,
            },
        });
        window.on('closed', () => { window = null; });
        window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
        return window;
    }

    function registerIpc() {
        ipcMain.handle(IPC.getState, () => session.getState());
        ipcMain.handle(IPC.refreshSetup, () => session.refreshSetup());
        ipcMain.handle(IPC.downloadBrowser, () => session.downloadBrowser());
        // Login fields travel as two arguments so the preload never builds objects.
        ipcMain.handle(IPC.saveLogin, (event, email, password) => session.saveLogin({ email, password }));
        ipcMain.handle(IPC.forgetLogin, () => session.forgetLogin());
        ipcMain.handle(IPC.startSession, () => session.startSession());
        ipcMain.handle(IPC.completeWizard, () => session.completeWizard());
        ipcMain.handle(IPC.action, (event, name, value) => session.action(name, value));
        ipcMain.handle(IPC.reflectionRespond, (event, id, text) => session.respondReflection(id, text));
    }

    // Headless launch proof for CI (scripts/app-launch-smoke.js): the window,
    // the sandboxed preload and one IPC roundtrip must work on the real built
    // app, then the app quits itself. No setup probe, no browser download, no
    // credential-store read; the outcome goes to a report file, not stdout,
    // because a GUI-subsystem executable has no console on every platform.
    async function smoke() {
        let report;
        try {
            createWindow();
            await new Promise((resolve, reject) => {
                window.webContents.once('did-finish-load', resolve);
                window.webContents.once('did-fail-load', (event, code, description) => {
                    reject(new Error('renderer failed to load: ' + code + ' ' + description));
                });
                window.webContents.once('render-process-gone', (event, details) => {
                    reject(new Error('renderer process gone: ' + details.reason));
                });
            });
            const state = await window.webContents.executeJavaScript('window.educationPerfected.getState()');
            if (!state || state.session !== 'idle' || typeof state.version !== 'string') {
                throw new Error('unexpected initial state: ' + JSON.stringify(state));
            }
            report = { ok: true, state };
        } catch (error) {
            report = { ok: false, error: String((error && error.message) || error) };
            process.exitCode = 1;
        }
        try {
            require('node:fs').writeFileSync(process.env.EP_APP_SMOKE_REPORT, JSON.stringify(report));
        } catch { /* a missing report fails the wrapper by timeout or absence */ }
        await quit();
    }

    async function quit() {
        if (quitting) return;
        quitting = true;
        // A stuck browser must not trap the app: quit anyway after a bound.
        const bound = new Promise(resolve => setTimeout(resolve, 10000));
        try { await Promise.race([session.close().catch(() => {}), bound]); } finally { app.quit(); }
    }

    function start() {
        if (process.env.EP_APP_SMOKE === '1') {
            // CI runners have no usable GPU; the smoke proves the window,
            // preload and IPC, not graphics. Test-mode switch only.
            app.commandLine.appendSwitch('disable-gpu');
        }
        registerIpc();
        app.on('before-quit', event => {
            if (!quitting) {
                event.preventDefault();
                void quit();
            }
        });
        // No macOS keep-alive: closing the window closes the managed browser too.
        app.on('window-all-closed', () => { if (!quitting) void quit(); });
        app.whenReady().then(async () => {
            if (process.env.EP_APP_SMOKE === '1') return smoke();
            createWindow();
            // Probe setup before first paint settles so the wizard/main screen is right.
            try { await session.refreshSetup(); } catch { /* the window shows the retry */ }
        });
    }

    return { start, createWindow, registerIpc, quit, IPC };
}

if (require.main === module) {
    const { createAppSession } = require('./session');
    let forwardedEvent = null;
    const session = createAppSession({ onEvent: (name, payload) => forwardedEvent && forwardedEvent(name, payload) });
    session.setOnEvent = fn => { forwardedEvent = fn; };
    const electron = require('electron');
    createElectronApp({ electron, session }).start();
}

module.exports = { createElectronApp, IPC };
