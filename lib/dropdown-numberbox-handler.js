// Plays one slide carrying both dropdown selects and number-box inputs by
// composing the two established rounds: fill the dropdown surface (F4-popup
// flow, verified around every key), fill the number boxes (per-character,
// verified around every character), then one whole-question Submit under the
// dropdown contract's readiness and guarded click, and the shared transition
// watch. Every sub-round re-read runs under the reader's explicit allow-mix
// flag; any mismatch stops the whole round without guessing.
const { readDropdownsInPage } = require('./dropdown-state');
const { NUMBER_BOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');
const { playDropdownRound } = require('./dropdown-handler');
const { playNumberBoxRound } = require('./textbox-handler');
const { waitForDropdownSubmit } = require('./dropdown-submit-readiness');
const { clickVerifiedSubmit } = require('./submit-click');
const { watchQuestionTransition } = require('./transition-watch');

const STOPPED = 'Lesson dropdowns with number boxes stopped: changed or unsupported state; no retry.';

async function playDropdownNumberBoxRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    let refusalDiagnostic;
    const refused = () => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: STOPPED, diagnostic: refusalDiagnostic });
    // A sub-round refusal keeps its own diagnostic, retold as a mixed stop.
    const wrap = result => result.status === 'aborted' ? { status: 'aborted' } : {
        status: 'stopped', reason: result.reason || 'unsafe-or-changed-state', message: STOPPED,
        ...(result.selectionDiagnostic ? { selectionDiagnostic: result.selectionDiagnostic } : {}),
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    };
    if (descriptor.kind !== 'dropdown-numberbox' || descriptor.autoMarked !== true
        || !Array.isArray(descriptor.dropdowns) || !Array.isArray(descriptor.boxes)
        || descriptor.dropdowns.some(d => d.filled) || descriptor.boxes.some(b => b.value !== '')) return refused();
    const dropdowns = await playDropdownRound(page, descriptor.dropdown, {
        ...opts, enter: false, fillOnly: true, mixedNumberBox: true,
        log: () => opts.log?.('Selected exact lesson dropdown answers.'),
    });
    if (dropdowns.status !== 'filled') return wrap(dropdowns);
    const boxes = await playNumberBoxRound(page, descriptor.numberBox, {
        ...opts, enter: false, fillOnly: true, mixedDropdown: true,
        log: () => opts.log?.('Filled exact lesson number-box answers.'),
    });
    if (boxes.status !== 'filled') return wrap(boxes);
    if (stop()) return { status: 'aborted' };
    let baseline, boxBaseline;
    const handles = [];
    try {
        // Bind a box baseline right after the verified fill: the click-time
        // re-read must prove the same components, definitions and accepted
        // answers still hold the typed values.
        boxBaseline = await page.evaluateHandle(readInputBoxesInPage, null, undefined, NUMBER_BOX_CONFIG, true);
        if (!opts.enter) {
            // Semi mode: the user submits; watch the transition like the
            // single-surface rounds do.
            const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: Infinity, detectQuestion: require('./detect-question').detectQuestion });
            if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
            refusalDiagnostic = { phase: 'post-fill', guard: transition.status === 'unsupported' ? 'unsupported-after-fill' : 'result-not-confirmed' };
            return refused();
        }
        baseline = await page.evaluateHandle(readDropdownsInPage, null, undefined, true, true);
        const ready = await waitForDropdownSubmit(page, baseline, { shouldStop: stop, timeout: opts.timeout, mixedNumberBox: true });
        if (ready.status === 'aborted') return { status: 'aborted' };
        if (ready.status !== 'ready') { refusalDiagnostic = { phase: 'submit-readiness', guard: ready.guard, submitState: ready.submitState }; return refused(); }
        handles.push(ready.handle);
        const button = await ready.handle.getProperty('target');
        handles.push(button);
        const element = button.asElement();
        if (!element) { refusalDiagnostic = { phase: 'submit-target', guard: 'missing-submit' }; return refused(); }
        if (opts.requireSubmitApproval) {
            if (typeof opts.approveSubmit !== 'function') { refusalDiagnostic = { phase: 'submit-approval', guard: 'submit-approval-required' }; return refused(); }
            let approved;
            try { approved = await opts.approveSubmit({ key: descriptor.key, dropdownCount: descriptor.dropdownCount, boxCount: descriptor.boxCount, inputMode: descriptor.inputMode }); }
            catch { refusalDiagnostic = { phase: 'submit-approval', guard: 'submit-approval-uncertain' }; return refused(); }
            if (approved !== true) { refusalDiagnostic = { phase: 'submit-approval', guard: 'submit-not-approved' }; return refused(); }
            if (stop()) return { status: 'aborted' };
        }
        // Click-time re-verification covers both surfaces, baseline-bound: a
        // box changed during the approval window stops the Submit.
        const outcome = await clickVerifiedSubmit(page, element, async el => {
            const last = await page.evaluateHandle(readDropdownsInPage, baseline, 'submit', false, true);
            let dropdownOk = false;
            try { dropdownOk = !!await last.evaluate((r, el) => r?.descriptor?.kind === 'dropdown' && r.target === el, el); } finally { await last.dispose(); }
            if (!dropdownOk) return false;
            const lastBoxes = await page.evaluateHandle(readInputBoxesInPage, boxBaseline, 'submit', NUMBER_BOX_CONFIG, true);
            try { return !!await lastBoxes.evaluate(r => r?.descriptor?.kind === 'numberbox' && r.descriptor.boxes.every(b => b.value === b.answer)); } finally { await lastBoxes.dispose(); }
        }, stop);
        if (outcome === 'aborted') return { status: 'aborted' };
        if (outcome !== 'clicked') { refusalDiagnostic = { phase: 'submit', guard: outcome === 'changed' ? 'changed-before-submit' : 'submit-covered' }; return refused(); }
        if (stop()) return { status: 'aborted' };
        const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: opts.timeout, detectQuestion: require('./detect-question').detectQuestion });
        if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
        refusalDiagnostic = { phase: 'post-submit', guard: transition.status === 'unsupported' ? 'unsupported-after-submit' : 'result-not-confirmed' };
        return refused();
    } catch { return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain', message: 'Lesson dropdowns with number boxes stopped: input result uncertain; no retry.' }; }
    finally {
        for (const h of handles) await h.dispose().catch(() => {});
        if (baseline) await baseline.dispose().catch(() => {});
        if (boxBaseline) await boxBaseline.dispose().catch(() => {});
    }
}

module.exports = { playDropdownNumberBoxRound };
