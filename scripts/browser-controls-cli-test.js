// Offline real-program browser panel test, no live EP account or service.
const assert = require('node:assert/strict');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { createCliFixture } = require('./cli-test-harness');
const { installControlMenu } = require('../lib/browser-controls');
(async () => {
    const { server, origin, child, wait, command, output, browser, page } = await createCliFixture();
    try {
        const ready = () => page.waitForFunction(() => document.getElementById('educationperfected-controls')?.shadowRoot?.getElementById('live').textContent.includes('Stopped'));
        const press = async (action, value, read = false) => {
            await page.evaluate(({ action, value, read }) => {
                const root = document.getElementById('educationperfected-controls').shadowRoot;
                const field = root.getElementById(action);
                if (field && value !== undefined) field.value = value;
                const buttons = [...root.querySelectorAll('button')];
                buttons.find(button => button.dataset.action === action && Boolean(button.dataset.read) === read).click();
            }, { action, value, read });
            await page.waitForFunction(() => !document.getElementById('educationperfected-controls').shadowRoot.getElementById('message').textContent.includes('Working...'));
        };
        const result = () => page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('result').textContent);
        const raw = () => page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('raw').textContent);
        const live = () => page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('live').textContent);
        const message = () => page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('message').textContent);
        await ready();
        await page.goto(origin + '/lesson'); await ready();
        await page.evaluate(installControlMenu);
        assert.equal(await page.$$eval('ep-control-menu', elements => elements.length), 1);
        assert.equal(await page.$$eval('ep-control-menu input, ep-control-menu button', elements => elements.length), 0, 'EP selectors cannot reach shadow controls');
        await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            root.querySelector('details').open = true;
            window.panelLeakedKeys = 0;
            document.addEventListener('keyup', () => { window.panelLeakedKeys += 1; });
            root.getElementById('accuracy').dispatchEvent(new KeyboardEvent('keyup', { key: 's', altKey: true, bubbles: true, composed: true }));
        });
        assert.equal(await page.evaluate(() => window.panelLeakedKeys), 0);
        await press('mode', 'semi'); assert.equal((await page.evaluate(() => window.epControl('status'))).mode, 'semi');
        await press('accuracy', '82'); assert.equal((await page.evaluate(() => window.epControl('status'))).accuracy.fixedTarget, 82);
        await press('accuracy', 'bad'); assert.match(await message(), /^Couldn't apply accuracy: /, 'errors read as a sentence'); assert.match(await message(), /Usage/);
        await press('delay', 'on');
        await press('delay', '1.5-4'); assert.match(await result(), /^Pacing: waiting 1\.5-4s before each answer\.$/, 'pacing echo reads as a sentence');
        assert.match(await raw(), /"delay": "1\.5-4s/, 'raw pacing echo stays under Technical details');
        await press('delay', 'off');
        await press('status');
        assert.match(await result(), /^Stopped\./m, 'status result leads with a readable state');
        assert.match(await result(), /Pacing: /, 'status result explains pacing in words');
        assert.ok(!(await result()).includes('"state"'), 'readable result hides raw JSON');
        assert.match(await raw(), /"state": "stopped"/, 'raw JSON stays under Technical details');
        assert.match(await live(), /Stopped\.\nSemi-auto mode: answers are filled in, you submit them\./, 'live banner reads as sentences');
        await command('accuracy off', '"enabled":false');
        await page.waitForFunction(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('live').textContent.includes('Accuracy: every answer goes in correct'));
        if (process.env.EP_PANEL_SCREENSHOT) {
            await page.setViewport({ width: 1100, height: 1000 });
            await page.evaluate(() => {
                const root = document.getElementById('educationperfected-controls').shadowRoot;
                root.getElementById('accuracy').value = '';
                root.getElementById('delay').value = '';
            });
            await page.screenshot({ path: process.env.EP_PANEL_SCREENSHOT });
        }
        const panelPos = () => page.evaluate(() => {
            const rect = document.getElementById('educationperfected-controls').getBoundingClientRect();
            return { left: rect.left, top: rect.top };
        });
        const beforeDrag = await panelPos();
        await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            const summary = root.querySelector('summary');
            const rect = summary.getBoundingClientRect();
            const start = { x: rect.left + 30, y: rect.top + 10 };
            const fire = (type, x, y) => summary.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
            fire('pointerdown', start.x, start.y);
            fire('pointermove', start.x - 1, start.y - 1); // below the 4px threshold: not a drag yet
            fire('pointermove', start.x - 150, start.y - 120);
            fire('pointerup', start.x - 150, start.y - 120); // released over the panel, the real path
            summary.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })); // the click every drag ends with
            // A stale drag must not keep steering the panel after release (review regression).
            fire('pointermove', start.x - 300, start.y - 300);
            window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: start.x - 300, clientY: start.y - 300, pointerId: 1 }));
        });
        const afterDrag = await panelPos();
        assert.ok(Math.abs(afterDrag.left - (beforeDrag.left - 150)) < 2 && Math.abs(afterDrag.top - (beforeDrag.top - 120)) < 2, 'drag moves the panel with the pointer and stops at release');
        assert.equal(await page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open), true, 'the click ending a drag does not toggle the panel');
        await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            root.querySelector('summary').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
        });
        assert.equal(await page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open), false, 'the next genuine header click toggles the panel');
        await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            root.querySelector('summary').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
        });
        await page.goto(origin + '/app'); await ready();
        const restored = await panelPos();
        assert.ok(Math.abs(restored.left - afterDrag.left) < 2 && Math.abs(restored.top - afterDrag.top) < 2, 'panel position persists across navigation');
        console.log('Panel drag, click suppression and position persistence passed');
        await page.goto(origin + '/lesson'); await ready();
        await press('start');
        console.log('Panel start completed');
        assert.equal((await page.evaluate(() => window.epControl('status'))).state, 'running');
        await press('mode', 'auto'); assert.match(await message(), /Stop/);
        await press('refresh'); assert.match(await message(), /Stop/);
        await press('accuracy', '80'); assert.match(await message(), /Stop/);
        await press('stop'); console.log('Panel stop completed'); assert.equal((await page.evaluate(() => window.epControl('status'))).state, 'stopped');
        for (const route of ['/lesson', '/app', '/lesson']) {
            await page.goto(origin + route); await ready(); console.log('Panel navigation', route);
            assert.equal(await page.$$eval('ep-control-menu', elements => elements.length), 1);
            const iframe = await page.evaluateHandle(() => {
                const iframe = document.createElement('iframe'); document.body.appendChild(iframe); return iframe;
            });
            const frame = await iframe.contentFrame();
            await frame.evaluate(installControlMenu);
            assert.equal(await frame.$$eval('ep-control-menu', elements => elements.length), 0);
        }
        await command('quit', '"state":"closed"');
        console.log('Browser panel real-program fixture: shared status/actions, guards, keyboard isolation, Shadow DOM, top-frame-only navigation/idempotence pass.');
    } catch (error) {
        console.error(error, output());
        throw error;
    } finally {
        if (browser) browser.disconnect();
        try { cleanupTestProcess(child); } catch {}
        server.closeAllConnections(); server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
