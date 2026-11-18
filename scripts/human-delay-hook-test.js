// The beforeSubmit hook (issue #221) fires exactly once per auto-mode round,
// after the answer is ready and before the one guarded Submit; semi mode
// never fires it. Driven against the synthetic choice fixture only.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playChoiceRound } = require('../lib/choice-handler');
const { setup } = require('./choice-renderer-fixture');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage();
        const origin = 'http://127.0.0.1:' + server.address().port;

        // Auto mode: hook fires once, before the Submit click lands.
        await setup(page, origin);
        await page.evaluate(() => {
            window.submitClickAt = 0;
            [...document.querySelectorAll('#sa-navigation-controls button')].find(button => button.textContent.trim() === 'Submit' && button.getClientRects().length).addEventListener('click', event => { event.stopImmediatePropagation(); window.submitClickAt = performance.now(); window.mathFixture.q.questionIndex++; }, true);
        });
        let delayAt = 0, calls = 0;
        const beforeSubmit = async () => { calls++; delayAt = await page.evaluate(() => performance.now()); };
        const descriptor = await detectQuestion(page);
        assert.equal(descriptor.kind, 'choice');
        const round = await playChoiceRound(page, descriptor, { enter: true, timeout: 1000, beforeSubmit });
        assert.equal(round.status, 'advanced', JSON.stringify(round));
        assert.equal(calls, 1, 'hook must fire exactly once per round');
        const clickAt = await page.evaluate(() => window.submitClickAt);
        assert.ok(clickAt > 0, 'fixture never saw the Submit click');
        assert.ok(delayAt <= clickAt, `hook at ${delayAt} must precede the Submit click at ${clickAt}`);

        // Semi mode: the user submits, so the hook never fires.
        await setup(page, origin);
        calls = 0;
        let selected = false;
        const semi = await playChoiceRound(page, await detectQuestion(page), { enter: false, timeout: 30, shouldStop: () => selected, log: message => { if (message.startsWith('Selected ')) selected = true; }, beforeSubmit: async () => { calls++; } });
        assert.equal(semi.status, 'aborted', JSON.stringify(semi));
        assert.equal(calls, 0, 'semi mode must not pace a submission the user makes');

        console.log('Human-delay hook: one paced wait before the guarded Submit in auto mode, none in semi mode PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
