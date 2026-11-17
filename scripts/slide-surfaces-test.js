const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playSlideSurfacesRound } = require('../lib/slide-surfaces-handler');
// The composed slide: one multi-select surface (invented alpha/gamma
// correct) sharing a slide with two number boxes. One pass fills every
// surface, one guarded Submit, one advance.
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        const setup = async () => {
            await page.goto(origin + '/lesson-multi-number-box');
            await page.evaluate(() => { const b = document.querySelector('#sa-navigation-controls button'), clone = b.cloneNode(true); clone.textContent = 'Next Question'; b.parentElement.append(clone); clone.click(); clone.remove(); });
            await page.evaluate(() => { dropdownNumberBoxFixture.nexts = 0; multiFixture.clicks = []; multiFixture.submits = 0; dropdownNumberBoxFixture.submits = 0; });
        };
        await setup();
        let d = await detectQuestion(page);
        assert.equal(d.kind, 'slide-surfaces', JSON.stringify(d));
        assert.deepEqual(d.surfaces, ['NUMBER_BOX_COMPONENT', 'MULTICHOICE_COMPONENT']);
        assert.deepEqual(d.numberBox.boxes.map(x => x.answer), ['30', '7']);
        assert.deepEqual(d.multi.correct, [0, 2]);
        const result = await playSlideSurfacesRound(page, d, { enter: true, timeout: 300 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        // Both surfaces were answered: exact box values typed per character,
        // the exact multi set selected, exactly one trusted Submit, advance.
        assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedBoxValues), [['30', '30'], ['7', '7']]);
        assert.deepEqual(await page.evaluate(() => multiFixture.clicks), [2, 0]);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.inputs.every(e => e.trusted), dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts, dropdownNumberBoxFixture.q.questionIndex, JSON.stringify([...(multiFixture.state.selectedOptions||[])].sort())]), [3, true, 1, 0, 1, '[0,2]']);
        // Fill-only (semi mode): every surface filled, never submitted.
        await setup(); d = await detectQuestion(page); let filled = 0;
        assert.equal((await playSlideSurfacesRound(page, d, { enter: false, timeout: 0, log: () => { filled++; }, shouldStop: () => filled >= 2 })).status, 'aborted');
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('input.number-box-component')].map(el => el.value)), ['30', '7']);
        assert.deepEqual(await page.evaluate(() => JSON.stringify([...(multiFixture.state.selectedOptions||[])].sort())), '[0,2]');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.q.questionIndex]), [0, 0]);
        // A refusal keeps every surface untouched: hide the multi surface's
        // correct answer by mutating its metadata before detection.
        await setup();
        await page.evaluate(() => { multiFixture.metadata.Options[0].Correct = 'false'; });
        d = await detectQuestion(page);
        assert.equal(d.kind, 'unsupported');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.inputs.length, multiFixture.clicks.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        console.log('Slide-surfaces handler: multi-select + number boxes fill in one pass, one Submit, fill-only semi mode, refusal untouched PASS');
    } finally { try { if (browser) await browser.close(); } finally { await new Promise(r => server.close(r)); } }
})().catch(e => { console.error(e); process.exitCode = 1; });
