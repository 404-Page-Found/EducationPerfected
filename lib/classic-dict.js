// Shared classic Q&A dictionary (issue #234).
// Single source for answer candidate building, merging, learning, rejection
// and lookup so production (index.js) and regression tests exercise the same
// code. All dict reads/writes index the symmetric questionKeyVariants set so
// a correction learned under one "," / ";" rendering is found from the other.
const { questionKeyVariants } = require('./question-keys');

/**
 * Builds an ordered list of candidate answers from a raw answer string.
 * Handles EP's different join formats (; , |) and produces candidates in priority order:
 * joined groups, whole groups, full display string, then bare pieces.
 * @param {string} rawAnswer
 * @returns {string[]}
 */
function answerCandidates(rawAnswer) {
    const text = String(rawAnswer)
        .replace(/\([^)]*\)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (text === '') return [];

    const candidates = [];
    const seen = new Set();
    const push = value => {
        const trimmed = value.trim();
        if (trimmed !== '' && !seen.has(trimmed)) {
            seen.add(trimmed);
            candidates.push(trimmed);
        }
    };

    // ";" and "|" both separate whole alternative answers; "," inside a
    // group is part of that answer's text
    const groups = text.split(/[;|]/).map(group => group.trim()).filter(group => group !== '');
    if (groups.length > 1 && groups.every(group => !/[;,]/.test(group))) {
        push(groups.join(", "));  // EP joins alternative phrases with ", "
    }
    // whole alternative answers first (all of them, then all pieces — the
    // pieces of group one must not be tried before group two's whole answer,
    // which strict grading is far likelier to accept)
    for (const group of groups) push(group);
    // the whole display string as written: the modal's "|" may separate
    // alternatives (per-group grading) or just join the one required
    // answer's parts; keeping this AFTER the group-fulls costs nothing when
    // per-group grading is right, and is the only candidate that can ever
    // match a whole-display grader
    if (groups.length > 1) push(text);
    // bare pieces last: each costs a wrong round under strict grading
    for (const group of groups) {
        for (const piece of group.split(",")) push(piece);
    }
    return candidates;
}

/**
 * Merges two candidate arrays, preserving order and deduplicating.
 * @param {string[]} existing
 * @param {string[]} incoming
 * @param {boolean} incomingFirst - If true, incoming candidates take priority
 * @returns {string[]}
 */
function mergeCandidates(existing, incoming, incomingFirst = true) {
    const merged = [];
    const seen = new Set();
    const ordered = incomingFirst
        ? [...(incoming || []), ...(existing || [])]
        : [...(existing || []), ...(incoming || [])];
    for (const candidate of ordered) {
        if (typeof candidate === 'string' && candidate.trim() !== '' && !seen.has(candidate)) {
            seen.add(candidate);
            merged.push(candidate);
        }
    }
    return merged;
}

/**
 * True when any key variant for the question holds at least one candidate.
 * Used to distinguish an unknown probe (no candidates -> random string)
 * from a known answer.
 * @param {object} candidatesDict
 * @param {string} question
 * @returns {boolean}
 */
function hasCandidates(candidatesDict, question) {
    for (const probe of questionKeyVariants(question)) {
        const key = String(probe).trim();
        if (key === '') continue;
        const list = candidatesDict[key];
        if (Array.isArray(list) && list.length > 0) return true;
    }
    return false;
}

/**
 * Pure lookup: first non-rejected candidate across all key variants.
 * Rejections are unioned across variants so a comma/semicolon skew cannot
 * resubmit a proven-wrong answer.
 * No logging, no random generation, no side effects.
 * @param {object} candidatesDict
 * @param {object} rejectedDict
 * @param {string} question
 * @returns {{candidate: string|null, hadCandidates: boolean}}
 */
function findCandidate(candidatesDict, rejectedDict, question) {
    const probes = questionKeyVariants(question);
    const unionRejected = new Set();
    for (const probe of probes) {
        const set = rejectedDict[String(probe).trim()];
        if (set) for (const value of set) unionRejected.add(value);
    }
    let hadCandidates = false;
    const visited = new Set();
    for (const probe of probes) {
        const key = String(probe).trim();
        if (key === '' || visited.has(key)) continue;
        visited.add(key);
        const candidates = candidatesDict[key];
        if (!candidates || candidates.length === 0) continue;
        hadCandidates = true;
        for (const candidate of candidates) {
            if (!unionRejected.has(candidate)) return { candidate, hadCandidates: true };
        }
    }
    return { candidate: null, hadCandidates };
}

/**
 * Registers candidate answers for a question under all key variants.
 * Mutates candidatesDict. Returns true if new candidates were added.
 * @param {object} candidatesDict
 * @param {string} question
 * @param {string} rawAnswer
 * @param {boolean} incomingFirst
 * @returns {boolean}
 */
function learnEntryIn(candidatesDict, question, rawAnswer, incomingFirst = true) {
    const incoming = answerCandidates(rawAnswer);
    if (incoming.length === 0) return false;
    let changed = false;
    for (const key of questionKeyVariants(question)) {
        if (key === '') continue;
        const before = candidatesDict[key] || [];
        const after = mergeCandidates(before, incoming, incomingFirst);
        if (after.length > before.length) changed = true;
        candidatesDict[key] = after;
    }
    return changed;
}

/**
 * Records that an answer was graded wrong for a question, under all variants.
 * Mutates rejectedDict.
 * @param {object} rejectedDict
 * @param {string} question
 * @param {string} answer
 */
function recordRejectionIn(rejectedDict, question, answer) {
    if (typeof answer !== 'string' || answer.trim() === '') return;
    for (const key of questionKeyVariants(question)) {
        if (key === '') continue;
        let rejected = rejectedDict[key];
        if (!rejected) {
            rejected = new Set();
            rejectedDict[key] = rejected;
        }
        rejected.add(answer);
    }
}

module.exports = {
    answerCandidates,
    mergeCandidates,
    hasCandidates,
    findCandidate,
    learnEntryIn,
    recordRejectionIn,
};
