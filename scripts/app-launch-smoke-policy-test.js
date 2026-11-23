// Fixed repository workflow and script source only; no Electron or display.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/app-launch-smoke.yml'), 'utf8');
for (const required of [
    'name: App launch smoke', 'pull_request:', 'push:', 'branches: [main]', 'permissions:', 'contents: read',
    // All five native targets, matching the candidate lanes.
    'ubuntu-22.04', 'linux-x64', 'ubuntu-22.04-arm', 'linux-arm64',
    'windows-2025', 'windows-x64', 'macos-15', 'macos-arm64', 'macos-15-intel', 'macos-x64',
    'fail-fast: false', 'CANDIDATE_TARGET: ${{ matrix.target }}',
    'npm ci --ignore-scripts', 'node packaging/build-app.js "$CANDIDATE_TARGET" build/app-launch',
    "if: runner.os == 'Linux'", 'Xvfb :99', 'DISPLAY=:99',
    'node scripts/app-launch-smoke.js build/app-launch/app-payload',
    'node scripts/app-launch-smoke.js --source',
    'persist-credentials: false',
]) assert.ok(workflow.includes(required), required);
assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch|release:|workflow_run|contents: write|upload-artifact/, 'a no-release launch lane: no artifacts, no write access, no release triggers');
for (const line of workflow.split('\n')) if (line.includes('uses:')) assert.match(line, /\/[a-z0-9-]+@[a-f0-9]{40}(?:\s|$)/, 'pinned action: ' + line);
const smoke = fs.readFileSync(path.join(__dirname, '../scripts/app-launch-smoke.js'), 'utf8');
for (const required of [
    'EducationPerfected.exe', 'educationperfected-app', "'EducationPerfected.app', 'Contents', 'MacOS', 'EducationPerfected'",
    'EP_APP_SMOKE', 'EP_APP_SMOKE_REPORT', 'HOME: work', 'USERPROFILE: work', 'delete env.ELECTRON_RUN_AS_NODE',
    "child.kill('SIGKILL')", 'the app quit cleanly', 'report.state.version',
]) assert.ok(smoke.includes(required), required);
const main = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
for (const required of ['EP_APP_SMOKE', 'EP_APP_SMOKE_REPORT', 'did-finish-load', 'did-fail-load', 'window.educationPerfected.getState()', 'process.exitCode = 1']) {
    assert.ok(main.includes(required), required);
}
assert.ok(main.indexOf("process.env.EP_APP_SMOKE === '1'") > main.indexOf('async function smoke()'), 'the smoke hook is declared before its whenReady call site');
assert.ok(require('../package.json').scripts['test:phase3'].includes('app-launch-smoke-policy-test.js'), 'wired into test:phase3');
console.log('App launch smoke policy: the workflow builds and launches the real payload on all five native targets (xvfb on Linux) in a no-release lane; the app self-quits after a proven preload IPC roundtrip.');

assert.equal(require('../package.json').scripts.app, 'electron app/start.js', 'npm app uses the explicit source entry');
assert.match(fs.readFileSync(path.join(__dirname, '../app/start.js'), 'utf8'), /require\('\.\/main'\)\.startElectronApp\(\)/, 'the source entry starts the app explicitly');
for (const required of ["process.argv[2] === '--source'", '../node_modules/electron/cli.js', '../app/start.js']) assert.ok(smoke.includes(required), 'source smoke: ' + required);
