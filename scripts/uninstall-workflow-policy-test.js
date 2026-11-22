// Fixed repository workflow source only; no YAML execution or installer runs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const wf = fs.readFileSync(path.join(__dirname, '../.github/workflows/uninstall-validation.yml'), 'utf8');
for (const required of [
    'windows-2025', 'contents: read', 'workflow_dispatch:', 'pull_request:',
    'Inno Setup 6\\ISCC.exe', '/VERYSILENT', '/TASKS="addtopath"',
    'windows-uninstall-handoff-proof.js', 'unins000', 'educationperfected-uninstall.log',
    // The non-ASCII install directory is deliberate: it exercises the install
    // record round-trip and the helper script encoding the BOM guards.
    'EducätionPerfected Proof',
]) assert.ok(wf.includes(required), required);
assert.doesNotMatch(wf, /upload-artifact|contents: write|pull_request_target|-Verb runas|sudo/, 'proof only: no artifacts, write access or elevation');
assert.ok(require('../package.json').scripts['test:phase3'].includes('uninstall-workflow-policy-test.js'), 'wired into test:phase3');
console.log('Uninstall validation: real Windows install, production handoff and full removal proof on windows-2025, read-only, no publication.');
