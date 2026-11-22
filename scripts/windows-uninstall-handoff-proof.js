// Native Windows proof driver for the uninstall handoff. The
// uninstall-validation workflow compiles the real Inno installer with a stub
// payload and installs it; this script then drives the PRODUCTION
// uninstallCommand against that real install - install record, inno plan,
// detached PowerShell helper and all, with the production default spawns - and
// exits so the helper's process wait releases. The workflow asserts the
// uninstaller actually starts, which is the failure mode unit tests with
// injected spawns cannot see. Runs only on Windows; skips elsewhere.
'use strict';
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

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

(async () => {
    const exe = path.join(installDir, 'educationperfected.exe');
    const record = readInstallRecord(exe);
    if (!record) throw new Error('no readable install record next to ' + exe);
    if (record.method !== 'setup-exe') throw new Error('unexpected install method in the record: ' + record.method);
    if (!record.uninstaller) throw new Error('the install record carries no uninstaller path');
    if (!fs.existsSync(record.uninstaller)) throw new Error('the recorded uninstaller does not exist: ' + record.uninstaller);
    console.log('install record ok: method ' + record.method + ', uninstaller ' + record.uninstaller);
    const result = await uninstallCommand({
        store: { async remove() { throw new Error('the inno handoff must not touch the credential store'); } },
        ownDirectory: null,
        cleanupOwn: async () => {},
        home: os.homedir(),
        executable: exe,
        platform: process.platform,
        env: process.env,
        pid: process.pid,
        tmpDir: os.tmpdir(),
        confirm: async () => ({}),
        confirmInno: async () => true,
        output: { write: line => process.stdout.write('[uninstall] ' + line) },
        // spawn and spawnDetached are deliberately NOT injected: the production
        // defaults (real spawnSync, real detached PowerShell helper) are under test.
    });
    if (!result.helperStarted) throw new Error('the handoff did not report helperStarted: ' + JSON.stringify(result));
    console.log('helper spawn confirmed; exiting so the helper process wait releases.');
    process.exit(0);
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
