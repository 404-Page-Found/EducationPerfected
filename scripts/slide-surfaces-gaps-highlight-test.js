const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playSlideSurfacesRound } = require('../lib/slide-surfaces-handler');
const { playTamperedRound } = require('./slide-surfaces-test-helpers');
// The composed slide: one multi-select surface sharing a slide with one
// drag-and-drop gaps surface and one highlight surface. One pass fills every
// surface, one guarded Submit (the multi fixture owns the button), one
// advance. Refusals stay content-free and leave every surface untouched.
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        const setup = () => page.goto(origin + '/lesson-multi-gaps-highlight');
        await setup();
        let d = await detectQuestion(page);
        assert.equal(d.kind, 'slide-surfaces', JSON.stringify(d));
        assert.deepEqual(d.surfaces, ['FILL_IN_GAPS_COMPONENT', 'HIGHLIGHT_COMPONENT', 'MULTICHOICE_COMPONENT']);
        assert.deepEqual([d.gapCount, d.highlightTokenCount, d.multiOptionCount], [2, 5, 3]);
        const result = await playSlideSurfacesRound(page, d, { enter: true, timeout: 300 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        // Every surface was answered exactly: gaps filled in gap order with
        // trusted keys, the exact highlight token set clicked, the exact
        // multi set selected, exactly one Submit, advance.
        assert.deepEqual(await page.evaluate(() => gapsFixture.inputs), [{ index: 2, trusted: true }, { index: 1, trusted: true }]);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.fitg-inline-dropzone .dropzone-answer')].map(el => el.textContent)), ['beta', 'alpha']);
        assert.deepEqual(await page.evaluate(() => highlightFixture.clicks), [{ index: 1, trusted: true }, { index: 2, trusted: true }]);
        assert.deepEqual(await page.evaluate(() => highlightFixture.questionElement.userSelectedOptions), [1, 2]);
        assert.deepEqual(await page.evaluate(() => multiFixture.clicks), [2, 0]);
        assert.deepEqual(await page.evaluate(() => [multiFixture.submits, multiFixture.q.questionIndex]), [1, 1]);
        // Fill-only (semi mode): every surface filled, never submitted.
        await setup(); d = await detectQuestion(page); let filled = 0;
        assert.equal((await playSlideSurfacesRound(page, d, { enter: false, timeout: 0, log: () => { filled++; }, shouldStop: () => filled >= 3 })).status, 'aborted');
        assert.deepEqual(await page.evaluate(() => [gapsFixture.inputs.length, highlightFixture.clicks.length, multiFixture.clicks.length]), [2, 2, 2]);
        assert.deepEqual(await page.evaluate(() => [multiFixture.submits, multiFixture.q.questionIndex]), [0, 0]);
        // A prefilled highlight selection stops the round before any surface
        // is touched; stored or prefilled answers are never corrected.
        await setup();
        await page.evaluate(() => { highlightFixture.questionElement.userSelectedOptions.push(0); highlightFixture.tokens[0].classList.add('highlighted'); });
        d = await detectQuestion(page);
        assert.equal(d.kind, 'slide-surfaces', JSON.stringify(d));
        const stopped = await playSlideSurfacesRound(page, d, { enter: true, timeout: 0 });
        assert.equal(stopped.status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [gapsFixture.inputs.length, multiFixture.clicks.length, multiFixture.submits]), [0, 0, 0]);
        // Mixed marking across the union refuses at detection: the gaps
        // definition alone authored unmarked.
        await setup();
        await page.evaluate(() => { gapsFixture.comp.Marked = 0; });
        d = await detectQuestion(page);
        assert.equal(d.kind, 'unsupported');
        assert.equal(d.diagnostic?.guard, 'mixed-definition-marking');
        assert.deepEqual(await page.evaluate(() => [gapsFixture.inputs.length, highlightFixture.clicks.length, multiFixture.clicks.length]), [0, 0, 0]);
        // Tamper between fill and Submit: clearing a filled gap during the
        // last multi click trips the click-time re-verification; the round
        // stops without the Submit click.
        const tampered = await playTamperedRound(page, setup, () => detectQuestion(page),
            d => playSlideSurfacesRound(page, d, { enter: true, timeout: 300 }), 2, () => {
                const zone = gapsFixture.renderer.dropZones.find(z => z.droppedDragID !== null);
                zone.span.textContent = ''; zone.droppedDragID = null;
            });
        assert.equal(tampered.status, 'stopped');
        assert.equal(tampered.diagnostic?.guard, 'changed-before-submit');
        assert.deepEqual(await page.evaluate(() => [multiFixture.submits, multiFixture.q.questionIndex]), [0, 0]);
        console.log('Slide-surfaces gaps+highlight: one pass, one Submit, fill-only semi mode, prefilled/mixed-marking refusals, submit-time tamper stop PASS');
    } finally { try { if (browser) await browser.close(); } finally { await new Promise(r => server.close(r)); } }
})().catch(e => { console.error(e); process.exitCode = 1; });
