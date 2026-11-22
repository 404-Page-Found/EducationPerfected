// In-app update for the installed desktop app. The app downloads the SAME OS
// installer the release publishes (setup exe / pkg / deb / rpm), verifies it
// against the release's SHA256SUMS - the integrity model of packaging/update.js,
// whose selection and verification helpers this reuses - then hands the update
// to that installer and closes. The installer upgrades the app and the CLI
// together under each OS's own privilege model (per-user on Windows, the OS
// installer or package manager elsewhere), so the app never swaps files in
// place against root-owned install locations, which is why the CLI's own
// update command refuses those methods.
// Never tags, uploads or publishes anything; release publication stays a
// separate owner-approved act.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const update = require('./update');
const { shellQuote } = require('./app-maintenance');

// The installer asset each install method updates through. The Windows setup
// exe and the macOS .pkg are per-arch fixed names; the Linux package names
// embed the release version (they come from build-packages.sh).
function installerAssetName({ method, arch = process.arch, version } = {}) {
    switch (method) {
        case 'setup-exe':
            return 'educationperfected-windows-x64-setup.exe';
        case 'pkg':
            if (arch !== 'arm64' && arch !== 'x64') throw new Error('Unsupported update architecture ' + arch);
            return 'educationperfected-macos-' + arch + '.pkg';
        case 'deb':
            if (!version) throw new Error('The deb asset name needs the release version');
            if (arch === 'x64') return 'educationperfected_' + version + '_amd64.deb';
            if (arch === 'arm64') return 'educationperfected_' + version + '_arm64.deb';
            throw new Error('Unsupported update architecture ' + arch);
        case 'rpm':
            if (!version) throw new Error('The rpm asset name needs the release version');
            if (arch === 'x64') return 'educationperfected-' + version + '-1.x86_64.rpm';
            if (arch === 'arm64') return 'educationperfected-' + version + '-1.aarch64.rpm';
            throw new Error('Unsupported update architecture ' + arch);
        default:
            throw new Error('This install method has no OS installer to update through: ' + method);
    }
}

// Pick the newest stable release strictly newer than currentVersion and plan
// the installer download from it. Mirrors update.selectUpdatePlan, with the
// installer asset chosen by install method instead of the raw CLI binary.
function planAppUpdate({ method, arch = process.arch, currentVersion, releases }) {
    const current = update.parseStableVersion(currentVersion);
    if (!current) throw new Error('Unrecognized current version ' + currentVersion);
    const best = update.latestStableRelease(releases);
    if (!best) return { newer: false, latest: null };
    if (update.compareVersions(best.parsed, current) <= 0) return { newer: false, latest: best.parsed.version };
    const tag = best.release.tag_name;
    const name = installerAssetName({ method, arch, version: best.parsed.version });
    const assets = Array.isArray(best.release.assets) ? best.release.assets : [];
    const find = assetName => assets.find(asset => asset && asset.name === assetName && typeof asset.browser_download_url === 'string');
    const asset = find(name), sums = find(update.SUMS_NAME);
    if (!asset) throw new Error('Release ' + tag + ' has no asset ' + name + ' for this install method');
    if (!sums) throw new Error('Release ' + tag + ' has no ' + update.SUMS_NAME);
    return {
        newer: true,
        version: best.parsed.version,
        tag,
        asset: { name, url: update.checkAssetUrl(asset.browser_download_url, tag, name), size: Number.isInteger(asset.size) && asset.size >= 0 ? asset.size : null },
        sums: { name: update.SUMS_NAME, url: update.checkAssetUrl(sums.browser_download_url, tag, update.SUMS_NAME) },
    };
}

const RELEASE_HEADERS = { 'User-Agent': 'educationperfected-update', 'Accept': 'application/vnd.github+json' };

async function fetchAppUpdatePlan({ method, arch = process.arch, currentVersion, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Network fetch unavailable in this Node runtime');
    const response = await fetchImpl(update.RELEASES_API, { headers: RELEASE_HEADERS, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Release check failed (HTTP ' + response.status + ')');
    return planAppUpdate({ method, arch, currentVersion, releases: await response.json() });
}

// cmd.exe helper, same pattern as the CLI's own Windows update helper: the
// running app cannot be replaced, so a background helper waits for the app
// process to exit, runs the verified installer silently, records a one-line
// receipt the next app launch reports, then removes the staging directory and
// itself. Paths containing % or ! are rejected: cmd would expand them.
function windowsInstallerHelperScript({ installer, staging, receipt, version, pid }) {
    for (const value of [installer, staging, receipt]) {
        if (/[%!]/.test(value)) throw new Error('Update paths must not contain % or ! on Windows');
    }
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('The installer helper needs the app process id');
    return [
        '@echo off',
        // cmd reads batch files in the console OEM code page; without this a
        // non-ASCII profile path decodes wrong and no longer matches the file.
        'chcp 65001 >nul',
        'setlocal',
        'set "PKG=' + installer + '"',
        'set "RECEIPT=' + receipt + '"',
        'set tries=0',
        ':wait',
        'tasklist /FI "PID eq ' + pid + '" | find "' + pid + '" >nul 2>&1',
        'if not errorlevel 1 (',
        '  set /a tries+=1',
        '  if %tries% geq 180 goto locked',
        '  ping -n 2 127.0.0.1 >nul',
        '  goto wait',
        ')',
        '"%PKG%" /SILENT /SUPPRESSMSGBOXES /NORESTART',
        'if errorlevel 1 goto failed',
        'echo ok ' + version + '>"%RECEIPT%"',
        'goto cleanup',
        ':failed',
        'echo failed installer-exit-error>"%RECEIPT%"',
        'goto cleanup',
        ':locked',
        'echo failed app-still-running>"%RECEIPT%"',
        ':cleanup',
        'rmdir /s /q "' + staging + '" >nul 2>&1',
        '(goto) 2>nul & del "%~f0" >nul 2>&1',
        '',
    ].join('\r\n');
}

// The helper lives OUTSIDE the staging directory it removes: cmd reads batch
// files lazily and a script cannot reliably delete its own folder.
function startWindowsInstallerHelper({ installer, staging, receipt, version, pid, spawnDetached }) {
    const helper = staging + '.cmd';
    fs.writeFileSync(helper, windowsInstallerHelperScript({ installer, staging, receipt, version, pid }), { mode: 0o700 });
    spawnDetached(process.env.ComSpec || 'cmd.exe', ['/c', helper]);
    return helper;
}

// macOS: open the verified .pkg in the OS Installer (it elevates itself and
// installs over /Applications/EducationPerfected.app and /usr/local/bin), and
// remove the staging directory once the Installer window closes.
function macosInstallerCommand({ installer, staging }) {
    return { command: 'sh', args: ['-c', 'open -W "$1"; rm -rf "$2"', 'sh', installer, staging] };
}

// Linux: the package manager replaces the root-owned payload, so the command
// runs through pkexec (the desktop's elevation prompt) when it exists.
function linuxInstallCommand({ method, file }) {
    if (method === 'deb') return ['dpkg', '-i', file];
    if (method === 'rpm') return ['rpm', '-U', file];
    throw new Error('This install method has no Linux package to update through: ' + method);
}

// The install itself runs through spawnSync: the window is
// already in its terminal "installing / closing" state while the desktop's
// password prompt or package manager runs, and the app closes right after a
// successful install.
function detectPkexec(spawnSync) {
    try {
        const result = spawnSync('pkexec', ['--help'], { stdio: 'ignore' });
        return !result.error;
    } catch { return false; }
}

// Download the planned installer, verify it against the release SHA256SUMS
// BEFORE anything is handed off, then start the per-OS handoff. The result
// tells the caller whether the app must close (quitRequired) and, on Linux
// without pkexec, the exact manual command to show.
async function applyAppUpdate(plan, {
    method,
    platform = process.platform,
    arch = process.arch,
    pid = process.pid,
    stagingParent = os.tmpdir(),
    receipt,
    fetchImpl = globalThis.fetch,
    spawnDetached = (command, args) => require('./windows-helper-spawn').spawnBackgroundHelper(command, args),
    spawnSync = require('node:child_process').spawnSync,
    hasPkexec,
    beforeHandoff = async () => {},
    write = () => {},
} = {}) {
    const staging = fs.mkdtempSync(path.join(stagingParent, '.educationperfected-app-update-'));
    fs.chmodSync(staging, 0o700);
    let helperOwned = false, keepStaging = false;
    try {
        const staged = await update.stageVerifiedAsset(plan, staging, fetchImpl, RELEASE_HEADERS, write);
        // Linux without desktop elevation never touches the installed files,
        // so the browser session stays open and the window keeps showing the
        // outcome; every real handoff closes the session first.
        if (platform === 'linux' && !(typeof hasPkexec === 'function' ? hasPkexec() : detectPkexec(spawnSync))) {
            const command = linuxInstallCommand({ method, file: staged });
            const manual = 'sudo ' + command.map(shellQuote).join(' ');
            keepStaging = true; // the verified package stays for the manual command
            write('Administrator rights are needed and no desktop elevation tool (pkexec) was found. The verified package is kept at ' + staged + '. Run: ' + manual + ' - then relaunch the app.');
            return { status: 'manual', quitRequired: false, manual, file: staged };
        }
        await beforeHandoff();
        if (platform === 'win32') {
            if (!receipt) throw new Error('The Windows installer helper needs a receipt path');
            startWindowsInstallerHelper({ installer: staged, staging, receipt, version: plan.version, pid, spawnDetached });
            helperOwned = true; // staging and the helper script belong to the helper now
            write('The verified installer starts when the app closes and upgrades the app and the CLI together.');
            return { status: 'installer-started', quitRequired: true, version: plan.version };
        }
        if (platform === 'darwin') {
            const handoff = macosInstallerCommand({ installer: staged, staging });
            spawnDetached(handoff.command, handoff.args);
            helperOwned = true; // the shell removes staging when the Installer closes
            write('The verified installer package opens in the macOS Installer and upgrades the app and the CLI together.');
            return { status: 'installer-opened', quitRequired: true, version: plan.version };
        }
        if (platform === 'linux') {
            const command = linuxInstallCommand({ method, file: staged });
            const manual = 'sudo ' + command.map(shellQuote).join(' ');
            write('Installing the verified package; the desktop asks for your password.');
            const result = spawnSync('pkexec', command, { stdio: 'ignore' });
            if (result.error || result.status !== 0) {
                keepStaging = true;
                // pkexec 126/127: the authentication was dismissed or failed, so
                // the package manager never ran. Any other failure came FROM the
                // package manager, which may have partly installed the update.
                const cancelled = !result.error && (result.status === 126 || result.status === 127);
                write(cancelled
                    ? 'The password prompt was dismissed; nothing changed. The verified package is kept at ' + staged + '. Run it by hand: ' + manual
                    : 'The package manager reported a failure; the update may be partly installed. The verified package is kept at ' + staged + ' - inspect it with your package manager or run it by hand: ' + manual);
                return { status: 'failed', quitRequired: false, manual, file: staged };
            }
            write('Updated to ' + plan.version + '. The app closes now; relaunch it from your applications menu.');
            return { status: 'updated', quitRequired: true, version: plan.version };
        }
        throw new Error('Unsupported update platform ' + platform + '-' + arch);
    } finally {
        if (!helperOwned && !keepStaging) {
            fs.rmSync(staging, { recursive: true, force: true });
            fs.rmSync(staging + '.cmd', { force: true });
        }
    }
}

module.exports = { installerAssetName, planAppUpdate, fetchAppUpdatePlan, applyAppUpdate, windowsInstallerHelperScript, startWindowsInstallerHelper, macosInstallerCommand, linuxInstallCommand, detectPkexec, RELEASE_HEADERS };
