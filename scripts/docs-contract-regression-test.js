// Exercise the documentation checker against valid and deliberately broken input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkDocs } = require('./docs-contract-test');
function check(transform) {
    const fakeFs = { ...fs, readFileSync(file, encoding) {
        return transform(String(file), fs.readFileSync(file, encoding));
    } };
    checkDocs(fakeFs);
}
check((file, text) => text);
check((file, text) => text.replace(/\r?\n/g, '\r\n'));
assert.throws(() => check((file, text) => file.endsWith('install-and-update.md')
    ? text.replace('npm ci\nnpm run app', 'npm run app') + '\n```sh\nnpm ci\nnpm run app\n```\n' : text), /short fresh ZIP/);
assert.throws(() => check((file, text) => file.endsWith('install-and-update.md')
    ? text.replace('#cli-credential-setup-source-build', '#missing-heading') : text), /missing-heading/);
assert.throws(() => check((file, text) => path.resolve(file) === path.resolve(__dirname, '..', 'README.md')
    ? text.replaceAll('](docs/usage.md)', '](docs/usage-removed.md)') : text), /README links docs\/usage.md/);
console.log('Docs checker regressions: CRLF, scoped setup, anchors and link targets pass.');
