// Local documentation contracts. No network or product runs.
const assert = require('node:assert/strict');
const realFs = require('node:fs');
const path = require('node:path');
function checkDocs(fs = realFs) {
    const root = path.join(__dirname, '..');
    const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    const main = read('README.md');
    assert.ok(main.split('\n').length < 120, 'README is a short entry point');
    for (const file of ['docs/README.md', 'docs/install-and-update.md', 'docs/usage.md']) assert.ok([...main.matchAll(/\]\(([^)]+)\)/g)].some(match => match[1].split('#')[0] === file), `README links ${file}`);
    const install = read('docs/install-and-update.md'), usage = read('docs/usage.md');
    for (const platform of ['Windows', 'macOS', 'Linux']) assert.ok(install.includes(`**${platform}:**`), `installer steps for ${platform}`);
    const sourceSetup = install.split('### From a source ZIP or checkout\n')[1]?.split('\n## ')[0] || '';
    assert.match(sourceSetup, /new folder[\s\S]*?```sh\nnpm ci\nnpm run app\n```/, 'short fresh ZIP app steps');
    assert.match(usage, /desktop app has no browser-page control panel/i);
    assert.match(usage, /top-right/);
    assert.doesNotMatch(usage, /bottom-right/);
    assert.ok(usage.includes('on/off toggles and separate Read buttons'));
    for (const file of ['README.md', 'docs/README.md', 'docs/install-and-update.md', 'docs/usage.md', 'docs/developer-guide.md']) {
        for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
            const [target, fragment] = match[1].split('#');
            if (target.includes('://') || target.startsWith('mailto:')) continue;
            const destination = path.resolve(root, path.dirname(file), target || path.basename(file));
            assert.ok(fs.existsSync(destination), `${file}: ${target}`);
            if (fragment && path.extname(destination) === '.md') {
                const headings = [...fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n').matchAll(/^#{1,6} (.+)$/gm)].map(heading =>
                    heading[1].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-'));
                assert.ok(headings.includes(decodeURIComponent(fragment)), `${file}: ${match[1]}`);
            }
        }
    }
}
module.exports = { checkDocs };
if (require.main === module) {
    checkDocs();
    console.log('Docs: entry points, platform setup, fresh ZIP steps, CLI-only panel and local links pass.');
}
