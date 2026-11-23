const { spawn } = require('node:child_process');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
// Unlike cli-test.js this focused fixture waits for EP_TEST_LOGIN_READY before login.
// cli-test.js deliberately exercises earlier startup and external close/signal paths.
async function bootFixtureCli(entry, prompt, extraEnv = {}) {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const env = { ...process.env, ...extraEnv, EP_TEST_BOOT: '1', EP_LOGIN_URL: origin + '/app/login', EP_LOGIN_HOST: '127.0.0.1' };
    delete env.EP_EMAIL; delete env.EP_PASSWORD;
    let child, browser, output = '';
    const cleanup = async () => {
        try {
            try { if (child) cleanupTestProcess(child); } catch {} // The detached group may outlive an exited child, or already be gone.
            if (browser) await browser.close().catch(() => {});
        } finally { await new Promise(resolve => server.close(resolve)); }
    };
    try {
        child = spawn(process.execPath, [path.join(__dirname, '../bin', entry)], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        const wait = async predicate => {
            const end = Date.now() + 20000;
            while (!predicate()) {
                if (child.exitCode !== null || child.signalCode !== null || Date.now() > end) throw new Error('Fixture CLI checkpoint failed: ' + output);
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        };
        await wait(() => /EP_WS_ENDPOINT=(\S+)/.test(output));
        browser = await puppeteer.connect({ browserWSEndpoint: output.match(/EP_WS_ENDPOINT=(\S+)/)[1] });
        await browser.waitForTarget(target => target.type() === 'page');
        const page = (await browser.pages())[0];
        await page.waitForSelector('#loginId');
        await wait(() => output.includes('EP_TEST_LOGIN_READY'));
        await page.type('#loginId', 'fixture-user');
        await page.type('#password', 'fixture-only');
        await page.click('form button');
        await wait(() => output.includes(prompt));
        return { child, page, origin, wait, cleanup, get output() { return output; } };
    } catch (error) { await cleanup(); throw error; }
}
// A completion-proof teardown shared by the box and mixed CLI fixtures: the
// first Submit click removes the slide and reveals the exit button.
async function installSubmitExitTeardown(session, fixtureGlobal) {
    await session.page.evaluate(name => {
        document.querySelector('#sa-navigation-controls button').addEventListener('click', () => {
            window[name].group.remove();
            document.querySelector('#question-container-group').remove();
            window[name].self.model._currentQuestion = null;
            const exit = document.querySelector('button.exit-button');
            exit.hidden = false;
            exit.style.display = '';
        });
    }, fixtureGlobal);
}

// The CLI prints a one-line status JSON (state, mode, pacing ranges) after
// every command since #221/#227. That line is control-plane output, not
// diagnostic output, and its millisecond ranges can contain digit runs that
// collide with short answer tokens, so content-free output checks filter it.
const stripCliStatusLines = output => String(output).split('\n').filter(line => !line.startsWith('{"state":')).join('\n');

module.exports = { bootFixtureCli, installSubmitExitTeardown, stripCliStatusLines };
