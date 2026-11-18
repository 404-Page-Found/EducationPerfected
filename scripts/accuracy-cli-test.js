// Random accuracy (issue #222) through the real CLI against mock-ep:
// - interactive `accuracy` command: query (also read-only during a run),
//   validation messages, off/range/fixed changes while stopped, and the
//   stopped-state guard for changes during a run.
// - EP_ACCURACY=0 forces a first-try mistake on every classic question, so
//   the whole run exercises the typo path end to end.
// - Swallowing the FIRST Enter leaves the typo in the box: the retry must
//   restore the correct answer (the enterClassic guard refuses a mismatched
//   box) and the run must still complete, rather than stopping.
// Synthetic only; never touches the live site.
const assert = require('node:assert/strict');
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { bootCli, fixtureLogin } = require('./cli-test-harness');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { child, wait, command, output } = bootCli(origin, { extraEnv: { EP_ACCURACY: '0', EP_TEST_ADVANCE_TIMEOUT: '1200' } });
    let browser;
    try {
        const login = await fixtureLogin(wait, output);
        browser = login.browser;
        const page = login.page;
        await wait(() => output().includes('Commands: start'));
        assert.ok(output().includes('accuracy'), 'the commands line must list accuracy');

        // Stopped: query, validation feedback, and every change form.
        await command('accuracy', '"enabled":true'); // EP_ACCURACY=0 explicitly enables accuracy under EP_TEST_BOOT
        await command('accuracy 101', 'Accuracy must be 0-100.');
        await command('accuracy bogus', 'Usage: accuracy');
        await command('accuracy off', 'Accuracy disabled (100% - perfect).');
        await command('accuracy', '"enabled":false');
        await command('accuracy 70-90', 'Accuracy band set to 70-90%');
        await command('accuracy 0', 'Accuracy target set to 0% (fixed).');

        // Learn the word list, then open the classic task page.
        await page.goto(origin + '/task');
        await command('refresh', 'Word Lists Refreshed. 5 entries');
        await page.goto(origin + '/task/play');
        // Swallow ONLY the first Enter on the answer box (capture listener beats
        // the fixture's own keydown handler), leaving the injected typo in the box.
        await page.evaluate(() => {
            window.__swallowEnters = 1;
            document.getElementById('answer-text').addEventListener('keydown', event => {
                if (event.key === 'Enter' && window.__swallowEnters > 0) {
                    window.__swallowEnters -= 1;
                    event.stopImmediatePropagation();
                    event.preventDefault();
                }
            }, true);
        });

        await command('start', '"state":"running"');
        await wait(() => output().includes('Accuracy target 0% for this run'));
        // Read-only query stays available during a run; changes are refused.
        await command('accuracy', '"enabled":true');
        await command('accuracy 82', 'Stop the run before changing accuracy.');

        await wait(() => output().includes('Accuracy mistake for "one"'));
        await wait(() => output().includes('Restoring the correct answer in the box before the retry.'));
        await wait(() => output().includes('answerLoop Exited.'));
        await command('status', '"state":"completed"');
        assert.ok(output().includes('Accuracy this run: target 0%, first-try 0/5 (0.0%).'),
            'every forced mistake must be counted after its confirmed submission: ' + output());
        console.log('Accuracy CLI: query/validation/guard, forced-typo run, swallowed-Enter restore-and-complete PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { cleanupTestProcess(child); } catch { /* already gone */ }
    }

    // Issue #229: the top-level `accuracy <n>` subcommand launches the run with
    // that accuracy setting (same meaning as the run flags).
    const sub = bootCli(origin, { args: ['accuracy', '0'] });
    let subBrowser;
    try {
        const login = await fixtureLogin(sub.wait, sub.output);
        subBrowser = login.browser;
        const page = login.page;
        await sub.wait(() => sub.output().includes('Commands: start'));
        await page.goto(origin + '/task');
        await sub.command('refresh', 'Word Lists Refreshed. 5 entries');
        await page.goto(origin + '/task/play');
        await sub.command('start', '"state":"running"');
        await sub.wait(() => sub.output().includes('Accuracy target 0% for this run (band 70-90%, cli:--accuracy).'));
        await sub.command('accuracy', '"fixedTarget":0');
        await sub.wait(() => sub.output().includes('answerLoop Exited.'));
        await sub.command('status', '"state":"completed"');
        console.log('Accuracy subcommand: top-level accuracy <n> reaches the run PASS. Synthetic only.');
    } finally {
        if (subBrowser) await subBrowser.close().catch(() => {});
        try { cleanupTestProcess(sub.child); } catch { /* already gone */ }
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
