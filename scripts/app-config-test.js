const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeConfig, readConfig, writeConfig } = require('../lib/app-config');
const { resolveAccuracyConfig } = require('../lib/accuracy');
const { createHumanDelay } = require('../lib/human-delay');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-config-test-'));
const options = { home };
const a = { enabled: true, min: 70, max: 90, fixedTarget: 82 };
const d = { enabled: false, override: [1500, 4000] };
try {
    assert.deepEqual(readConfig(options), { version: 1 });
    writeConfig({ version: 1, accuracy: a, delay: d, password: 'not-a-real-secret', email: 'fixture' }, options);
    assert.deepEqual(readConfig(options), { version: 1, accuracy: a, delay: d });
    const root = path.join(home, '.educationperfected');
    const file = path.join(root, 'config.json');
    assert(!fs.readFileSync(file, 'utf8').includes('secret'));
    assert.deepEqual(fs.readdirSync(root), ['config.json']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(resolveAccuracyConfig({ env: {}, config: readConfig(options).accuracy }).fixedTarget, 82);
    assert.equal(resolveAccuracyConfig({ env: { EP_ACCURACY: '84' }, config: a }).fixedTarget, 84);
    assert.equal(resolveAccuracyConfig({ cli: { fixedTarget: 85 }, env: { EP_ACCURACY: '84' }, config: a }).fixedTarget, 85);
    assert.equal(resolveAccuracyConfig({ env: { EP_PERFECT: '1' }, config: a }).enabled, false);
    const delay = createHumanDelay({ env: {}, config: readConfig(options).delay });
    assert.equal(delay.isEnabled(), false);
    assert.deepEqual(delay.describe().override, [1500, 4000]);
    assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'on' }, config: d }).isEnabled(), true);
    assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'off' }, config: { enabled: true } }).isEnabled(), false);
    for (const bad of ['', '{broken', 'null', '{"version":2,"accuracy":{}}']) {
        fs.writeFileSync(file, bad);
        assert.deepEqual(readConfig(options), { version: 1 });
    }
    assert.deepEqual(normalizeConfig({ version: 1, accuracy: { ...a, min: -1 }, delay: d }), { version: 1, delay: d });
    for (const override of [[-1, 2], [1, 120001], [2, 1], ['1', 2], [1, 2, 3]]) {
        assert.deepEqual(normalizeConfig({ version: 1, delay: { enabled: true, override } }), { version: 1 });
    }
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    assert.deepEqual(readConfig(options), { version: 1 });
    assert.throws(() => writeConfig({ version: 1, accuracy: a }, options));
    assert.deepEqual(fs.readdirSync(root), ['config.json']);
    fs.rmdirSync(file);
    if (process.platform !== 'win32') {
        const target = path.join(home, 'outside.json');
        fs.writeFileSync(target, JSON.stringify({ version: 1, accuracy: a }));
        fs.symlinkSync(target, file);
        assert.deepEqual(readConfig(options), { version: 1 });
        writeConfig({ version: 1, delay: d }, options);
        assert(!fs.lstatSync(file).isSymbolicLink());
        assert.deepEqual(JSON.parse(fs.readFileSync(target)), { version: 1, accuracy: a });
    }
    console.log('App config: normalization, restart, precedence, corruption, atomic failure and non-secret writes pass.');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
