// Plays one slide carrying exactly one multi-select surface plus box-family
// inputs (dropdown selects, number boxes and/or lesson text boxes), by
// composing the established rounds: fill the dropdown surface when present
// (F4-popup flow, verified around every key), fill the number boxes and any
// text boxes (per-character, verified around every character), select the
// exact multi-select answer set (trusted clicks, re-verified after each),
// then one whole-question Submit under the established readiness and guarded
// click, and the shared transition watch. Every sub-round re-read runs under
// the readers' explicit allow-mix sets; any mismatch stops the whole round
// without guessing.
const { readDropdownsInPage } = require('./dropdown-state');
const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');
const { readMultiChoiceInPage } = require('./multi-choice-state');
const { playDropdownRound } = require('./dropdown-handler');
const { playNumberBoxRound, playTextboxRound } = require('./textbox-handler');
const { readChoiceInPage } = require('./choice-state');
const { selectChoiceOption } = require('./choice-handler');
const { playMultiChoiceSelection } = require('./multi-choice-handler');
const { readGapsInPage } = require('./gaps-state');
const { readHighlightInPage } = require('./highlight-state');
const { playGapsRound } = require('./gaps-handler');
const { playHighlightRound } = require('./highlight-handler');
const { waitForDropdownSubmit } = require('./dropdown-submit-readiness');
const { verifyBoxesSubmit } = require('./mixed-submit-verify');
const { clickVerifiedSubmit } = require('./submit-click');
const { watchQuestionTransition } = require('./transition-watch');

async function playSlideSurfacesRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    const STOPPED = 'Multi-select with lesson inputs stopped: changed or unsupported state; no retry.';
    let refusalDiagnostic;
    const refused = () => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: STOPPED, diagnostic: refusalDiagnostic });
    // A sub-round refusal keeps its own diagnostic, retold as an
    // orchestrator stop.
    const wrap = result => result == null ? null : result.status === 'aborted' ? { status: 'aborted' } : {
        status: 'stopped', reason: result.reason || 'unsafe-or-changed-state', message: STOPPED,
        ...(result.selectionDiagnostic ? { selectionDiagnostic: result.selectionDiagnostic } : {}),
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    };
    if (descriptor.kind !== 'slide-surfaces' || descriptor.autoMarked !== true
        || !Array.isArray(descriptor.surfaces) || !descriptor.multi || descriptor.multi.autoMarked !== true
        || (descriptor.dropdown && descriptor.dropdown.dropdowns.some(d => d.filled))
        || (descriptor.numberBox && descriptor.numberBox.boxes.some(b => b.value !== ''))
        || (descriptor.textBox && descriptor.textBox.boxes.some(b => b.value !== ''))
        || (descriptor.gaps && descriptor.gaps.gaps.some(g => g.filled))
        || (descriptor.highlight && (!Array.isArray(descriptor.highlight.selected) || descriptor.highlight.selected.length))) return refused();
    // Each companion reader admits exactly the other present surfaces, never
    // its own, matching the composed detection's allow-mix sets.
    const mixFor = own => descriptor.surfaces.filter(t => t !== own);
    const dropdownMix = mixFor('DROPDOWN_COMPONENT');
    const numberBoxMix = mixFor('NUMBER_BOX_COMPONENT');
    const textBoxMix = mixFor('TEXT_BOX_COMPONENT');
    // With a sibling single-choice surface both choice readers receive the
    // full type set (their shared component code marks the sibling).
    const multiMix = descriptor.choiceSibling ? descriptor.surfaces : mixFor('MULTICHOICE_COMPONENT');
    const choiceMix = descriptor.surfaces;
    const gapsMix = mixFor('FILL_IN_GAPS_COMPONENT');
    const highlightMix = mixFor('HIGHLIGHT_COMPONENT');
    if (descriptor.dropdown) {
        const dropdowns = await playDropdownRound(page, descriptor.dropdown, {
            ...opts, enter: false, fillOnly: true, mixedSurfaces: dropdownMix,
            log: () => opts.log?.('Selected exact lesson dropdown answers.'),
        });
        if (dropdowns.status !== 'filled') return wrap(dropdowns);
    }
    if (descriptor.numberBox) {
        const boxes = await playNumberBoxRound(page, descriptor.numberBox, {
            ...opts, enter: false, fillOnly: true, mixedSurfaces: numberBoxMix,
            log: () => opts.log?.('Filled exact lesson number-box answers.'),
        });
        if (boxes.status !== 'filled') return wrap(boxes);
    }
    if (descriptor.textBox) {
        const textBoxes = await playTextboxRound(page, descriptor.textBox, {
            ...opts, enter: false, fillOnly: true, mixedSurfaces: textBoxMix,
            log: () => opts.log?.('Filled exact lesson textbox answers.'),
        });
        if (textBoxes.status !== 'filled') return wrap(textBoxes);
    }
    if (descriptor.gaps) {
        // Fill-only: every gap answered with a verified read around each
        // trusted key; the orchestrator owns the single Submit.
        const gaps = await playGapsRound(page, descriptor.gaps, {
            ...opts, enter: false, fillOnly: true, mixedSurfaces: gapsMix,
            log: () => opts.log?.('Filled exact drag-and-drop gap answers.'),
        });
        if (gaps.status !== 'filled') return wrap(gaps);
    }
    if (descriptor.highlight) {
        // Select-only: the exact token set clicked with a verified read
        // around each trusted click; the orchestrator owns the single Submit.
        const highlight = await playHighlightRound(page, descriptor.highlight, {
            ...opts, enter: false, fillOnly: true, mixedSurfaces: highlightMix,
            log: () => opts.log?.('Selected exact highlight answer set.'),
        });
        if (highlight.status !== 'filled') return wrap(highlight);
    }
    if (descriptor.choice) {
        // The established single-choice selection path: click-time text
        // match, one trusted click, no Submit - the orchestrator owns it.
        const selected = await selectChoiceOption(page, descriptor.choice, stop, () => opts.log?.('Selected exact single-choice answer.'));
        if (selected !== null) return wrap(selected);
    }
    // The multi-select round selects the exact correct set with a verified
    // read around every click; enter:false stops before its Submit.
    const selected = await playMultiChoiceSelection(page, descriptor.multi, {
        ...opts, enter: false, mixedSurfaces: multiMix,
        log: () => opts.log?.('Selected exact multi-select answer set.'),
    });
    if (selected !== null) return wrap(selected) || refused();
    if (stop()) return { status: 'aborted' };
    let baseline, boxBaseline, textBoxBaseline, gapsBaseline, highlightBaseline, multiBaseline;
    const handles = [];
    try {
        // Bind every surface's baseline right after the verified fills: the
        // click-time re-read must prove the same components, definitions,
        // accepted answers and typed/selected values still hold.
        if (descriptor.dropdown) baseline = await page.evaluateHandle(readDropdownsInPage, null, undefined, true, dropdownMix);
        if (descriptor.numberBox) boxBaseline = await page.evaluateHandle(readInputBoxesInPage, null, undefined, NUMBER_BOX_CONFIG, numberBoxMix);
        if (descriptor.textBox) textBoxBaseline = await page.evaluateHandle(readInputBoxesInPage, null, undefined, TEXTBOX_CONFIG, textBoxMix);
        if (descriptor.gaps) gapsBaseline = await page.evaluateHandle(readGapsInPage, null, undefined, gapsMix);
        if (descriptor.highlight) highlightBaseline = await page.evaluateHandle(readHighlightInPage, null, undefined, highlightMix);
        multiBaseline = await page.evaluateHandle(readMultiChoiceInPage, null, undefined, multiMix);
        if (!opts.enter) {
            // Semi mode: the user submits; watch the transition like the
            // single-surface rounds do.
            const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: Infinity, detectQuestion: require('./detect-question').detectQuestion });
            if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
            refusalDiagnostic = { phase: 'post-fill', guard: transition.status === 'unsupported' ? 'unsupported-after-fill' : 'result-not-confirmed' };
            return refused();
        }
        // The submit target comes from the dropdown readiness poll when a
        // dropdown surface is present (F4-popup timing), otherwise from the
        // first present input-box surface's final submit read, otherwise
        // from the multi-select contract's submit read; that read owns the
        // button and proves it still targets this element at click time.
        let element, owner;
        if (descriptor.dropdown) {
            const ready = await waitForDropdownSubmit(page, baseline, { shouldStop: stop, timeout: opts.timeout, mixedNumberBox: dropdownMix });
            if (ready.status === 'aborted') return { status: 'aborted' };
            if (ready.status !== 'ready') { refusalDiagnostic = { phase: 'submit-readiness', guard: ready.guard, submitState: ready.submitState }; return refused(); }
            handles.push(ready.handle);
            const button = await ready.handle.getProperty('target');
            handles.push(button);
            element = button.asElement();
            owner = 'dropdown';
        } else {
            const config = descriptor.numberBox ? NUMBER_BOX_CONFIG : descriptor.textBox ? TEXTBOX_CONFIG : null;
            const ownerBaseline = descriptor.numberBox ? boxBaseline : descriptor.textBox ? textBoxBaseline : multiBaseline;
            const ownerReader = config ? readInputBoxesInPage : readMultiChoiceInPage;
            const ownerArgs = config ? [ownerBaseline, 'submit', config, descriptor.numberBox ? numberBoxMix : textBoxMix] : [ownerBaseline, 'submit', multiMix];
            // Wait out EP's asynchronous Submit enablement (bounded, like
            // the gaps and multi-select rounds) before judging the read.
            let final;
            const deadline = Date.now() + Math.min(Math.max(opts.timeout || 0, 0), 3000);
            while (true) {
                if (stop()) return { status: 'aborted' };
                final = await page.evaluateHandle(ownerReader, ...ownerArgs);
                const waiting = await final.evaluate(r => r?.readiness === 'not-ready');
                if (!waiting || Date.now() >= deadline) break;
                await final.dispose();
                final = null;
                await new Promise(r => setTimeout(r, 50));
            }
            if (!final) { refusalDiagnostic = { phase: 'submit-target', guard: 'final-state-mismatch' }; return refused(); }
            handles.push(final);
            const kind = descriptor.numberBox ? 'numberbox' : descriptor.textBox ? 'textbox' : 'choice';
            const finalOk = await final.evaluate((r, kind) => r?.descriptor?.kind === kind && !r.readiness && !!r.target
                && (kind === 'choice' ? r.descriptor.autoMarked === true : r.descriptor.boxes.every(b => b.value === b.answer)), kind);
            if (!finalOk) { refusalDiagnostic = { phase: 'submit-target', guard: 'final-state-mismatch' }; return refused(); }
            const button = await final.getProperty('target');
            handles.push(button);
            element = button.asElement();
            owner = kind;
        }
        if (!element) { refusalDiagnostic = { phase: 'submit-target', guard: 'missing-submit' }; return refused(); }
        // Click-time re-verification covers every surface, baseline-bound: a
        // control changed between fill and click stops the Submit.
        const outcome = await clickVerifiedSubmit(page, element, async el => {
            if (descriptor.dropdown) {
                const last = await page.evaluateHandle(readDropdownsInPage, baseline, 'submit', false, dropdownMix);
                let dropdownOk = false;
                try { dropdownOk = !!await last.evaluate((r, el) => r?.descriptor?.kind === 'dropdown' && r.target === el, el); } finally { await last.dispose(); }
                if (!dropdownOk) return false;
            }
            if (descriptor.numberBox && !await verifyBoxesSubmit(page, boxBaseline, NUMBER_BOX_CONFIG, numberBoxMix, 'numberbox', owner === 'numberbox', el)) return false;
            if (descriptor.textBox && !await verifyBoxesSubmit(page, textBoxBaseline, TEXTBOX_CONFIG, textBoxMix, 'textbox', owner === 'textbox', el)) return false;
            // Gaps and highlight never own the Submit target (the multi
            // surface is always present and outranks them); their submit
            // reads re-prove the exact filled set and a ready shared Submit.
            if (descriptor.gaps) {
                const last = await page.evaluateHandle(readGapsInPage, gapsBaseline, 'submit', gapsMix);
                let gapsOk = false;
                try { gapsOk = !!await last.evaluate(r => r?.descriptor?.kind === 'gaps' && r.descriptor.autoMarked === true && !r.readiness); } finally { await last.dispose(); }
                if (!gapsOk) return false;
            }
            if (descriptor.highlight) {
                const last = await page.evaluateHandle(readHighlightInPage, highlightBaseline, 'submit', highlightMix);
                let highlightOk = false;
                try { highlightOk = !!await last.evaluate(r => r?.descriptor?.kind === 'highlight' && r.descriptor.autoMarked === true && !r.readiness); } finally { await last.dispose(); }
                if (!highlightOk) return false;
            }
            if (descriptor.choice) {
                // The legacy choice contract's click-time proof: a fresh read
                // re-binds the same key, mode, auto-marking and correct set.
                const fresh = await page.evaluate(readChoiceInPage, null, null, choiceMix);
                if (!(fresh?.kind === 'choice' && fresh.multi === false && fresh.key === descriptor.choice.key
                    && fresh.autoMarked === true && JSON.stringify(fresh.correct) === JSON.stringify(descriptor.choice.correct))) return false;
            }
            const last = await page.evaluateHandle(readMultiChoiceInPage, multiBaseline, 'submit', multiMix);
            let multiOk = false;
            try { multiOk = !!await last.evaluate((r, el, ownsTarget) => r?.descriptor?.kind === 'choice' && r.descriptor.autoMarked === true && (!ownsTarget || r.target === el) && !r.readiness, el, owner === 'choice'); } finally { await last.dispose(); }
            return multiOk;
        }, stop);
        if (outcome === 'aborted') return { status: 'aborted' };
        if (outcome !== 'clicked') { refusalDiagnostic = { phase: 'submit', guard: outcome === 'changed' ? 'changed-before-submit' : 'submit-covered' }; return refused(); }
        if (stop()) return { status: 'aborted' };
        const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: opts.timeout, detectQuestion: require('./detect-question').detectQuestion });
        if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
        refusalDiagnostic = { phase: 'post-submit', guard: transition.status === 'unsupported' ? 'unsupported-after-submit' : 'result-not-confirmed' };
        return refused();
    } catch { return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain', message: 'Multi-select with lesson inputs stopped: input result uncertain; no retry.' }; }
    finally {
        for (const h of handles) await h.dispose().catch(() => {});
        if (baseline) await baseline.dispose().catch(() => {});
        if (boxBaseline) await boxBaseline.dispose().catch(() => {});
        if (textBoxBaseline) await textBoxBaseline.dispose().catch(() => {});
        if (gapsBaseline) await gapsBaseline.dispose().catch(() => {});
        if (highlightBaseline) await highlightBaseline.dispose().catch(() => {});
        if (multiBaseline) await multiBaseline.dispose().catch(() => {});
    }
}

module.exports = { playSlideSurfacesRound };
