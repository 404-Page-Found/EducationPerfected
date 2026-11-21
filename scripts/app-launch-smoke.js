// Real launch smoke for the built desktop app payload on the native host.
// Spawns the actual app executable headless-safe (xvfb provides the display
// on Linux; the app self-quits in EP_APP_SMOKE mode) and requires a reported
// successful window + sandboxed-preload IPC roundtrip. No release, browser
// download, network fetch, login or live EP traffic: the session orchestrator
// is only asked for its initial state.
'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const payload = process.argv[2];
if (!payload) throw new Error('Usage: app-launch-smoke.js <app-payload directory>');
const executables = {
    win32: 'EducationPerfected.exe',
    darwin: path.join('EducationPerfected.app', 'Contents', 'MacOS', 'EducationPerfected'),
    linux: 'educationperfected-app',
};
if (!Object.hasOwn(executables, process.platform)) throw new Error('Unsupported app platform: ' + process.platform);
const executable = path.join(payload, executables[process.platform]);
assert.ok(fs.statSync(executable).isFile(), 'app executable missing: ' + executable);

// An isolated HOME keeps the run hermetic: no profile, credential-store or
// app-data state from the runner, and nothing left behind there either.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-smoke-'));
const reportPath = path.join(work, 'smoke-report.json');
const env = {
    ...process.env,
    EP_APP_SMOKE: '1',
    EP_APP_SMOKE_REPORT: reportPath,
    HOME: work,
    USERPROFILE: work,
    XDG_CONFIG_HOME: work,
    XDG_CACHE_HOME: work,
};
delete env.ELECTRON_RUN_AS_NODE;

const child = cp.spawn(executable, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', chunk => { out += chunk; });
child.stderr.on('data', chunk => { out += chunk; });
const kill = setTimeout(() => {
    child.kill('SIGKILL');
}, 120000);

child.on('error', error => {
    clearTimeout(kill);
    console.error(out);
    throw error;
});

child.on('close', (code, signal) => {
    clearTimeout(kill);
    try {
        assert.ok(fs.existsSync(reportPath), 'the app wrote no smoke report (exit ' + code + ', signal ' + signal + '): ' + out.slice(-2000));
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        assert.ok(report.ok, 'the app reported a failed launch: ' + report.error);
        const version = require('../package.json').version;
        assert.equal(report.state.version, version, 'the running app reports the source version');
        assert.equal(report.state.session, 'idle');
        assert.equal(code, 0, 'the app quit cleanly');
        console.log('App launch smoke: ' + process.platform + '/' + process.arch + ' payload launched, window loaded, preload IPC answered (version ' + report.state.version + ') and the app quit cleanly.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});
