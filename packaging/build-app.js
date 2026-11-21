// Desktop app payload builder: lays out the host platform's Electron
// distribution with the bundled EducationPerfected app over it. Pure file
// layout on the native build host - no cross-building, no signing, no
// distribution authority. The payload is embedded in the per-OS installers
// (setup exe / pkg / deb / rpm); it is never a release asset on its own.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const esbuild = require('esbuild');

const APP_NAME = 'EducationPerfected';
const APP_IDENTIFIER = 'com.404pf.educationperfected';

// Electron's postinstall downloads the host dist; CI installs with
// --ignore-scripts, so materialize it explicitly when absent. The version and
// integrity come from the pinned npm package (@electron/get verifies the
// release SHASUMS256).
function electronDist(root) {
    const dist = path.join(root, 'node_modules', 'electron', 'dist');
    if (!fs.existsSync(dist)) {
        const result = cp.spawnSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' });
        if (result.error || result.status !== 0) throw new Error('Electron distribution download failed');
    }
    if (!fs.existsSync(dist)) throw new Error('Electron distribution is missing after install');
    return dist;
}

// The app resources: bundled main process plus the files the window loads by
// path. main.js keeps its source-checkout '../branding' icon path, so the
// icon sits one level above the app resources here too.
async function writeAppResources(root, appDir, version) {
    fs.mkdirSync(appDir, { recursive: true });
    await esbuild.build({
        entryPoints: [path.join(root, 'app', 'main.js')], bundle: true, platform: 'node', format: 'cjs',
        outfile: path.join(appDir, 'main.cjs'), external: ['electron', 'keytar', '@napi-rs/keyring'],
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.copyFileSync(path.join(root, 'app', 'preload.js'), path.join(appDir, 'preload.js'));
    fs.cpSync(path.join(root, 'app', 'renderer'), path.join(appDir, 'renderer'), { recursive: true });
    const brandingDir = path.join(appDir, '..', 'branding');
    fs.mkdirSync(brandingDir, { recursive: true });
    fs.copyFileSync(path.join(root, 'branding', 'icon-256.png'), path.join(brandingDir, 'icon-256.png'));
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
        name: 'educationperfected-app', version, private: true, productName: APP_NAME, main: 'main.cjs',
    }, null, 2) + '\n');
    // The native credential-store binding: the base package plus whichever
    // platform binary npm installed on this native host.
    const napiSource = path.join(root, 'node_modules', '@napi-rs');
    const napiOut = path.join(appDir, 'node_modules', '@napi-rs');
    fs.mkdirSync(napiOut, { recursive: true });
    const packages = fs.readdirSync(napiSource).filter(name => name === 'keyring' || name.startsWith('keyring-'));
    if (!packages.includes('keyring') || !packages.some(name => name.startsWith('keyring-'))) throw new Error('Native credential-store binding is missing');
    for (const name of packages) fs.cpSync(path.join(napiSource, name), path.join(napiOut, name), { recursive: true });
}

// One asserted Info.plist substitution; a missing key fails the build closed.
function replacePlistValue(plist, key, from, to) {
    const pattern = new RegExp('(<key>' + key + '</key>\\s*<string>)' + from + '(</string>)');
    if (!pattern.test(plist)) throw new Error('Electron Info.plist lacks the expected ' + key + ' entry');
    return plist.replace(pattern, '$1' + to + '$2');
}

function finishMacosBundle(bundle, root, version) {
    const contents = path.join(bundle, 'Contents');
    fs.renameSync(path.join(contents, 'MacOS', 'Electron'), path.join(contents, 'MacOS', APP_NAME));
    fs.copyFileSync(path.join(root, 'branding', 'educationperfected.icns'), path.join(contents, 'Resources', 'educationperfected.icns'));
    const plistPath = path.join(contents, 'Info.plist');
    let plist = fs.readFileSync(plistPath, 'utf8');
    plist = replacePlistValue(plist, 'CFBundleExecutable', 'Electron', APP_NAME);
    plist = replacePlistValue(plist, 'CFBundleDisplayName', 'Electron', APP_NAME);
    plist = replacePlistValue(plist, 'CFBundleName', 'Electron', APP_NAME);
    plist = replacePlistValue(plist, 'CFBundleIdentifier', 'com\\.github\\.Electron', APP_IDENTIFIER);
    plist = replacePlistValue(plist, 'CFBundleIconFile', 'electron\\.icns', 'educationperfected.icns');
    plist = replacePlistValue(plist, 'CFBundleShortVersionString', '[^<]*', version);
    plist = replacePlistValue(plist, 'CFBundleVersion', '[^<]*', version);
    fs.writeFileSync(plistPath, plist);
    fs.rmSync(path.join(contents, 'Resources', 'default_app.asar'), { force: true });
    fs.rmSync(path.join(contents, 'Resources', 'electron.icns'), { force: true });
}

// Build the payload into <out>/app-payload: a directory tree (Windows/Linux)
// or EducationPerfected.app (macOS), ready for the installer scripts.
async function buildApp({ root = path.resolve(__dirname, '..'), out, version = require(path.join(root, 'package.json')).version, platform = process.platform, dist, notices } = {}) {
    if (!out) throw new Error('buildApp requires an output directory');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('App payload version must be numeric parts');
    dist ||= electronDist(root);
    const payload = path.join(out, 'app-payload');
    fs.rmSync(payload, { recursive: true, force: true });
    fs.mkdirSync(payload, { recursive: true });
    let appDir;
    if (platform === 'darwin') {
        const bundle = path.join(payload, APP_NAME + '.app');
        fs.cpSync(path.join(dist, 'Electron.app'), bundle, { recursive: true, verbatimSymlinks: true });
        appDir = path.join(bundle, 'Contents', 'Resources', 'app');
        await writeAppResources(root, appDir, version);
        finishMacosBundle(bundle, root, version);
    } else if (platform === 'win32' || platform === 'linux') {
        fs.cpSync(dist, payload, { recursive: true, verbatimSymlinks: true });
        appDir = path.join(payload, 'resources', 'app');
        await writeAppResources(root, appDir, version);
        fs.rmSync(path.join(payload, 'resources', 'default_app.asar'), { force: true });
        if (platform === 'win32') {
            const executable = path.join(payload, APP_NAME + '.exe');
            fs.renameSync(path.join(payload, 'electron.exe'), executable);
            require('./windows-icon').applyWindowsIcon(executable, path.join(root, 'branding', 'educationperfected.ico'), version);
        } else {
            fs.renameSync(path.join(payload, 'electron'), path.join(payload, 'educationperfected-app'));
        }
    } else {
        throw new Error('Unsupported app payload platform: ' + platform);
    }
    // Electron's own notices ride with the payload's THIRD-PARTY-NOTICES set.
    if (notices) {
        fs.copyFileSync(path.join(dist, 'LICENSE'), path.join(notices, 'ELECTRON-LICENSE.txt'));
        fs.copyFileSync(path.join(dist, 'LICENSES.chromium.html'), path.join(notices, 'ELECTRON-LICENSES-CHROMIUM.html'));
        fs.writeFileSync(path.join(notices, 'ELECTRON-VERSION.txt'), 'Electron ' + require(path.join(root, 'node_modules', 'electron', 'package.json')).version + ' binary distribution, from the pinned npm electron package. Unmodified except the app-name and icon substitutions described in the developer guide.\n');
    }
    console.log('App payload: ' + payload);
    return payload;
}

if (require.main === module) {
    const [target, out] = process.argv.slice(2);
    const platforms = { 'linux-x64': 'linux', 'linux-arm64': 'linux', 'windows-x64': 'win32', 'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
    if (!platforms[target] || !out || process.argv.length !== 4) throw new Error('Usage: build-app.js <target> <downloadable-build-directory>');
    const expected = { linux: 'linux', win32: 'win32', darwin: 'darwin' }[platforms[target]];
    if (process.platform !== expected) throw new Error('App payload requires its native build host');
    buildApp({ out, platform: platforms[target], notices: path.join(out, 'THIRD-PARTY-NOTICES') })
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { buildApp };
