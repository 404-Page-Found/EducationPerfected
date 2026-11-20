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

    async function quit() {
        if (quitting) return;
        quitting = true;
        try { await session.close(); } finally { app.quit(); }
    }

    function start() {
        registerIpc();
        app.on('before-quit', event => {
            if (!quitting) {
                event.preventDefault();
                quit();
            }
        });
        // No macOS keep-alive: closing the window closes the managed browser too.
        app.on('window-all-closed', () => { if (!quitting) quit(); });
        app.whenReady().then(async () => {
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
