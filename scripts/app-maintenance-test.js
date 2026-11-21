// Session-level contract for the desktop app's update and uninstall wiring
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

    // Elevation: sudo becomes pkexec on Linux, one administrator shell on
    // macOS, and a reported failure elsewhere; non-sudo passes through.
    {
        const calls = [];
        const spawnSync = (command, args) => { calls.push([command, args]); return { status: 0 }; };
        const linux = maintenance.elevatedSpawn({ platform: 'linux', spawnSync });
        linux('npm', ['uninstall', '-g', 'x'], {});
        assert.deepEqual(calls[0], ['npm', ['uninstall', '-g', 'x']], 'non-sudo passes through');
        linux('sudo', ['apt', 'remove', 'educationperfected'], {});
        // apt's own [Y/n] cannot be answered with stdin ignored; the dialog
        // already confirmed, so the elevated run is noninteractive.
        assert.deepEqual(calls[1], ['pkexec', ['apt', '-y', 'remove', 'educationperfected']]);
        linux('sudo', ['rpm', '-e', 'educationperfected'], {});
        assert.deepEqual(calls[2], ['pkexec', ['rpm', '-e', 'educationperfected']], 'rpm has no prompt to answer');
        const darwin = maintenance.elevatedSpawn({ platform: 'darwin', spawnSync });
        darwin('sudo', ['rm', '-rf', '/Applications/EducationPerfected.app', '/usr/local/bin/educationperfected'], {});
        assert.equal(calls[3][0], 'osascript');
        assert.ok(calls[3][1][1].startsWith('do shell script "rm -rf /Applications/EducationPerfected.app /usr/local/bin/educationperfected" with administrator privileges'), calls[3][1][1]);
        const other = maintenance.elevatedSpawn({ platform: 'win32', spawnSync });
        assert.ok(other('sudo', ['x'], {}).error, 'no desktop elevation on Windows');
        // Shell quoting: a path with a space is quoted, a quote inside escaped.
        assert.equal(maintenance.shellQuote('/plain/path'), '/plain/path');
        assert.equal(maintenance.shellQuote('/Program Files/x'), "'/Program Files/x'");
        assert.equal(maintenance.appleScriptShell('a"b'), 'do shell script "a\\"b" with administrator privileges');
        console.log('ok desktop elevation');
    }

    // checkUpdate: no recognized layout refuses; a plan lands in state; a
    // failed check surfaces as state, not a crash.
    {
        const { deps } = makeDeps();
        const session = createAppSession(deps);
        await assert.rejects(() => session.checkUpdate(), /OS installer/);
        await assert.rejects(() => session.applyUpdate(), /OS installer/);
        await assert.rejects(() => session.uninstall({}), /OS installer/);

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

    // Update and uninstall are serialized: each refuses while the other runs.
    {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const plan = { newer: true, version: '2026.11.30', tag: 'v2026.11.30', asset: { name: 'a.exe', url: 'u', size: 1 }, sums: { name: 'SHA256SUMS', url: 's' } };
        const busy = withInstall({
            appUpdate: {
                fetchAppUpdatePlan: async () => plan,
                applyAppUpdate: async (p, options) => { await gate; return { status: 'installer-started', quitRequired: true, version: p.version }; },
            },
            uninstallCommand: async () => { await gate; return { cancelled: false, incomplete: false, programPending: false, programRemoved: true }; },
        });
        const session = createAppSession(busy.deps);
        await session.checkUpdate();
        const applying = session.applyUpdate();
        await assert.rejects(() => session.uninstall({ program: true }), /update is being applied/);
        release();
        await applying;
        // And the converse: an in-flight uninstall blocks an update apply.
        let releaseTwo;
        const gateTwo = new Promise(resolve => { releaseTwo = resolve; });
        const busyTwo = withInstall({
            appUpdate: {
                fetchAppUpdatePlan: async () => plan,
                applyAppUpdate: async p => ({ status: 'installer-started', quitRequired: true, version: p.version }),
            },
            uninstallCommand: async () => { await gateTwo; return { cancelled: false, incomplete: false, programPending: false, programRemoved: true }; },
        });
        const sessionTwo = createAppSession(busyTwo.deps);
        await sessionTwo.checkUpdate();
        const uninstalling = sessionTwo.uninstall({ program: true });
        await new Promise(resolve => setImmediate(resolve));
        await assert.rejects(() => sessionTwo.applyUpdate(), /uninstall is running/);
        releaseTwo();
        await uninstalling;
        console.log('ok update and uninstall are serialized');
    }

    // uninstall: the dialog choices replace the terminal prompts (no TTY
    // anywhere), elevation is injected, and quitRequired reflects the plan.
    {
        const seen = {};
        const wrapper = () => ({ status: 0 });
        const uninstalled = withInstall({
            buildElevatedSpawn: ({ platform }) => { seen.platform = platform; return wrapper; },
            uninstallCommand: async options => {
                seen.options = options;
                const choices = await options.confirm();
                options.output.write('Requested items removed.');
                // Mirror the real command: the program outcome is explicit.
                return { cancelled: !choices.program, incomplete: false, programPending: false, programRemoved: Boolean(choices.program) };
            },
        });
        const session = createAppSession(uninstalled.deps);
        const choices = { login: true, data: false, browsers: false, program: true };
        const result = await session.uninstall(choices);
        assert.equal(result.quitRequired, true);
        assert.equal(seen.options.executable, '/fake/educationperfected.exe');
        assert.equal(seen.options.spawn, wrapper, 'the session-built elevation wrapper is injected');
        assert.ok(seen.platform, 'the wrapper was built for the session platform');
        const noOpDeps = withInstall({
            uninstallCommand: async () => { seen.noOpCalled = true; return { cancelled: true }; },
        });
        const cancelled = await createAppSession(noOpDeps.deps).uninstall({ login: false, data: false, browsers: false, program: false });
        assert.equal(cancelled.cancelled, true);
        assert.equal(cancelled.quitRequired, false);
        assert.equal(seen.noOpCalled, undefined, 'an empty selection never reaches the uninstall command');
        assert.ok(uninstalled.events.some(e => e.name === 'maintenance-progress'));

        // No safe removal plan: the program choice alone never quits the app.
        const noPlan = withInstall({
            uninstallCommand: async () => ({ cancelled: false, incomplete: false, programPending: false, programRemoved: false }),
        });
        const kept = await createAppSession(noPlan.deps).uninstall({ login: false, data: false, browsers: false, program: true });
        assert.equal(kept.quitRequired, false, 'no actual program removal keeps the app open');
        // Retained login/data (incomplete) never hides a successful removal.
        const partial = withInstall({
            uninstallCommand: async () => ({ cancelled: false, incomplete: true, programPending: false, programRemoved: true }),
        });
        const removed = await createAppSession(partial.deps).uninstall({ login: true, data: false, browsers: false, program: true });
        assert.equal(removed.quitRequired, true, 'a removed program closes the app despite retained data');
        console.log('ok uninstall wiring');
    }

    // uninstall with the real command against a fixture: the injected confirm
    // replaces every TTY prompt and the chosen removals happen.
    {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-maint-real-'));
        const root = path.join(home, '.educationperfected');
        fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
        fs.writeFileSync(path.join(root, 'config.json'), '{}');
        const removed = [];
        const real = makeDeps({
            home,
            platform: 'linux', // the fixture models a POSIX install-sh install
            resolveCliExecutable: () => path.join(home, 'educationperfected'),
            detectInstall: () => ({ method: 'install-sh', files: [path.join(home, 'educationperfected')], directories: [], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: false }),
            store: { async read() { return null; }, async save() {}, async remove() { removed.push('login'); return true; } },
        });
        fs.writeFileSync(path.join(home, 'educationperfected'), 'fake');
        const session = createAppSession(real.deps);
        const result = await session.uninstall({ login: true, data: true, browsers: false, program: true });
        assert.equal(fs.existsSync(path.join(home, 'educationperfected')), false, 'program file removed');
        assert.deepEqual(removed, ['login']);
        assert.equal(fs.existsSync(path.join(root, 'config.json')), false, 'app settings removed');
        assert.equal(result.quitRequired, true);
        fs.rmSync(home, { recursive: true, force: true });
        console.log('ok real uninstall machinery from the dialog');
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
