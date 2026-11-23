// Tests for classic word-to-word answering from the round model's shipped
// validAnswers, live-captured 2026-11-23 with the read-only
// EP_CLASSIC_ANSWERS_READONLY check (gameMode 1, questionType 0,
// translationMode 0, valid contentID/questionIndex, one validAnswers entry
// whose outputString is the answer, not the prompt):
//
//   1. handler level: the classic text branch of detectQuestion returns the
//      answers only for the captured shape, and every deviation (empty
//      validAnswers, other question/translation mode, invalid identity, the
//      older answerless model) stays answerless so the loop keeps its
//      dictionary + wrong-answer-modal learning.
//   2. integration level: the REAL index.js answer loop (EP_TEST_BOOT=1
//      against the mock) completes /task/play-answers first-try - no random
//      probe, no wrong-answer modal - while the answerless /task/play route
//      still exercises modal learning.
//
//   node scripts/classic-model-answers-test.js
//
// Exits 0 when every check passes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { createServer, WORDS } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { bootCli, fixtureLogin } = require('./cli-test-harness');
const { cleanupTestProcess } = require('./test-process-cleanup');

(async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        // -----------------------------------------------------------------
        // handler level: detection returns answers only for the captured shape
        // -----------------------------------------------------------------
        const browser = await puppeteer.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.goto(`${origin}/task/play-answers`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#question-text', { timeout: 5000 });

            const first = await detectQuestion(page);
            assert.equal(first.kind, 'text');
            assert.equal(first.text, WORDS[0][0]);
            assert.deepEqual(first.answers, [WORDS[0][1]], 'captured shape ships the round answer');
            console.log('  ok  classic round detected with the model answer');

            const mutate = (fn, arg) => page.evaluate((source, value) => {
                const q = window.__classicAnswersSelf.model._currentQuestion;
                new Function('q', 'value', source)(q, value);
            }, fn, arg);

            await mutate('q.validAnswers = [];');
            assert.equal((await detectQuestion(page)).answers, undefined, 'empty validAnswers stays answerless');
            console.log('  ok  empty validAnswers stays answerless');

            await mutate('q.validAnswers = [{ outputString: value }];', WORDS[0][1]);
            assert.deepEqual((await detectQuestion(page)).answers, [WORDS[0][1]], 'restored shape answers again');

            await mutate('q.questionType = 1;');
            assert.equal((await detectQuestion(page)).answers, undefined, 'other questionType stays answerless');
            await mutate('q.questionType = 0; q.translationMode = 2;');
            assert.equal((await detectQuestion(page)).answers, undefined, 'other translationMode stays answerless');
            await mutate('q.translationMode = 0; q.contentID = "88001";');
            assert.equal((await detectQuestion(page)).answers, undefined, 'non-integer contentID stays answerless');
            await mutate('q.contentID = 88001; q.questionIndex = -1;');
            assert.equal((await detectQuestion(page)).answers, undefined, 'negative questionIndex stays answerless');
            console.log('  ok  deviations from the captured shape stay answerless');

            // The pre-capture model (no validAnswers at all) is the /task/play
            // shape: detection still classifies the round as text, just
            // without answers, so the loop's modal learning runs unchanged.
            await page.goto(`${origin}/task/play`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#question-text', { timeout: 5000 });
            const plain = await detectQuestion(page);
            assert.equal(plain.kind, 'text');
            assert.equal(plain.answers, undefined, 'answerless model keeps the fallback path');
            console.log('  ok  answerless model keeps the dictionary/modal fallback');
        } finally {
            await browser.close().catch(() => {});
        }

        // -----------------------------------------------------------------
        // integration level: the real CLI answers every round first-try
        // -----------------------------------------------------------------
        const { child, wait, command, output } = bootCli(origin);
        let cliBrowser;
        try {
            const login = await fixtureLogin(wait, output);
            cliBrowser = login.browser;
            const page = login.page;
            await wait(() => output().includes('Commands: start'));
            await page.goto(`${origin}/task/play-answers`);
            // No word-list refresh on purpose: the dictionary starts empty,
            // so only the model's shipped answers can avoid random probes.
            await command('start', '"state":"running"');
            await wait(() => output().includes('answerLoop Exited.'));
            await command('status', '"state":"completed"');
            assert.ok(!output().includes('No answer found for'), 'no random probe for any round');
            assert.ok(!output().includes('Details after Incorrect Answer'), 'no wrong-answer modal for any round');
            const counters = await page.evaluate(() => ({
                submitted: localStorage.getItem('classicAnswersSubmitted'),
                wrong: localStorage.getItem('classicAnswersWrong'),
            }));
            assert.equal(counters.submitted, String(WORDS.length), 'one submission per round');
            assert.equal(counters.wrong, '0', 'no submission was graded wrong');
            console.log('  ok  real CLI completes the classic task first-try from the model answers');
        } finally {
            if (cliBrowser) await cliBrowser.close().catch(() => {});
            try { cleanupTestProcess(child); } catch {}
        }

        // -----------------------------------------------------------------
        // structural: the loop learns shipped answers only for the question
        // the stabilization pass proved (round-skew guard), and the fixture
        // route stays registered.
        // -----------------------------------------------------------------
        const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
        assert.ok(
            indexSrc.includes('Array.isArray(descriptor.answers) && descriptor.text === question'),
            'model answers are learned only for the stabilized question text',
        );
        const mockSrc = fs.readFileSync(path.join(__dirname, 'mock-ep.js'), 'utf8');
        assert.ok(mockSrc.includes("'/task/play-answers'"), 'captured-shape fixture route registered');
        console.log('  ok  round-skew guard and fixture route in place');

        console.log('Classic model answers: captured shape answered first-try, every deviation keeps modal learning. PASS.');
    } finally {
        server.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
