// Fixed repository assets only; no builds or external tools.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const branding = path.join(__dirname, '../branding');

// Source asset: the owner's SVG, kept verbatim as the design source.
const svg = fs.readFileSync(path.join(branding, 'educationperfected-logo.svg'), 'utf8');
for (const required of ['<svg', 'viewBox="0 0 1024 1024"', 'x="164" y="162" width="696" height="698"', 'rx="170"', 'linearGradient', 'feDropShadow']) assert.ok(svg.includes(required), required);

// Derived rasters: exact sizes, real PNGs with an alpha channel.
for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
 const file = path.join(branding, 'icon-' + n + '.png');
 const data = fs.readFileSync(file);
 assert.equal(data.readUInt32BE(0), 0x89504e47, file);
 assert.equal(data.readUInt32BE(16), n, file + ' width');
 assert.equal(data.readUInt32BE(20), n, file + ' height');
 assert.equal(data[25], 6, file + ' must be RGBA');
}

// Windows .ico: seven PNG-compressed entries, 16 through 256.
const ico = fs.readFileSync(path.join(branding, 'educationperfected.ico'));
assert.equal(ico.readUInt16LE(0), 0, 'ico reserved');
assert.equal(ico.readUInt16LE(2), 1, 'ico type');
assert.equal(ico.readUInt16LE(4), 7, 'ico entry count');
const icoSizes = [];
for (let i = 0; i < 7; i++) {
 const off = 6 + 16 * i;
 const w = ico[off] || 256, h = ico[off + 1] || 256;
 assert.equal(h, w, 'ico entry ' + i + ' must be square');
 icoSizes.push(w);
 const imageOffset = ico.readUInt32LE(off + 12);
 assert.equal(ico.readUInt32BE(imageOffset), 0x89504e47, 'ico entry ' + i + ' is a PNG');
 assert.equal(ico.readUInt32BE(imageOffset + 16), w, 'ico entry ' + i + ' PNG width matches its directory entry');
 assert.equal(ico.readUInt32BE(imageOffset + 20), h, 'ico entry ' + i + ' PNG height matches its directory entry');
}
assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256]);

// macOS .icns: container magic and the expected PNG entries.
const icns = fs.readFileSync(path.join(branding, 'educationperfected.icns'));
assert.equal(icns.toString('ascii', 0, 4), 'icns', 'icns magic');
for (const tag of ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10']) assert.ok(icns.includes(tag), tag);

// Inno wizard artwork: BMPs at Inno's modern-style dimensions.
for (const [name, w, h] of [['wizard-image.bmp', 164, 314], ['wizard-small.bmp', 55, 55]]) {
 const data = fs.readFileSync(path.join(__dirname, '../installer', name));
 assert.equal(data.toString('ascii', 0, 2), 'BM', name);
 assert.equal(data.readUInt32LE(18), w, name + ' width');
 assert.equal(data.readUInt32LE(22), h, name + ' height');
}

// Installer wiring: the setup exe, wizard and Settings entry use the icon.
const iss = fs.readFileSync(path.join(__dirname, '../installer/windows-setup.iss'), 'utf8');
for (const required of ['SetupIconFile=..\\branding\\educationperfected.ico', 'WizardImageFile=wizard-image.bmp', 'WizardSmallImageFile=wizard-small.bmp', 'UninstallDisplayIcon={app}\\educationperfected.exe']) assert.ok(iss.includes(required), required);

// Build wiring: the Windows SEA executables get the icon after postject.
const builder = fs.readFileSync(path.join(__dirname, '../packaging/build-development.js'), 'utf8');
assert.ok(builder.includes("require('./windows-icon').applyWindowsIcon"), 'builder applies the icon');
assert.ok(builder.includes("endsWith('.exe')"), 'icon step is Windows-only');
const windowsPostject = builder.indexOf("cp.execFileSync(process.execPath, [require.resolve('postject");
assert.ok(windowsPostject !== -1, 'Windows postject injection call found');
assert.ok(windowsPostject < builder.indexOf("require('./windows-icon')"), 'icon is the final exe mutation');
const iconStep = fs.readFileSync(path.join(__dirname, '../packaging/windows-icon.js'), 'utf8');
for (const required of ['IconGroupEntry', 'replaceIconsForResource', 'VersionInfo', '404-Page-Found']) assert.ok(iconStep.includes(required), required);
assert.ok(require('../package.json').devDependencies.resedit, 'resedit is a dev dependency');

assert.ok(require('../package.json').scripts['test:phase3'].includes('branding-icon-test.js'), 'wired into test:phase3');
console.log('Branding: SVG source kept, PNG/.ico/.icns derived, Windows exe + Inno installer wired to the icon.');
