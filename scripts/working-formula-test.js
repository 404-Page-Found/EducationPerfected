const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playWorkingFormulaRound } = require('../lib/working-formula-handler');
// The working-formula maths editor (issue #113): one slide with EP's "Add a
// line of working" editor, three shipped correct steps. One pass types the
// exact steps, verifies each row's read-back, one guarded Submit, advance.
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        const setup = (variant) => page.goto(origin + '/lesson-working-formula' + (variant ? '?variant=' + variant : ''));
        await setup();
        let d = await detectQuestion(page);
        assert.equal(d.kind, 'workingformula', JSON.stringify(d));
        assert.equal(d.stepCount, 3);
        assert.equal(d.autoMarked, true);
        const result = await playWorkingFormulaRound(page, d, { enter: true, timeout: 3000 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        // Every typed row finalised CORRECT against the shipped steps,
        // exactly one trusted Submit, question advanced to a fresh editor.
        assert.deepEqual(await page.evaluate(() => workingFormulaFixture.finalized), ['CORRECT', 'CORRECT', 'CORRECT']);
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex, workingFormulaFixture.nexts]), [1, 1, 0]);
        assert.deepEqual(await page.evaluate(() => workingFormulaFixture.state.formulaInput.rows.map(r => r.model.value)), ['']);
        // Fill-only (semi mode): all rows typed, never submitted.
        await setup(); d = await detectQuestion(page);
        const filled = await playWorkingFormulaRound(page, d, { enter: false, timeout: 0 });
        assert.equal(filled.status, 'filled', JSON.stringify(filled));
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex]), [0, 0]);
        // Delayed Submit enablement: the readiness wait still submits once.
        await setup('delayed'); d = await detectQuestion(page);
        const delayed = await playWorkingFormulaRound(page, d, { enter: true, timeout: 2000 });
        assert.equal(delayed.status, 'advanced', JSON.stringify(delayed));
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex]), [1, 1]);
        // Refusals leave the editor untouched: prefilled working, two correct
        // sets, a hint step, freeform without shipped answers, manual marking.
        for (const variant of ['prefilled', 'twosets', 'hints', 'freeform', 'unmarked']) {
            await setup(variant);
            d = await detectQuestion(page);
            if (variant === 'unmarked') {
                assert.equal(d.kind, 'workingformula', variant);
                const stopped = await playWorkingFormulaRound(page, d, { enter: true, timeout: 0 });
                assert.equal(stopped.status, 'stopped', variant); // autoMarked 'unknown' fails closed
            } else {
                assert.equal(d.kind, 'unsupported', variant + ': ' + JSON.stringify(d));
            }
            // prefilled keeps its stored row; unmarked holds the typed fill
            // but never submits; the rest never touch the editor.
            const untouched = variant === 'prefilled' ? [0, 1] : variant === 'unmarked' ? [0, 3] : [0, 0];
            assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.state.formulaInput.getWorkingSteps().length]), untouched, variant);
        }
        // Tamper between fill and Submit: rewriting a row after the fill
        // trips the submit-read verification; the round stops, unclicked.
        await setup(); d = await detectQuestion(page);
        await page.evaluate(() => {
            const input = workingFormulaFixture.state.formulaInput;
            const origAdd = input.addFormulaRow.bind(input);
            input.addFormulaRow = (...args) => {
                const row = origAdd(...args);
                if (input.rows.length === 3) setTimeout(() => { input.rows[0].model.value = 'tampered'; }, 0);
                return row;
            };
        });
        const tampered = await playWorkingFormulaRound(page, d, { enter: true, timeout: 1000 });
        assert.equal(tampered.status, 'stopped', JSON.stringify(tampered));
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex]), [0, 0]);
        console.log('Working-formula editor: typed rows verified, one Submit, fill-only semi mode, delayed readiness, five refusals, tamper stop PASS');
    } finally { try { if (browser) await browser.close(); } finally { await new Promise(r => server.close(r)); } }
})().catch(e => { console.error(e); process.exitCode = 1; });
