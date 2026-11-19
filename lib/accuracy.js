// Random accuracy (issue #222): simulate a real student with 70%-90%
// first-try accuracy by default, with plausible human mistakes.
//
// Design notes:
// - Enabled by default outside the test harness; disabled (perfect) under
//   EP_TEST_BOOT=1 unless explicitly enabled via CLI/env, so existing
//   deterministic fixtures stay deterministic.
// - Per-run target: randomized integer in [min,max] at the start of each run,
//   so every run looks slightly different.
// - Per-question decision: Bernoulli with p = 1 - target/100. Over many
//   questions the first-try rate lands near the target.
// - Mistakes are human-plausible (small typo, neighboring distractor), never
//   random garbage, and only injected where the normal retry/advance path
//   still completes (classic text, audio/typed, single-choice). Other
//   surfaces stay perfect to preserve their fail-closed completion proofs.
// - No guessing: a mistake is only made when the correct answer is already
//   known; unknown questions keep the existing random-probe/error path.

const DEFAULT_MIN = 70;
const DEFAULT_MAX = 90;

function clampInt(value, lo, hi) {
    if (!Number.isFinite(value)) return null;
    const n = Math.floor(value);
    if (n < lo || n > hi) return null;
    return n;
}

function parseAccuracyValue(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim().replace(/%$/, '').trim();
    if (!/^\d{1,3}$/.test(trimmed)) return null;
    return clampInt(Number(trimmed), 0, 100);
}

function parseAccuracyRange(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim().replace(/%/g, '');
    const m = trimmed.match(/^(\d{1,3})\s*[-:–—]\s*(\d{1,3})$/);
    if (!m) return null;
    const lo = clampInt(Number(m[1]), 0, 100);
    const hi = clampInt(Number(m[2]), 0, 100);
    if (lo === null || hi === null || lo > hi) return null;
    return { min: lo, max: hi };
}

const SHORT_CLI_FLAGS = { '-a': '--accuracy', '-r': '--accuracy-range', '-p': '--perfect' };

// Parses only the accuracy-related CLI flags from an argv slice (excluding any
// subcommand). Returns {options, error}. Options: {min,max,fixedTarget,perfect}.
// Short aliases: -a (--accuracy), -r (--accuracy-range), -p (--perfect).
function parseAccuracyCliArgs(args) {
    const options = {};
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        const eq = arg.indexOf('=');
        const rawName = eq >= 0 ? arg.slice(0, eq) : arg;
        const name = SHORT_CLI_FLAGS[rawName] || rawName;
        const inline = eq >= 0 ? arg.slice(eq + 1) : null;
        const next = () => {
            if (inline !== null) return inline;
            i += 1;
            return args[i];
        };
        if (name === '--accuracy') {
            const raw = next();
            if (raw === undefined || raw.startsWith('--')) return { options, error: 'Missing value for --accuracy <0-100>.' };
            // Allow "70-90" through --accuracy as a range shorthand.
            if (/^\d{1,3}\s*[-:–—]\s*\d{1,3}$/.test(String(raw).replace(/%/g, ''))) {
                const range = parseAccuracyRange(String(raw));
                if (!range) return { options, error: `Invalid --accuracy value ${JSON.stringify(raw)}; use 0-100 or a range like 70-90.` };
                options.min = range.min;
                options.max = range.max;
                delete options.fixedTarget;
            } else {
                const value = parseAccuracyValue(String(raw));
                if (value === null) return { options, error: `Invalid --accuracy value ${JSON.stringify(raw)}; use 0-100.` };
                options.fixedTarget = value;
                delete options.min;
                delete options.max;
            }
            i += 1;
            continue;
        }
        if (name === '--accuracy-range') {
            const raw = next();
            if (raw === undefined || raw.startsWith('--')) return { options, error: 'Missing value for --accuracy-range <min-max> (e.g. 70-90).' };
            const range = parseAccuracyRange(String(raw));
            if (!range) return { options, error: `Invalid --accuracy-range value ${JSON.stringify(raw)}; use MIN-MAX like 70-90.` };
            options.min = range.min;
            options.max = range.max;
            delete options.fixedTarget;
            i += 1;
            continue;
        }
        if (name === '--perfect' || name === '--no-mistakes' || name === '--no-mistake') {
            if (inline !== null) return { options, error: `${name} takes no value.` };
            options.perfect = true;
            i += 1;
            continue;
        }
        return { options, error: `Unknown option ${JSON.stringify(arg)}. See --help.` };
    }
    return { options, error: null };
}

// Merges CLI options > env vars > defaults. The accuracy simulation is OFF by
// default (perfect answers); `accuracy on`, a target/band, or env enables it. Env:
//   EP_PERFECT=1 / EP_NO_MISTAKES=1 -> perfect (disabled; redundant with the default)
//   EP_ACCURACY=82 -> fixed target (enables the simulation)
//   EP_ACCURACY_RANGE=70-90 -> range (enables the simulation)
// testBoot (EP_TEST_BOOT=1) also defaults to perfect unless explicitly enabled
// via CLI or env, keeping existing fixtures deterministic.
function resolveAccuracyConfig({ cli = {}, env = process.env, testBoot = env.EP_TEST_BOOT === '1', config = {} } = {}) {
    let min = config.min ?? DEFAULT_MIN;
    let max = config.max ?? DEFAULT_MAX;
    let fixedTarget = config.fixedTarget ?? null;
    let perfect = config.enabled !== true;
    let source = config.enabled !== undefined ? 'config' : testBoot ? 'test-default-perfect' : 'default-perfect';

    const applyEnv = () => {
        const rangeRaw = env.EP_ACCURACY_RANGE;
        const fixedRaw = env.EP_ACCURACY;
        const perfectRaw = env.EP_PERFECT ?? env.EP_NO_MISTAKES;
        if (typeof rangeRaw === 'string' && rangeRaw.trim() !== '') {
            const range = parseAccuracyRange(rangeRaw);
            if (!range) throw new Error(`Invalid EP_ACCURACY_RANGE ${JSON.stringify(rangeRaw)}; use MIN-MAX like 70-90.`);
            min = range.min;
            max = range.max;
            fixedTarget = null;
            perfect = false;
            source = 'env:EP_ACCURACY_RANGE';
        }
        if (typeof fixedRaw === 'string' && fixedRaw.trim() !== '') {
            const value = parseAccuracyValue(fixedRaw);
            if (value === null) throw new Error(`Invalid EP_ACCURACY ${JSON.stringify(fixedRaw)}; use 0-100.`);
            fixedTarget = value;
            perfect = false;
            source = 'env:EP_ACCURACY';
        }
        if (typeof perfectRaw === 'string' && perfectRaw.trim() !== '') {
            // Truthy forces perfect; falsy (EP_PERFECT=0) opts out and enables the
            // default band. Anything else is a typo: reject it rather than guess.
            const normalized = perfectRaw.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalized)) {
                perfect = true;
            } else if (['0', 'false', 'no', 'off'].includes(normalized)) {
                perfect = false;
            } else {
                throw new Error(`Invalid EP_PERFECT ${JSON.stringify(perfectRaw)}; use 1 or 0.`);
            }
            source = 'env:EP_PERFECT';
        }
    };

    const applyCli = () => {
        if (!cli) return;
        if (cli.fixedTarget !== undefined) {
            if (cli.fixedTarget < 0 || cli.fixedTarget > 100) throw new Error(`Invalid --accuracy ${cli.fixedTarget}; use 0-100.`);
            fixedTarget = cli.fixedTarget;
            source = 'cli:--accuracy';
            // An explicit target/range overrides env perfect; --perfect below stays the final override.
            perfect = false;
        } else if (cli.min !== undefined) {
            if (cli.min < 0 || cli.min > 100 || cli.max < 0 || cli.max > 100 || cli.min > cli.max) throw new Error(`Invalid --accuracy-range ${cli.min}-${cli.max}.`);
            min = cli.min;
            max = cli.max;
            fixedTarget = null;
            source = 'cli:--accuracy-range';
            perfect = false;
        }
        if (cli.perfect) {
            perfect = true;
            source = 'cli:--perfect';
        }
    };

    if (testBoot) {
        // In the harness, env/CLI can still explicitly enable accuracy.
        const hasExplicit = (cli && (cli.fixedTarget !== undefined || cli.min !== undefined || cli.perfect))
            || (typeof env.EP_ACCURACY === 'string' && env.EP_ACCURACY.trim() !== '')
            || (typeof env.EP_ACCURACY_RANGE === 'string' && env.EP_ACCURACY_RANGE.trim() !== '')
            || (typeof (env.EP_PERFECT ?? env.EP_NO_MISTAKES) === 'string' && String(env.EP_PERFECT ?? env.EP_NO_MISTAKES).trim() !== '');
        if (!hasExplicit) {
            return { enabled: false, min, max, fixedTarget: 100, target: 100, source };
        }
        applyEnv();
        applyCli();
        // Explicit "0-100" style enabling without a value is not a thing;
        // hasExplicit already guarantees a value was given.
        if (!perfect && fixedTarget === null && source === 'test-default-perfect') {
            // EP_PERFECT=0 style explicit "not perfect" with no range/target:
            // fall back to defaults (enabled).
            min = DEFAULT_MIN;
            max = DEFAULT_MAX;
            source = 'test-explicit-enabled-default-range';
        }
    } else {
        applyEnv();
        applyCli();
    }

    if (perfect) return { enabled: false, min, max, fixedTarget: 100, target: 100, source };
    return { enabled: true, min, max, fixedTarget, source };
}

function pickTarget(config, random = Math.random) {
    if (!config.enabled) return 100;
    if (config.fixedTarget !== null && config.fixedTarget !== undefined) return config.fixedTarget;
    const lo = config.min ?? DEFAULT_MIN;
    const hi = config.max ?? DEFAULT_MAX;
    const span = hi - lo + 1;
    const r = typeof random === 'function' ? random() : Math.random();
    const clamped = Number.isFinite(r) && r >= 0 && r < 1 ? r : Math.random();
    return lo + Math.floor(clamped * span);
}

// Per-run controller: target randomized once per run, Bernoulli decisions after.
function createAccuracyRun(config, random = Math.random) {
    const target = pickTarget(config, random);
    const stats = { target, attempts: 0, mistakes: 0 };
    const randomFn = typeof random === 'function' ? random : Math.random;
    return {
        target,
        enabled: config.enabled,
        min: config.min,
        max: config.max,
        fixedTarget: config.fixedTarget ?? null,
        source: config.source,
        stats,
        shouldMistake() {
            if (!config.enabled) return false;
            if (target >= 100) return false;
            if (target <= 0) return true;
            const r = randomFn();
            const value = Number.isFinite(r) && r >= 0 && r < 1 ? r : Math.random();
            return value >= target / 100;
        },
        // records a first-try decision: mistook=true means we intentionally
        // submitted wrong, so first-try correct=false.
        recordFirstTry(mistook) {
            stats.attempts += 1;
            if (mistook) stats.mistakes += 1;
        },
        accuracy() {
            if (stats.attempts === 0) return null;
            return ((stats.attempts - stats.mistakes) / stats.attempts) * 100;
        },
    };
}

const KEYBOARD_NEIGHBORS = {
    a: 'sq', b: 'vn', c: 'xv', d: 'sfe', e: 'wrs', f: 'dgr', g: 'fht', h: 'gjy',
    i: 'ujo', j: 'hku', k: 'jli', l: 'kop', m: 'nj', n: 'bm', o: 'ilp', p: 'ol',
    q: 'wa', r: 'etd', s: 'adw', t: 'ryf', u: 'yih', v: 'cb', w: 'qae', x: 'zcs',
    y: 'tuh', z: 'xs',
};

function neighborOf(ch, random) {
    const lower = String(ch).toLowerCase();
    const options = KEYBOARD_NEIGHBORS[lower];
    if (!options) return null;
    const pick = options[Math.floor((typeof random === 'function' ? random() : Math.random()) * options.length)];
    if (!pick) return null;
    // Preserve case.
    return ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? pick.toUpperCase() : pick;
}

// Human-plausible typo: small edit, never random garbage. Returns null when no
// plausible edit exists (e.g. empty). Guarantees result !== input (and, when
// `avoid` is given, not in that list case-insensitively).
function makeTypo(answer, { avoid = [], random = Math.random } = {}) {
    if (Array.isArray(answer)) {
        // Convenience: avoid-list as first arg is not supported; keep signature simple.
    }
    const original = String(answer ?? '');
    if (original.trim() === '') return null;
    const rand = typeof random === 'function' ? random : Math.random;
    const forbidden = new Set([original.toLowerCase(), ...avoid.map(s => String(s).toLowerCase())]);
    const isLetter = ch => /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch);

    const candidates = [];

    // 1. Swap two adjacent letters.
    for (let attempt = 0; attempt < 3; attempt++) {
        if (original.length >= 2) {
            const indices = [];
            for (let i = 0; i < original.length - 1; i++) {
                if (isLetter(original[i]) && isLetter(original[i + 1])) indices.push(i);
            }
            if (indices.length) {
                const i = indices[Math.floor(rand() * indices.length)];
                const chars = [...original];
                [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
                const swapped = chars.join('');
                if (swapped !== original) candidates.push(swapped);
            }
        }
        // 2. Drop one interior character (keeps first/last, like a fast typer).
        if (original.length >= 3) {
            const inner = [];
            for (let i = 1; i < original.length - 1; i++) {
                if (original[i] !== ' ') inner.push(i);
            }
            if (inner.length) {
                const i = inner[Math.floor(rand() * inner.length)];
                const dropped = original.slice(0, i) + original.slice(i + 1);
                if (dropped.trim() !== '' && dropped !== original) candidates.push(dropped);
            }
        }
        // 3. Double a middle letter ("accomodate" style).
        {
            const spots = [];
            for (let i = 0; i < original.length; i++) {
                if (isLetter(original[i])) spots.push(i);
            }
            if (spots.length) {
                const i = spots[Math.floor(rand() * spots.length)];
                const doubled = original.slice(0, i + 1) + original[i] + original.slice(i + 1);
                candidates.push(doubled);
            }
        }
        // 4. Keyboard-neighbor replacement (one letter, same case).
        {
            const spots = [];
            for (let i = 0; i < original.length; i++) {
                if (neighborOf(original[i], rand)) spots.push(i);
            }
            if (spots.length) {
                const i = spots[Math.floor(rand() * spots.length)];
                const replacement = neighborOf(original[i], rand);
                if (replacement && replacement !== original[i]) {
                    const replaced = original.slice(0, i) + replacement + original.slice(i + 1);
                    candidates.push(replaced);
                }
            }
        }
        // 5. Single-char answers: neighbor or doubling.
        if (original.length <= 2 && isLetter(original.trim())) {
            const ch = original.trim()[0];
            const neighbor = neighborOf(ch, rand);
            if (neighbor && neighbor.toLowerCase() !== ch.toLowerCase()) {
                candidates.push(original.replace(ch, neighbor));
            }
        }
        // Prefer earlier (simpler) edits but shuffle by attempt randomness:
        // try candidates in order, first valid wins.
        for (const candidate of candidates) {
            if (candidate && candidate.trim() !== '' && candidate !== original && !forbidden.has(candidate.toLowerCase())) {
                return candidate;
            }
        }
        candidates.length = 0;
    }
    // Last resort: deterministic tiny edit so callers can still mistake
    // (still human-scale, never random garbage).
    if (original.length >= 2) {
        const fallback = original.slice(0, -1);
        if (fallback.trim() !== '' && !forbidden.has(fallback.toLowerCase())) return fallback;
    }
    const doubled = original + original.slice(-1);
    if (!forbidden.has(doubled.toLowerCase())) return doubled;
    return null;
}

// Allows the (answer, avoid, random) calling convention used by the classic
// path, plus the options-object form.
function makeTypoFor(answer, avoidOrOptions, maybeRandom) {
    if (avoidOrOptions && typeof avoidOrOptions === 'object' && !Array.isArray(avoidOrOptions)) {
        return makeTypo(answer, avoidOrOptions);
    }
    return makeTypo(answer, { avoid: Array.isArray(avoidOrOptions) ? avoidOrOptions : [], random: maybeRandom });
}

// Neighboring/distractor option for single-choice: prefer the option right
// next to the correct one, so the mistake looks like a near-miss.
function pickDistractorIndex(optionTexts, correctIndex, { random = Math.random } = {}) {
    if (!Array.isArray(optionTexts) || optionTexts.length < 2) return null;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= optionTexts.length) return null;
    const rand = typeof random === 'function' ? random : Math.random;
    const order = [];
    if (correctIndex + 1 < optionTexts.length) order.push(correctIndex + 1);
    if (correctIndex - 1 >= 0) order.push(correctIndex - 1);
    // Any other incorrect index, shuffled.
    const rest = [];
    for (let i = 0; i < optionTexts.length; i++) {
        if (i !== correctIndex && !order.includes(i)) rest.push(i);
    }
    // Shuffle rest deterministically via provided random.
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [...order, ...rest][0] ?? null;
}

module.exports = {
    DEFAULT_MIN,
    DEFAULT_MAX,
    parseAccuracyValue,
    parseAccuracyRange,
    parseAccuracyCliArgs,
    resolveAccuracyConfig,
    pickTarget,
    createAccuracyRun,
    makeTypo,
    makeTypoFor,
    pickDistractorIndex,
};
