const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1100, height: 900 });
        await page.evaluateOnNewDocument(() => {
            window.calls = [];
            window.state = { session: 'ready', setup: { browserReady: true, wizardDone: true, hasLogin: false }, status: { state: 'stopped', mode: 'auto', accuracy: { enabled: false, min: 70, max: 90 }, pacing: { enabled: true } } };
            window.educationPerfected = {
                onMaintenanceProgress: () => {}, onReflectionRequest: () => {}, onReflectionSettled: () => {},
                onState: fn => { window.pushState = fn; }, getState: async () => state,
                action: async (name, value) => {
                    calls.push([name, value]);
                    if (window.failAction) throw new Error('Setting rejected');
                    const key = name === 'accuracy' ? 'accuracy' : 'pacing';
                    state.status[key].enabled = value === 'on';
                    pushState(state);
                }
            };
        });
        page.on('pageerror', e => console.error('PAGE', e.message));
        await page.goto('file://' + path.join(__dirname, '../app/renderer/index.html'));
        await page.waitForFunction(() => !document.getElementById('main-screen').hidden, {timeout:2000});
        assert.equal(await page.$eval('#accuracy', el => el.type), 'checkbox');
        assert.equal(await page.$eval('#accuracy', el => el.checked), false);
        assert.equal(await page.$eval('#delay', el => el.checked), true);
        assert.equal(await page.$('#apply-accuracy'), null);
        assert.equal(await page.$('#apply-delay'), null);
        await page.click('#accuracy');
        await page.waitForFunction(() => document.getElementById('accuracy').checked && !document.getElementById('accuracy').disabled);
        await page.focus('#delay'); await page.keyboard.press('Space');
        await page.waitForFunction(() => !document.getElementById('delay').checked && !document.getElementById('delay').disabled);
        assert.deepEqual(await page.evaluate(() => calls), [['accuracy', 'on'], ['delay', 'off']]);
        await page.evaluate(() => { failAction = true; });
        await page.click('#accuracy');
        await page.waitForFunction(() => document.getElementById('action-message').textContent.includes('Setting rejected'));
        assert.equal(await page.$eval('#accuracy', el => el.checked), true);
        await page.evaluate(() => { state.status.state = 'running'; pushState(state); });
        assert.equal(await page.$eval('#accuracy', el => el.disabled), true);
        assert.equal(await page.$eval('#delay', el => el.disabled), true);
        await page.click('#accuracy');
        assert.equal(await page.evaluate(() => calls.length), 3);
        await page.evaluate(() => { state.status.state = 'stopped'; document.getElementById('action-message').hidden = true; pushState(state); });
        if (process.env.EP_TOGGLE_SCREENSHOT) await page.screenshot({ path: process.env.EP_TOGGLE_SCREENSHOT, clip: { x: 0, y: 0, width: 420, height: 810 } });
        console.log('Desktop toggle renderer: saved-state sync, mouse/keyboard changes, rejected-action rollback and running locks pass.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
