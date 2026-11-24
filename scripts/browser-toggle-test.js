// Synthetic page only. Never signs in or runs an EP task.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { installControlMenu } = require('../lib/browser-controls');
(async () => {
    const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.HANDLER_EXECUTABLE_PATH });
    try {
        const page = await browser.newPage();
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.setViewport({ width: 900, height: 800 });
        await page.setContent('<h1>Offline browser controls fixture</h1>');
        await page.evaluate(() => {
            window.calls = [];
            window.state = { state: 'stopped', mode: 'auto', accuracy: { enabled: false, min: 70, max: 90 }, pacing: { enabled: true } };
            window.epControl = async (action, value) => {
                if (action === 'status') return structuredClone(state);
                calls.push([action, value]);
                if (window.deferAction) await new Promise(resolve => { window.releaseAction = resolve; });
                if (window.rejectAction) throw new Error('Setting rejected');
                state[action === 'accuracy' ? 'accuracy' : 'pacing'].enabled = value === 'on';
                return structuredClone(state);
            };
        });
        await page.evaluate(installControlMenu);
        const field = id => page.evaluateHandle(id => document.getElementById('educationperfected-controls').shadowRoot.getElementById(id), id);
        const read = id => page.evaluate(id => { const e = document.getElementById('educationperfected-controls').shadowRoot.getElementById(id); return { type: e.type, checked: e.checked, disabled: e.disabled }; }, id);
        await page.waitForFunction(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('live').textContent.includes('stopped'));
        await page.evaluate(() => { document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open = true; });
        assert.deepEqual(await page.evaluate(() => { const r = document.getElementById('educationperfected-controls').getBoundingClientRect(); return { top: r.top, right: innerWidth - r.right }; }), { top: 12, right: 12 }, 'fresh default is top right');
        assert.equal((await read('accuracy')).type, 'checkbox');
        assert.equal((await read('accuracy')).checked, false);
        assert.equal((await read('delay')).checked, true);
        const accuracy = await field('accuracy'), delay = await field('delay');
        await accuracy.click();
        await page.waitForFunction(() => calls.length === 1 && !document.getElementById('educationperfected-controls').shadowRoot.getElementById('accuracy').disabled);
        await delay.focus(); await page.keyboard.press('Space');
        await page.waitForFunction(() => calls.length === 2 && !document.getElementById('educationperfected-controls').shadowRoot.getElementById('delay').disabled);
        assert.deepEqual(await page.evaluate(() => calls), [['accuracy', 'on'], ['delay', 'off']]);
        await page.evaluate(() => { deferAction = true; }); await delay.click();
        await page.waitForFunction(() => typeof releaseAction === 'function');
        assert.equal((await read('delay')).disabled, true);
        assert.equal((await read('accuracy')).disabled, true);
        await page.evaluate(() => { deferAction = false; releaseAction(); });
        await page.waitForFunction(() => !document.getElementById('educationperfected-controls').shadowRoot.getElementById('delay').disabled);
        await page.evaluate(() => { rejectAction = true; }); await accuracy.click();
        await page.waitForFunction(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('message').textContent.includes('Setting rejected'));
        assert.equal((await read('accuracy')).checked, true, 'rejected change returns to confirmed status');
        await page.evaluate(() => { state.state = 'running'; });
        await page.waitForFunction(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('accuracy').disabled);
        assert.equal((await read('delay')).disabled, true);
        await page.evaluate(() => { state.state = 'stopped'; state.accuracy.enabled = false; });
        await page.waitForFunction(() => { const e = document.getElementById('educationperfected-controls').shadowRoot.getElementById('accuracy'); return !e.disabled && !e.checked; });
        assert.equal(await page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.querySelectorAll('button[data-action="accuracy"]:not([data-read]),button[data-action="delay"]:not([data-read])').length), 0);
        await page.evaluate(() => { document.getElementById('educationperfected-controls').shadowRoot.getElementById('message').textContent = ''; });
        if (process.env.EP_TOGGLE_SCREENSHOT) await page.screenshot({ path: process.env.EP_TOGGLE_SCREENSHOT });
        await page.evaluate(() => { state.controlPanelVisible = false; });
        await page.waitForFunction(() => getComputedStyle(document.getElementById('educationperfected-controls')).display === 'none', { timeout: 1800 });
        await page.evaluate(() => { state.controlPanelVisible = true; });
        await page.waitForFunction(() => getComputedStyle(document.getElementById('educationperfected-controls')).display !== 'none');
        assert.deepEqual(errors, []);
        console.log('Browser toggles: confirmed status, mouse/keyboard, pending locks, rejection rollback and running locks pass.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
