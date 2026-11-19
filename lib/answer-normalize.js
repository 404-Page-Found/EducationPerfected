// Answer-box verification normalization (issue #232).
// EP's input handling can IME-convert punctuation after typing: the shipped
// answer `你饿了吗?` (halfwidth U+003F) arrives in the box as `你饿了吗？`
// (fullwidth U+FF1F). The guard exists to refuse garbled text from EP's input
// race ("I speak" -> "I I sI speakeakat"), so it must stay strict for real
// content drift and only fold the halfwidth/fullwidth punctuation pairs EP
// normalizes.
const FULLWIDTH_TO_HALF = Object.freeze({
    '？': '?',
    '！': '!',
    '，': ',',
    '。': '.',
    '．': '.',
    '：': ':',
    '；': ';',
    '（': '(',
    '）': ')',
});
const NORMALIZE_PATTERN = /[？！，。．：；（）]/g;
// NFKC folds fullwidth ASCII (？！，：；（）．) to halfwidth automatically;
// the explicit map covers U+3002 。 (ideographic full stop) which NFKC leaves
// distinct, and keeps the helper correct when String.normalize is unavailable.
function normalizeAnswerText(value) {
    if (typeof value !== 'string') return value;
    let folded = value;
    try {
        folded = folded.normalize('NFKC');
    } catch {
        // keep the raw value; the explicit map below still applies.
    }
    return folded.replace(NORMALIZE_PATTERN, ch => FULLWIDTH_TO_HALF[ch] ?? ch);
}
// True when the box holds exactly what was typed, or EP's normalized form of
// it. Null (vanished box) and non-strings never match: callers handle the
// round transition separately. Length/content drift beyond the punctuation
// map still mismatches, so true garbles keep refusing to submit.
function boxMatchesAnswer(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') return false;
    if (actual === expected) return true;
    return normalizeAnswerText(actual) === normalizeAnswerText(expected);
}
module.exports = { normalizeAnswerText, boxMatchesAnswer };
