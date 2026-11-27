// Always-focused page environment (lib/always-focused.js): the task page must
// present itself as focused and visible to page scripts even when the window
// is not, while EducationPerfected keeps reading the genuine platform state
// through the stashed native probes (the dropdown F4 recovery depends on it).
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installDropdownFixture } = require('./dropdown-fixture');
const { detectQuestion } = require('../lib/detect-question');
const { playDropdownRound } = require('../lib/dropdown-handler');
const { createSubmitDropdownOnce } = require('../lib/dropdown-once');
const { expectedPopupKeys, installPopupEmulation, restorePopupEmulation } = require('./dropdown-popup-test-helpers');
const { installAlwaysFocused } = require('../lib/always-focused');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage();
        const origin = 'http://127.0.0.1:' + server.address().port;

        await installAlwaysFocused(page);
        await page.goto(origin + '/lesson');

        // The page looks focused and visible to its own scripts, and the
        // genuine platform state stays readable through the stashed probes.
        const presentation = await page.evaluate(() => ({
            hasFocus: document.hasFocus(),
            visibilityState: document.visibilityState,
            hidden: document.hidden,
            webkitVisibilityState: document.webkitVisibilityState,
            webkitHidden: document.webkitHidden,
            nativeHasFocus: window.__epNativeFocus.hasFocus(),
            nativeVisibilityState: window.__epNativeFocus.visibilityState(),
        }));
        assert.equal(presentation.hasFocus, true);
        assert.equal(presentation.visibilityState, 'visible');
        assert.equal(presentation.hidden, false);
        assert.equal(presentation.webkitVisibilityState, 'visible');
        assert.equal(presentation.webkitHidden, false);
        assert.equal(typeof presentation.nativeHasFocus, 'boolean');
        assert.equal(typeof presentation.nativeVisibilityState, 'string');

        // Window blur/pagehide and document visibilitychange listeners never
        // register; element-level blur and ordinary document listeners do.
        const delivery = await page.evaluate(() => {
            const seen = { windowBlur: 0, windowPagehide: 0, docVisibility: 0, elementBlur: 0, docKeyup: 0, onblur: 0 };
            window.addEventListener('blur', () => { seen.windowBlur++; });
            window.addEventListener('pagehide', () => { seen.windowPagehide++; });
            document.addEventListener('visibilitychange', () => { seen.docVisibility++; });
            const input = document.createElement('input');
            document.body.appendChild(input);
            input.addEventListener('blur', () => { seen.elementBlur++; });
            document.addEventListener('keyup', () => { seen.docKeyup++; });
            window.onblur = () => { seen.onblur++; };
            window.dispatchEvent(new Event('blur'));
            window.dispatchEvent(new Event('pagehide'));
            document.dispatchEvent(new Event('visibilitychange'));
            input.dispatchEvent(new Event('blur'));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x' }));
            return { ...seen, onblurRead: window.onblur, onvisibilitychangeRead: document.onvisibilitychange };
        });
        assert.deepEqual({ windowBlur: delivery.windowBlur, windowPagehide: delivery.windowPagehide, docVisibility: delivery.docVisibility, elementBlur: delivery.elementBlur, docKeyup: delivery.docKeyup, onblur: delivery.onblur }, { windowBlur: 0, windowPagehide: 0, docVisibility: 0, elementBlur: 1, docKeyup: 1, onblur: 0 });
        assert.equal(delivery.onblurRead, null);
        assert.equal(delivery.onvisibilitychangeRead, null);

        // A re-install is inert: the guard survives it, the overrides still
        // report focused, and the stash still holds the platform-native probes
        // (a re-stash would have captured the already-overridden hasFocus).
        await installAlwaysFocused(page);
        assert.equal(await page.evaluate(() => window.__epAlwaysFocused), true);
        assert.equal(await page.evaluate(() => document.hasFocus()), true);
        assert.match(await page.evaluate(() => window.__epNativeFocus.hasFocus.toString()), /\[native code\]/);

        // The environment survives navigation via evaluateOnNewDocument.
        await page.goto(origin + '/learning/dashboard');
        assert.equal(await page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible' && typeof window.__epNativeFocus?.hasFocus === 'function'), true);

        // Dropdown F4 recovery still probes the genuine focus, not the spoofed
        // document.hasFocus(): with the page looking focused but the native
        // probe reporting a loss that the raise repairs, the window is raised
        // exactly once and no emulation is sent.
        const trackFocusRecovery = () => {
            const calls = { bringToFront: 0, emulation: 0 };
            const originalRaise = page.bringToFront.bind(page);
            page.bringToFront = async () => { calls.bringToFront++; return originalRaise(); };
            const originalSession = page.createCDPSession.bind(page);
            page.createCDPSession = async () => {
                const session = await originalSession();
                const send = session.send.bind(session);
                session.send = (method, params) => {
                    if (method === 'Emulation.setFocusEmulationEnabled' && params?.enabled === true) calls.emulation++;
                    return send(method, params);
                };
                return session;
            };
            return calls;
        };
        const untrackFocusRecovery = () => { delete page.bringToFront; delete page.createCDPSession; };
        const setup = async (count = 5) => {
            await page.goto(origin + '/lesson');
            await page.evaluate(installDropdownFixture, count);
        };

        await setup();
        await installPopupEmulation(page);
        let focusCalls = trackFocusRecovery();
        // Trace install read consumes the first probe; the handler's first read
        // is still a loss, the raise repairs it, the second read holds.
        await page.evaluate(() => { let focusReads = 0; window.__epNativeFocus = { hasFocus: () => ++focusReads > 2, visibilityState: () => 'visible', hidden: () => false }; });
        let once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        let result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(5));
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 0);
        untrackFocusRecovery();
        await restorePopupEmulation(page);

        // A genuine loss the raise cannot repair still falls back to focus
        // emulation and then stops with window-not-focused before any dispatch,
        // even though the page presents itself as focused throughout.
        await setup();
        await installPopupEmulation(page);
        focusCalls = trackFocusRecovery();
        await page.evaluate(() => { window.__epNativeFocus = { hasFocus: () => false, visibilityState: () => 'visible', hidden: () => false }; });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'window-not-focused');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 0);
        assert.equal(await page.evaluate(() => document.hasFocus()), true);
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 1);
        untrackFocusRecovery();
        await restorePopupEmulation(page);

        console.log('Always-focused: page presents focused and visible, focus-loss signals blocked, real state stashed, F4 recovery probes the genuine focus.');
    } finally {
        if (browser) await browser.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
