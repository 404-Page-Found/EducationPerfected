// Swallowed-Enter retry on the classic path, through the real CLI against
// mock-ep (generic successor to the coverage that lived in the retired
// accuracy-cli-test): swallowing the FIRST Enter leaves the round unresolved,
// and a box that drifts before the retry must be restored (the enterClassic
// guard refuses to press Enter over a mismatched box), then the retry submits
// and the run still completes rather than stopping.
// Synthetic only; never touches the live site.
const assert = require('node:assert/strict');
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { bootCli, fixtureLogin } = require('./cli-test-harness');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { child, wait, command, output } = bootCli(origin, { extraEnv: { EP_TEST_ADVANCE_TIMEOUT: '1200' } });
    let browser;
    try {
        const login = await fixtureLogin(wait, output);
        browser = login.browser;
        const page = login.page;
        await wait(() => output().includes('Commands: start'));
        await page.goto(origin + '/task');
        await command('refresh', 'Word Lists Refreshed. 5 entries');
        await page.goto(origin + '/task/play');
        // Swallow ONLY the first Enter on the answer box (capture listener beats
        // the fixture's own keydown handler), then drift the box to a wrong value
        // so the retry must restore the typed answer before resubmitting.
        await page.evaluate(() => {
            window.__swallowEnters = 1;
            document.getElementById('answer-text').addEventListener('keydown', event => {
                if (event.key === 'Enter' && window.__swallowEnters > 0) {
                    window.__swallowEnters -= 1;
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    event.target.value = 'a wrong drifted value';
                }
            }, true);
        });

        await command('start', '"state":"running"');
        await wait(() => output().includes('did not advance within'));
        await wait(() => output().includes('Restoring the answer in the box before the retry.'));
        await wait(() => output().includes('answerLoop Exited.'));
        await command('status', '"state":"completed"');
        for (const failure of ['Enter-retry timeout', 'pre-submit guard refused', 'did not advance after submitting'])
            assert.ok(!output().includes(failure),
                'a swallowed first Enter must recover, not stop the run: ' + output());
        console.log('Classic Enter-retry: swallowed-Enter restore-and-complete PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { cleanupTestProcess(child); } catch { /* already gone */ }
        try { server.close(); } catch { /* already closed */ }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
