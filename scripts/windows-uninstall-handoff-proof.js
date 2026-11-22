// Native Windows proof driver for the uninstall handoff. The
// uninstall-validation workflow compiles the real Inno installer with a stub
// payload and installs it; this script then drives the PRODUCTION
// uninstallCommand against that real install - install record, inno plan,
// detached PowerShell helper and all, with the production default spawns - and
// verifies the helper really starts the uninstaller on real Windows
// PowerShell, the failure mode unit tests with injected spawns cannot see.
//
// Everything happens inside this one process on purpose: the CI runner kills
// a step's process tree when the step's main process exits, so a detached
// helper spawned by a process that immediately exits never runs there. The
// helper's pid wait is exercised with a controlled short-lived child instead:
// this process stays alive and watches. Runs only on Windows; skips elsewhere.
'use strict';
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { spawn } = require('node:child_process');

if (process.platform !== 'win32') {
    console.log('Windows uninstall handoff proof: skipped off Windows (runs in the windows-2025 CI lane).');
    process.exit(0);
}

const installDir = process.argv[2];
if (!installDir) {
    console.error('usage: node scripts/windows-uninstall-handoff-proof.js <install dir>');
    process.exit(2);
}

const { uninstallCommand } = require('../packaging/uninstall');
const { readInstallRecord } = require('../lib/install-record');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
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
        // defaults (real spawnSync, real detached PowerShell helper) are under test.
    });
    if (!result.helperStarted) throw new Error('the handoff did not report helperStarted: ' + JSON.stringify(result));
    console.log('helper spawn confirmed; watching for the uninstaller (pid ' + marker.pid + ' releases after ~3s).');

    let seen = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        // unins000 running is the regression assertion for "the app quits but
        // the uninstaller never starts". tasklist avoids a WMI dependency.
        const list = require('node:child_process').spawnSync('tasklist', ['/FI', 'IMAGENAME eq unins000.exe', '/NH'], { encoding: 'utf8' });
        if (list.stdout && list.stdout.includes('unins000.exe')) { seen = true; break }
        const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
        if (/FAILED to start the uninstaller|uninstaller exit code/.test(text)) break;
        await sleep(2000);
    }
    if (seen) {
        console.log('unins000.exe is RUNNING: the handoff started the uninstaller.');
        require('node:child_process').spawnSync('taskkill', ['/F', '/IM', 'unins000.exe'], { stdio: 'ignore' });
        await sleep(3000);
    }
    if (!fs.existsSync(log)) {
        // Diagnostic: rerun the same helper with its output captured, so a
        // silent PowerShell startup failure says why instead of vanishing.
        // Diagnostic matrix: the production spawn options (detached, stdio
        // ignore, windowsHide) silently killed the console-subsystem helper.
        // Vary one factor at a time to pin down which.
        console.error('helper log missing; running a spawn-option matrix for diagnostics');
        const cp = require('node:child_process');
        const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const variants = {
            'A-production': { detached: true, stdio: 'ignore', windowsHide: true },
            'B-no-detached': { detached: false, stdio: 'ignore', windowsHide: true },
            'C-no-hide': { detached: true, stdio: 'ignore', windowsHide: false },
            'D-pipes': { detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
        };
        for (const [name, opts] of Object.entries(variants)) {
            const markerFile = path.join(os.tmpdir(), 'ep-spawn-diag-' + name + '.txt');
            fs.rmSync(markerFile, { force: true });
            const c = cp.spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', `Set-Content -LiteralPath '${markerFile}' -Value ran`], opts);
            if (opts.detached) c.unref();
            if (c.stderr) c.stderr.on('data', d => process.stdout.write('[' + name + ' stderr] ' + d));
            c.on('error', e => console.log('[' + name + ' error]', e.message));
            c.on('exit', (code, sig) => console.log('[' + name + ' exit]', code, sig));
        }
        await sleep(15000);
        for (const name of Object.keys(variants)) {
            const markerFile = path.join(os.tmpdir(), 'ep-spawn-diag-' + name + '.txt');
            console.log('[matrix]', name, fs.existsSync(markerFile) ? 'RAN' : 'NEVER RAN');
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
    process.exit(0);
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
