// Offline regression for CLI-only Windows upgrades that used to leave the
// v2026.11.16 Start-menu launcher pointing at the CLI. No installer is executed.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const update = require('../packaging/update');
const appUpdate = require('../packaging/app-update');

const version = '2026.11.22';
const assetName = 'educationperfected-windows-x64-setup.exe';
const bytes = Buffer.from('inert Windows setup fixture');
const hash = createHash('sha256').update(bytes).digest('hex');
const url = name => 'https://github.com/404-Page-Found/EducationPerfected/releases/download/v' + version + '/' + name;
const releases = [{ tag_name: 'v' + version, assets: [assetName, update.SUMS_NAME].map(name => ({ name, size: bytes.length, browser_download_url: url(name) })) }];
const stream = value => new ReadableStream({ start(c) { c.enqueue(value); c.close(); } });

(async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-installed-update-'));
    const executable = path.join(home, 'educationperfected.exe');
    const desktop = path.join(home, 'app', 'EducationPerfected.exe');
    const record = path.join(home, 'educationperfected-install.json');
    const spawned = [], helpers = [], calls = [];
    fs.writeFileSync(executable, 'current CLI');
    fs.writeFileSync(record, JSON.stringify({ version: 1, method: 'setup-exe' }));
    const fetchImpl = async target => {
        calls.push(target);
        if (target === update.RELEASES_API) return { ok: true, json: async () => releases };
        if (target === url(update.SUMS_NAME)) return { ok: true, text: async () => hash + '  ' + assetName + '\n' };
        assert.equal(target, url(assetName), 'must download the installer, never a raw CLI');
        return { ok: true, body: stream(bytes) };
    };
    const base = {
        executable, packaged: true, platform: 'win32', arch: 'x64', currentVersion: '2026.11.16', fetchImpl,
        output: { write() {} }, confirm: async plan => { assert.equal(plan.installer, true); return true; },
        spawnDetached: (command, args) => { spawned.push([command, args]); helpers.push(args[1]); },
    };
    try {
        // A first-release setup migrates through the full installer. It never
        // swaps the running CLI or deletes an earlier raw-update backup.
        fs.writeFileSync(executable + '.backup', 'legacy backup');
        let result = await update.updateCommand(base);
        assert.equal(result.status, 'installer-started');
        assert.equal(result.quitRequired, true);
        assert.equal(fs.readFileSync(executable, 'utf8'), 'current CLI');
        assert.equal(fs.readFileSync(executable + '.backup', 'utf8'), 'legacy backup');
        assert.ok(fs.existsSync(executable + '.update.lock'), 'lock survives installer handoff');
        let script = fs.readFileSync(helpers.at(-1), 'utf8');
        assert.ok(script.includes(assetName));
        assert.ok(script.includes('del /q "' + executable + '.update.lock"'), 'helper owns lock cleanup');
        await assert.rejects(update.updateCommand(base), /Another update.*Close all EducationPerfected/s);
        fs.rmSync(executable + '.update.lock');
        assert.ok(script.includes('/SILENT /SUPPRESSMSGBOXES /NORESTART'));
        assert.ok(!script.includes('move /y'), 'installer handles the entire installation');

        // Already-raw-updated users can repair a same-version missing desktop.
        result = await update.updateCommand({ ...base, currentVersion: version });
        assert.equal(result.status, 'installer-started');
        fs.rmSync(executable + '.update.lock');
        // Once the desktop exists, equal versions are a true no-op.
        fs.mkdirSync(path.dirname(desktop)); fs.writeFileSync(desktop, 'desktop fixture');
        calls.length = 0;
        result = await update.updateCommand({ ...base, currentVersion: version, confirm: () => assert.fail('no prompt for current complete install') });
        assert.equal(result.status, 'up-to-date');
        assert.deepEqual(calls, [update.RELEASES_API]);
        // Newer CLI versions are never downgraded, even with no desktop.
        fs.rmSync(desktop);
        let missingMessage = '';
        result = await update.updateCommand({ ...base, currentVersion: '2026.12.1', output: { write: text => { missingMessage += text; } }, confirm: () => assert.fail('no downgrade') });
        assert.equal(result.status, 'desktop-missing');
        assert.match(missingMessage, /desktop app is missing/);
        assert.doesNotMatch(missingMessage, /Already up to date/);
        // Declining, noninteractive input and checksum failure never hand off.
        calls.length = 0;
        const count = spawned.length;
        result = await update.updateCommand({ ...base, confirm: async () => false });
        assert.equal(result.status, 'cancelled');
        assert.deepEqual(calls, [update.RELEASES_API]);
        await assert.rejects(update.updateCommand({ ...base, confirm: update.promptUpdate, input: { isTTY: false } }), /interactive/);
        await assert.rejects(update.updateCommand({ ...base, fetchImpl: async target => target === url(update.SUMS_NAME) ? { ok: true, text: async () => '0'.repeat(64) + '  ' + assetName + '\n' } : fetchImpl(target) }), /checksum mismatch/);
        await assert.rejects(update.updateCommand({ ...base, spawnDetached: () => { throw new Error('fixture spawn failure'); } }), /fixture spawn failure/);
        assert.equal(spawned.length, count);
        assert.ok(!fs.existsSync(executable + '.update.lock'));
        // Interrupted/concurrent updates refuse before confirmation/download.
        fs.writeFileSync(executable + '.update.lock', '');
        await assert.rejects(update.updateCommand({ ...base, confirm: () => assert.fail('lock first') }), /Another update/);
        fs.rmSync(executable + '.update.lock');
        // Legacy inference also chooses the installer when a record is absent.
        fs.rmSync(record); fs.writeFileSync(path.join(home, 'unins000.exe'), 'inert');
        result = await update.updateCommand(base);
        assert.equal(result.status, 'installer-started');
        fs.rmSync(executable + '.update.lock');
        // Repair is explicit and never permits a downgrade in shared planning.
        assert.equal(appUpdate.planAppUpdate({ method: 'setup-exe', currentVersion: version, releases, repair: true }).asset.name, assetName);
        assert.equal(appUpdate.planAppUpdate({ method: 'setup-exe', currentVersion: '2026.12.1', releases, repair: true }).newer, false);
        console.log('Windows setup CLI update: installer migration, equal-version desktop repair, no downgrade, consent, integrity, lock and legacy-backup contracts passed.');
    } finally {
        for (const helper of helpers) {
            fs.rmSync(helper.slice(0, -4), { recursive: true, force: true });
            fs.rmSync(helper, { force: true });
        }
        fs.rmSync(home, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
