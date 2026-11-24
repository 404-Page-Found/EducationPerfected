// Exercise the documentation checker against valid and deliberately broken input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'docs-contract-test.js'), 'utf8');
function check(transform) {
    const fakeFs = { ...fs, readFileSync(file, encoding) {
        return transform(String(file), fs.readFileSync(file, encoding));
    } };
    vm.runInNewContext(source, {
        require: name => name === 'node:fs' ? fakeFs : require(name),
        __dirname, console: { log() {} }
    });
}
check((file, text) => text);
check((file, text) => text.replace(/\r?\n/g, '\r\n'));
assert.throws(() => check((file, text) => file.endsWith('install-and-update.md')
    ? text.replace('npm ci\nnpm run app', 'npm run app') + '\n```sh\nnpm ci\nnpm run app\n```\n' : text), /short fresh ZIP/);
assert.throws(() => check((file, text) => file.endsWith('install-and-update.md')
    ? text.replace('#cli-credential-setup-source-build', '#missing-heading') : text), /missing-heading/);
assert.throws(() => check((file, text) => file.endsWith('/README.md')
    ? text.replace(/\[[^\]]+\]\(docs\/usage.md\)/g, 'docs/usage.md') : text), /README links docs\/usage.md/);
console.log('Docs checker regressions: CRLF, scoped setup, anchors and link targets pass.');
