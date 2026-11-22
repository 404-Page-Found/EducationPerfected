// Wiring contract for the Electron shell (app/main.js, app/preload.js) and static
// safety checks for the renderer. Runs without the Electron binary or a display:
// the electron module is stubbed at the CommonJS loader.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

function fakeSession() {
    const calls = [];
    const record = name => (...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true }); };
    return {
        calls,
        getState: record('getState'),
        refreshSetup: record('refreshSetup'),
        saveLogin: record('saveLogin'),
        forgetLogin: record('forgetLogin'),
        startSession: record('startSession'),
        completeWizard: record('completeWizard'),
        action: record('action'),
        respondReflection: record('respondReflection'),
        checkUpdate: record('checkUpdate'),
        applyUpdate: record('applyUpdate'),
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
            commandLine: { appendSwitch: () => {} },
            getPath: name => path.join(os.tmpdir(), 'ep-shell-test-' + name),
            setPath: () => {},
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
        [IPC.saveLogin, 'saveLogin', ['a@b.c', 'pw']],
        [IPC.forgetLogin, 'forgetLogin', []],
        [IPC.startSession, 'startSession', []],
        [IPC.completeWizard, 'completeWizard', []],
        [IPC.action, 'action', ['start', undefined]],
        [IPC.reflectionRespond, 'respondReflection', [7, 'text']],
        [IPC.checkUpdate, 'checkUpdate', []],
        [IPC.applyUpdate, 'applyUpdate', []],
    ];
    const byName = (a, b) => String(a).localeCompare(String(b));
    assert.deepEqual([...handlers.keys()].sort(byName), expected.map(([channel]) => channel).sort(byName));
    await new Promise(resolve => setImmediate(resolve)); // let start()'s setup probe land
    session.calls.length = 0;
    for (const [channel, method, args] of expected) await handlers.get(channel)({}, ...args);
    // Full argument comparison: dropped or swapped IPC payloads fail here.
    assert.deepEqual(session.calls, expected.map(([, method, args]) => {
        if (method === 'saveLogin') return ['saveLogin', { email: args[0], password: args[1] }];
        return [method, ...args];
    }));
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

    // Closing the last window drains the session before quitting; app.quit()
    // waits even for a deferred close().
    let releaseClose;
    session.close = () => new Promise(resolve => { releaseClose = () => { session.calls.push(['close']); resolve({ ok: true }); }; });
    const beforeQuit = listeners.get('before-quit');
    let prevented = false;
    beforeQuit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(listeners.get('quit-called'), undefined); // still waiting on close
    releaseClose();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(session.calls.some(([name]) => name === 'close'));
    assert.equal(listeners.get('quit-called'), true);

    // The window-all-closed path triggers the same drain-and-quit on a fresh app.
    const second = fakeElectron();
    const secondSession = fakeSession();
    createElectronApp({ electron: second.electron, session: secondSession }).start();
    second.listeners.get('window-all-closed')();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(secondSession.calls.some(([name]) => name === 'close'));
    assert.equal(second.listeners.get('quit-called'), true);
    console.log('ok quit drains the session');

    // The preload exposes exactly the allowlisted API over fixed channels. The
    // electron import is stubbed at the CommonJS loader; no code is evaluated
    // outside Node's own module machinery.
    const exposed = {};
    const ipcCalls = [];
    const electronStub = {
        contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
        ipcRenderer: {
            invoke: (channel, ...args) => { ipcCalls.push(['invoke', channel, ...args]); return Promise.resolve(); },
            on: channel => { ipcCalls.push(['on', channel]); },
        },
    };
    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return electronStub;
        return originalLoad.call(this, request, ...rest);
    };
    try { require('../app/preload'); } finally { Module._load = originalLoad; }
    const api = exposed.educationPerfected;
    assert.deepEqual(Object.keys(api).sort(byName), [
        'action', 'applyUpdate', 'checkUpdate', 'completeWizard', 'forgetLogin', 'getState',
        'onMaintenanceProgress', 'onReflectionRequest', 'onReflectionSettled', 'onState',
        'refreshSetup', 'respondReflection', 'saveLogin', 'startSession',
    ].sort(byName));
    await api.action('start', undefined);
    await api.saveLogin('a@b.c', 'pw');
    assert.deepEqual(ipcCalls[0], ['invoke', 'ep:action', 'start', undefined]);
    assert.deepEqual(ipcCalls[1], ['invoke', 'ep:save-login', 'a@b.c', 'pw']);
    console.log('ok preload allowlist');

    // Renderer sources parse (Node's own syntax checker), and the page carries a
    // self-only CSP with no remote targets.
    for (const file of ['app/renderer/renderer.js', 'app/session.js', 'app/main.js', 'app/preload.js']) {
        execFileSync(process.execPath, ['--check', path.join(ROOT, file)]);
    }
    const html = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'index.html'), 'utf8');
    // The policy is a response header set by the main process (the page has no meta CSP).
    const { RENDERER_CSP } = require('../app/main');
    assert.doesNotMatch(html, /http-equiv="Content-Security-Policy"/);
    assert.match(RENDERER_CSP, /^default-src 'self'; script-src 'self'; /);
    assert.doesNotMatch(RENDERER_CSP.split('; ').find(d => d.startsWith('script-src')), /unsafe/);
    assert.doesNotMatch(html, /https?:\/\//);
    console.log('ok renderer sources and CSP');

    console.log('Desktop app shell wiring contract passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
