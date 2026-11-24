// Offline engine regression. Uses only the local mock lesson, never a live account.
const assert = require('node:assert/strict');
const Module = require('node:module');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const savedEnv = { ...process.env };
    Object.assign(process.env, { EP_TEST_BOOT: '1', EP_LOGIN_URL: origin + '/app/login', EP_LOGIN_HOST: '127.0.0.1' });
    delete process.env.EP_EMAIL; delete process.env.EP_PASSWORD;
    let browser, controls, loginReady = false;
    const load = Module._load, launchBrowser = puppeteer.launch.bind(puppeteer), log = console.log;
    Module._load = function (id, ...args) {
        const value = load.call(this, id, ...args);
        return id === 'puppeteer' ? new Proxy(value, { get(target, key) {
            return key === 'launch' ? async (...options) => {
                browser = await launchBrowser({ ...options[0], ...(process.env.HANDLER_EXECUTABLE_PATH ? { executablePath: process.env.HANDLER_EXECUTABLE_PATH } : {}) });
                return browser;
            } : target[key];
        } }) : value;
    };
    console.log = (...args) => { if (String(args[0]).includes('No credentials provided')) loginReady = true; log(...args); };
    try {
        let launchFailure;
        const launch = require('../index').launchProgram({ browserControls: false });
        launch.catch(error => { launchFailure = error; });
        const deadline = Date.now() + 12000;
        while (!browser || !loginReady) {
            if (launchFailure) throw launchFailure;
            if (Date.now() >= deadline) throw new Error('Offline login checkpoint timed out');
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        const page = (await browser.pages())[0];
        await page.type('#loginId', 'fixture-user');
        await page.type('#password', 'fixture-only');
        await page.click('form button');
        controls = await launch;
        const assertNoPanel = async () => {
            assert.equal(await page.$('#educationperfected-controls'), null, 'desktop never mounts the panel');
            assert.equal(await page.evaluate(() => typeof window.epControl), 'undefined', 'desktop has no panel binding');
        };
        await assertNoPanel();
        await page.goto(origin + '/lesson');
        await assertNoPanel();
        assert.equal(typeof controls.start, 'function', 'desktop keeps its native session controls');
        if (process.env.EP_NO_PANEL_SCREENSHOT) await page.screenshot({ path: process.env.EP_NO_PANEL_SCREENSHOT });
        console.log('Desktop engine: no panel or panel binding on initial load or navigation; native controls remain.');
    } finally {
        Module._load = load; console.log = log;
        try { if (controls) await controls.close(); else if (browser) await browser.close(); } finally {
            for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
            Object.assign(process.env, savedEnv);
            server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
