// Issue #222: random accuracy unit coverage. No browser, no EP, no network.
const assert = require('node:assert/strict');
const {
    DEFAULT_MIN, DEFAULT_MAX,
    parseAccuracyValue, parseAccuracyRange, parseAccuracyCliArgs,
    resolveAccuracyConfig, pickTarget, createAccuracyRun,
    makeTypo, makeTypoFor, pickDistractorIndex,
} = require('../lib/accuracy');

assert.equal(DEFAULT_MIN, 70);
assert.equal(DEFAULT_MAX, 90);

// Value and range parsing.
assert.equal(parseAccuracyValue('82'), 82);
assert.equal(parseAccuracyValue(' 82% '), 82);
assert.equal(parseAccuracyValue('0'), 0);
assert.equal(parseAccuracyValue('100'), 100);
assert.equal(parseAccuracyValue('101'), null);
assert.equal(parseAccuracyValue('-1'), null);
assert.equal(parseAccuracyValue('abc'), null);
assert.deepEqual(parseAccuracyRange('70-90'), { min: 70, max: 90 });
assert.deepEqual(parseAccuracyRange('70 - 90'), { min: 70, max: 90 });
assert.equal(parseAccuracyRange('90-70'), null);
assert.equal(parseAccuracyRange('70'), null);

// CLI flag parsing.
assert.deepEqual(parseAccuracyCliArgs(['--accuracy', '82']), { options: { fixedTarget: 82 }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['--accuracy=82']), { options: { fixedTarget: 82 }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['--accuracy-range', '70-90']), { options: { min: 70, max: 90 }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['--perfect']), { options: { perfect: true }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['--no-mistakes']), { options: { perfect: true }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['-a', '82']), { options: { fixedTarget: 82 }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['-a=82']), { options: { fixedTarget: 82 }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['-r', '70-90']), { options: { min: 70, max: 90 }, error: null });
assert.deepEqual(parseAccuracyCliArgs(['-p']), { options: { perfect: true }, error: null });
assert.ok(parseAccuracyCliArgs(['-p=1']).error);
assert.ok(parseAccuracyCliArgs(['-a']).error);
assert.ok(parseAccuracyCliArgs(['--bogus']).error);

// Config resolution: defaults to perfect (simulation off) outside TEST_BOOT.
{
    const config = resolveAccuracyConfig({ cli: {}, env: {} });
    assert.equal(config.enabled, false);
    assert.equal(config.target, 100);
}
// A target/band via env or CLI enables the simulation.
{
    const config = resolveAccuracyConfig({ cli: {}, env: { EP_ACCURACY_RANGE: '70-90' } });
    assert.equal(config.enabled, true);
    assert.equal(config.min, 70);
    assert.equal(config.max, 90);
}
// EP_PERFECT=0 explicitly opts out of perfect and enables the default band.
{
    const config = resolveAccuracyConfig({ cli: {}, env: { EP_PERFECT: '0' } });
    assert.equal(config.enabled, true);
    assert.equal(config.min, 70);
    assert.equal(config.max, 90);
}
// An unrecognized EP_PERFECT value is rejected, never treated as an opt-out.
assert.throws(() => resolveAccuracyConfig({ cli: {}, env: { EP_PERFECT: 'tru' } }), /Invalid EP_PERFECT/);
assert.equal(resolveAccuracyConfig({ cli: {}, env: { EP_PERFECT: 'off' } }).enabled, true);
// TEST_BOOT defaults to perfect for deterministic fixtures.
{
    const config = resolveAccuracyConfig({ cli: {}, env: { EP_TEST_BOOT: '1' } });
    assert.equal(config.enabled, false);
    assert.equal(config.target, 100);
}
// Explicit CLI/env enables accuracy even under TEST_BOOT.
{
    const config = resolveAccuracyConfig({ cli: { fixedTarget: 82 }, env: { EP_TEST_BOOT: '1' } });
    assert.equal(config.enabled, true);
    assert.equal(config.fixedTarget, 82);
}
{
    const config = resolveAccuracyConfig({ cli: {}, env: { EP_TEST_BOOT: '1', EP_ACCURACY: '82' } });
    assert.equal(config.enabled, true);
    assert.equal(config.fixedTarget, 82);
}
// Env and CLI sources.
assert.equal(resolveAccuracyConfig({ cli: {}, env: { EP_PERFECT: '1' } }).enabled, false);
assert.equal(resolveAccuracyConfig({ cli: { perfect: true }, env: {} }).enabled, false);
assert.equal(resolveAccuracyConfig({ cli: {}, env: { EP_ACCURACY_RANGE: '60-80' } }).min, 60);
// Explicit CLI target/range overrides env perfect; --perfect stays the final override.
assert.equal(resolveAccuracyConfig({ cli: { fixedTarget: 82 }, env: { EP_PERFECT: '1' } }).enabled, true);
assert.equal(resolveAccuracyConfig({ cli: { min: 60, max: 80 }, env: { EP_PERFECT: '1' } }).enabled, true);
assert.equal(resolveAccuracyConfig({ cli: { fixedTarget: 82, perfect: true }, env: { EP_PERFECT: '1' } }).enabled, false);

// Per-run target: fixed vs randomized, inclusive bounds.
assert.equal(pickTarget({ enabled: false }, () => 0), 100);
assert.equal(pickTarget({ enabled: true, fixedTarget: 82 }, () => 0.99), 82);
assert.equal(pickTarget({ enabled: true, min: 70, max: 90 }, () => 0), 70);
assert.equal(pickTarget({ enabled: true, min: 70, max: 90 }, () => 0.999), 90);

// Run controller: Bernoulli near target, stats tracking.
{
    // Deterministic random: 0.5 always mistakes when target < 50, never when > 50.
    const low = createAccuracyRun({ enabled: true, min: 70, max: 90, fixedTarget: 20, source: 'test' }, () => 0.5);
    assert.equal(low.target, 20);
    assert.equal(low.shouldMistake(), true);
    low.recordFirstTry(true);
    assert.equal(low.stats.mistakes, 1);
    assert.equal(low.accuracy(), 0);
    const high = createAccuracyRun({ enabled: true, min: 70, max: 90, fixedTarget: 80, source: 'test' }, () => 0.5);
    assert.equal(high.shouldMistake(), false);
    high.recordFirstTry(false);
    assert.equal(high.accuracy(), 100);
}
{
    const disabled = createAccuracyRun({ enabled: false, source: 'test' }, () => 0);
    assert.equal(disabled.shouldMistake(), false);
    assert.equal(disabled.target, 100);
}

// Typos: human-plausible, never empty, never identical, avoid-list respected.
for (const word of ['hello', 'Bonjour', 'hola', 'a', 'ab', 'I take']) {
    const typo = makeTypo(word, { random: () => 0.5 });
    assert.ok(typeof typo === 'string' && typo.trim() !== '', `typo for ${word}`);
    assert.notEqual(typo, word, `typo differs for ${word}`);
    assert.ok(typo.length <= word.length + 2, 'small edit, not garbage');
}
{
    const typo = makeTypoFor('hello', ['helol', 'hello']);
    assert.ok(typo && typo.toLowerCase() !== 'hello' && typo.toLowerCase() !== 'helol');
    // Options-object form.
    const typo2 = makeTypo('world', { avoid: ['world'], random: () => 0.1 });
    assert.notEqual(typo2.toLowerCase(), 'world');
    assert.equal(makeTypo('', { random: () => 0.5 }), null);
}
// Distractor: neighboring incorrect option.
assert.equal(pickDistractorIndex(['a', 'b', 'c'], 1), 2);
assert.equal(pickDistractorIndex(['a', 'b', 'c'], 2), 1);
assert.equal(pickDistractorIndex(['only'], 0), null);
assert.equal(pickDistractorIndex(['a', 'b'], 5), null);

console.log('Accuracy unit coverage passed (issue #222).');
