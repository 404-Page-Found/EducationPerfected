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
const { expectedPopupKeys, installPopupEmulation, restorePopupEmulation, trackFocusRecovery, untrackFocusRecovery } = require('./dropdown-popup-test-helpers');
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

        // Page-level focus-loss observation is blocked (listeners, on*
        // handlers, window or document target), while element-level blur and
        // ordinary listeners are untouched - including a capture-phase window
        // listener watching element blurs.
        const delivery = await page.evaluate(() => {
            const seen = {
                windowBlur: 0, windowPagehide: 0, docVisibility: 0, windowVisibility: 0, windowWebkitVisibility: 0,
                elementBlur: 0, windowCaptureElementBlur: 0, docKeyup: 0,
                onblur: 0, onpagehide: 0, onvisibilitychange: 0,
            };
            window.addEventListener('blur', () => { seen.windowBlur++; });
            window.addEventListener('pagehide', () => { seen.windowPagehide++; });
            document.addEventListener('visibilitychange', () => { seen.docVisibility++; });
            window.addEventListener('visibilitychange', () => { seen.windowVisibility++; });
            window.addEventListener('webkitvisibilitychange', () => { seen.windowWebkitVisibility++; });
            const input = document.createElement('input');
            document.body.appendChild(input);
            input.addEventListener('blur', () => { seen.elementBlur++; });
            window.addEventListener('blur', event => { if (event.target === input) seen.windowCaptureElementBlur++; }, true);
            document.addEventListener('keyup', () => { seen.docKeyup++; });
            window.onblur = () => { seen.onblur++; };
            window.onpagehide = () => { seen.onpagehide++; };
            document.onvisibilitychange = () => { seen.onvisibilitychange++; };
            window.dispatchEvent(new Event('blur'));
            window.dispatchEvent(new Event('pagehide'));
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
            document.dispatchEvent(new Event('webkitvisibilitychange', { bubbles: true }));
            input.dispatchEvent(new Event('blur'));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x' }));
            return {
                ...seen,
                onblurRead: window.onblur,
                onpagehideRead: window.onpagehide,
                onvisibilitychangeRead: document.onvisibilitychange,
            };
        });
        assert.deepEqual(
            (({ onblurRead, onpagehideRead, onvisibilitychangeRead, ...rest }) => rest)(delivery),
            {
                windowBlur: 0, windowPagehide: 0, docVisibility: 0, windowVisibility: 0, windowWebkitVisibility: 0,
                elementBlur: 1, windowCaptureElementBlur: 1, docKeyup: 1,
                onblur: 0, onpagehide: 0, onvisibilitychange: 0,
            });
        assert.equal(delivery.onblurRead, null);
        assert.equal(delivery.onpagehideRead, null);
        assert.equal(delivery.onvisibilitychangeRead, null);

        // A re-install is inert: the guard survives it, the overrides still
        // report focused, and the stash is the same frozen object holding the
        // platform-native probes (a re-stash would bind the already-overridden
        // own hasFocus, not the platform Document.prototype one).
        await page.evaluate(() => { window.__stashBeforeReinstall = window.__epNativeFocus; });
        await installAlwaysFocused(page);
        assert.equal(await page.evaluate(() => window.__epAlwaysFocused), true);
        assert.equal(await page.evaluate(() => document.hasFocus()), true);
        assert.equal(await page.evaluate(() => window.__epNativeFocus === window.__stashBeforeReinstall), true);
        assert.match(await page.evaluate(() => window.__epNativeFocus.hasFocus.toString()), /\[native code\]/);

        // The stash does not yield to a plain assignment (non-writable).
        await page.evaluate(() => { window.__epNativeFocus = { hasFocus: () => false }; });
        assert.equal(await page.evaluate(() => window.__epNativeFocus === window.__stashBeforeReinstall), true);

        // The environment survives navigation via evaluateOnNewDocument.
        await page.goto(origin + '/learning/dashboard');
        assert.equal(await page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible' && typeof window.__epNativeFocus?.hasFocus === 'function'), true);

        // Dropdown F4 recovery still probes the genuine focus, not the spoofed
        // document.hasFocus(): with the page looking focused but the native
        // probe reporting a loss that the raise repairs, the window is raised
        // exactly once and no emulation is sent.
        const setup = async (count = 5) => {
            await page.goto(origin + '/lesson');
            await page.evaluate(installDropdownFixture, count);
        };
        // The stash is non-writable, so the focus-loss simulations replace it
        // by redefining the configurable property.
        const stubNativeFocus = readsToFocus => page.evaluate(limit => {
            let focusReads = 0;
            Object.defineProperty(window, '__epNativeFocus', {
                configurable: true,
                value: { hasFocus: () => limit !== null && ++focusReads > limit, visibilityState: () => 'visible', hidden: () => false },
            });
        }, readsToFocus);

        await setup();
        await installPopupEmulation(page);
        let focusCalls = trackFocusRecovery(page);
        // Trace install read consumes the first probe; the handler's first read
        // is still a loss, the raise repairs it, the second read holds.
        await stubNativeFocus(2);
        let once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        let result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(5));
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 0);
        untrackFocusRecovery(page);
        await restorePopupEmulation(page);

        // A genuine loss the raise cannot repair still falls back to focus
        // emulation and then stops with window-not-focused before any dispatch,
        // even though the page presents itself as focused throughout.
        await setup();
        await installPopupEmulation(page);
        focusCalls = trackFocusRecovery(page);
        await stubNativeFocus(null);
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'window-not-focused');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 0);
        assert.equal(await page.evaluate(() => document.hasFocus()), true);
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 1);
        untrackFocusRecovery(page);
        await restorePopupEmulation(page);

        console.log('Always-focused: page presents focused and visible, focus-loss signals blocked, real state stashed, F4 recovery probes the genuine focus.');
    } finally {
        if (browser) await browser.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
