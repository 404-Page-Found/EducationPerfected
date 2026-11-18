// Unit coverage for lib/human-delay.js (issue #221): per-type default
// ranges, uniform sampling within bounds, enable/disable, the seconds
// override and its parser, and the env defaults (on normally, off under
// EP_HUMAN_DELAY=off or the EP_TEST_BOOT harness). No browser involved.
const assert = require('node:assert');
const { createHumanDelay, parseDelayOverride, DEFAULT_RANGES } = require('../lib/human-delay');

(async () => {

const sleeps = [];
const sleep = ms => { sleeps.push(ms); return Promise.resolve(); };

// Default: enabled with no env, every documented kind samples inside its
// range at both extremes and the middle of the uniform draw.
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
    const delay = createHumanDelay({ random: () => 0, sleep, env: {} });
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

// Override replaces every kind's range; reset restores the defaults.
{
    const delay = createHumanDelay({ random: () => 0.5, sleep, env: {} });
    delay.setOverride(1200, 1800);
    for (const kind of ['text', 'audio', 'workingformula']) {
        const sampled = delay.sample(kind);
        assert.ok(sampled >= 1200 && sampled <= 1800, `override missed ${kind}: ${sampled}`);
    }
    assert.deepEqual(delay.describe().override, [1200, 1800]);
    delay.clearOverride();
    assert.equal(delay.describe().override, null);
    assert.equal(delay.sample('text') >= DEFAULT_RANGES.text[0], true);
}

// Env defaults: on without overrides, off under EP_HUMAN_DELAY=off or the
// test harness boot.
assert.equal(createHumanDelay({ env: {} }).isEnabled(), true);
assert.equal(createHumanDelay({ env: { EP_HUMAN_DELAY: 'off' } }).isEnabled(), false);
assert.equal(createHumanDelay({ env: { EP_TEST_BOOT: '1' } }).isEnabled(), false);

// The interactive override parser: seconds with optional decimal, bounded,
// ordered; anything else is rejected so a typo never disables pacing.
assert.deepEqual(parseDelayOverride('2-6'), [2000, 6000]);
assert.deepEqual(parseDelayOverride('1.5-4'), [1500, 4000]);
assert.deepEqual(parseDelayOverride('0.5-0.5'), [500, 500]);
for (const bad of ['', 'abc', '5-2', '-1-3', '2', '2-', '2-6-8', '0-121', 'NaN-5', '1.5.2-3']) {
    assert.equal(parseDelayOverride(bad), null, `accepted ${JSON.stringify(bad)}`);
}

console.log('Human delay: per-type ranges sampled in bounds, enable/disable, override and reset, env defaults, override parser PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
