// Plays one slide carrying number boxes with dropdown selects and/or lesson
// text boxes, by composing the established rounds: fill the dropdown surface
// when present (F4-popup flow, verified around every key), fill the number
// boxes and any text boxes (per-character, verified around every character),
// then one whole-question Submit under the established readiness and guarded
// click, and the shared transition watch. Every sub-round re-read runs under
// the reader's explicit allow-mix flag; any mismatch stops the whole round
// without guessing.
const { readDropdownsInPage } = require('./dropdown-state');
const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');
const { playDropdownRound } = require('./dropdown-handler');
const { playNumberBoxRound, playTextboxRound } = require('./textbox-handler');
const { waitForDropdownSubmit } = require('./dropdown-submit-readiness');
const { verifyBoxesSubmit } = require('./mixed-submit-verify');
const { clickVerifiedSubmit } = require('./submit-click');
const { watchQuestionTransition } = require('./transition-watch');

async function playDropdownNumberBoxRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    const withDropdowns = Array.isArray(descriptor?.dropdowns) && descriptor.dropdowns.length > 0;
    const STOPPED = withDropdowns
        ? 'Lesson dropdowns with number boxes stopped: changed or unsupported state; no retry.'
        : 'Lesson number boxes with text boxes stopped: changed or unsupported state; no retry.';
    let refusalDiagnostic;
    const refused = () => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: STOPPED, diagnostic: refusalDiagnostic });
    // A sub-round refusal keeps its own diagnostic, retold as a mixed stop.
    const wrap = result => result.status === 'aborted' ? { status: 'aborted' } : {
        status: 'stopped', reason: result.reason || 'unsafe-or-changed-state', message: STOPPED,
        ...(result.selectionDiagnostic ? { selectionDiagnostic: result.selectionDiagnostic } : {}),
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    };
    const withTextBoxes = Array.isArray(descriptor.textBoxes);
    const checkDescriptor = () => {
        if (descriptor.kind !== 'dropdown-numberbox' || descriptor.autoMarked !== true
            || !Array.isArray(descriptor.dropdowns) || !Array.isArray(descriptor.boxes)
            || descriptor.dropdowns.some(d => d.filled) || descriptor.boxes.some(b => b.value !== '')
            || (withTextBoxes && descriptor.textBoxes.some(b => b.value !== ''))) return refused();
        return null;
    };
    const descriptorRefusal = checkDescriptor();
    if (descriptorRefusal) return descriptorRefusal;
    // A text-box surface admits itself into every companion reader's
    // allow-mix set; a two-surface slide keeps the original `true` contract.
    // Without selects the readers admit exactly the other box surface.
    const dropdownMix = withTextBoxes ? ['NUMBER_BOX_COMPONENT', 'TEXT_BOX_COMPONENT'] : true;
    const numberBoxMix = withDropdowns ? (withTextBoxes ? ['DROPDOWN_COMPONENT', 'TEXT_BOX_COMPONENT'] : true) : ['TEXT_BOX_COMPONENT'];
    const textBoxMix = withDropdowns ? ['DROPDOWN_COMPONENT', 'NUMBER_BOX_COMPONENT'] : ['NUMBER_BOX_COMPONENT'];
    const fillSurfaces = async () => {
        if (withDropdowns) {
            const dropdowns = await playDropdownRound(page, descriptor.dropdown, {
                ...opts, enter: false, fillOnly: true, mixedSurfaces: dropdownMix,
                log: () => opts.log?.('Selected exact lesson dropdown answers.'),
            });
            if (dropdowns.status !== 'filled') return wrap(dropdowns);
        }
        const boxes = await playNumberBoxRound(page, descriptor.numberBox, {
            ...opts, enter: false, fillOnly: true, mixedSurfaces: numberBoxMix,
            log: () => opts.log?.('Filled exact lesson number-box answers.'),
        });
        if (boxes.status !== 'filled') return wrap(boxes);
        if (withTextBoxes) {
            const textBoxes = await playTextboxRound(page, descriptor.textBox, {
                ...opts, enter: false, fillOnly: true, mixedSurfaces: textBoxMix,
                log: () => opts.log?.('Filled exact lesson textbox answers.'),
            });
            if (textBoxes.status !== 'filled') return wrap(textBoxes);
        }
        return null;
    };
    const fillOutcome = await fillSurfaces();
    if (fillOutcome) return fillOutcome;
    if (stop()) return { status: 'aborted' };
    let baseline, boxBaseline, textBoxBaseline;
    const handles = [];
    try {
        // Bind a box baseline right after the verified fill: the click-time
        // re-read must prove the same components, definitions and accepted
        // answers still hold the typed values.
        boxBaseline = await page.evaluateHandle(readInputBoxesInPage, null, undefined, NUMBER_BOX_CONFIG, numberBoxMix);
        if (withTextBoxes) textBoxBaseline = await page.evaluateHandle(readInputBoxesInPage, null, undefined, TEXTBOX_CONFIG, textBoxMix);
        if (!opts.enter) {
            // Semi mode: the user submits; watch the transition like the
            // single-surface rounds do.
            opts.onWatching?.(); // test synchronisation point: every baseline is bound, the user may Submit now
            const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: Infinity, detectQuestion: require('./detect-question').detectQuestion });
            if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
            refusalDiagnostic = { phase: 'post-fill', guard: transition.status === 'unsupported' ? 'unsupported-after-fill' : 'result-not-confirmed' };
            return refused();
        }
        // The submit target comes from the dropdown readiness poll when a
        // dropdown surface is present (F4-popup timing), otherwise from the
        // number-box contract's final submit read, which owns the button.
        const resolveDropdownTarget = async () => {
            baseline = await page.evaluateHandle(readDropdownsInPage, null, undefined, true, dropdownMix);
            const ready = await waitForDropdownSubmit(page, baseline, { shouldStop: stop, timeout: opts.timeout, mixedNumberBox: dropdownMix });
            if (ready.status === 'aborted') return { status: 'aborted' };
            if (ready.status !== 'ready') { refusalDiagnostic = { phase: 'submit-readiness', guard: ready.guard, submitState: ready.submitState }; return refused(); }
            handles.push(ready.handle);
            const button = await ready.handle.getProperty('target');
            handles.push(button);
            return { element: button.asElement() };
        };
        const resolveBoxTarget = async () => {
            // Wait out EP's asynchronous Submit enablement (bounded, like
            // the gaps and multi-select rounds) before judging the read.
            let final;
            const deadline = Date.now() + Math.min(Math.max(opts.timeout || 0, 0), 3000);
            while (true) {
                if (stop()) return { status: 'aborted' };
                final = await page.evaluateHandle(readInputBoxesInPage, boxBaseline, 'submit', NUMBER_BOX_CONFIG, numberBoxMix);
                const waiting = await final.evaluate(r => r?.readiness === 'not-ready');
                if (!waiting || Date.now() >= deadline) break;
                await final.dispose();
                final = null;
                await new Promise(r => setTimeout(r, 50));
            }
            if (!final) { refusalDiagnostic = { phase: 'submit-target', guard: 'final-state-mismatch' }; return refused(); }
            handles.push(final);
            const finalOk = await final.evaluate(r => r?.descriptor?.kind === 'numberbox' && !r.readiness && !!r.target && r.descriptor.boxes.every(b => b.value === b.answer));
            if (!finalOk) { refusalDiagnostic = { phase: 'submit-target', guard: 'final-state-mismatch' }; return refused(); }
            const button = await final.getProperty('target');
            handles.push(button);
            return { element: button.asElement() };
        };
        const target = withDropdowns ? await resolveDropdownTarget() : await resolveBoxTarget();
        if (target.status) return target;
        const element = target.element;
        if (!element) { refusalDiagnostic = { phase: 'submit-target', guard: 'missing-submit' }; return refused(); }
        // Click-time re-verification covers every surface, baseline-bound: a
        // control changed between fill and click stops the Submit. The read
        // that owns the button also proves it still targets this element.
        await opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
        const outcome = await clickVerifiedSubmit(page, element, async el => {
            if (withDropdowns) {
                const last = await page.evaluateHandle(readDropdownsInPage, baseline, 'submit', false, dropdownMix);
                let dropdownOk = false;
                try { dropdownOk = !!await last.evaluate((r, el) => r?.descriptor?.kind === 'dropdown' && r.target === el, el); } finally { await last.dispose(); }
                if (!dropdownOk) return false;
            }
            if (!await verifyBoxesSubmit(page, boxBaseline, NUMBER_BOX_CONFIG, numberBoxMix, 'numberbox', !withDropdowns, el)) return false;
            if (!withTextBoxes) return true;
            return verifyBoxesSubmit(page, textBoxBaseline, TEXTBOX_CONFIG, textBoxMix, 'textbox', false, el);
        }, stop);
        if (outcome === 'aborted') return { status: 'aborted' };
        if (outcome !== 'clicked') { refusalDiagnostic = { phase: 'submit', guard: outcome === 'changed' ? 'changed-before-submit' : 'submit-covered' }; return refused(); }
        if (stop()) return { status: 'aborted' };
        const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: opts.timeout, detectQuestion: require('./detect-question').detectQuestion });
        if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
        refusalDiagnostic = { phase: 'post-submit', guard: transition.status === 'unsupported' ? 'unsupported-after-submit' : 'result-not-confirmed' };
        return refused();
    } catch { return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain', message: withDropdowns ? 'Lesson dropdowns with number boxes stopped: input result uncertain; no retry.' : 'Lesson number boxes with text boxes stopped: input result uncertain; no retry.' }; }
    finally {
        for (const h of handles) await h.dispose().catch(() => {});
        if (baseline) await baseline.dispose().catch(() => {});
        if (boxBaseline) await boxBaseline.dispose().catch(() => {});
        if (textBoxBaseline) await textBoxBaseline.dispose().catch(() => {});
    }
}

module.exports = { playDropdownNumberBoxRound };
