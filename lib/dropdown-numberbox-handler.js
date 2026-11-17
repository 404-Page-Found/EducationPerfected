const { readDropdownNumberBoxInPage } = require('./dropdown-numberbox-state');
const { observeDropdownInput } = require('./dropdown-input-trace');
const { waitForDropdownNumberBoxSubmit } = require('./dropdown-numberbox-submit-readiness');
// One round of a mixed dropdown + number-box slide: the dropdown phase is the
// F4-popup dropdown flow, the box phase is the number-box typing flow, then a
// single whole-question Submit. Each phase rechecks the whole slide through
// the combined reader; any mismatch stops before Submit, never a partial or
// guessed answer.
async function playDropdownNumberBoxRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    const inputMode = opts.inputMode === 'f4-popup' ? 'f4-popup' : 'legacy';
    let phase = 'initial', dropdownIndex = null, boxIndex = null, keyDispatchesReturned = 0, guard = 'descriptor-mismatch', nativeState, submitState, refusalDiagnostic;
    const selectionDiagnostic = () => ({ phase, dropdownIndex, boxIndex, keyDispatchesReturned, guard, ...(nativeState ? { nativeState } : {}), ...(submitState ? { submitState } : {}) });
    const refused = () => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: 'Lesson dropdowns with number boxes stopped: changed or unsupported state; no retry.', selectionDiagnostic: selectionDiagnostic(), ...(refusalDiagnostic ? { diagnostic: refusalDiagnostic } : {}) });
    let baseline, trace = opts.inputTrace, ownsTrace = false; const handles = [];
    try {
        if (descriptor.kind !== 'dropdown-numberbox' || descriptor.autoMarked !== true || descriptor.dropdowns.some(d => d.filled) || descriptor.boxes.some(b => b.value !== '')) return refused();
        // Bind one-shot input to the caller's pre-input identities when supplied.
        phase = 'baseline';
        baseline = await page.evaluateHandle(readDropdownNumberBoxInPage, opts.baseline, undefined);
        const baselineCheck = await baseline.evaluate((r, d) => ({
            match: JSON.stringify(r?.descriptor) === JSON.stringify(d),
            diagnostic: r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined,
        }), descriptor);
        if (!baselineCheck.match) { guard = baselineCheck.diagnostic?.guard || 'descriptor-mismatch'; refusalDiagnostic = baselineCheck.diagnostic; return refused(); }
        const expected = descriptor.dropdowns.map(d => d.selectedIndex);
        const expectedBoxes = descriptor.boxes.map(() => '');
        const check = async (index, focus, previous) => {
            const state = await page.evaluateHandle(readDropdownNumberBoxInPage, baseline, { dropdown: index });
            try {
                const failure = await state.evaluate((r, values, active, before) => {
                    if (r?.descriptor?.kind !== 'dropdown-numberbox') return { guard: r?.descriptor?.diagnostic?.guard || 'unsupported-state', diagnostic: r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined };
                    const nativeState = { actual: r.descriptor.dropdowns.map(d => d.selectedIndex), expected: values, focusedDropdownIndex: r.rows.findIndex(row => row.select === document.activeElement) };
                    if (active && document.activeElement !== r.target) return { guard: 'focus-mismatch', nativeState };
                    if (r.descriptor.dropdowns.every((d, i) => d.selectedIndex === values[i])) return null;
                    if (before && r.descriptor.dropdowns.every((d, i) => d.selectedIndex === before[i])) return { guard: 'key-state-pending', nativeState };
                    return { guard: 'selected-index-mismatch', nativeState };
                }, expected, focus, previous);
                if (failure) { guard = failure.guard; nativeState = failure.nativeState; refusalDiagnostic = failure.diagnostic; return null; }
                nativeState = undefined;
                if (focus) return true;
                const handle = await state.getProperty('target'); handles.push(handle); return handle.asElement();
            } finally { await state.dispose(); }
        };
        const checkBox = async (index, active = false) => {
            const state = await page.evaluateHandle(readDropdownNumberBoxInPage, baseline, { box: index });
            try {
                const boxCheck = await state.evaluate((r, values, focus) => {
                    const ok = r?.descriptor?.kind === 'dropdown-numberbox' && r.descriptor.boxes.every((b, i) => b.value === values[i])
                        && (!focus || (document.activeElement === r.target && r.target.selectionStart === r.target.value.length && r.target.selectionEnd === r.target.value.length));
                    return { ok, guard: r?.descriptor?.diagnostic?.guard, diagnostic: !ok && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined };
                }, expectedBoxes, active);
                if (!boxCheck.ok) { guard = boxCheck.guard || 'box-state-mismatch'; refusalDiagnostic = boxCheck.diagnostic; return null; }
                if (active) return true; // Focus/prefix checks need no retained target handle.
                const handle = await state.getProperty('target');
                handles.push(handle);
                return handle.asElement();
            } finally { await state.dispose(); }
        };
        // Read-only grace only for the exact valid pre-key state. No input retry.
        const settled = async (index, previous) => {
            const deadline = Date.now() + 200;
            const poll = async () => {
                if (stop()) return false;
                if (Date.now() >= deadline) { guard = 'key-state-did-not-settle'; return false; }
                const matched = await check(index, true, previous);
                if (stop()) return false;
                if (Date.now() >= deadline) { guard = 'key-state-did-not-settle'; return false; }
                if (matched) return true;
                if (guard !== 'key-state-pending') return false;
                await new Promise(resolve => setTimeout(resolve, 25));
                return poll();
            };
            return poll();
        };
        const popupState = async element => await element.evaluate(el => {
            try { return el.matches(':open'); } catch { return null; }
        }).catch(() => null);
        const waitPopupState = async (element, open) => {
            const deadline = Date.now() + 200;
            while (Date.now() < deadline) {
                if (stop()) return 'aborted';
                const state = await popupState(element);
                if (state === open || state === null) return state;
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            if (stop()) return 'aborted';
            return popupState(element);
        };
        const popupNavigationClean = async index => {
            if (!trace) { guard = 'popup-trace-required'; return false; }
            const snapshot = await trace.evaluate(observer => observer.snapshot()).catch(() => null);
            if (!snapshot) { guard = 'popup-trace-unavailable'; return false; }
            if (snapshot.dropped > 0) { guard = 'popup-trace-capacity-exceeded'; return false; }
            if (snapshot.events?.some(event => event.targetIndex === index && (event.type === 2 || event.type === 3))) { guard = 'popup-navigation-committed'; return false; }
            return true;
        };
        for (let i = 0; i < descriptor.dropdowns.length; i++) {
            if (stop()) return { status: 'aborted' };
            dropdownIndex = i; phase = 'target'; guard = 'missing-target';
            const element = await check(i); if (!element) return refused();
            phase = 'focus'; await element.focus(); if (!await check(i, true)) return refused();
            if (stop()) return { status: 'aborted' };
            if (inputMode === 'f4-popup') {
                if (!trace) { trace = await page.evaluateHandle(observeDropdownInput, baseline, { popup: true }); ownsTrace = true; }
                const startIndex = expected[i], targetIndex = descriptor.dropdowns[i].index;
                if (targetIndex < startIndex) { guard = 'popup-target-before-start'; return refused(); }
                const beforePopup = expected.slice();
                phase = 'f4-dispatch'; await element.press('F4'); keyDispatchesReturned++; phase = 'after-f4';
                const opened = await waitPopupState(element, true);
                if (opened === 'aborted') return { status: 'aborted' };
                if (opened !== true) { guard = opened === null ? 'popup-open-state-unsupported' : 'popup-open-unverified'; return refused(); }
                if (!await popupNavigationClean(i)) return refused();
                while (expected[i] < targetIndex) {
                    if (stop()) return { status: 'aborted' };
                    phase = 'popup-arrow-dispatch'; await element.press('ArrowDown'); keyDispatchesReturned++; expected[i]++; phase = 'after-popup-arrow';
                    const stillOpen = await waitPopupState(element, true);
                    if (stillOpen === 'aborted') return { status: 'aborted' };
                    if (stillOpen !== true) { guard = stillOpen === null ? 'popup-open-state-unsupported' : 'popup-closed-before-commit'; return refused(); }
                    if (!await popupNavigationClean(i)) return refused();
                }
                if (stop()) return { status: 'aborted' };
                phase = 'popup-enter-dispatch'; await element.press('Enter'); keyDispatchesReturned++; phase = 'after-popup-enter';
                const closed = await waitPopupState(element, false);
                if (closed === 'aborted') return { status: 'aborted' };
                if (closed !== false) { guard = closed === null ? 'popup-open-state-unsupported' : 'popup-close-unverified'; return refused(); }
                if (!await settled(i, beforePopup)) return stop() ? { status: 'aborted' } : refused();
                continue;
            }
            // Native select keys, not DOM-selectedIndex assignment or synthetic change.
            // Intermediate choices may be saved by EP; each key is checked and never retried.
            const beforeHome = expected.slice();
            phase = 'home-dispatch'; await element.press('Home'); keyDispatchesReturned++; expected[i] = 0; phase = 'after-home';
            if (!await settled(i, beforeHome)) return stop() ? { status: 'aborted' } : refused();
            for (let n = 0; n < descriptor.dropdowns[i].index; n++) {
                if (stop()) return { status: 'aborted' };
                phase = 'before-arrow'; if (!await check(i, true)) return refused();
                const beforeArrow = expected.slice();
                phase = 'arrow-dispatch'; await element.press('ArrowDown'); keyDispatchesReturned++; expected[i]++; phase = 'after-arrow';
                if (!await settled(i, beforeArrow)) return stop() ? { status: 'aborted' } : refused();
            }
        }
        if (stop()) return { status: 'aborted' };
        phase = 'dropdown-verification'; guard = 'dropdown-fill-mismatch';
        if (!await check(0)) return refused();
        opts.log?.('Selected exact lesson dropdown answers.');
        for (let i = 0; i < descriptor.boxes.length; i++) {
            if (stop()) return { status: 'aborted' };
            boxIndex = i; phase = 'box-target'; guard = 'missing-box-target';
            const element = await checkBox(i);
            if (!element) return refused();
            phase = 'box-input';
            await element.focus();
            for (const char of descriptor.boxes[i].answer) {
                if (stop()) return { status: 'aborted' };
                if (!await checkBox(i, true)) return refused();
                if (stop()) return { status: 'aborted' };
                await element.type(char); // No Enter or replacement/retry. EP input events update cached answer.
                expectedBoxes[i] += char;
                if (!await checkBox(i, true)) return refused();
            }
        }
        if (stop()) return { status: 'aborted' };
        phase = 'box-verification'; guard = 'box-fill-mismatch';
        if (!await checkBox(0)) return refused();
        opts.log?.('Filled exact lesson number-box answers.');
        phase = 'final-verification';
        let final;
        if (opts.enter) {
            phase = 'submit-readiness';
            const ready = await waitForDropdownNumberBoxSubmit(page, baseline, { shouldStop: stop, timeout: opts.timeout });
            if (ready.status === 'aborted') return { status: 'aborted' };
            if (ready.status !== 'ready') { guard = ready.guard; submitState = ready.submitState; return refused(); }
            final = ready.handle;
        } else final = await page.evaluateHandle(readDropdownNumberBoxInPage, baseline, 'verify');
        try {
            const failure = await final.evaluate(r => r?.descriptor?.kind === 'dropdown-numberbox'
                && r.descriptor.dropdowns.every(d => d.selectedIndex === d.index)
                && r.descriptor.boxes.every(b => b.value === b.answer) ? null : r?.descriptor?.diagnostic?.guard || 'final-answer-mismatch');
            if (failure) { guard = failure; return refused(); }
            opts.onVerified?.();
            if (opts.enter) {
                phase = 'submit-target'; guard = 'missing-submit';
                const button = await final.getProperty('target'); handles.push(button); const element = button.asElement(); if (!element) return refused();
                if (opts.requireSubmitApproval) {
                    if (typeof opts.approveSubmit !== 'function') { guard = 'submit-approval-required'; return refused(); }
                    let approved;
                    try { approved = await opts.approveSubmit({ key: descriptor.key, dropdownCount: descriptor.dropdowns.length, boxCount: descriptor.boxes.length, inputMode }); }
                    catch { guard = 'submit-approval-uncertain'; return refused(); }
                    if (approved !== true) { guard = 'submit-not-approved'; return refused(); }
                    if (stop()) return { status: 'aborted' };
                }
                await element.scrollIntoView(); const point = await element.clickablePoint();
                const last = await page.evaluateHandle(readDropdownNumberBoxInPage, baseline, 'submit');
                try { if (!await last.evaluate((r, el) => r?.descriptor?.kind === 'dropdown-numberbox' && r.target === el, element)) { guard = 'changed-before-submit'; return refused(); } } finally { await last.dispose(); }
                if (!await element.evaluate((el, p) => { const hit = document.elementFromPoint(p.x, p.y); return hit === el || el.contains(hit); }, point)) { guard = 'submit-covered'; return refused(); }
                if (stop()) return { status: 'aborted' };
                await page.mouse.click(point.x, point.y); // One Submit, never Next or retry.
            }
        } finally { await final.dispose(); }
        phase = 'post-selection'; guard = 'result-not-confirmed';
        const deadline = opts.enter ? Date.now() + opts.timeout : Infinity;
        while (!stop() && Date.now() < deadline) {
            const current = await require('./detect-question').detectQuestion(page);
            const modal = await page.$('div[uib-modal-window=modal-window]'); if (modal) { await modal.dispose(); return { status: 'modal' }; }
            if (current && typeof current.key === 'string' && current.key !== descriptor.key) return { status: 'advanced' };
            if (current?.kind === 'unsupported') return refused();
            if (current === null && await page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')].some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)))) return { status: 'complete' };
            await new Promise(r => setTimeout(r, 100));
        }
        return stop() ? { status: 'aborted' } : refused();
    } catch { guard = 'inspection-or-dispatch-uncertain'; return { status: 'stopped', reason: guard, message: 'Lesson dropdowns with number boxes stopped: input result uncertain; no retry.', selectionDiagnostic: selectionDiagnostic(), ...(refusalDiagnostic ? { diagnostic: refusalDiagnostic } : {}) }; }
    finally {
        if (trace && ownsTrace) { await trace.evaluate(observer => observer.close()).catch(() => {}); await trace.dispose().catch(() => {}); }
        for (const h of handles) await h.dispose().catch(() => {}); if (baseline) await baseline.dispose().catch(() => {});
    }
}
module.exports = { playDropdownNumberBoxRound };
