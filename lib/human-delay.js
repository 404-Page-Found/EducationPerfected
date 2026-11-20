// Human-paced answer timing (issue #221). Instant back-to-back submissions
// read as a bot; this module inserts one randomized wait per answered
// question, sampled uniformly from a per-question-type range, after the
// answer is ready and before the round's one guarded Submit or Enter.
// Enabled by default; EP_HUMAN_DELAY=off or the interactive `delay off`
// command restores super-speed, and `delay MIN-MAX` overrides every range.
// The test harness boot (EP_TEST_BOOT=1) starts with the delay off so
// synthetic suites keep their speed; delay behavior itself is tested with
// injected random/sleep.
//
// Dash pacing (issues #237/#273): the timed Dash sprint shares the classic
// per-question-type ranges in the reconstructions (text 2-6s, choice 3-8s,
// typed 4-10s). On a timed clock that wait is expected (unproved live) to
// trade score for human-likeness, so `delay off` is the provisional Dash
// recommendation for maximum points; `delay MIN-MAX` already covers a
// faster-but-paced sprint with no Dash-specific range. See
// lib/dash.js for the full decision.

// Milliseconds [min, max] per descriptor kind, from the issue's examples:
// short for word/selection shapes, longer where a student reads or types
// more, and a listening floor for audio (no audio length is readable from
// the page contract, so the floor stands in for playback plus think time).
const DEFAULT_RANGES = Object.freeze({
    text: [2000, 6000],              // classic word-to-word / translation
    typed: [4000, 10000],            // short-answer text rounds
    audio: [8000, 15000],            // listening/dictation: playback + think time
    choice: [3000, 8000],
    gaps: [4000, 10000],
    textbox: [4000, 10000],
    numberbox: [4000, 10000],
    dropdown: [3000, 8000],
    'dropdown-numberbox': [3000, 8000],
    'slide-surfaces': [5000, 12000],
    highlight: [3000, 8000],
    workingformula: [6000, 15000],
    default: [3000, 8000],
});

function createHumanDelay({ random = Math.random, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), env = process.env, config = {} } = {}) {
    let enabled = env.EP_TEST_BOOT === '1' ? false : config.enabled ?? true;
    if (env.EP_HUMAN_DELAY === 'off') enabled = false;
    else if (env.EP_HUMAN_DELAY === 'on' && env.EP_TEST_BOOT !== '1') enabled = true;
    let override = config.override ? [...config.override] : null; // milliseconds
    const rangeFor = kind => override || DEFAULT_RANGES[kind] || DEFAULT_RANGES.default;
    const sample = kind => {
        const [min, max] = rangeFor(kind);
        return min + Math.floor(random() * (max - min + 1));
    };
    return {
        isEnabled: () => enabled,
        setEnabled(value) { enabled = value === true; },
        setOverride(minMs, maxMs) { override = [minMs, maxMs]; },
        clearOverride() { override = null; },
        rangeFor,
        sample,
        describe: () => ({ enabled, override, ranges: DEFAULT_RANGES }),
        // The single wait per answered question. Callers place it after the
        // answer is ready, immediately before the guarded submission.
        async beforeSubmit(kind) { if (enabled) await sleep(sample(kind)); },
    };
}

// One-line summary of the per-type ranges for the `delay` report and docs,
// derived from DEFAULT_RANGES so the numbers have a single source of truth.
const RANGE_GROUPS = [
    ['text', ['text']],
    ['choice/dropdown/highlight', ['choice', 'dropdown', 'dropdown-numberbox', 'highlight']],
    ['typed/gaps/boxes', ['typed', 'gaps', 'textbox', 'numberbox']],
    ['slide-surfaces', ['slide-surfaces']],
    ['working-formula', ['workingformula']],
    ['audio', ['audio']],
];
function summarizeRanges() {
    return RANGE_GROUPS.map(([label, kinds]) => {
        const [min, max] = DEFAULT_RANGES[kinds[0]];
        return `${label} ${min / 1000}-${max / 1000}s`;
    }).join(', ');
}

// Parses the interactive `delay MIN-MAX` override: seconds, one decimal
// allowed (`2-6`, `1.5-4`). Returns ms bounds or null when unparseable.
function parseDelayOverride(text) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ''));
    if (!match) return null;
    const min = Math.round(Number(match[1]) * 1000), max = Math.round(Number(match[2]) * 1000);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min || max > 120000) return null;
    return [min, max];
}

module.exports = { createHumanDelay, parseDelayOverride, summarizeRanges, DEFAULT_RANGES };
