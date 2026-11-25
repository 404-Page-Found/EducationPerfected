// Offline real-program browser panel test, no live EP account or service.
const assert = require('node:assert/strict');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { createCliFixture } = require('./cli-test-harness');
const { installControlMenu } = require('../lib/browser-controls');
(async () => {
    const { server, origin, child, command, output, browser, page } = await createCliFixture();
    try {
        const ready = () => page.waitForFunction(() => document.getElementById('educationperfected-controls')?.shadowRoot?.getElementById('live').textContent.includes('|'));
        const press = async (action, value, read = false) => {
            await page.evaluate(({ action, value, read }) => {
                const root = document.getElementById('educationperfected-controls').shadowRoot;
                const field = root.getElementById(action);
                if (field?.type === 'checkbox' && !read) {
                    field.checked = value === 'on';
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    return;
                }
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
        // A first real header click expands the panel without re-anchoring it off screen.
        await page.evaluate(() => { document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open = false; });
        const summaryCenter = await page.evaluate(() => {
            const rect = document.getElementById('educationperfected-controls').shadowRoot.querySelector('summary').getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await page.mouse.click(summaryCenter.x, summaryCenter.y);
        await page.waitForFunction(() => document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open);
        const placed = await page.evaluate(() => {
            const host = document.getElementById('educationperfected-controls');
            const rect = host.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, vw: window.innerWidth, vh: window.innerHeight, bottomAnchor: host.style.bottom };
        });
        assert.equal(placed.bottomAnchor, 'initial', 'default top/right anchoring does not set bottom');
        assert.equal(placed.top, 12, 'default panel starts at top right');
        assert.ok(placed.top >= 0 && placed.left >= 0 && placed.bottom <= placed.vh && placed.right <= placed.vw, 'first expand keeps the panel fully on screen');
        await press('mode', 'semi'); assert.equal((await page.evaluate(() => window.epControl('status'))).mode, 'semi');
        await press('accuracy', 'on'); assert.equal((await page.evaluate(() => window.epControl('status'))).accuracy.enabled, true);
        await assert.rejects(page.evaluate(() => window.epControl('accuracy', 'bad')), /Usage/);
        await press('delay', 'on');
        await assert.rejects(page.evaluate(() => window.epControl('delay', '1.5-4')), /Use delay, delay on or delay off/);
        await press('delay', 'off');
        await press('status');
        assert.match(await result(), /^Stopped\./m, 'status result leads with a readable state');
        assert.match(await result(), /Pacing: /, 'status result explains pacing in words');
        assert.ok(!(await result()).includes('"state"'), 'readable result hides raw JSON');
        assert.match(await raw(), /"state": "stopped"/, 'raw JSON stays under Technical details');
        assert.match(await live(), /^stopped \| semi \| accuracy on \(70-90%\) \| pacing off$/, 'live bar is one compact line');
        const topDown = await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
            return after(root.getElementById('live'), root.getElementById('message'))
                && after(root.getElementById('message'), root.getElementById('result'))
                && after(root.getElementById('result'), root.querySelector('button'));
        });
        assert.ok(topDown, 'result block sits at the top between the status bar and the controls');
        assert.equal(await page.evaluate(() => [...document.getElementById('educationperfected-controls').shadowRoot.querySelectorAll('button')].filter(button => (button.dataset.action || '').startsWith('inspect')).length), 0, 'no inspect-* developer commands in the panel');
        assert.deepEqual(await page.evaluate(() => [...new Set([...document.getElementById('educationperfected-controls').shadowRoot.querySelectorAll('button[data-action]')].map(button => button.dataset.action))].sort((a, b) => a.localeCompare(b))), ['accuracy', 'delay', 'mode', 'refresh', 'start', 'status', 'stop'], 'the panel exposes only ordinary user controls, no developer commands');
        // #285: intro guide plus per-button helpers, discoverable without leaving the browser.
        await page.evaluate(() => { document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open = true; });
        const guideText = await page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('guide')?.textContent || '');
        assert.ok(guideText.includes('Refresh words'), 'intro guide names the Refresh-then-Start workflow');
        assert.ok(guideText.includes('Start'), 'intro guide names Start');
        assert.match(guideText, /Auto/, 'intro guide mentions Auto vs Semi-auto');
        assert.match(guideText, /status|one-line/i, 'intro guide points at the status bar/result area');
        const helpers = await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            return {
                buttons: [...root.querySelectorAll('button[data-action]')].map(button => ({ action: button.dataset.action, read: Boolean(button.dataset.read), title: button.getAttribute('title') || '', aria: button.getAttribute('aria-label') || '', text: button.textContent })),
                fields: ['mode', 'accuracy', 'delay'].map(id => ({ id, title: root.getElementById(id)?.getAttribute('title') || '', aria: root.getElementById(id)?.getAttribute('aria-label') || '' })),
                help: root.getElementById('help')?.textContent || '',
                helpButtons: root.getElementById('help')?.querySelectorAll('button[data-action]').length ?? -1,
                guideButtons: root.getElementById('guide')?.querySelectorAll('button[data-action]').length ?? -1,
            };
        });
        assertGuideAndHelp(helpers);
        // Collapsing the guide persists on this origin and applies to a fresh mount.
        await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            root.getElementById('guide').open = false;
            root.getElementById('guide').dispatchEvent(new Event('toggle', { bubbles: true }));
        });
        assert.equal(await page.evaluate(() => localStorage.getItem('educationperfected-control-menu-guide')), 'closed');
        await page.evaluate(() => {
            document.getElementById('educationperfected-controls').remove();
            window.__epControlMenuInstalled = false;
        });
        await page.evaluate(installControlMenu);
        assert.equal(await page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('guide').open), false, 'saved guide state applies to the next mount');
        await page.evaluate(() => {
            const root = document.getElementById('educationperfected-controls').shadowRoot;
            root.getElementById('guide').open = true;
            root.getElementById('guide').dispatchEvent(new Event('toggle', { bubbles: true }));
            root.querySelector('details').open = true;
        });
        await ready();
        await assert.rejects(page.evaluate(() => window.epControl('inspect-dash')), /Unknown browser control/, 'the page control surface no longer dispatches inspect-*');
        for (const dev of ['inspect-self-mark', 'inspect-components', 'inspectDropdowns', 'eval', 'diagnose']) {
            await assert.rejects(page.evaluate(action => window.epControl(action), dev), /Unknown browser control/, `${dev} is not a panel command`);
        }
        await command('inspect-dash', 'EP_DASH_INSPECT ', 'terminal keeps the read-only capture command');
        await command('accuracy off', '"enabled":false');
        await page.waitForFunction(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('live').textContent.includes('accuracy off'));
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
        assert.ok(Math.abs(afterDrag.left - (beforeDrag.left - 150)) < 2 && Math.abs(afterDrag.top - (Math.max(0, beforeDrag.top - 120))) < 2, 'drag moves the panel with the pointer and stops at release');
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
        assert.equal(await page.evaluate(() => document.getElementById('educationperfected-controls').shadowRoot.getElementById('accuracy').disabled), true);
        await assert.rejects(page.evaluate(() => window.epControl('accuracy', 'on')), /Stop/);
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

function assertGuideAndHelp(helpers) {
    for (const button of helpers.buttons) {
        assert.ok(button.title.trim().length > 0, `${button.action}${button.read ? ' read' : ''} button has a tooltip`);
        assert.ok(button.aria.trim().length > 0, `${button.action}${button.read ? ' read' : ''} button keeps a screen-reader label`);
    }
    for (const field of helpers.fields) {
        assert.ok(field.title.trim().length > 0, `${field.id} field has a tooltip`);
        assert.ok(field.aria.trim().length > 0, `${field.id} field keeps a screen-reader label`);
    }
    for (const name of ['Start', 'Stop', 'Refresh words', 'Status', 'Mode', 'Accuracy', 'Pacing']) {
        assert.ok(helpers.help.includes(name), `help maps ${name} to one sentence`);
    }
    assert.equal(helpers.helpButtons, 0, 'help adds no extra panel commands');
    assert.equal(helpers.guideButtons, 0, 'guide adds no extra panel commands');
}
