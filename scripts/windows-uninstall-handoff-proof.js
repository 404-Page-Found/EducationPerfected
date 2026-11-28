// Native Windows proof driver for the maintenance handoffs. The
// uninstall-validation workflow compiles the real Inno installer with a stub
// payload and installs it; this script then drives the PRODUCTION
// uninstallCommand against that real install - install record, inno plan,
// background PowerShell helper and all, with the production default spawns -
// and verifies the helper really starts the uninstaller on real Windows
// PowerShell, the failure mode unit tests with injected spawns cannot see.
// It then proves the CLI update handoff the same way: the production
// windowsHelperScript + spawnBackgroundHelper against fixture files, asserting
// the cmd.exe helper actually runs (receipt written, staging cleaned up).
//
// Everything happens inside this one process on purpose: the CI runner kills
// a step's process tree when the step's main process exits, so a helper
// spawned by a process that immediately exits never runs there. The
// uninstall helper's pid wait is exercised with a controlled short-lived
// child instead: this process stays alive and watches. Runs only on Windows;
// skips elsewhere.
'use strict';
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
    console.log('Windows handoff proof: skipped off Windows (runs in the windows-2025 CI lane).');
    process.exit(0);
}

const installDir = process.argv[2];
if (!installDir) {
    console.error('usage: node scripts/windows-uninstall-handoff-proof.js <install dir>');
    process.exit(2);
}

const { uninstallCommand } = require('../packaging/uninstall');
const { readInstallRecord } = require('../lib/install-record');
const { windowsHelperScript } = require('../packaging/update');
const { resolvePowerShell } = require('../packaging/uninstall-windows');
const { spawnBackgroundHelper } = require('../packaging/windows-helper-spawn');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Absolute System32 paths: never resolve OS tools through PATH.
const system32 = name => path.join(process.env.SystemRoot || String.raw`C:\Windows`, 'System32', name);

async function proveUninstallHandoff() {
    const exe = path.join(installDir, 'educationperfected.exe');
    const record = readInstallRecord(exe);
    if (!record) throw new Error('no readable install record next to ' + exe);
    if (record.method !== 'setup-exe') throw new Error('unexpected install method in the record: ' + record.method);
    if (!record.uninstaller) throw new Error('the install record carries no uninstaller path');
    if (!fs.existsSync(record.uninstaller)) throw new Error('the recorded uninstaller does not exist: ' + record.uninstaller);
    console.log('install record ok: method ' + record.method + ', uninstaller ' + record.uninstaller);

    const log = path.join(os.tmpdir(), 'educationperfected-uninstall.log');
    fs.rmSync(log, { force: true });

    // The helper waits for the "app" process to exit before launching the
    // uninstaller. Hand it a controlled ~3s child as that process; this proof
    // process itself must stay alive (see the header comment).
    const marker = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'ignore' });
    const result = await uninstallCommand({
        store: { async remove() { throw new Error('the inno handoff must not touch the credential store'); } },
        ownDirectory: null,
        cleanupOwn: async () => {},
        home: os.homedir(),
        executable: exe,
        platform: process.platform,
        env: process.env,
        pid: marker.pid,
        tmpDir: os.tmpdir(),
        confirm: async () => ({}),
        confirmInno: async () => true,
        output: { write: line => process.stdout.write('[uninstall] ' + line) },
        // spawn and spawnDetached are deliberately NOT injected: the production
        // defaults (real spawnSync, real background PowerShell helper) are under test.
    });
    if (!result.helperStarted) throw new Error('the handoff did not report helperStarted: ' + JSON.stringify(result));
    console.log('helper spawn confirmed; watching for the uninstaller (pid ' + marker.pid + ' releases after ~3s).');

    let seen = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        // unins000 running is the regression assertion for "the app quits but
        // the uninstaller never starts". tasklist avoids a WMI dependency.
        const list = spawnSync(system32('tasklist.exe'), ['/FI', 'IMAGENAME eq unins000.exe', '/NH'], { encoding: 'utf8' });
        if (list.stdout && list.stdout.includes('unins000.exe')) { seen = true; break }
        const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
        if (/FAILED to start the uninstaller|uninstaller exit code/.test(text)) break;
        await sleep(2000);
    }
    if (seen) {
        console.log('unins000.exe is RUNNING: the handoff started the uninstaller.');
        // The Inno uninstaller re-executes itself from a TEMP copy whose image
        // name (_unins.tmp on Inno 6, _iu*.tmp on older builds) escapes a
        // by-name taskkill, and it is not reliably a child of the launcher, so
        // /T cannot be trusted either. A survivor sits at its wizard dialog
        // holding the uninstall mutex, and every later silent uninstall then
        // exits 1 instantly. Sweep all those names and prove none remain.
        const sweep = "Get-Process | Where-Object { $_.Name -like '*unins*' -or $_.Name -like '_iu*' }";
        spawnSync(resolvePowerShell(process.env), ['-NoProfile', '-Command', sweep + ' | Stop-Process -Force'], { stdio: 'ignore' });
        await sleep(3000);
        const check = spawnSync(resolvePowerShell(process.env), ['-NoProfile', '-Command', 'if (' + sweep + ') { \'leftover\' } else { \'clean\' }'], { encoding: 'utf8' });
        if ((check.stdout || '').trim() !== 'clean') throw new Error('the helper-launched uninstaller survived the cleanup sweep: ' + (check.stdout || '').trim());
    }
    if (!fs.existsSync(log)) {
        // Diagnostic: rerun the newest helper with its output captured, so a
        // silent PowerShell startup failure says why instead of vanishing.
        console.error('helper log missing; rerunning the helper with captured output');
        const helpers = fs.readdirSync(os.tmpdir()).filter(name => /^educationperfected-uninstall-.*\.ps1$/.test(name))
            .map(name => path.join(os.tmpdir(), name))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        if (helpers.length === 0) {
            console.error('no helper script found in ' + os.tmpdir() + ': the handoff never wrote one');
        } else {
            console.error('rerunning ' + helpers[0]);
            const rerun = spawnSync(resolvePowerShell(process.env), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helpers[0]], { encoding: 'utf8' });
            console.error('rerun exit ' + rerun.status + ' signal ' + rerun.signal + '\n--- stdout ---\n' + rerun.stdout + '\n--- stderr ---\n' + rerun.stderr);
        }
        throw new Error('helper log missing: the PowerShell helper never ran');
    }
    const text = fs.readFileSync(log, 'utf8');
    console.log('--- helper log ---\n' + text + '------------------');
    if (/FAILED to start the uninstaller/.test(text)) throw new Error('the helper failed to start the uninstaller');
    if (!text.includes('uninstall helper started (mode inno')) throw new Error('helper log lacks the start marker');
    if (!seen && !text.includes('uninstaller exit code')) {
        throw new Error('the uninstaller never started: no running process and no exit code in the helper log');
    }
    console.log('Windows uninstall handoff proof passed: real install, real helper, uninstaller started.');
}

// The CLI update handoff spawns the same cmd.exe helper shape through the same
// spawnBackgroundHelper, and it broke the same way (a detached console helper
// never executes). Prove the production script generator and spawn module end
// to end with fixture files. The stub "executables" are text, so the helper's
// version check cannot pass: a rollback receipt is the expected outcome and
// still proves the helper ran, swapped and restored.
async function proveUpdateHandoff() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-update-proof-'));
    const executable = path.join(root, 'educationperfected.exe');
    const staging = path.join(root, 'staging');
    const staged = path.join(staging, 'educationperfected.exe');
    const backup = executable + '.backup';
    const receipt = executable + '.update-result';
    fs.writeFileSync(executable, 'old build');
    fs.mkdirSync(staging);
    fs.writeFileSync(staged, 'new build');
    const helper = staging + '.cmd';
    // The production pieces under test: windowsHelperScript builds the helper
    // exactly as startWindowsHelper does, spawnBackgroundHelper is the
    // production default spawnDetached.
    fs.writeFileSync(helper, windowsHelperScript({ executable, staged, backup, version: '9.9.9-proof', receipt, staging }), { mode: 0o700 });
    spawnBackgroundHelper(process.env.ComSpec || 'cmd.exe', ['/c', helper]);
    console.log('update helper spawned through spawnBackgroundHelper; waiting for the receipt.');

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !fs.existsSync(receipt)) await sleep(1000);
    if (!fs.existsSync(receipt)) throw new Error('update helper receipt missing: the cmd.exe helper never ran');
    const outcome = fs.readFileSync(receipt, 'utf8').trim();
    console.log('update helper receipt: ' + outcome);
    if (outcome !== 'rollback version-check-failed' && !outcome.startsWith('ok ')) {
        throw new Error('unexpected update helper receipt: ' + outcome);
    }
    if (outcome.startsWith('rollback') && fs.readFileSync(executable, 'utf8') !== 'old build') {
        throw new Error('the rollback receipt lied: the original executable was not restored');
    }
    if (fs.existsSync(backup)) throw new Error('the update helper left the backup behind');
    // The helper writes its receipt BEFORE cleaning up, so give the cleanup a
    // moment to land instead of racing it.
    const cleanupDeadline = Date.now() + 30000;
    while (Date.now() < cleanupDeadline && (fs.existsSync(staging) || fs.existsSync(helper))) await sleep(500);
    if (fs.existsSync(staging)) throw new Error('the update helper left the staging directory behind');
    if (fs.existsSync(helper)) throw new Error('the update helper did not remove itself');
    console.log('Windows update handoff proof passed: real helper, ran, rolled the stub back, cleaned up.');
}

(async () => {
    await proveUninstallHandoff();
    await proveUpdateHandoff();
    process.exit(0);
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
