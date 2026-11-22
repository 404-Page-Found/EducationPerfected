'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shouldExitAfterWindowsUninstall, exitAfterMaintenanceHandoff } = require('../packaging/maintenance-exit');
(async () => {
    for (const result of [undefined, {}, { cancelled: true }, { helperStarted: true, incomplete: true }]) {
        assert.equal(shouldExitAfterWindowsUninstall(result, { platform: 'win32' }), false);
    }
    for (const result of [{ helperStarted: true }, { programPending: true }]) {
        assert.equal(shouldExitAfterWindowsUninstall(result, { platform: 'win32' }), true);
        assert.equal(shouldExitAfterWindowsUninstall(result, { platform: 'darwin' }), false);
        assert.equal(shouldExitAfterWindowsUninstall(result, { platform: 'win32', hasLiveWorkers: true }), false);
    }
    const events = [];
    const stream = name => ({ write(text, done) { assert.equal(text, ''); setImmediate(() => { events.push(name); done(); }); } });
    await exitAfterMaintenanceHandoff({ exitAfterHandoff: true }, { stdout: stream('stdout'), stderr: stream('stderr'), exitCode: 7, exit(code) { assert.equal(events.length, 2); assert.equal(code, 7); events.push('exit'); } });
    assert.equal(events[2], 'exit');
    assert.equal(await exitAfterMaintenanceHandoff(undefined, { exit() { throw Error('unexpected exit'); } }), false);
    // A referenced interval models the actual failure class: the maintenance
    // command returned, but a remaining handle prevents natural process exit.
    const modulePath = path.resolve(__dirname, '../packaging/maintenance-exit');
    const child = spawnSync(process.execPath, ['-e', "setInterval(()=>{},1000);console.log('cleanup completed');console.error('handoff log flushed');require(process.argv[1]).exitAfterMaintenanceHandoff({exitAfterHandoff:true});", modulePath], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.error, undefined, 'handoff must not wait for event-loop idleness');
    assert.equal(child.status, 0);
    assert.ok(child.stdout.includes('cleanup completed'));
    assert.ok(child.stderr.includes('handoff log flushed'));
    const source = require('node:fs').readFileSync(path.resolve(__dirname, '../packaging/bootstrap.js'), 'utf8');
    assert.ok(source.includes('shouldExitAfterWindowsUninstall(result'));
    assert.ok(source.includes('finally { cleanup(); handoffSignals();'));
    assert.ok(source.includes('main().then(result =>'));
    console.log('Windows handoff exits with a referenced timer only after output drains; canceled/incomplete/live-worker/non-Windows cases never force exit.');
})().catch(error => { console.error(error); process.exitCode = 1; });
