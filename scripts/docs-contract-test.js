// Local documentation contracts. No network or product runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('README.md');
assert.ok(main.split('\n').length < 120, 'README is a short entry point');
for (const file of ['docs/README.md', 'docs/install-and-update.md', 'docs/usage.md']) assert.ok(main.includes(file), `README links ${file}`);
const install = read('docs/install-and-update.md'), usage = read('docs/usage.md');
for (const platform of ['Windows', 'macOS', 'Linux']) assert.ok(install.includes(`**${platform}:**`), `installer steps for ${platform}`);
assert.match(install, /new folder[\s\S]*npm ci\nnpm run app/, 'short fresh ZIP app steps');
assert.match(usage, /desktop app has no browser-page control panel/i);
assert.match(usage, /top-right/);
assert.doesNotMatch(usage, /bottom-right/);
assert.ok(usage.includes('on/off toggles and separate Read buttons'));
for (const file of ['README.md', 'docs/README.md', 'docs/install-and-update.md', 'docs/usage.md', 'docs/developer-guide.md']) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || target.includes('://') || target.startsWith('mailto:')) continue;
        assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: ${target}`);
    }
}
console.log('Docs: entry points, platform setup, fresh ZIP steps, CLI-only panel and local links pass.');
