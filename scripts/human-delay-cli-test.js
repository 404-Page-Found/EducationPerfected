// Interactive `delay` command wiring (issue #221): report, on/off, seconds
// override, reset, and rejection of unparseable ranges, driven through the
// real CLI against the mock EP server. The harness boot (EP_TEST_BOOT=1)
// starts with pacing off so suites keep their speed.
const assert = require('node:assert/strict');
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { bootCli, fixtureLogin } = require('./cli-test-harness');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { child, wait, command, output } = bootCli(origin);
    let browser;
    try {
        const login = await fixtureLogin(wait, output);
        browser = login.browser;
        await wait(() => output().includes('Commands: start'));
        assert.ok(output().includes('delay'), 'the commands line must list delay');
        await command('delay', 'Answer pacing: off (super speed)'); // harness boot starts un paced
        await command('delay on', 'Answer pacing: per-question-type ranges');
        await command('delay', 'Answer pacing: per-question-type ranges');
        await command('delay 2-6', 'Answer pacing: 2-6s (custom)');
        await command('delay 1.5-4', 'Answer pacing: 1.5-4s (custom)');
        await command('delay reset', 'Answer pacing: per-question-type ranges');
        await command('delay bogus', 'Use delay, delay on, delay off, delay MIN-MAX or delay reset (seconds).');
        await command('delay 9-2', 'Use delay, delay on, delay off, delay MIN-MAX or delay reset (seconds).');
        await command('delay off', 'Answer pacing: off (super speed)');
        await command('delay', 'Answer pacing: off (super speed)');
        console.log('Human-delay CLI: report, on/off, seconds override, reset and invalid-range refusal PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { cleanupTestProcess(child); } catch { /* already gone */ }
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
