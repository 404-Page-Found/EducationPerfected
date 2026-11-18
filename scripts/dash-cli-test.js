// Dash timed sprint (issue #230) through the real CLI against the synthetic
// /dash-task fixture in scripts/mock-ep.js:
// - starting a timed run with an empty word list reports clearly (a dash timer
//   with nothing learned means every first answer is guessed from the
//   wrong-answer modal and each guess burns the clock) instead of silently
//   mistyping through the sprint;
// - after Refresh Words on the starter page, the same timed run completes
//   through the classic loop with no warning.
// Synthetic only; never touches the live site.
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { bootCli, fixtureLogin } = require('./cli-test-harness');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { child, wait, command, output } = bootCli(origin, {});
    let browser;
    try {
        const login = await fixtureLogin(wait, output);
        browser = login.browser;
        const page = login.page;
        await wait(() => output().includes('Commands: start'));

        // No refresh: the dictionary is empty, so a timed run must say so.
        await page.goto(origin + '/dash-task/play');
        await command('start', '"state":"running"');
        await wait(() => output().includes('Timed task detected (dash timer) with an empty word list'));
        await command('stop', '"state":"stopped"');

        // After Refresh Words on the starter page, the same timed run warns no
        // more and completes through the classic loop.
        await page.goto(origin + '/dash-task');
        await command('refresh', 'Word Lists Refreshed. 5 entries');
        await page.goto(origin + '/dash-task/play');
        const offset = output().length;
        await command('start', '"state":"running"');
        await wait(() => output().slice(offset).includes('answerLoop Exited.'));
        if (output().slice(offset).includes('Timed task detected')) {
            throw new Error('timed warning printed despite a refreshed word list');
        }
        await command('status', '"state":"completed"');
        console.log('Dash: empty-list timed start warns; refreshed timed run completes without the warning PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { cleanupTestProcess(child); } catch { /* already gone */ }
        try { server.close(); } catch { /* already closed */ }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
