// Windows setup installations update as a unit: CLI, Electron and shortcuts.
// Kept separate from the raw-executable updater; lazy-loaded to avoid a cycle
// through app-update's shared release/checksum helpers.
const fs = require('node:fs'), path = require('node:path');
const appUpdate = require('./app-update');
const update = require('./update');

async function updateWindowsInstall({ executable, currentVersion, arch, input, output, fetchImpl, confirm, spawnDetached }) {
    const write = line => output.write(line + '\n');
    const receipt = executable + '.update-result';
    if (fs.existsSync(receipt)) {
        write('Previous update result: ' + fs.readFileSync(receipt, 'utf8').trim());
        fs.rmSync(receipt, { force: true });
    }
    const desktop = path.join(path.dirname(executable), 'app', 'EducationPerfected.exe');
    const repair = !fs.existsSync(desktop);
    const response = await fetchImpl(update.RELEASES_API, { headers: appUpdate.RELEASE_HEADERS, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Release check failed (HTTP ' + response.status + ')');
    const plan = appUpdate.planAppUpdate({ method: 'setup-exe', arch, currentVersion, releases: await response.json(), repair });
    if (!plan.newer) {
        write(plan.latest ? 'Already up to date (version ' + currentVersion + ').' : 'No stable release found; nothing to update to.');
        return { status: 'up-to-date' };
    }
    plan.currentVersion = currentVersion;
    plan.installer = true;
    if (repair) write('The desktop app is missing. The full Windows installer will install it and repair the Start-menu launcher, even if the CLI version is already current.');
    const lock = executable + '.update.lock';
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        throw new Error('Another update is active or was interrupted. Lock: ' + lock);
    }
    try {
        if (!await confirm(plan, null, { input, output })) {
            write('Update cancelled; nothing changed.');
            return { status: 'cancelled' };
        }
        // A legacy raw update's .backup does not block the installer repair.
        // It is left untouched; no CLI files are swapped by this path.
        return await appUpdate.applyAppUpdate(plan, {
            method: 'setup-exe', platform: 'win32', arch, receipt,
            fetchImpl, spawnDetached, write,
        });
    } finally {
        fs.closeSync(fd);
        fs.rmSync(lock, { force: true });
    }
}
module.exports = { updateWindowsInstall };
