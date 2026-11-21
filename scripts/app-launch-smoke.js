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

const payloadArg = process.argv[2];
if (!payloadArg) throw new Error('Usage: app-launch-smoke.js <app-payload directory>');
// The payload directory is the fixed build-app.js output name; a caller
// pointing anywhere else is a wiring error, not a payload to execute.
const payload = path.resolve(payloadArg); // NOSONAR: constrained to the fixed app-payload directory below; no user-controlled path is executed.
if (path.basename(payload) !== 'app-payload') throw new Error('Not an app-payload directory: ' + payloadArg);
const executables = {
    win32: 'EducationPerfected.exe',
    darwin: path.join('EducationPerfected.app', 'Contents', 'MacOS', 'EducationPerfected'),
    linux: 'educationperfected-app',
};
if (!Object.hasOwn(executables, process.platform)) throw new Error('Unsupported app platform: ' + process.platform);
const executable = path.join(payload, executables[process.platform]);
if (!executable.startsWith(payload + path.sep)) throw new Error('Executable escaped the payload directory');
assert.ok(fs.statSync(executable).isFile(), 'app executable missing: ' + executable); // NOSONAR: the path is the fixed per-platform name inside a directory required to be named app-payload, containment-checked above.

// An isolated HOME keeps POSIX runs hermetic: no profile, credential-store
// or app-data state from the runner, and nothing left behind there either.
// Windows is excepted: the Electron main process aborts at startup when
// USERPROFILE is redirected away from the real profile (proven on the
// windows-2025 runner; the CI VM is already throwaway).
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-smoke-'));
const reportPath = path.join(work, 'smoke-report.json');
const env = {
    ...process.env,
    EP_APP_SMOKE: '1',
    EP_APP_SMOKE_REPORT: reportPath,
    ELECTRON_ENABLE_LOGGING: '1',
};
if (process.platform !== 'win32') {
    Object.assign(env, { HOME: work, USERPROFILE: work, XDG_CONFIG_HOME: work, XDG_CACHE_HOME: work });
}
delete env.ELECTRON_RUN_AS_NODE;

// Child output goes to a log file, never a pipe: a Windows GUI-subsystem
// executable can abort at startup when its console handles are pipes.
const logPath = path.join(work, 'smoke-output.log');
const logFd = fs.openSync(logPath, 'a');
const child = cp.spawn(executable, [], { env, stdio: ['ignore', logFd, logFd] }); // NOSONAR: fixed per-platform executable name inside a directory required to be named app-payload; array spawn with no shell, built by this same run.
child.on('close', () => fs.closeSync(logFd));
const output = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '').slice(-2000);
const kill = setTimeout(() => {
    child.kill('SIGKILL');
}, 120000);

child.on('error', error => {
    clearTimeout(kill);
    console.error('the app failed to start: ' + error.message);
    console.error(output());
    process.exitCode = 1;
});

child.on('close', (code, signal) => {
    clearTimeout(kill);
    try {
        assert.ok(fs.existsSync(reportPath), 'the app wrote no smoke report (exit ' + code + ', signal ' + signal + '): ' + output());
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
