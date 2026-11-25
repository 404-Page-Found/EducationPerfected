// Session-level contract for the desktop app's update wiring
// (app/session.js + packaging/app-maintenance.js). Everything external is
// injected: no network, no installer, no elevation, no credential store, no
// real install layout.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppSession } = require('../app/session');
const maintenance = require('../packaging/app-maintenance');

// Every fixture home is removed on exit, pass or fail.
const tempHomes = [];
process.on('exit', () => { for (const home of tempHomes) fs.rmSync(home, { recursive: true, force: true }); });

function makeDeps(overrides = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-maint-test-'));
    tempHomes.push(home);
    const events = [];
    const deps = {
        launchProgram: async () => { throw new Error('no browser in this test'); },
        ensureBrowser: async () => '/fake/chrome',
        installedBrowser: async () => '/fake/chrome',
        store: {
            async read() { return null; },
            async save() {},
            async remove() { return true; },
        },
        createRuntimeDirectory: () => ({ directory: '/fake/runtime', remove() {} }),
        env: {},
        home,
        storageRoot: root => {
            const dir = path.join(root, '.educationperfected');
            fs.mkdirSync(dir, { recursive: true });
            return dir;
        },
        onEvent: (name, payload) => events.push({ name, payload }),
    };
    Object.assign(deps, overrides);
    return { deps, events, home };
}

const INSTALL = { cliExecutable: '/fake/educationperfected.exe', method: 'setup-exe', inferred: false };

function withInstall(overrides = {}) {
    return makeDeps({
        resolveCliExecutable: () => '/fake/educationperfected.exe',
        detectInstall: () => ({ ...INSTALL, files: [], directories: [], pathEntries: [], shortcuts: [], uninstaller: 'u', receipt: null, inferred: false }),
        ...overrides,
    });
}

async function main() {
    // CLI pairing: only the exact installed app layouts resolve to a CLI.
    {
        const r = maintenance.resolveCliExecutable;
        assert.equal(r({ platform: 'win32', execPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\EducationPerfected\\app\\EducationPerfected.exe' }),
            'C:\\Users\\u\\AppData\\Local\\Programs\\EducationPerfected\\educationperfected.exe');
        assert.equal(r({ platform: 'win32', execPath: 'C:\\src\\node_modules\\electron\\dist\\electron.exe' }), null);
        assert.equal(r({ platform: 'darwin', execPath: '/Applications/EducationPerfected.app/Contents/MacOS/EducationPerfected' }), '/usr/local/bin/educationperfected');
        assert.equal(r({ platform: 'darwin', execPath: '/Users/u/dev/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' }), null);
        assert.equal(r({ platform: 'linux', execPath: '/usr/lib/educationperfected/app/educationperfected-app' }), '/usr/bin/educationperfected');
        assert.equal(r({ platform: 'linux', execPath: '/home/u/dev/node_modules/electron/dist/electron' }), null);
        console.log('ok cli executable pairing');
    }

    // shellQuote: the manual sudo command app-update prints quotes paths.
    assert.equal(maintenance.shellQuote('/plain/path'), '/plain/path');
    assert.equal(maintenance.shellQuote('/Program Files/x'), "'/Program Files/x'");
    console.log('ok shell quoting');

    // checkUpdate: no recognized layout refuses; a plan lands in state; a
    // failed check surfaces as state, not a crash.
    {
        const { deps } = makeDeps();
        const session = createAppSession(deps);
        await assert.rejects(() => session.checkUpdate(), /OS installer/);
        await assert.rejects(() => session.applyUpdate(), /OS installer/);

        const plan = { newer: true, version: '2026.11.30', tag: 'v2026.11.30', asset: { name: 'a.exe', url: 'https://github.com/x', size: 100 }, sums: { name: 'SHA256SUMS', url: 'https://github.com/y' } };
        const installed = withInstall({
            appUpdate: { fetchAppUpdatePlan: async () => plan },
        });
        const up = createAppSession(installed.deps);
        const state = await up.checkUpdate();
        assert.equal(state.maintenance.install.method, 'setup-exe');
        assert.deepEqual(state.maintenance.update.plan, { version: '2026.11.30', name: 'a.exe', size: 100 });
        assert.equal(state.maintenance.update.upToDate, false);

        const failing = withInstall({ appUpdate: { fetchAppUpdatePlan: async () => { throw new Error('Release check failed (HTTP 403)'); } } });
        const down = createAppSession(failing.deps);
        const failed = await down.checkUpdate();
        assert.equal(failed.maintenance.update.error, 'Release check failed (HTTP 403)');
        assert.equal(failed.maintenance.update.plan, null);
        console.log('ok update check state');
    }

    // applyUpdate: the browser session closes before the handoff, the plan
    // reaches the module with the method and receipt, and quitRequired passes
    // through.
    {
        const calls = [];
        const applied = withInstall({
            appUpdate: {
                fetchAppUpdatePlan: async () => ({ newer: true, version: '2026.11.30', tag: 'v2026.11.30', asset: { name: 'a.exe', url: 'u', size: 1 }, sums: { name: 'SHA256SUMS', url: 's' } }),
                applyAppUpdate: async (plan, options) => {
                    calls.push(['apply', plan.version, options.method, options.receipt]);
                    options.write('Checksum verified.');
                    await options.beforeHandoff();
                    return { status: 'installer-started', quitRequired: true, version: plan.version };
                },
            },
        });
        const session = createAppSession(applied.deps);
        session.close = async () => { calls.push(['close']); return session.getState(); };
        await session.checkUpdate();
        const result = await session.applyUpdate();
        assert.equal(result.quitRequired, true);
        assert.equal(calls[0][0], 'apply', 'verification and staging come first');
        assert.deepEqual(calls[1], ['close'], 'the browser session closes only at the handoff');
        assert.equal(calls[0][2], 'setup-exe');
        assert.ok(calls[0][3].endsWith('app-update-result.txt'));
        const state = session.getState();
        assert.equal(state.maintenance.update.plan, null, 'the plan is consumed');
        assert.deepEqual(state.maintenance.update.log, ['Checksum verified.']);
        assert.ok(applied.events.some(e => e.name === 'maintenance-progress' && e.payload.kind === 'update'));
        await assert.rejects(() => session.applyUpdate(), /Check for an update first/);
        console.log('ok update handoff');
    }

    // The Windows installer helper's receipt is shown once, then cleared.
    {
        const { deps, home } = withInstall();
        fs.writeFileSync(path.join(deps.storageRoot(home), 'app-update-result.txt'), 'ok 2026.11.30\n');
        const session = createAppSession(deps);
        const state = await session.refreshSetup();
        assert.equal(state.maintenance.update.lastResult, 'ok 2026.11.30');
        const second = createAppSession(deps);
        assert.equal((await second.refreshSetup()).maintenance.update.lastResult, null);
        console.log('ok update receipt shown once');
    }

    console.log('Desktop app maintenance contract passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
