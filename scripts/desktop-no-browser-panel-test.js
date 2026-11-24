// Offline engine regression. Only a local mock lesson, never a live account.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, { EP_TEST_BOOT: '1', EP_LOGIN_URL: origin + '/app/login', EP_LOGIN_HOST: '127.0.0.1' });
    delete process.env.EP_EMAIL; delete process.env.EP_PASSWORD;
    const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.HANDLER_EXECUTABLE_PATH });
    let controls;
    try {
        const page = await browser.newPage();
        const launch = require('../index').launchProgram({
            browserControls: false,
            connectBrowser: async () => browser,
            selectPage: async () => page,
        });
        // Observe startup failure while waiting for the fixture form.
        await Promise.race([page.waitForSelector('#loginId'), launch.then(() => { throw new Error('Startup skipped fixture login'); })]);
        await page.type('#loginId', 'fixture-user');
        await page.type('#password', 'fixture-only');
        await page.click('form button');
        controls = await launch;
        for (const target of [null, origin + '/lesson']) {
            if (target) await page.goto(target);
            assert.equal(await page.$('#educationperfected-controls'), null, 'desktop never mounts the panel');
            assert.equal(await page.evaluate(() => typeof window.epControl), 'undefined', 'desktop has no panel binding');
        }
        assert.equal(typeof controls.start, 'function', 'desktop keeps its native session controls');
        if (process.env.EP_NO_PANEL_SCREENSHOT) await page.screenshot({ path: process.env.EP_NO_PANEL_SCREENSHOT });
        console.log('Desktop engine: no panel or panel binding before/after navigation; native controls remain.');
    } finally {
        try { if (controls) await controls.close(); } finally {
            await browser.close();
            server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
