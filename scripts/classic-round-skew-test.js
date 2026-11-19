// Regression test for issue #234: comma/semicolon round skew
// ("eight, 8" detected vs "eight; 8" graded) must keep answering from the
// learned correction, and every answerQuestions exit must log its reason.
// Uses the shared production dictionary (lib/classic-dict) so the test fails
// if production stops using questionVariants or handles rejections wrongly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanString, questionKeyVariants } = require('../lib/question-keys');
const {
    answerCandidates: sharedAnswerCandidates,
    mergeCandidates: sharedMergeCandidates,
    hasCandidates: sharedHasCandidates,
    findCandidate: sharedFindCandidate,
    learnEntryIn: sharedLearnEntry,
    recordRejectionIn: sharedRecordRejection,
} = require('../lib/classic-dict');

// 1. cleanString is shared across renderings.
assert.equal(cleanString('eight, 8'), 'eight');
assert.equal(cleanString('eight; 8'), 'eight');
assert.equal(cleanString('eight'), 'eight');

// 2. Variants are symmetric: learning under one rendering indexes the other.
const fromSemi = questionKeyVariants('eight; 8');
assert.ok(fromSemi.includes('eight; 8'), 'semi variant keeps literal');
assert.ok(fromSemi.includes('eight, 8'), 'semi variant also indexes comma literal (issue #234)');
assert.ok(fromSemi.includes('eight'), 'semi variant indexes clean key');

const fromComma = questionKeyVariants('eight, 8');
assert.ok(fromComma.includes('eight, 8'), 'comma variant keeps literal');
assert.ok(fromComma.includes('eight; 8'), 'comma variant also indexes semicolon rendering');
assert.ok(fromComma.includes('eight'), 'comma variant indexes clean key');

// trimming / empty safety
assert.deepEqual(questionKeyVariants('  eight; 8  ')[0], 'eight; 8');
assert.ok(!questionKeyVariants('').includes(''), 'empty never indexes ""');
assert.ok(!questionKeyVariants('   ').includes(''), 'whitespace never indexes ""');

// 3. Learn/find symmetry via shared production functions.
let candidatesDict = Object.create(null);
let rejectedDict = Object.create(null);
function learnEntry(question, rawAnswer, incomingFirst = true) {
    return sharedLearnEntry(candidatesDict, question, rawAnswer, incomingFirst);
}
function recordRejection(question, answer) {
    return sharedRecordRejection(rejectedDict, question, answer);
}
function findAnswer(question) {
    const { candidate, hadCandidates } = sharedFindCandidate(candidatesDict, rejectedDict, question);
    if (candidate !== null) return candidate;
    if (hadCandidates) return null;
    return `RANDOM-${question}`;
}

// Shared builder sanity: production candidate order for the fixture.
const built = sharedAnswerCandidates('八, bā');
assert.ok(built.includes('八, bā'), 'shared builder keeps full answer');
assert.ok(built.includes('八'), 'shared builder keeps piece');
assert.ok(sharedMergeCandidates(['a'], ['b']).includes('a'), 'shared merge keeps existing');
assert.equal(sharedHasCandidates(candidatesDict, 'eight, 8'), false, 'unknown has no candidates');

// Simulate the issue: unknown "eight, 8", modal grades "eight; 8" -> "八, bā".
assert.ok(findAnswer('eight, 8').startsWith('RANDOM'), 'unknown probe before learning');
recordRejection('eight; 8', 'YCVYg6MIo');
const learned = learnEntry('eight; 8', '八, bā');
assert.equal(learned, true, 'modal correction adds new candidates');
assert.equal(sharedHasCandidates(candidatesDict, 'eight, 8'), true, 'post-learn comma rendering is known via shared variants');
const next = findAnswer('eight, 8');
assert.ok(['八, bā', '八', 'bā'].includes(next), `post-learning lookup for "eight, 8" returns learned candidate, got ${next}`);
assert.equal(findAnswer('eight; 8'), next, 'semicolon rendering returns the same top candidate');
assert.equal(findAnswer('eight'), next, 'clean key returns the same top candidate');

// Rejection is symmetric: a rejection under one rendering blocks the other.
candidatesDict = Object.create(null);
rejectedDict = Object.create(null);
learnEntry('eight; 8', '八, bā');
recordRejection('eight, 8', '八, bā');
assert.equal(findAnswer('eight; 8'), '八', 'rejected full answer under comma variant is skipped via semicolon lookup (union)');

// All-rejected stays distinct from unknown: candidates exist but all blocked.
candidatesDict = Object.create(null);
rejectedDict = Object.create(null);
learnEntry('eight; 8', 'solo');
recordRejection('eight, 8', 'solo');
assert.equal(findAnswer('eight, 8'), null, 'all-rejected returns null (caller escalates), not a random probe');

// 4. Stop paths emit a reason line (issue #234 debuggability).
// Every answerQuestions break must log "Answer loop stopping:" — checked
// structurally (each break preceded by the log), not by matching a fixed
// list of strings, so a future break without a reason fails the test.
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert.ok(indexSrc.includes('answerLoop Exited.'), 'exit line keeps historic substring');
const answerQuestionsStart = indexSrc.indexOf('async function answerQuestions()');
assert.ok(answerQuestionsStart !== -1, 'answerQuestions found');
const answerQuestionsEnd = indexSrc.indexOf('function startLoop()', answerQuestionsStart);
assert.ok(answerQuestionsEnd !== -1, 'answerQuestions end found');
const loopSrc = indexSrc.slice(answerQuestionsStart, answerQuestionsEnd);
const loopLines = loopSrc.split('\n');
let breakCount = 0;
for (let i = 0; i < loopLines.length; i++) {
    if (loopLines[i].trim() !== 'break;') continue;
    // Inner stabilization-loop success breaks out of its `for`, not the run.
    if (i > 0 && loopLines[i - 1].trim() === 'unstable = false;') continue;
    breakCount += 1;
    const window = loopLines.slice(Math.max(0, i - 8), i + 1).join('\n');
    assert.ok(
        window.includes('Answer loop stopping:'),
        `break at answerQuestions line ${i + 1} must be preceded by an "Answer loop stopping:" reason`,
    );
}
assert.ok(breakCount >= 10, `expected many guarded breaks, found ${breakCount}`);

// 5. Unknown-probe advance heuristic: unknown random probes (no candidates)
// and all-rejected randoms must both pass true to every classic advance wait,
// so a submit-clear never false-accepts before the correction modal.
assert.ok(indexSrc.includes('isRandomProbe'), 'waitForAdvance takes a random-probe flag');
assert.ok(indexSrc.includes('CLEAR_GRACE_MS'), 'cleared-box grace is implemented');
assert.ok(indexSrc.includes('unknownProbe'), 'unknown probes tracked separately from randomRound');
assert.ok(
    indexSrc.includes('const isRandomProbe = randomRound || unknownProbe'),
    'advance flag unions both random kinds',
);
assert.ok(
    indexSrc.includes('lastSubmitted = { question, answer, isRandomProbe, randomRound }'),
    'stall guard remembers both the probe flag (advance wait) and randomRound (futility)',
);
const classicWaits = [...indexSrc.matchAll(/await waitForAdvance\(question,[^;]*?\)/g)].map(m => m[0]);
assert.ok(classicWaits.length >= 4, `expected classic advance waits, found ${classicWaits.length}`);
for (const call of classicWaits) {
    assert.ok(
        call.includes('isRandomProbe') || call.includes('stalledProbe'),
        `classic advance wait must pass the probe flag, got: ${call}`,
    );
}
assert.ok(
    !classicWaits.some(call => /,\s*randomRound\s*\)$/.test(call)),
    'no classic advance wait passes randomRound alone (issue #258: unknown probes would miss)',
);
// 6. Futility counting uses randomRound alone: the descriptor-gone fallback
// and stalled-wait modal paths must forward the submission's randomRound,
// not isRandomProbe (unknown probes were not pre-counted; passing
// isRandomProbe would skip the unreadable-modal increment and spin forever).
assert.ok(
    indexSrc.includes('lastSubmitted?.randomRound ?? false'),
    'descriptor-gone modal fallback forwards randomRound (issue #258)',
);
assert.ok(
    indexSrc.includes('lastSubmitted?.randomRound ?? randomRound'),
    'stalled modal path forwards the submission randomRound',
);
const modalForwards = [...indexSrc.matchAll(/await handleModalAndContinue\([^;]*?\)/g)].map(m => m[0]);
for (const call of modalForwards) {
    assert.ok(
        !call.includes('isRandomProbe'),
        `modal forward must pass randomRound, not isRandomProbe, got: ${call}`,
    );
}

console.log('Classic round-skew (#234): symmetric ,/; keys learn-and-continue, futility bounds intact, and every stop path logs a reason.');
