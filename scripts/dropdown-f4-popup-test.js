const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installDropdownFixture } = require('./dropdown-fixture');
const { detectQuestion } = require('../lib/detect-question');
const { playDropdownRound } = require('../lib/dropdown-handler');
const { createSubmitDropdownOnce } = require('../lib/dropdown-once');
const { readDropdownsInPage } = require('../lib/dropdown-state');
const { observeDropdownInput } = require('../lib/dropdown-input-trace');
const { expectedPopupChanges, expectedPopupKeys, installPopupEmulation, restorePopupEmulation, trackFocusRecovery, untrackFocusRecovery } = require('./dropdown-popup-test-helpers');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage();
        const origin = 'http://127.0.0.1:' + server.address().port;
        const setup = async (count = 5) => {
            await page.goto(origin + '/lesson');
            await page.evaluate(installDropdownFixture, count);
        };
        await setup();
        let once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        let result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), Array.from({ length: 5 }, (_, index) => ({ id: 'dropdown-' + index, key: 'F4', trusted: true })));
        assert.deepEqual(await page.evaluate(() => dropdownFixture.changes.map(event => event.index)), new Array(5).fill(2));
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [1, 0]);

        await setup();
        await installPopupEmulation(page);
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(5));
        assert.deepEqual(await page.evaluate(() => dropdownFixture.changes), expectedPopupChanges(5));
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [1, 0]);
        await restorePopupEmulation(page);

        await setup();
        await page.evaluate(() => {
            const original = HTMLSelectElement.prototype.matches;
            window.__restoreSelectMatches = () => { HTMLSelectElement.prototype.matches = original; };
            HTMLSelectElement.prototype.matches = function(selector) {
                if (selector === ':open') throw new SyntaxError('unsupported');
                return original.call(this, selector);
            };
        });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'popup-open-state-unsupported');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 1);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.map(event => event.key), dropdownFixture.changes.length, dropdownFixture.submits]), [['F4'], 0, 0]);
        await restorePopupEmulation(page);

        await setup();
        await installPopupEmulation(page, { openDelayMs: 600 });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(5));
        await restorePopupEmulation(page);

        // A re-render replacing the select right after F4 is a changed state: the
        // open wait re-resolves through the identity-checked read and refuses with
        // the precise binding guard instead of a misleading popup-open-unverified.
        await setup();
        await installPopupEmulation(page, { replaceOnF4At: 0 });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'component-select-binding');
        assert.equal(result.selectionDiagnostic.phase, 'after-f4');
        await restorePopupEmulation(page);

        await setup();
        await installPopupEmulation(page, { neverOpen: true });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'popup-open-unverified');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 1);
        assert.equal(result.diagnostic?.popup?.f4Seen, 1);
        assert.equal(result.diagnostic?.popup?.f4Prevented, 1);
        assert.equal(result.diagnostic?.popup?.openSeen, 0);
        assert.equal(result.diagnostic?.popup?.focusIndex, 1);
        await restorePopupEmulation(page);

        // EP always takes focus itself before dispatching F4: an unfocused window or
        // app guest never receives the key (#397). The handler raises the window,
        // falls back to focus emulation, and only stops (with its own guard, before
        // any key dispatch) when focus still does not hold, as in this stub. The
        // tracking wrapper proves which recovery ran instead of trusting the stub.

        await setup();
        await installPopupEmulation(page);
        let focusCalls = trackFocusRecovery(page);
        await page.evaluate(() => { document.hasFocus = () => false; });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'window-not-focused');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 0);
        assert.equal(result.diagnostic?.popup?.hasFocus, 0);
        assert.equal(result.diagnostic?.popup?.focusIndex, 1);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.length, dropdownFixture.submits]), [0, 0]);
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 1);
        untrackFocusRecovery(page);
        await restorePopupEmulation(page);

        // When focus returns after the window is raised (here: the second hasFocus
        // read), the round proceeds without emulation. The trace observer's install
        // read consumes the first false.
        await setup();
        await installPopupEmulation(page);
        focusCalls = trackFocusRecovery(page);
        await page.evaluate(() => { let focusReads = 0; document.hasFocus = () => ++focusReads > 2; });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(5));
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 0);
        untrackFocusRecovery(page);
        await restorePopupEmulation(page);

        // When raising the window changes nothing, focus emulation must be sent and
        // the round then proceeds (here: focus holds from the third read on).
        await setup();
        await installPopupEmulation(page);
        focusCalls = trackFocusRecovery(page);
        await page.evaluate(() => { let focusReads = 0; document.hasFocus = () => ++focusReads > 3; });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.deepEqual(result, { status: 'submitted-once' });
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(5));
        assert.equal(focusCalls.bringToFront, 1);
        assert.equal(focusCalls.emulation, 1);
        untrackFocusRecovery(page);
        await restorePopupEmulation(page);

        await setup();
        await installPopupEmulation(page, { commitDuringNavigation: true });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'popup-navigation-committed');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 2);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.map(event => event.key), dropdownFixture.changes.map(event => event.index), dropdownFixture.submits]), [['F4', 'ArrowDown'], [1], 0]);
        await restorePopupEmulation(page);

        await setup();
        await installPopupEmulation(page, { closeOnArrow: true });
        once = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: 'f4-popup' });
        result = await once(page);
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.guard, 'popup-closed-before-commit');
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 2);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.map(event => event.key), dropdownFixture.changes.length, dropdownFixture.submits]), [['F4', 'ArrowDown'], 0, 0]);
        await restorePopupEmulation(page);

        await setup(3);
        await installPopupEmulation(page, { closeOnArrowAt: 1 });
        let descriptor = await detectQuestion(page);
        result = await playDropdownRound(page, descriptor, {
            inputMode: 'f4-popup',
            enter: true,
            timeout: 50,
        });
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.phase, 'after-popup-arrow');
        assert.equal(result.selectionDiagnostic.dropdownIndex, 1);
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 6);
        assert.equal(result.selectionDiagnostic.guard, 'popup-closed-before-commit');
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(1).concat(['F4', 'ArrowDown'].map(key => ({ id: 'dropdown-1', key, trusted: true }))));
        assert.deepEqual(await page.evaluate(() => dropdownFixture.changes), expectedPopupChanges(1));
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [0, 0]);
        await restorePopupEmulation(page);

        await setup(3);
        await installPopupEmulation(page);
        descriptor = await detectQuestion(page);
        const baseline = await page.evaluateHandle(readDropdownsInPage, undefined, undefined, true);
        const trace = await page.evaluateHandle(observeDropdownInput, baseline, { popup: true });
        await page.evaluate(() => {
            const select = document.querySelector('#dropdown-0');
            for (let index = 0; index < 65; index++) {
                select.dispatchEvent(new KeyboardEvent('keyup', { key: 'F4', code: 'F4', bubbles: true }));
            }
        });
        result = await playDropdownRound(page, descriptor, {
            baseline,
            inputMode: 'f4-popup',
            inputTrace: trace,
            enter: true,
            timeout: 50,
        });
        assert.equal(result.status, 'stopped');
        assert.equal(result.selectionDiagnostic.phase, 'after-f4');
        assert.equal(result.selectionDiagnostic.dropdownIndex, 0);
        assert.equal(result.selectionDiagnostic.keyDispatchesReturned, 1);
        assert.equal(result.selectionDiagnostic.guard, 'popup-trace-capacity-exceeded');
        assert.equal((await trace.evaluate(observer => observer.snapshot())).dropped > 0, true);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.map(event => event.key), dropdownFixture.changes.length, dropdownFixture.submits]), [['F4'], 0, 0]);
        await trace.evaluate(observer => observer.close());
        await trace.dispose();
        await baseline.dispose();
        await restorePopupEmulation(page);

        await setup(1);
        await installPopupEmulation(page);
        descriptor = await detectQuestion(page);
        result = await playDropdownRound(page, descriptor, {
            inputMode: 'f4-popup',
            enter: true,
            timeout: 300,
        });
        assert.equal(result.status, 'advanced');
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.map(event => event.key), dropdownFixture.keys.every(event => event.trusted), dropdownFixture.changes.map(event => event.index), dropdownFixture.submits, dropdownFixture.nexts]), [['F4', 'ArrowDown', 'ArrowDown', 'Enter'], true, [2], 1, 0]);
        await restorePopupEmulation(page);

        await setup(1);
        await installPopupEmulation(page);
        descriptor = await detectQuestion(page);
        await setup(3);
        await installPopupEmulation(page);
        descriptor = await detectQuestion(page);
        result = await playDropdownRound(page, descriptor, {
            inputMode: 'f4-popup',
            enter: true,
            timeout: 300,
        });
        assert.equal(result.status, 'advanced');
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(3));
        assert.deepEqual(await page.evaluate(() => dropdownFixture.changes), expectedPopupChanges(3));
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [1, 0]);
        await restorePopupEmulation(page);

        console.log('Dropdown F4 popup PASS: Linux-headless native popup exact path; synthetic popup guards, no navigation commit, unsupported-open, early-close, mid-sequence failure, trace-capacity loss, unfocused-window stop before dispatch, refocus retry and focus-emulation fallback, and early-commit stop before Enter/Submit; multi-dropdown questions submit once with no typed approval. Not Windows headful proof.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
