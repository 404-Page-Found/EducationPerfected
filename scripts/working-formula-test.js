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
        // Fill-only: all rows typed, never submitted, returned at once.
        await setup(); d = await detectQuestion(page);
        const filled = await playWorkingFormulaRound(page, d, { fillOnly: true, enter: false, timeout: 0 });
        assert.equal(filled.status, 'filled', JSON.stringify(filled));
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex]), [0, 0]);
        // Semi mode: the verified fill waits for the user's own Submit; the
        // round resolves only when that manual submit advances the question.
        await setup(); d = await detectQuestion(page);
        const semiRound = playWorkingFormulaRound(page, d, { enter: false, timeout: 0 });
        await page.waitForFunction(() => workingFormulaFixture.finalized.length === 3);
        assert.equal(await page.evaluate(() => workingFormulaFixture.submits), 0, 'semi mode must never submit');
        await page.evaluate(() => [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit').click());
        const semi = await semiRound;
        assert.equal(semi.status, 'advanced', JSON.stringify(semi));
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex]), [1, 1]);
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
            assert.equal(d.kind, 'unsupported', variant + ': ' + JSON.stringify(d));
            // prefilled keeps its stored row; the rest never touch the editor.
            const untouched = variant === 'prefilled' ? [0, 1] : [0, 0];
            assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.state.formulaInput.getWorkingSteps().length]), untouched, variant);
        }
        // A misbound cached association refuses with the failed field named.
        await setup('misbound');
        d = await detectQuestion(page);
        assert.equal(d.kind, 'unsupported', JSON.stringify(d));
        assert.ok((d.reason || '').includes('visual element'), JSON.stringify(d));
        assert.equal(await page.evaluate(() => workingFormulaFixture.state.formulaInput.getWorkingSteps().length), 0);
        // Submit enablement that never arrives: the readiness wait expires
        // and the round stops without a click.
        await setup('delayed'); d = await detectQuestion(page);
        await page.evaluate(() => { workingFormulaFixture.neverEnable = true; });
        const neverReady = await playWorkingFormulaRound(page, d, { enter: true, timeout: 500 });
        assert.equal(neverReady.status, 'stopped', JSON.stringify(neverReady));
        assert.equal(await page.evaluate(() => workingFormulaFixture.submits), 0);
        // Tamper at Submit enablement: rewriting a row in the same instant
        // Submit re-enables trips the submit-read verification; the round
        // stops at the submit-target guard, unclicked.
        await setup('delayed'); d = await detectQuestion(page);
        await page.evaluate(() => {
            const submit = [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit');
            let disabled = true;
            Object.defineProperty(submit, 'disabled', {
                get: () => disabled,
                set: value => { disabled = value; if (value === false) workingFormulaFixture.state.formulaInput.rows[0].model.value = 'tampered'; },
            });
        });
        const tampered = await playWorkingFormulaRound(page, d, { enter: true, timeout: 2000 });
        assert.equal(tampered.status, 'stopped', JSON.stringify(tampered));
        assert.equal(tampered.diagnostic.guard, 'final-state-mismatch', JSON.stringify(tampered));
        assert.deepEqual(await page.evaluate(() => [workingFormulaFixture.submits, workingFormulaFixture.q.questionIndex]), [0, 0]);
        console.log('Working-formula editor: typed rows verified, one Submit, fill-only and semi-manual-submit modes, delayed and never-arriving readiness, five refusals, submit-time tamper stop PASS');
    } finally { try { if (browser) await browser.close(); } finally { await new Promise(r => server.close(r)); } }
})().catch(e => { console.error(e); process.exitCode = 1; });
