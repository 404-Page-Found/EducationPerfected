const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playSlideSurfacesRound } = require('../lib/slide-surfaces-handler');
// The composed slide: one single-choice group (the base page's definite-
// article round, correct "l'") sharing a slide with one multi-select
// sibling surface (invented alpha/gamma correct). One pass answers both,
// one guarded Submit, one advance.
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        const setup = () => page.goto(origin + '/lesson-multi-single-choice');
        await setup();
        let d = await detectQuestion(page);
        assert.equal(d.kind, 'slide-surfaces', JSON.stringify(d));
        assert.equal(d.choiceSibling, true);
        assert.deepEqual(d.surfaces, ['MULTICHOICE_COMPONENT']);
        assert.deepEqual([d.choiceOptionCount, d.multiOptionCount], [4, 3]);
        assert.deepEqual(d.choice.correct, ["l'"]);
        const result = await playSlideSurfacesRound(page, d, { enter: true, timeout: 300 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        // The exact single-choice option is checked, the exact multi set
        // selected, exactly one trusted Submit, advance.
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('div.multi-choice-component[role=radiogroup] .mcq-preview-option')]
            .map(el => [el.querySelector('#render-group').textContent.trim(), el.querySelector('input').checked])), [['lo', false], ['la', false], ['il', false], ["l'", true]]);
        assert.deepEqual(await page.evaluate(() => multiFixture.clicks), [2, 0]);
        assert.deepEqual(await page.evaluate(() => [multiFixture.submits, multiFixture.q.questionIndex]), [1, 1]);
        // Fill-only (semi mode): both surfaces selected, never submitted.
        await setup(); d = await detectQuestion(page); let filled = 0;
        assert.equal((await playSlideSurfacesRound(page, d, { enter: false, timeout: 0, log: () => { filled++; }, shouldStop: () => filled >= 2 })).status, 'aborted');
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('div.multi-choice-component[role=radiogroup] input')].map(el => el.checked)), [false, false, false, true]);
        assert.deepEqual(await page.evaluate(() => JSON.stringify([...(multiFixture.state.selectedOptions || [])].sort((a, b) => a - b))), '[0,2]');
        assert.deepEqual(await page.evaluate(() => [multiFixture.submits, multiFixture.q.questionIndex]), [0, 0]);
        // Mixed marking across the sibling union refuses at detection: the
        // single-choice definition alone authored unmarked.
        await setup();
        await page.evaluate(() => { multiFixture.q.questionDef.Components[0].Marked = 0; });
        d = await detectQuestion(page);
        assert.equal(d.kind, 'unsupported');
        assert.equal(d.diagnostic?.guard, 'mixed-definition-marking');
        assert.deepEqual(await page.evaluate(() => multiFixture.clicks.length), 0);
        console.log('Slide-surfaces single-choice+multi: one pass, one Submit, fill-only semi mode, mixed-marking refusal PASS');
    } finally { try { if (browser) await browser.close(); } finally { await new Promise(r => server.close(r)); } }
})().catch(e => { console.error(e); process.exitCode = 1; });
