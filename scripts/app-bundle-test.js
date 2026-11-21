// App payload layout contract, with a synthetic Electron distribution: the
// builder never downloads Electron or touches a real browser in this test.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { buildApp } = require('../packaging/build-app');
const root = path.resolve(__dirname, '..');

function fakeDist() {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-fake-electron-'));
    fs.writeFileSync(path.join(dist, 'LICENSE'), 'fake electron license');
    fs.writeFileSync(path.join(dist, 'LICENSES.chromium.html'), '<html>chromium</html>');
    fs.writeFileSync(path.join(dist, 'electron'), 'fake electron binary');
    fs.mkdirSync(path.join(dist, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'resources', 'default_app.asar'), 'default');
    return dist;
}

function fakeMacDist() {
    const dist = fakeDist();
    const contents = path.join(dist, 'Electron.app', 'Contents');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'MacOS', 'Electron'), 'fake mac binary');
    fs.writeFileSync(path.join(contents, 'Resources', 'default_app.asar'), 'default');
    fs.writeFileSync(path.join(contents, 'Resources', 'electron.icns'), 'icon');
    fs.writeFileSync(path.join(contents, 'Info.plist'), [
        '<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0"><dict>',
        '\t<key>CFBundleExecutable</key>\n\t<string>Electron</string>',
        '\t<key>CFBundleDisplayName</key>\n\t<string>Electron</string>',
        '\t<key>CFBundleName</key>\n\t<string>Electron</string>',
        '\t<key>CFBundleIdentifier</key>\n\t<string>com.github.Electron</string>',
        '\t<key>CFBundleIconFile</key>\n\t<string>electron.icns</string>',
        '\t<key>CFBundleShortVersionString</key>\n\t<string>45.4.1</string>',
        '\t<key>CFBundleVersion</key>\n\t<string>45.4.1</string>',
        '</dict></plist>',
    ].join('\n'));
    return dist;
}

function assertAppResources(appDir, version) {
    for (const file of ['main.cjs', 'preload.js', 'package.json', path.join('renderer', 'index.html'), path.join('..', 'branding', 'icon-256.png')]) {
        assert.ok(fs.statSync(path.join(appDir, file)).isFile(), 'app resource missing: ' + file);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'main.cjs');
    assert.equal(manifest.productName, 'EducationPerfected');
    assert.equal(manifest.version, version);
    // The bundled main must not reference the source tree, and the native
    // credential-store binding rides along unbundled.
    const bundle = fs.readFileSync(path.join(appDir, 'main.cjs'), 'utf8');
    assert.ok(!bundle.includes(root), 'bundle references the source tree');
    assert.ok(fs.statSync(path.join(appDir, 'node_modules', '@napi-rs', 'keyring', 'package.json')).isFile());
    assert.ok(fs.readdirSync(path.join(appDir, 'node_modules', '@napi-rs')).some(name => name.startsWith('keyring-')));
}

(async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-app-payload-'));
    const notices = path.join(out, 'THIRD-PARTY-NOTICES');
    fs.mkdirSync(notices, { recursive: true });

    const linuxPayload = await buildApp({ root, out: path.join(out, 'linux'), version: '2026.11.21', platform: 'linux', dist: fakeDist(), notices });
    assert.ok(fs.statSync(path.join(linuxPayload, 'educationperfected-app')).isFile(), 'linux app executable renamed');
    assert.ok(!fs.existsSync(path.join(linuxPayload, 'resources', 'default_app.asar')), 'default app removed');
    assertAppResources(path.join(linuxPayload, 'resources', 'app'), '2026.11.21');
    console.log('ok linux app payload layout');

    const macPayload = await buildApp({ root, out: path.join(out, 'mac'), version: '2026.11.21', platform: 'darwin', dist: fakeMacDist(), notices });
    const contents = path.join(macPayload, 'EducationPerfected.app', 'Contents');
    assert.ok(fs.statSync(path.join(contents, 'MacOS', 'EducationPerfected')).isFile(), 'mac binary renamed');
    assert.ok(fs.statSync(path.join(contents, 'Resources', 'educationperfected.icns')).isFile(), 'mac icon installed');
    assert.ok(!fs.existsSync(path.join(contents, 'Resources', 'electron.icns')), 'electron icon removed');
    const plist = fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8');
    for (const expected of ['<string>EducationPerfected</string>', '<string>com.404pf.educationperfected</string>', '<string>educationperfected.icns</string>', '<string>2026.11.21</string>']) {
        assert.ok(plist.includes(expected), 'plist missing ' + expected);
    }
    assert.ok(!plist.includes('<string>Electron</string>'), 'plist keeps no Electron names');
    assertAppResources(path.join(contents, 'Resources', 'app'), '2026.11.21');
    console.log('ok macos app bundle layout');

    // A plist without an expected key fails the build closed.
    const broken = fakeMacDist();
    fs.writeFileSync(path.join(broken, 'Electron.app', 'Contents', 'Info.plist'), '<plist><dict></dict></plist>');
    await assert.rejects(() => buildApp({ root, out: path.join(out, 'broken'), version: '2026.11.21', platform: 'darwin', dist: broken }), /Info.plist lacks the expected/);
    console.log('ok unexpected plist fails closed');

    for (const name of ['ELECTRON-LICENSE.txt', 'ELECTRON-LICENSES-CHROMIUM.html', 'ELECTRON-VERSION.txt']) {
        assert.ok(fs.statSync(path.join(notices, name)).isFile(), 'notice missing: ' + name);
    }
    await assert.rejects(() => buildApp({ root, out: path.join(out, 'badversion'), version: 'x', platform: 'linux', dist: fakeDist() }), /version must be numeric parts/);
    console.log('ok electron notices and version validation');

    fs.rmSync(out, { recursive: true, force: true });
    console.log('Desktop app payload layout contract passed (synthetic Electron only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
