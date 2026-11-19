const assert = require('node:assert/strict');
const { normalizeAnswerText, boxMatchesAnswer } = require('../lib/answer-normalize');
const { guardClassicEnter } = require('../lib/classic-enter');

// Logged case from issue #232: halfwidth ? vs fullwidth ？ must verify.
assert.equal(boxMatchesAnswer('你饿了吗?', '你饿了吗？'), true, 'logged audio case verifies');
assert.equal(boxMatchesAnswer('你饿了吗？', '你饿了吗?'), true, 'logged case is direction-independent');
assert.equal(normalizeAnswerText('你饿了吗？'), normalizeAnswerText('你饿了吗?'));

// Halfwidth/fullwidth pairs from the proposal: ? ! , . : ; ( ).
const pairs = [
    ['?', '？'],
    ['!', '！'],
    [',', '，'],
    ['.', '。'],
    [':', '：'],
    [';', '；'],
    ['(', '（'],
    [')', '）'],
];
for (const [half, full] of pairs) {
    const expected = `a${half}b`;
    const boxed = `a${full}b`;
    assert.equal(boxMatchesAnswer(expected, boxed), true, `${half}/${full} verifies`);
    assert.equal(boxMatchesAnswer(boxed, expected), true, `${full}/${half} verifies`);
    assert.equal(boxMatchesAnswer(expected, expected), true, 'exact still verifies');
}
// Fullwidth full stop folds via NFKC as well.
assert.equal(boxMatchesAnswer('a.b', 'a．b'), true, 'fullwidth full stop verifies');

// True garbles must still refuse: content/length drift beyond punctuation.
assert.equal(boxMatchesAnswer('I speak', 'I I sI speakeakat'), false, 'input-race garble refuses');
assert.equal(boxMatchesAnswer('hello', 'hallo'), false, 'letter drift refuses');
assert.equal(boxMatchesAnswer('hello?', 'hello!'), false, 'different punctuation refuses');
assert.equal(boxMatchesAnswer('你饿了吗?', '你饿了吗'), false, 'missing punctuation refuses');
assert.equal(boxMatchesAnswer('你饿了吗?', '你饿了吗？？'), false, 'extra punctuation refuses');
assert.equal(boxMatchesAnswer('answer', ''), false, 'cleared box refuses');
assert.equal(boxMatchesAnswer('answer', null), false, 'vanished box never matches');
assert.equal(boxMatchesAnswer('answer', undefined), false, 'missing box never matches');

// Classic dispatch guard submits the normalized box as-is (issue #232).
(async () => {
    let pressed = 0;
    const ok = await guardClassicEnter({
        readQuestion: async () => ({ kind: 'text', text: 'q' }),
        readValue: async () => '你饿了吗？',
        shouldStop: () => false,
        pressEnter: async () => { pressed += 1; },
        question: 'q',
        answer: '你饿了吗?',
        enter: true,
    });
    assert.equal(ok, true, 'guard accepts normalized punctuation');
    assert.equal(pressed, 1, 'guard submits normalized box');

    pressed = 0;
    const garbled = await guardClassicEnter({
        readQuestion: async () => ({ kind: 'text', text: 'q' }),
        readValue: async () => 'I I sI speakeakat',
        shouldStop: () => false,
        pressEnter: async () => { pressed += 1; },
        question: 'q',
        answer: 'I speak',
        enter: true,
    });
    assert.equal(garbled, false, 'guard still refuses garbles');
    assert.equal(pressed, 0, 'guard never submits garbles');
    console.log('Answer normalize: logged CJK case, 8 halfwidth/fullwidth pairs and garble refusals passed; classic guard submits normalized boxes as-is.');
})().catch(e => { console.error(e); process.exit(1); });
