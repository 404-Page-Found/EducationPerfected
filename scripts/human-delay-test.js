// Unit coverage for lib/human-delay.js (issue #221): per-type default
// ranges, uniform sampling within bounds, enable/disable, and the env
// defaults (off normally, on under EP_HUMAN_DELAY=on, always off under the
// EP_TEST_BOOT harness). No browser involved. Pacing has no custom range:
// on and off are the only settings.
const assert = require('node:assert');
const { createHumanDelay, summarizeRanges, DEFAULT_RANGES } = require('../lib/human-delay');

(async () => {

const sleeps = [];
const sleep = ms => { sleeps.push(ms); return Promise.resolve(); };

// Sampling is independent of the on/off default: every documented kind
// samples inside its range at both extremes and the middle of the uniform draw.
for (const kind of ['text', 'typed', 'audio', 'choice', 'gaps', 'textbox', 'numberbox', 'dropdown', 'dropdown-numberbox', 'slide-surfaces', 'highlight', 'workingformula', 'unknown-kind']) {
    const [min, max] = DEFAULT_RANGES[kind] || DEFAULT_RANGES.default;
    for (const draw of [0, 0.5, 0.999999]) {
        const delay = createHumanDelay({ random: () => draw, sleep, env: {} });
        const sampled = delay.sample(kind);
        assert.ok(sampled >= min && sampled <= max, `${kind} @${draw}: ${sampled} outside ${min}-${max}`);
    }
}
// Audio keeps a listening floor above the word/selection shapes.
assert.ok(DEFAULT_RANGES.audio[0] >= 8000, 'audio range must cover playback plus think time');
assert.ok(DEFAULT_RANGES.text[1] <= DEFAULT_RANGES.typed[1], 'word rounds stay shorter than typed rounds');

// beforeSubmit sleeps the sampled value exactly once when enabled, and not
// at all when disabled.
{
    const delay = createHumanDelay({ random: () => 0, sleep, env: {}, config: { enabled: true } });
    sleeps.length = 0;
    await delay.beforeSubmit('choice');
    assert.deepEqual(sleeps, [DEFAULT_RANGES.choice[0]]);
    delay.setEnabled(false);
    await delay.beforeSubmit('choice');
    assert.deepEqual(sleeps, [DEFAULT_RANGES.choice[0]], 'disabled delay must not sleep');
    assert.equal(delay.isEnabled(), false);
    delay.setEnabled(true);
    assert.equal(delay.isEnabled(), true);
}

// describe reports only on/off plus the per-type ranges: no custom range.
{
    const delay = createHumanDelay({ env: {} });
    const described = delay.describe();
    assert.equal(described.enabled, false, 'pacing defaults to off');
    assert.deepEqual(described.ranges, DEFAULT_RANGES);
    assert.ok(!('override' in described), 'no custom range is reported');
}

// Env defaults: off without an override, on under EP_HUMAN_DELAY=on, off
// under EP_HUMAN_DELAY=off or the test harness boot.
assert.equal(createHumanDelay({ env: {} }).isEnabled(), false);
assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'on' } }).isEnabled(), true);
assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'off' }, config: { enabled: true } }).isEnabled(), false);
assert.equal(createHumanDelay({ env: { EP_TEST_BOOT: '1' }, config: { enabled: true } }).isEnabled(), false);

// The delay report's range summary: one line, honest grouping, every
// documented kind covered (drift here means docs would lie about a range).
assert.equal(summarizeRanges(), 'text 2-6s, choice/dropdown/highlight 3-8s, typed/gaps/boxes 4-10s, slide-surfaces 5-12s, working-formula 6-15s, audio 8-15s');

console.log('Human delay: per-type ranges sampled in bounds, enable/disable, env defaults PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
