// Interactive `delay` command wiring (issue #221): report, on/off, seconds
// override, reset, and rejection of unparseable ranges, driven through the
// real CLI against the mock EP server. The harness boot (EP_TEST_BOOT=1)
// starts with pacing off so suites keep their speed.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
const puppeteer = require('puppeteer');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, EP_TEST_BOOT: '1', EP_LOGIN_URL: origin + '/app/login', EP_LOGIN_HOST: '127.0.0.1' };
    delete env.EP_EMAIL; delete env.EP_PASSWORD;
    const child = spawn(process.execPath, [path.join(__dirname, '../bin/cli.js')], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const wait = async predicate => {
        const limit = Date.now() + 15000;
        while (!predicate()) {
            if (child.exitCode !== null || Date.now() >= limit) throw new Error('CLI checkpoint failed: ' + output);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const command = async (text, expected) => {
        const offset = output.length;
        child.stdin.write(text + '\n');
        await wait(() => output.slice(offset).includes(expected));
    };
    let browser;
    try {
        await wait(() => /EP_WS_ENDPOINT=(\S+)/.test(output));
        browser = await puppeteer.connect({ browserWSEndpoint: output.match(/EP_WS_ENDPOINT=(\S+)/)[1] });
        await browser.waitForTarget(target => target.type() === 'page');
        const page = (await browser.pages())[0];
        await page.waitForSelector('#loginId');
        await page.type('#loginId', 'fixture-user');
        await page.type('#password', 'fixture-only');
        await page.click('form button');
        await wait(() => output.includes('Commands: start'));
        assert.ok(output.includes('delay'), 'the commands line must list delay');
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
        try { await cleanupTestProcess(child); } catch { /* already gone */ }
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
