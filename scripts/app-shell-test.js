// Wiring contract for the Electron shell (app/main.js, app/preload.js) and static
// safety checks for the renderer. Runs without the Electron binary or a display:
// the electron module is stubbed at the CommonJS loader.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

function fakeSession() {
    const calls = [];
    const record = name => (...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true }); };
    return {
        calls,
        getState: record('getState'),
        refreshSetup: record('refreshSetup'),
        downloadBrowser: record('downloadBrowser'),
        saveLogin: record('saveLogin'),
        forgetLogin: record('forgetLogin'),
        startSession: record('startSession'),
        completeWizard: record('completeWizard'),
        action: record('action'),
        respondReflection: record('respondReflection'),
        close: record('close'),
        setOnEvent(fn) { this.onEvent = fn; },
    };
}

function fakeElectron() {
    const handlers = new Map();
    const listeners = new Map();
    const windows = [];
    const electron = {
        app: {
            quit: () => { listeners.set('quit-called', true); },
            on: (name, fn) => listeners.set(name, fn),
            whenReady: () => Promise.resolve(),
            _listeners: listeners,
        },
        BrowserWindow: function (options) {
            this.options = options;
            this.webContents = { send: (channel, payload) => { this.sent = this.sent || []; this.sent.push([channel, payload]); } };
            this.isDestroyed = () => false;
            this.loadFile = file => { this.file = file; };
            this.on = () => {};
            windows.push(this);
        },
        ipcMain: {
            handle: (channel, fn) => handlers.set(channel, fn),
            _handlers: handlers,
        },
    };
    return { electron, handlers, listeners, windows };
}

async function main() {
    const { createElectronApp, IPC } = require('../app/main');
    const { electron, handlers, listeners, windows } = fakeElectron();
    const session = fakeSession();
    createElectronApp({ electron, session }).start();

    // Every IPC channel maps onto the matching session method, nothing else.
    const expected = [
        [IPC.getState, 'getState', []],
        [IPC.refreshSetup, 'refreshSetup', []],
        [IPC.downloadBrowser, 'downloadBrowser', []],
        [IPC.saveLogin, 'saveLogin', ['a@b.c', 'pw']],
        [IPC.forgetLogin, 'forgetLogin', []],
        [IPC.startSession, 'startSession', []],
        [IPC.completeWizard, 'completeWizard', []],
        [IPC.action, 'action', ['start', undefined]],
        [IPC.reflectionRespond, 'respondReflection', [7, 'text']],
    ];
    assert.deepEqual([...handlers.keys()].sort(), expected.map(([channel]) => channel).sort());
    await new Promise(resolve => setImmediate(resolve)); // let start()'s setup probe land
    session.calls.length = 0;
    for (const [channel, method, args] of expected) await handlers.get(channel)({}, ...args);
    assert.deepEqual(session.calls.map(([name]) => name), expected.map(([, method]) => method));
    // Login fields arrive as two arguments and become one record for the store.
    assert.deepEqual(session.calls.find(([name]) => name === 'saveLogin'), ['saveLogin', { email: 'a@b.c', password: 'pw' }]);
    console.log('ok ipc channel mapping');

    // The window is sandboxed, isolated and loads only the bundled renderer.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(windows.length, 1);
    const prefs = windows[0].options.webPreferences;
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.sandbox, true);
    assert.ok(prefs.preload.endsWith(path.join('app', 'preload.js')));
    assert.ok(windows[0].file.endsWith(path.join('app', 'renderer', 'index.html')));
    console.log('ok window security preferences');

    // Closing the last window drains the session before quitting.
    const beforeQuit = listeners.get('before-quit');
    let prevented = false;
    beforeQuit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(session.calls.some(([name]) => name === 'close'));
    assert.equal(listeners.get('quit-called'), true);
    console.log('ok quit drains the session');

    // The preload exposes exactly the allowlisted API over fixed channels.
    const exposed = {};
    const ipcCalls = [];
    const sandbox = {
        require: name => {
            assert.equal(name, 'electron');
            return {
                contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
                ipcRenderer: {
                    invoke: (channel, ...args) => { ipcCalls.push(['invoke', channel, ...args]); return Promise.resolve(); },
                    on: (channel, fn) => { ipcCalls.push(['on', channel]); },
                },
            };
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'preload.js'), 'utf8'), sandbox, { filename: 'preload.js' });
    const api = exposed.educationPerfected;
    assert.deepEqual(Object.keys(api).sort(), [
        'action', 'completeWizard', 'downloadBrowser', 'forgetLogin', 'getState',
        'onReflectionRequest', 'onReflectionSettled', 'onSetupProgress', 'onState',
        'refreshSetup', 'respondReflection', 'saveLogin', 'startSession',
    ].sort());
    await api.action('start', undefined);
    await api.saveLogin('a@b.c', 'pw');
    assert.deepEqual(ipcCalls[0], ['invoke', 'ep:action', 'start', undefined]);
    assert.deepEqual(ipcCalls[1], ['invoke', 'ep:save-login', 'a@b.c', 'pw']);
    console.log('ok preload allowlist');

    // Renderer sources parse, and the page carries a self-only CSP with no remote targets.
    new vm.Script(fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'renderer.js'), 'utf8'), { filename: 'renderer.js' });
    const html = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'index.html'), 'utf8');
    assert.match(html, /Content-Security-Policy" content="default-src 'self'/);
    assert.doesNotMatch(html, /https?:\/\//);
    new vm.Script(fs.readFileSync(path.join(ROOT, 'app', 'session.js'), 'utf8'), { filename: 'session.js' });
    new vm.Script(fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8'), { filename: 'main.js' });
    console.log('ok renderer sources and CSP');

    console.log('Desktop app shell wiring contract passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
