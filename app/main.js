// Electron entry for the desktop app. All orchestration lives in session.js; this
// file only wires the window and the allowlisted IPC surface onto it. Testable
// without the Electron binary via createElectronApp (scripts/app-shell-test.js).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RENDERER_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:"].join('; ');

const IPC = {
    getState: 'ep:get-state',
    refreshSetup: 'ep:refresh-setup',
    saveLogin: 'ep:save-login',
    forgetLogin: 'ep:forget-login',
    startSession: 'ep:start-session',
    completeWizard: 'ep:complete-wizard',
    action: 'ep:action',
    reflectionRespond: 'ep:reflection-respond',
    checkUpdate: 'ep:check-update',
    applyUpdate: 'ep:apply-update',
};

// The embedded browser view's persistent partition: the EP login survives app
// restarts in the app's own profile, never touching a system browser.
const BROWSER_PARTITION = 'persist:educationperfected';

// All app-owned data lives under ~/.educationperfected so one directory can be
// inspected, backed up and removed on uninstall. The Electron userData folder
// (web sessions, caches) moves there before Electron reads it; a folder left
// by an older version at the OS default location migrates across first.
function relocateUserData(app) {
    const root = path.join(app.getPath('home'), '.educationperfected');
    const target = path.join(root, 'app-data');
    const legacy = app.getPath('userData');
    if (legacy !== target && !fs.existsSync(target) && fs.existsSync(legacy)) {
        try {
            fs.mkdirSync(root, { recursive: true, mode: 0o700 });
            fs.renameSync(legacy, target);
        } catch {
            // Cross-device or locked files: copy to a staging sibling first so a
            // partial copy never poses as a migrated folder and blocks retries.
            const staging = path.join(root, `.app-data-migrating-${process.pid}`);
            try {
                fs.cpSync(legacy, staging, { recursive: true });
                fs.renameSync(staging, target);
            } catch {
                try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* staging cleanup is best-effort */ }
            }
        }
    }
    app.setPath('userData', target);
    // Keep every Electron-writable directory under the same root, so nothing
    // lands in the OS default app-data location (the pre-relocation home on
    // Windows was %AppData%\\EducationPerfected, which page's rule forbids).
    app.setPath('sessionData', target);
    app.setPath('cache', path.join(target, 'Cache'));
    app.setPath('logs', path.join(target, 'logs'));
    app.setPath('crashDumps', path.join(target, 'Crashpad'));
}

// Chromium writes the chosen endpoint to <userData>/DevToolsActivePort when
// remote debugging opens on port 0. The session's engine attaches over that
// loopback WebSocket instead of launching a separate browser.
function readDevtoolsEndpoint(app, { retries = 50, delayMs = 200 } = {}) {
    const file = path.join(app.getPath('userData'), 'DevToolsActivePort');
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const read = () => {
            attempts += 1;
            let text = null;
            try { text = fs.readFileSync(file, 'utf8'); } catch { /* not written yet */ }
            const lines = text ? text.trim().split('\n') : [];
            if (lines.length >= 2 && lines[0] && lines[1]) {
                resolve(`ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`);
                return;
            }
            if (attempts >= retries) {
                reject(new Error('The embedded browser did not open its control channel in time.'));
                return;
            }
            setTimeout(read, delayMs);
        };
        read();
    });
}

// The guest page presents itself as plain Chrome: EP and its sign-in page see
// the same browser family the CLI's pinned Chrome provides, not an Electron shell.
function applyBrowserUserAgent(electron) {
    if (!electron.session || typeof electron.session.fromPartition !== 'function') return;
    const osToken = { win32: 'Windows NT 10.0; Win64; x64', darwin: 'Macintosh; Intel Mac OS X 10_15_7', linux: 'X11; Linux x86_64' }[process.platform] || 'X11; Linux x86_64';
    electron.session.fromPartition(BROWSER_PARTITION)
        .setUserAgent(`Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
}

function createElectronApp({ electron, session }) {
    const { app, BrowserWindow, ipcMain } = electron;
    let window = null;
    let quitting = false;

    const send = (channel, payload) => {
        if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
    };
    const onEvent = (name, payload) => {
        if (name === 'state') send('ep:state', payload);
        else if (name === 'reflection-request') send('ep:reflection-request', payload);
        else if (name === 'reflection-settled') send('ep:reflection-settled', payload);
        else if (name === 'maintenance-progress') send('ep:maintenance-progress', payload);
    };
    // Session events must reach the window; session was created with our forwarder.
    if (typeof session.setOnEvent === 'function') session.setOnEvent(onEvent);

    function createWindow() {
        // Applied as a header (not a meta tag) for the renderer page only. Chromium sizes the
        // webview guest through an inline style; a style-src without inline allowance leaves the
        // guest at its default 150px height and the pane clips. Scripts load only from the app.
        const rendererPolicy = RENDERER_CSP;
        const rendererSession = electron.session && electron.session.defaultSession;
        if (rendererSession && rendererSession.webRequest) rendererSession.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
            callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [rendererPolicy] } });
        });
        window = new BrowserWindow({
            // Master-detail: the control column on the left, the embedded
            // browser view (a sandboxed webview guest) filling the rest.
            width: 1180,
            height: 800,
            minWidth: 920,
            minHeight: 560,
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
                webviewTag: true,
            },
        });
        window.on('closed', () => { window = null; });
        window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
        return window;
    }

    function registerIpc() {
        ipcMain.handle(IPC.getState, () => session.getState());
        ipcMain.handle(IPC.refreshSetup, () => session.refreshSetup());
        // Login fields travel as two arguments so the preload never builds objects.
        ipcMain.handle(IPC.saveLogin, (event, email, password) => session.saveLogin({ email, password }));
        ipcMain.handle(IPC.forgetLogin, () => session.forgetLogin());
        ipcMain.handle(IPC.startSession, () => session.startSession());
        ipcMain.handle(IPC.completeWizard, () => session.completeWizard());
        ipcMain.handle(IPC.action, (event, name, value) => session.action(name, value));
        ipcMain.handle(IPC.reflectionRespond, (event, id, text) => session.respondReflection(id, text));
        ipcMain.handle(IPC.checkUpdate, () => session.checkUpdate());
        // The update handoff replaces the running app's own files, so when the
        // session says the handoff needs it the app closes right after the IPC
        // reply lands.
        ipcMain.handle(IPC.applyUpdate, async () => {
            const result = await session.applyUpdate();
            if (result && result.quitRequired) quitAfterReply();
            return result;
        });
    }

    function quitAfterReply() {
        const timer = setTimeout(() => { void quit(); }, 750);
        if (typeof timer.unref === 'function') timer.unref();
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
            // Exercise the real embedded guest, not just the shell. Electron
            // reports it as a webview target, omitted by browser.pages(). Use
            // the same selector as engine startup and navigate offline only.
            const browser = await require('puppeteer').connect({ browserWSEndpoint: await readDevtoolsEndpoint(app), defaultViewport: null });
            try {
                const page = await require('./embedded-browser').selectEmbeddedPage(browser);
                await page.goto('data:text/html,<title>Embedded browser ready</title><h1>Embedded browser ready</h1>');
                if (await page.title() !== 'Embedded browser ready') throw new Error('embedded guest navigation failed');
                // The guest must fill the browser pane, not sit at the webview's
                // 300x150 default (a strict style-src once clipped the page to a
                // strip that way): assert the real sizes, not only the load.
                const guestSize = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
                const paneSize = await window.webContents.executeJavaScript(`(() => { const r = document.getElementById('browser').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
                if (!paneSize || paneSize.h <= 200 || !guestSize || guestSize.h < paneSize.h * 0.8 || guestSize.w < paneSize.w * 0.8) {
                    throw new Error('embedded guest does not fill the browser pane: ' + JSON.stringify({ guestSize, paneSize }));
                }
            } finally { await browser.disconnect(); }
            // Maintenance must stay reachable even when startup fails. No
            // install identity is invented and no update request is made.
            const maintenanceScreens = await window.webContents.executeJavaScript(`(() => {
                clearInterval(statePoll);
                const original = ${JSON.stringify(state)};
                const checked = [];
                for (const session of ['idle', 'failed', 'ready']) {
                    render({ ...original, setup: { browserReady: false, hasLogin: false, wizardDone: true }, session, sessionError: 'Offline fixture' });
                    for (const id of ['check-update']) {
                        const button = document.getElementById(id);
                        if (!button || !button.getClientRects().length || button.closest('[hidden]')) throw new Error(id + ' hidden in ' + session);
                    }
                    checked.push(session);
                }
                return checked;
            })()`);
            if (process.env.EP_APP_SMOKE_SCREENSHOT) {
                for (const fixtureState of ['ready', 'failed']) {
                    await window.webContents.executeJavaScript(`render({ ...${JSON.stringify(state)}, setup: { browserReady: false, hasLogin: false, wizardDone: true }, session: ${JSON.stringify(fixtureState)}, sessionError: 'Offline startup-failure fixture' })`);
                    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                    fs.writeFileSync(process.env.EP_APP_SMOKE_SCREENSHOT + '.' + fixtureState + '.png', (await window.webContents.capturePage()).toPNG());
                }
            }
            report = { ok: true, state, embeddedPage: true, maintenanceScreens };
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
        relocateUserData(app);
        if (process.env.EP_APP_SMOKE === '1') {
            // CI runners have no usable GPU; the smoke proves the window,
            // preload and IPC, not graphics. Test-mode switch only.
            app.commandLine.appendSwitch('disable-gpu');
        }
        // Loopback-only debugging port (0 = auto-assigned, written to
        // DevToolsActivePort): the engine attaches to the embedded browser
        // view through it. This switch must be set before the app is ready.
        app.commandLine.appendSwitch('remote-debugging-port', '0');
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
            // Only our bundled webview attaches, with the locked preferences the
            // renderer declares: anything the page markup does not say is dropped.
            // will-attach-webview is a WebContents event (Electron declares no
            // Session-level one), so it is wired onto each embedder webContents
            // as it is created; a Session-level listener would never fire.
            if (typeof app.on === 'function') {
                app.on('web-contents-created', (event, contents) => {
                    if (!contents || typeof contents.getType !== 'function' || contents.getType() !== 'window') return;
                    contents.on('will-attach-webview', (attachEvent, webPreferences) => {
                        delete webPreferences.preload;
                        delete webPreferences.preloadURL;
                        webPreferences.contextIsolation = true;
                        webPreferences.sandbox = true;
                        webPreferences.nodeIntegration = false;
                        // The guest keeps answering while its window is unfocused:
                        // Chromium must not throttle its timers or rAF in the
                        // background (the always-focused page environment covers
                        // what EP's scripts observe).
                        webPreferences.backgroundThrottling = false;
                    });
                });
            }
            applyBrowserUserAgent(electron);
            if (process.env.EP_APP_SMOKE === '1') return smoke();
            createWindow();
            // Probe setup before first paint settles so the wizard/main screen is right.
            try { await session.refreshSetup(); } catch { /* the window shows the retry */ }
        });
    }

    return { start, createWindow, registerIpc, quit, IPC };
}

function startElectronApp() {
    const { createAppSession } = require('./session');
    const electron = require('electron');
    let forwardedEvent = null;
    const session = createAppSession({
        onEvent: (name, payload) => forwardedEvent && forwardedEvent(name, payload),
        devtoolsEndpoint: () => readDevtoolsEndpoint(electron.app),
    });
    session.setOnEvent = fn => { forwardedEvent = fn; };
    createElectronApp({ electron, session }).start();
}

// The bundled payload keeps its existing direct-entry launch. Source checkouts
// use start.js explicitly because Electron loads file entries as dependencies.
if (require.main === module) startElectronApp();

module.exports = { startElectronApp, createElectronApp, readDevtoolsEndpoint, applyBrowserUserAgent, BROWSER_PARTITION, IPC, RENDERER_CSP };
