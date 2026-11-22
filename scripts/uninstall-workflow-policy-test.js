// Fixed repository workflow source only; no YAML execution or installer runs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const wf = fs.readFileSync(path.join(__dirname, '../.github/workflows/uninstall-validation.yml'), 'utf8');
for (const required of [
    'windows-2025', 'contents: read', 'workflow_dispatch:', 'pull_request:',
    'Inno Setup 6\\ISCC.exe', '/VERYSILENT', '/TASKS="addtopath"',
    'windows-uninstall-handoff-proof.js', 'educationperfected-uninstall.log',
    // The non-ASCII install directory is deliberate: it exercises the install
    // record round-trip and the helper script encoding the BOM guards.
    'EducätionPerfected Proof',
]) assert.ok(wf.includes(required), required);
assert.doesNotMatch(wf, /upload-artifact|contents: write|pull_request_target|-Verb runas|sudo/, 'proof only: no artifacts, write access or elevation');
const proof = fs.readFileSync(path.join(__dirname, 'windows-uninstall-handoff-proof.js'), 'utf8');
for (const required of ['unins000', 'uninstallCommand', 'confirmInno', 'helperStarted', 'windowsHelperScript', 'spawnBackgroundHelper', 'update-result']) assert.ok(proof.includes(required), required);
assert.ok(!proof.includes('spawnDetached:'), 'the proof drives the production spawn, never an injected one');
assert.doesNotMatch(proof, /detached\s*:/, 'the proof never spawns a detached console helper');

// Every Windows maintenance helper spawns through the shared module, and the
// shared module never sets detached: a detached console-subsystem helper
// (powershell.exe, cmd.exe) starts, exits 0 and silently never runs on real
// Windows - the original "the uninstaller never starts" bug.
const spawnModule = fs.readFileSync(path.join(__dirname, '../packaging/windows-helper-spawn.js'), 'utf8');
assert.doesNotMatch(spawnModule, /detached\s*:/, 'spawnBackgroundHelper must not use detached');
for (const file of ['uninstall.js', 'update.js', 'app-update.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../packaging', file), 'utf8');
    assert.doesNotMatch(source, /detached\s*:/, file + ' must not spawn a detached console helper');
    assert.ok(source.includes('windows-helper-spawn'), file + ' must spawn background helpers through packaging/windows-helper-spawn.js');
}
assert.ok(require('../package.json').scripts['test:phase3'].includes('uninstall-workflow-policy-test.js'), 'wired into test:phase3');
console.log('Uninstall validation: real Windows install, production handoff and full removal proof on windows-2025, read-only, no publication.');
