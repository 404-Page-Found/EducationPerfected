const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playDropdownNumberBoxRound } = require('../lib/dropdown-numberbox-handler');
// EP enables Submit asynchronously once its own validation accepts every
// filled input (the live boxes+text-box failure: the one-shot submit read
// fired inside the disabled window and stopped as final-state-mismatch).
// The fixture re-disables Submit on every input event and re-enables it
// 120ms later; the round must wait the readiness out, then Submit once.
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        await page.goto(origin + '/lesson-dropdown-number-box?variant=boxes-textbox-delayed');
        const d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        const result = await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 2000 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.q.questionIndex]), [1, 1]);
        // A button that never enables is still a stop, not a click.
        await page.goto(origin + '/lesson-dropdown-number-box?variant=boxes-textbox-delayed');
        await page.evaluate(() => { dropdownNumberBoxFixture.neverEnable = true; });
        const d2 = await detectQuestion(page);
        const blocked = await playDropdownNumberBoxRound(page, d2, { enter: true, timeout: 200 });
        assert.equal(blocked.status, 'stopped');
        assert.equal(blocked.diagnostic?.guard, 'final-state-mismatch');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.q.questionIndex]), [0, 0]);
        console.log('Dropdown+number-box submit readiness: waits out async enablement, never-enabled still stops PASS');
    } finally { try { if (browser) await browser.close(); } finally { await new Promise(r => server.close(r)); } }
})().catch(e => { console.error(e); process.exitCode = 1; });
