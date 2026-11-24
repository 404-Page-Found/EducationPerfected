// Unit contract for the desktop app session orchestrator (app/session.js).
// Everything external is injected: no Electron, no browser, no credential store,
// no network. Run in CI on the plain source tree.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppSession } = require('../app/session');

function makeControls(calls) {
    return {
        status: () => ({ state: 'stopped', mode: 'auto', wordList: null }),
        start: () => { calls.push('start'); return { state: 'running' }; },
        stop: async () => { calls.push('stop'); return { state: 'stopped' }; },
        mode: async value => { calls.push('mode:' + value); return { state: 'stopped', mode: value }; },
        refresh: async () => { calls.push('refresh'); return { state: 'stopped' }; },
        setAccuracy: async value => { calls.push('accuracy:' + value); return { state: 'stopped' }; },
        delay: value => {
            if (value !== 'on' && value !== 'off') return { error: 'Use delay, delay on or delay off.' };
            calls.push('delay:' + value);
            return { delay: 'on' };
        },
        close: async () => { calls.push('close'); return { state: 'closed' }; },
    };
}

function makeDeps(overrides = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-test-'));
    const calls = [];
    const events = [];
    const controls = makeControls(calls);
    if (overrides.controlsStatus) controls.status = overrides.controlsStatus;
    const deps = {
        launchProgram: async options => { deps.launchOptions = options; return controls; },
        ensureBrowser: async () => '/fake/chrome',
        installedBrowser: async () => null,
        store: {
            saved: null,
            async read() { return this.saved; },
            async save(record) {
                if (!record || !record.email || !record.password) throw new Error('Email and password are required.');
                this.saved = record;
            },
            async remove() { this.saved = null; return true; },
        },
        createRuntimeDirectory: () => ({ directory: '/fake/runtime', remove(confirmed) { deps.runtimeRemoved = confirmed; } }),
        validateReflection: text => typeof text === 'string' && text.length >= 1 && text.length <= 2000 && !text.includes('\n'),
        env: {},
        home,
        accuracy: {},
        storageRoot: root => {
            const dir = path.join(root, '.educationperfected');
            fs.mkdirSync(dir, { recursive: true });
            return dir;
        },
        onEvent: (name, payload) => events.push({ name, payload }),
    };
    Object.assign(deps, overrides);
    return { deps, calls, events, controls, home };
}

async function expectReject(promise, pattern) {
    await assert.rejects(promise, error => {
        assert.match(String(error && error.message), pattern);
        return true;
    });
}

async function main() {
    // Initial state and gating: unknown actions and actions without a session refuse.
    {
        const { deps } = makeDeps();
        const session = createAppSession(deps);
        const state = session.getState();
        assert.equal(state.setup.browserReady, null);
        assert.equal(state.setup.hasLogin, null);
        assert.equal(state.session, 'idle');
        assert.equal(state.status, null);
        assert.equal(typeof state.version, 'string');
        await expectReject(session.action('inspect-dash'), /Unknown app control/);
        await expectReject(session.action('start'), /not running/);
        console.log('ok initial state and action gating');
    }

    // refreshSetup probes browser, login and the wizard marker without throwing.
    {
        const { deps } = makeDeps({ installedBrowser: async () => '/fake/chrome' });
        deps.store.saved = { email: 'a@b.c', password: 'pw' };
        const session = createAppSession(deps);
        const state = await session.refreshSetup();
        assert.deepEqual(state.setup, { browserReady: true, hasLogin: true, wizardDone: false });
        session.completeWizard();
        assert.equal(session.getState().setup.wizardDone, true);
        // The marker persists: a fresh session over the same home sees it.
        const again = createAppSession(deps);
        assert.equal((await again.refreshSetup()).setup.wizardDone, true);
        console.log('ok setup probing and wizard marker');
    }

    // Setup probe failures read as "not ready", never as crashes.
    {
        const { deps } = makeDeps({
            installedBrowser: async () => { throw new Error('receipt corrupt'); },
        });
        deps.store.read = async () => { throw new Error('keychain locked'); };
        const session = createAppSession(deps);
        const state = await session.refreshSetup();
        assert.deepEqual(state.setup, { browserReady: false, hasLogin: false, wizardDone: false });
        console.log('ok setup probe failures are non-fatal');
    }

    // Starting needs the first-run wizard alone: the embedded browser ships
    // with the app, and the engine hooks pass through to the shared program.
    {
        const { deps } = makeDeps();
        const session = createAppSession(deps);
        await session.refreshSetup();
        await expectReject(session.startSession(), /Finish first-run setup/);
        session.completeWizard();
        const state = await session.startSession();
        assert.equal(state.session, 'ready');
        assert.equal(typeof deps.launchOptions.connectBrowser, 'function');
        assert.equal(typeof deps.launchOptions.selectPage, 'function');
        const guest = { marker: 'guest' };
        const browser = { waitForTarget: async (predicate, options) => {
            assert.equal(predicate({ type: () => 'page' }), false, 'never select the control window');
            assert.equal(predicate({ type: () => 'webview' }), true);
            assert.equal(options.timeout, 10000);
            return { page: async () => guest };
        } };
        assert.equal(await deps.launchOptions.selectPage([], browser), guest, 'guest selection does not depend on browser.pages()');
        console.log('ok session start gates on the wizard and passes the embedded browser hooks');
    }

    // Login save/remove update setup state; store validation errors propagate.
    {
        const { deps } = makeDeps();
        const session = createAppSession(deps);
        await session.refreshSetup();
        await expectReject(session.saveLogin({ email: '', password: 'pw' }), /Email and password/);
        await session.saveLogin({ email: 'a@b.c', password: 'pw' });
        assert.equal(session.getState().setup.hasLogin, true);
        await session.forgetLogin();
        assert.equal(session.getState().setup.hasLogin, false);
        console.log('ok login save and forget');
    }

    // startSession passes the reflection provider through and is idempotent
    // while ready.
    {
        let launches = 0;
        const holder = {};
        const { deps, calls } = makeDeps({
            launchProgram: async options => { launches++; holder.launchOptions = options; return makeControls(calls); },
        });
        deps.launchOptions = holder;
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        const state = await session.startSession();
        assert.equal(state.session, 'ready');
        assert.equal(state.status.state, 'stopped');
        assert.equal(typeof holder.launchOptions.reflectionTextProvider, 'function');
        await session.startSession();
        assert.equal(launches, 1);
        console.log('ok session start provider and idempotence');
    }

    // A launch failure surfaces as session=failed with the message and rethrows.
    {
        const { deps } = makeDeps({
            installedBrowser: async () => '/fake/chrome',
            launchProgram: async () => { throw new Error('browser did not start'); },
        });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        await expectReject(session.startSession(), /browser did not start/);
        const state = session.getState();
        assert.equal(state.session, 'failed');
        assert.equal(state.sessionError, 'browser did not start');
        console.log('ok session start failure');
    }

    // The action allowlist maps onto the shared controls with panel semantics.
    {
        const { deps, calls } = makeDeps({ installedBrowser: async () => '/fake/chrome' });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        await session.startSession();
        assert.deepEqual((await session.action('status')).state, 'stopped');
        await session.action('start');
        await session.action('stop');
        await session.action('refresh');
        await session.action('mode', 'semi');
        await session.action('accuracy', 'on');
        await session.action('delay', 'off');
        assert.deepEqual(calls, ['start', 'stop', 'refresh', 'mode:semi', 'accuracy:on', 'delay:off']);
        await expectReject(session.action('mode', 'weird'), /Mode must be auto or semi/);
        await expectReject(session.action('delay', 'bad'), /Use delay, delay on or delay off/);
        console.log('ok control action mapping and validation');
    }

    // A stale renderer cannot change config after a browser hotkey starts a run.
    {
        let state = 'stopped';
        const { deps, calls } = makeDeps({ controlsStatus: () => ({ state }) });
        const session = createAppSession(deps);
        await session.refreshSetup(); session.completeWizard(); await session.startSession();
        for (state of ['running', 'stopping', 'closing', 'updating']) {
            await expectReject(session.action('accuracy', 'on'), /Stop the run/);
            await expectReject(session.action('delay', 'on'), /Stop the run/);
        }
        assert.deepEqual(calls, []);
        state = 'stopped';
        await session.action('delay', 'on');
        assert.deepEqual(calls, ['delay:on']);
    }

    // Reflection approval: request event, validated fill, cancel, and core-side cancel.
    {
        const { deps, events } = makeDeps({ installedBrowser: async () => '/fake/chrome' });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        await session.startSession();
        const provider = deps.launchOptions.reflectionTextProvider;

        const first = provider({ key: 'Reflection 1' }, () => () => {});
        assert.ok(events.some(e => e.name === 'reflection-request' && e.payload.key === 'Reflection 1'));
        const request = events.find(e => e.name === 'reflection-request').payload;
        session.respondReflection(request.id, 'my own answer');
        assert.equal(await first, 'my own answer');
        assert.ok(events.some(e => e.name === 'reflection-settled' && e.payload.answered === true));

        // Invalid text refuses and leaves the request pending; false cancels it.
        const second = provider({ key: 'Reflection 2' }, () => () => {});
        const secondId = events.filter(e => e.name === 'reflection-request')[1].payload.id;
        assert.throws(() => session.respondReflection(secondId, ''), /not supported/);
        session.respondReflection(secondId, false);
        assert.equal(await second, false);

        // The core's own cancel hook (Stop) settles the request as unanswered.
        let cancel;
        const third = provider({ key: 'Reflection 3' }, onCancel => { cancel = onCancel; return () => {}; });
        cancel();
        assert.equal(await third, false);

        // Stray responses refuse.
        assert.throws(() => session.respondReflection(999, 'text'), /No reflection request/);
        console.log('ok reflection dialog flow');
    }

    // Browser loss resets to closed and allows relaunch.
    {
        const { deps } = makeDeps({ installedBrowser: async () => '/fake/chrome' });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        await session.startSession();
        deps.launchOptions.onBrowserDisconnected();
        assert.equal(session.getState().session, 'closed');
        await session.startSession();
        assert.equal(session.getState().session, 'ready');
        console.log('ok browser disconnect resets the session');
    }

    // A close during launch wins: the fresh browser is shut, never marked ready.
    {
        let releaseLaunch;
        const controlsClosed = [];
        const { deps } = makeDeps({
            installedBrowser: async () => '/fake/chrome',
            launchProgram: () => new Promise(resolve => {
                releaseLaunch = () => resolve({
                    status: () => ({ state: 'stopped', mode: 'auto' }),
                    close: async () => { controlsClosed.push(true); return { state: 'closed' }; },
                });
            }),
        });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        const starting = session.startSession();
        await new Promise(resolve => setImmediate(resolve));
        const closing = session.close();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(controlsClosed.length, 0); // close waits out the launch
        releaseLaunch();
        await Promise.all([starting, closing]);
        assert.equal(controlsClosed.length, 1);
        assert.equal(session.getState().session, 'closed');
        console.log('ok close during launch shuts the fresh browser');
    }

    // A close while the launch is parked on the manual-sign-in wait cannot wait
    // the launch out (it never settles): close cuts the launch's browser
    // connection, the cancelled startup settles closed, and close returns.
    {
        let parked;
        const connection = { disconnected: false, async disconnect() { this.disconnected = true; parked(new Error('Connection closed.')); } };
        const { deps } = makeDeps({
            installedBrowser: async () => '/fake/chrome',
            connectBrowser: async () => connection,
            launchProgram: async ({ connectBrowser: connect }) => {
                await connect();
                await new Promise((_, reject) => { parked = reject; });
                throw new Error('unreachable');
            },
        });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        const starting = session.startSession();
        await new Promise(resolve => setImmediate(resolve));
        const closing = session.close();
        await Promise.all([starting, closing]);
        assert.equal(connection.disconnected, true);
        assert.equal(session.getState().session, 'closed');
        console.log('ok close cuts a launch parked on the sign-in wait');
    }

    // close() drains the shared controls and cleans up.
    {
        const { deps, calls } = makeDeps({ installedBrowser: async () => '/fake/chrome' });
        const session = createAppSession(deps);
        await session.refreshSetup();
        session.completeWizard();
        await session.startSession();
        await session.close();
        assert.ok(calls.includes('close'));
        assert.equal(session.getState().session, 'closed');
        console.log('ok close drains controls');
    }

    console.log('Desktop app session orchestration contract passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
