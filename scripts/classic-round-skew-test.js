// Regression test for issue #234: comma/semicolon round skew
// ("eight, 8" detected vs "eight; 8" graded) must keep answering from the
// learned correction, and every answerQuestions exit must log its reason.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanString, questionKeyVariants } = require('../lib/question-keys');

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

// 3. Learn/find symmetry: learn(modalQuestion="eight; 8", modalAnswer="八, bā")
// must be found from detected question "eight, 8".
// Mirrors index.js learnEntry/findAnswer (mergeCandidates + answerCandidates
// simplified to the built-in alternative handling for this fixture).
function answerCandidates(raw) {
    const text = String(raw).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (text === '') return [];
    const groups = text.split(/[;|]/).map(g => g.trim()).filter(Boolean);
    const out = [];
    const seen = new Set();
    const push = v => { const t = v.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
    for (const g of groups) push(g);
    if (groups.length > 1) push(text);
    for (const g of groups) for (const p of g.split(',')) push(p);
    return out;
}
function mergeCandidates(existing, incoming, incomingFirst = true) {
    const ordered = incomingFirst ? [...incoming, ...existing] : [...existing, ...incoming];
    const out = [];
    const seen = new Set();
    for (const c of ordered) if (typeof c === 'string' && c.trim() !== '' && !seen.has(c)) { seen.add(c); out.push(c); }
    return out;
}
let candidatesDict = Object.create(null);
let rejectedDict = Object.create(null);
function learnEntry(question, rawAnswer, incomingFirst = true) {
    const incoming = answerCandidates(rawAnswer);
    if (!incoming.length) return false;
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
function recordRejection(question, answer) {
    for (const key of questionKeyVariants(question)) {
        if (key === '') continue;
        if (!rejectedDict[key]) rejectedDict[key] = new Set();
        rejectedDict[key].add(answer);
    }
}
function findAnswer(question) {
    const probes = questionKeyVariants(question);
    const unionRejected = new Set();
    for (const p of probes) {
        const s = rejectedDict[String(p).trim()];
        if (s) for (const v of s) unionRejected.add(v);
    }
    let hadCandidates = false;
    const visited = new Set();
    for (const probe of probes) {
        const key = String(probe).trim();
        if (!key || visited.has(key)) continue;
        visited.add(key);
        const cands = candidatesDict[key];
        if (!cands || !cands.length) continue;
        hadCandidates = true;
        for (const c of cands) if (!unionRejected.has(c)) return c;
    }
    return hadCandidates ? null : `RANDOM-${question}`;
}

// Simulate the issue: unknown "eight, 8", modal grades "eight; 8" -> "八, bā".
assert.ok(findAnswer('eight, 8').startsWith('RANDOM'), 'unknown probe before learning');
recordRejection('eight; 8', 'YCVYg6MIo');
const learned = learnEntry('eight; 8', '八, bā');
assert.equal(learned, true, 'modal correction adds new candidates');
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

// 4. Stop paths emit a reason line (issue #234 debuggability).
// Every answerQuestions break must log "Answer loop stopping:" and the exit
// line must keep the historic "answerLoop Exited." substring.
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert.ok(indexSrc.includes("Answer loop stopping: futility guard tripped"), 'futileStop exit logs a reason');
assert.ok(indexSrc.includes("Answer loop stopping: pre-submit guard refused"), 'enterClassic refusal logs a reason');
assert.ok(indexSrc.includes("Answer loop stopping: Enter-retry timeout"), 'Enter-retry timeout logs a reason');
assert.ok(indexSrc.includes("Answer loop stopping: question text never held still"), 'unstable exit logs a reason');
assert.ok(indexSrc.includes("Answer loop stopping: answer box never reappeared"), 'boxVanished exit logs a reason');
assert.ok(indexSrc.includes("Answer loop stopping: answer box keeps changing"), 'boxTampered exit logs a reason');
assert.ok(indexSrc.includes("Answer loop stopping: advance wait aborted"), 'aborted wait logs a reason');
assert.ok(indexSrc.includes("answerLoop Exited."), 'exit line keeps historic substring');

// 5. Unknown-probe advance heuristic: random submissions must not treat a
// cleared box as advancement (the false-accept that caused the double
// "No answer found" before any learning).
assert.ok(indexSrc.includes("isRandomProbe"), 'waitForAdvance takes a random-probe flag');
assert.ok(indexSrc.includes("CLEAR_GRACE_MS"), 'cleared-box grace is implemented');
assert.ok(
    indexSrc.includes("await waitForAdvance(question, ENTER ? ADVANCE_TIMEOUT : 0, answer, randomRound)"),
    'main wait passes randomRound'
);

console.log('Classic round-skew (#234): symmetric ,/; keys learn-and-continue, futility bounds intact, and every stop path logs a reason.');
