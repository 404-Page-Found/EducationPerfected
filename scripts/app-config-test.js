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
const d = { enabled: false };
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
    const enabledFromPerfect = resolveAccuracyConfig({ env: { EP_PERFECT: '0' }, config: { ...a, enabled: false, fixedTarget: 100 } });
    assert.equal(enabledFromPerfect.enabled, true);
    assert.equal(enabledFromPerfect.fixedTarget, null);
    assert.deepEqual([enabledFromPerfect.min, enabledFromPerfect.max], [70, 90]);
    assert.equal(resolveAccuracyConfig({ env: { EP_PERFECT: '0', EP_ACCURACY: '84' }, config: a }).fixedTarget, 84);
    const delay = createHumanDelay({ env: {}, config: readConfig(options).delay });
    assert.equal(delay.isEnabled(), false);
    // Both settings default to off: accuracy perfect and no pacing wait.
    assert.equal(createHumanDelay({ env: {}, config: undefined }).isEnabled(), false);
    assert.equal(resolveAccuracyConfig({ env: {}, config: undefined }).enabled, false);
    assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'on' }, config: d }).isEnabled(), true);
    assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'off' }, config: { enabled: true } }).isEnabled(), false);
    for (const bad of ['', '{broken', 'null', '{"version":2,"accuracy":{}}']) {
        fs.writeFileSync(file, bad);
        assert.deepEqual(readConfig(options), { version: 1 });
    }
    assert.deepEqual(normalizeConfig({ version: 1, accuracy: { ...a, min: -1 }, delay: d }), { version: 1, delay: d });
    // Migration: the saved accuracy block applies again (the simulation is
    // restored); the retired delay.override stops applying, while the delay
    // on/off choice survives.
    assert.deepEqual(normalizeConfig({ version: 1, delay: { enabled: true, override: [1500, 4000] } }), { version: 1, delay: { enabled: true } });
    for (const override of [[-1, 2], [1, 120001], [2, 1], ['1', 2], [1, 2, 3]]) {
        assert.deepEqual(normalizeConfig({ version: 1, delay: { enabled: true, override } }), { version: 1, delay: { enabled: true } });
    }
    // A migrated file is rewritten without the retired override key on save.
    fs.writeFileSync(file, JSON.stringify({ version: 1, accuracy: a, delay: { enabled: false, override: [1500, 4000] } }));
    const migrated = readConfig(options);
    assert.deepEqual(migrated, { version: 1, accuracy: a, delay: { enabled: false } });
    writeConfig(migrated, options);
    const rewritten = fs.readFileSync(file, 'utf8');
    assert(!rewritten.includes('override') && rewritten.includes('accuracy'), 'the rewrite drops the retired override key and keeps accuracy');
    assert.deepEqual(readConfig(options), { version: 1, accuracy: a, delay: { enabled: false } });
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
    console.log('App config: normalization, migration of the retired pacing override, restart, precedence, corruption, atomic failure and non-secret writes pass.');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
