// Offline contracts for the desktop app's installer-based update
// (packaging/app-update.js). Fixture releases and installers only: no real
// GitHub release, tag, upload, network request, installer or elevation ever
// runs.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const appUpdate = require('../packaging/app-update');
const update = require('../packaging/update');

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const webStream = buffer => new ReadableStream({ start(controller) { controller.enqueue(buffer); controller.close(); } });

function releaseList(tag, assets, flags = {}) {
    return [{
        tag_name: tag, draft: Boolean(flags.draft), prerelease: Boolean(flags.prerelease),
        assets: assets.map(([name, bytes]) => ({ name, size: bytes.length, browser_download_url: 'https://github.com/404-Page-Found/EducationPerfected/releases/download/' + tag + '/' + name, _bytes: bytes })),
    }];
}

function fakeFetch(releases) {
    return async (url, options = {}) => {
        if (url === update.RELEASES_API) return { ok: true, status: 200, json: async () => releases.map(({ assets, ...rest }) => ({ ...rest, assets: assets.map(({ _bytes, ...asset }) => asset) })) };
        const asset = releases.flatMap(r => r.assets.map(a => ({ ...a, tag: r.tag_name }))).find(a => a.browser_download_url === url);
        assert.ok(asset, 'unexpected download URL ' + url);
        if (asset.name === update.SUMS_NAME) return { ok: true, status: 200, text: async () => asset._bytes.toString() };
        return { ok: true, status: 200, body: webStream(asset._bytes) };
    };
}

// A release carrying every installer asset plus SHA256SUMS, like the Publish
// workflow's bundle.
function fullRelease(tag, version) {
    const installer = Buffer.from('fake installer payload');
    const assets = [
        ['educationperfected-windows-x64-setup.exe', installer],
        ['educationperfected-macos-arm64.pkg', installer],
        ['educationperfected-macos-x64.pkg', installer],
        [`educationperfected_${version}_amd64.deb`, installer],
        [`educationperfected_${version}_arm64.deb`, installer],
        [`educationperfected-${version}-1.x86_64.rpm`, installer],
        [`educationperfected-${version}-1.aarch64.rpm`, installer],
    ];
    const sums = Buffer.from(assets.map(([name, bytes]) => sha256(bytes) + '  ' + name).join('\n') + '\n');
    return releaseList(tag, [...assets, [update.SUMS_NAME, sums]]);
}

(async () => {
    // Installer asset names per install method and architecture.
    assert.equal(appUpdate.installerAssetName({ method: 'setup-exe', arch: 'x64' }), 'educationperfected-windows-x64-setup.exe');
    assert.equal(appUpdate.installerAssetName({ method: 'pkg', arch: 'arm64' }), 'educationperfected-macos-arm64.pkg');
    assert.equal(appUpdate.installerAssetName({ method: 'pkg', arch: 'x64' }), 'educationperfected-macos-x64.pkg');
    assert.equal(appUpdate.installerAssetName({ method: 'deb', arch: 'x64', version: '2026.11.30' }), 'educationperfected_2026.11.30_amd64.deb');
    assert.equal(appUpdate.installerAssetName({ method: 'deb', arch: 'arm64', version: '2026.11.30' }), 'educationperfected_2026.11.30_arm64.deb');
    assert.equal(appUpdate.installerAssetName({ method: 'rpm', arch: 'x64', version: '2026.11.30' }), 'educationperfected-2026.11.30-1.x86_64.rpm');
    assert.equal(appUpdate.installerAssetName({ method: 'rpm', arch: 'arm64', version: '2026.11.30' }), 'educationperfected-2026.11.30-1.aarch64.rpm');
    assert.throws(() => appUpdate.installerAssetName({ method: 'npm', arch: 'x64' }), /no OS installer/);
    assert.throws(() => appUpdate.installerAssetName({ method: 'pkg', arch: 'ia32' }), /Unsupported/);
    assert.throws(() => appUpdate.installerAssetName({ method: 'deb', arch: 'ia32', version: '2026.11.30' }), /Unsupported/);
    assert.throws(() => appUpdate.installerAssetName({ method: 'deb', arch: 'x64' }), /version/);
    console.log('ok installer asset names');

    // Plan selection: newer stable only, per-method asset, drafts and
    // prereleases skipped, missing assets and checksums refused.
    {
        const releases = [...fullRelease('v2026.11.30', '2026.11.30'), ...fullRelease('v2026.12.1', '2026.12.1').map(r => ({ ...r, draft: true }))];
        for (const [method, arch, name] of [
            ['setup-exe', 'x64', 'educationperfected-windows-x64-setup.exe'],
            ['pkg', 'arm64', 'educationperfected-macos-arm64.pkg'],
            ['deb', 'x64', 'educationperfected_2026.11.30_amd64.deb'],
            ['rpm', 'arm64', 'educationperfected-2026.11.30-1.aarch64.rpm'],
        ]) {
            const plan = appUpdate.planAppUpdate({ method, arch, currentVersion: '2026.11.21', releases });
            assert.equal(plan.newer, true, method);
            assert.equal(plan.version, '2026.11.30');
            assert.equal(plan.asset.name, name);
            assert.equal(plan.tag, 'v2026.11.30');
        }
        assert.deepEqual(appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: '2026.11.30', releases }), { newer: false, latest: '2026.11.30' });
        assert.throws(() => appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: '2026.11.21', releases: releaseList('v2026.11.30', [['other-file', Buffer.from('x')]]) }), /has no asset educationperfected-windows-x64-setup.exe/);
        assert.throws(() => appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: 'x', releases }), /Unrecognized current version/);
        // A prerelease is never offered even when it is the newest release.
        const pre = fullRelease('v2026.12.1', '2026.12.1').map(r => ({ ...r, prerelease: true }));
        assert.deepEqual(appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: '2026.11.21', releases: pre }), { newer: false, latest: null });
        // An installer without the release's SHA256SUMS is refused.
        const noSums = fullRelease('v2026.11.30', '2026.11.30').map(r => ({ ...r, assets: r.assets.filter(a => a.name !== update.SUMS_NAME) }));
        assert.throws(() => appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: '2026.11.21', releases: noSums }), /has no SHA256SUMS/);
        console.log('ok update plan selection');
    }

    // Release fetch wiring (fixture fetch; the real call is one GET to the
    // releases API).
    {
        const plan = await appUpdate.fetchAppUpdatePlan({ method: 'pkg', arch: 'x64', currentVersion: '2026.11.21', fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')) });
        assert.equal(plan.newer, true);
        assert.equal(plan.asset.name, 'educationperfected-macos-x64.pkg');
        await assert.rejects(() => appUpdate.fetchAppUpdatePlan({ method: 'pkg', arch: 'x64', currentVersion: '2026.11.21', fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
        console.log('ok release fetch');
    }

    // Windows: the helper waits for the app process, runs the verified
    // installer silently, writes a receipt, and owns the staging directory.
    {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-update-test-'));
        const spawned = [];
        const plan = appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: '2026.11.21', releases: fullRelease('v2026.11.30', '2026.11.30') });
        const result = await appUpdate.applyAppUpdate(plan, {
            method: 'setup-exe', platform: 'win32', pid: 4321,
            stagingParent: parent, receipt: path.join(parent, 'app-update-result.txt'),
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            spawnDetached: (command, args) => spawned.push([command, args]),
            beforeHandoff: async () => { spawned.push(['beforeHandoff']); },
        });
        assert.equal(result.status, 'installer-started');
        assert.deepEqual(spawned[0], ['beforeHandoff'], 'the session closes before the helper starts');
        assert.equal(result.quitRequired, true);
        assert.equal(spawned.length, 2);
        const helper = spawned[1][1][1];
        assert.ok(helper.endsWith('.cmd') && helper.startsWith(parent), 'helper lives next to staging: ' + helper);
        const script = fs.readFileSync(helper, 'utf8');
        for (const expected of ['chcp 65001', 'tasklist /FI "PID eq 4321"', '/SILENT /SUPPRESSMSGBOXES /NORESTART', 'educationperfected-windows-x64-setup.exe', 'echo ok 2026.11.30', 'rmdir /s /q']) {
            assert.ok(script.includes(expected), expected);
        }
        // The staged installer survived (helper-owned) and is the verified bytes.
        const staged = path.join(helper.slice(0, -4), 'educationperfected-windows-x64-setup.exe');
        assert.equal(fs.readFileSync(staged).toString(), 'fake installer payload');
        fs.rmSync(parent, { recursive: true, force: true });
        console.log('ok windows installer handoff');
    }

    // The Windows helper refuses cmd-expandable paths.
    for (const bad of [{ installer: 'a%b' }, { staging: 'a!b' }, { receipt: 'a%b' }]) {
        assert.throws(() => appUpdate.windowsInstallerHelperScript({ installer: 'i', staging: 's', receipt: 'r', version: '2026.11.30', pid: 1, ...bad }), /% or !/);
    }
    assert.throws(() => appUpdate.windowsInstallerHelperScript({ installer: 'i', staging: 's', receipt: 'r', version: '2026.11.30', pid: 0 }), /process id/);
    console.log('ok windows helper path safety');

    // macOS: the verified pkg opens in the OS Installer; staging is cleaned
    // when the Installer closes.
    {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-update-test-'));
        const spawned = [];
        const plan = appUpdate.planAppUpdate({ method: 'pkg', arch: 'arm64', currentVersion: '2026.11.21', releases: fullRelease('v2026.11.30', '2026.11.30') });
        const result = await appUpdate.applyAppUpdate(plan, {
            method: 'pkg', platform: 'darwin', arch: 'arm64', stagingParent: parent,
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            spawnDetached: (command, args) => spawned.push([command, args]),
        });
        assert.equal(result.status, 'installer-opened');
        assert.equal(result.quitRequired, true);
        assert.deepEqual(spawned[0][0], 'sh');
        assert.equal(spawned[0][1][0], '-c');
        assert.ok(spawned[0][1][1].includes('open -W "$1"'));
        assert.ok(spawned[0][1][3].endsWith('.pkg'), 'the verified pkg is the opened file');
        fs.rmSync(parent, { recursive: true, force: true });
        console.log('ok macos installer handoff');
    }

    // Linux deb: no pkexec keeps the verified package and names the exact
    // manual command; with pkexec the package manager runs elevated.
    {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-update-test-'));
        const plan = appUpdate.planAppUpdate({ method: 'deb', arch: 'x64', currentVersion: '2026.11.21', releases: fullRelease('v2026.11.30', '2026.11.30') });
        let handedOff = 0;
        const manualResult = await appUpdate.applyAppUpdate(plan, {
            method: 'deb', platform: 'linux', arch: 'x64', stagingParent: parent,
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            hasPkexec: () => false,
            beforeHandoff: async () => { handedOff++; },
        });
        assert.equal(manualResult.status, 'manual');
        assert.equal(handedOff, 0, 'a manual-only outcome never reaches the handoff');
        assert.equal(manualResult.quitRequired, false);
        assert.ok(manualResult.manual.startsWith('sudo dpkg -i '), manualResult.manual);
        assert.ok(manualResult.manual.endsWith('educationperfected_2026.11.30_amd64.deb'));
        assert.equal(fs.readFileSync(manualResult.file).toString(), 'fake installer payload', 'verified package kept for the manual command');

        const calls = [];
        const okResult = await appUpdate.applyAppUpdate(plan, {
            method: 'deb', platform: 'linux', arch: 'x64', stagingParent: parent,
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            hasPkexec: () => true,
            spawnSync: (command, args) => { calls.push([command, args]); return { status: 0 }; },
        });
        assert.equal(okResult.status, 'updated');
        assert.equal(okResult.quitRequired, true);
        assert.equal(calls[0][0], 'pkexec');
        assert.deepEqual(calls[0][1].slice(0, 2), ['dpkg', '-i']);

        // A dismissed pkexec prompt (126/127) means the package manager never
        // ran: nothing changed.
        const rpmPlan = appUpdate.planAppUpdate({ method: 'rpm', arch: 'arm64', currentVersion: '2026.11.21', releases: fullRelease('v2026.11.30', '2026.11.30') });
        const cancelLog = [];
        const cancelResult = await appUpdate.applyAppUpdate(rpmPlan, {
            method: 'rpm', platform: 'linux', arch: 'arm64', stagingParent: parent,
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            hasPkexec: () => true,
            spawnSync: () => ({ status: 126 }),
            write: line => cancelLog.push(line),
        });
        assert.equal(cancelResult.status, 'failed');
        assert.equal(cancelResult.quitRequired, false);
        assert.ok(cancelResult.manual.startsWith('sudo rpm -U '), cancelResult.manual);
        assert.ok(cancelResult.manual.endsWith('educationperfected-2026.11.30-1.aarch64.rpm'));
        assert.ok(cancelLog.some(line => line.includes('dismissed') && line.includes('nothing changed')), cancelLog.join(' | '));

        // A package-manager failure may have partly installed: the message
        // says so instead of claiming nothing changed.
        const failLog = [];
        const failResult = await appUpdate.applyAppUpdate(plan, {
            method: 'deb', platform: 'linux', arch: 'x64', stagingParent: parent,
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            hasPkexec: () => true,
            spawnSync: () => ({ status: 1 }),
            write: line => failLog.push(line),
        });
        assert.equal(failResult.status, 'failed');
        assert.ok(failLog.some(line => line.includes('may be partly installed')), failLog.join(' | '));

        // A staging path with spaces is shell-quoted in the manual command.
        const spaced = fs.mkdtempSync(path.join(os.tmpdir(), 'ep update test '));
        const spacedResult = await appUpdate.applyAppUpdate(plan, {
            method: 'deb', platform: 'linux', arch: 'x64', stagingParent: spaced,
            fetchImpl: fakeFetch(fullRelease('v2026.11.30', '2026.11.30')),
            hasPkexec: () => false,
        });
        assert.ok(spacedResult.manual.includes("'"), 'spaced path quoted: ' + spacedResult.manual);
        assert.ok(spacedResult.manual.startsWith('sudo dpkg -i '), spacedResult.manual);
        fs.rmSync(spaced, { recursive: true, force: true });
        fs.rmSync(parent, { recursive: true, force: true });
        console.log('ok linux package handoff');
    }

    // A checksum mismatch discards the download before any handoff.
    {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-update-test-'));
        const corrupt = fullRelease('v2026.11.30', '2026.11.30');
        corrupt[0].assets.find(a => a.name === update.SUMS_NAME)._bytes = Buffer.from(sha256(Buffer.from('other bytes')) + '  educationperfected-windows-x64-setup.exe\n');
        const plan = appUpdate.planAppUpdate({ method: 'setup-exe', arch: 'x64', currentVersion: '2026.11.21', releases: corrupt });
        let spawned = 0;
        await assert.rejects(() => appUpdate.applyAppUpdate(plan, {
            method: 'setup-exe', platform: 'win32', pid: 1, stagingParent: parent, receipt: path.join(parent, 'r'),
            fetchImpl: fakeFetch(corrupt), spawnDetached: () => { spawned++; },
        }), /checksum mismatch/);
        assert.equal(spawned, 0, 'no handoff on a failed verification');
        assert.equal(fs.readdirSync(parent).length, 0, 'staging cleaned after a failed verification');
        fs.rmSync(parent, { recursive: true, force: true });
        console.log('ok verification precedes any handoff');
    }

    // update.js exposes the shared selection/verification helpers this reuses.
    for (const name of ['latestStableRelease', 'checkAssetUrl', 'stageVerifiedAsset']) assert.equal(typeof update[name], 'function', name);
    console.log('ok shared updater helpers');

    console.log('Desktop app update contract passed (offline fixtures only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
