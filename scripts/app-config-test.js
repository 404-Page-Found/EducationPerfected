const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeConfig, readConfig, writeConfig } = require('../lib/app-config');
const { createHumanDelay } = require('../lib/human-delay');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-config-test-'));
const options = { home };
const d = { enabled: false };
try {
    assert.deepEqual(readConfig(options), { version: 1 });
    writeConfig({ version: 1, delay: d, password: 'not-a-real-secret', email: 'fixture' }, options);
    assert.deepEqual(readConfig(options), { version: 1, delay: d });
    const root = path.join(home, '.educationperfected');
    const file = path.join(root, 'config.json');
    assert(!fs.readFileSync(file, 'utf8').includes('secret'));
    assert.deepEqual(fs.readdirSync(root), ['config.json']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const delay = createHumanDelay({ env: {}, config: readConfig(options).delay });
    assert.equal(delay.isEnabled(), false);
    assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'on' }, config: d }).isEnabled(), true);
    assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'off' }, config: { enabled: true } }).isEnabled(), false);
    for (const bad of ['', '{broken', 'null', '{"version":2,"delay":{}}']) {
        fs.writeFileSync(file, bad);
        assert.deepEqual(readConfig(options), { version: 1 });
    }
    // Migration from the retired settings: a saved accuracy block and a saved
    // delay override stop applying, while the delay on/off choice survives.
    assert.deepEqual(normalizeConfig({ version: 1, accuracy: { enabled: true, min: 70, max: 90, fixedTarget: 82 }, delay: d }), { version: 1, delay: d });
    assert.deepEqual(normalizeConfig({ version: 1, delay: { enabled: true, override: [1500, 4000] } }), { version: 1, delay: { enabled: true } });
    assert.deepEqual(normalizeConfig({ version: 1, delay: { enabled: false, override: [1500, 4000] } }), { version: 1, delay: { enabled: false } });
    // A migrated file is rewritten without the retired keys on the next save.
    fs.writeFileSync(file, JSON.stringify({ version: 1, accuracy: { enabled: true, min: 70, max: 90, fixedTarget: 82 }, delay: { enabled: false, override: [1500, 4000] } }));
    const migrated = readConfig(options);
    assert.deepEqual(migrated, { version: 1, delay: { enabled: false } });
    writeConfig(migrated, options);
    const rewritten = fs.readFileSync(file, 'utf8');
    assert(!rewritten.includes('accuracy') && !rewritten.includes('override'), 'the rewrite drops the retired keys');
    assert.deepEqual(readConfig(options), { version: 1, delay: { enabled: false } });
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    assert.deepEqual(readConfig(options), { version: 1 });
    assert.throws(() => writeConfig({ version: 1, delay: d }, options));
    assert.deepEqual(fs.readdirSync(root), ['config.json']);
    fs.rmdirSync(file);
    if (process.platform !== 'win32') {
        const target = path.join(home, 'outside.json');
        fs.writeFileSync(target, JSON.stringify({ version: 1, delay: d }));
        fs.symlinkSync(target, file);
        assert.deepEqual(readConfig(options), { version: 1 });
        writeConfig({ version: 1, delay: { enabled: true } }, options);
        assert(!fs.lstatSync(file).isSymbolicLink());
        assert.deepEqual(JSON.parse(fs.readFileSync(target)), { version: 1, delay: d });
    }
    console.log('App config: normalization, migration of retired settings, restart, corruption, atomic failure and non-secret writes pass.');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
