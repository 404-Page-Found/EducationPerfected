const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');
const { clickVerifiedSubmit } = require('./submit-click');
const { watchQuestionTransition } = require('./transition-watch');

const HANDLERS = {
    textbox: {
        state: TEXTBOX_CONFIG,
        stopped: 'Lesson textboxes stopped: changed or unsupported state; no retry.',
        filled: 'Filled exact lesson textbox answers.',
        transition: 'Lesson textboxes stopped: unsupported or changed slide; submission outcome not verified; no retry.',
        uncertain: 'Lesson textboxes stopped: inspection or input result uncertain; no retry.',
    },
    numberbox: {
        state: NUMBER_BOX_CONFIG,
        stopped: 'Lesson number boxes stopped: changed or unsupported state; no retry.',
        filled: 'Filled exact lesson number-box answers.',
        transition: 'Lesson number boxes stopped: unsupported or changed slide; submission outcome not verified; no retry.',
        uncertain: 'Lesson number boxes stopped: inspection or input result uncertain; no retry.',
    },
};

async function playInputBoxesRound(page, descriptor, opts, config) {
    const stop = opts.shouldStop || (() => false);
    // Set only by the mixed-slide handler: every internal re-read then
    // allows the verified companion surfaces alongside.
    const mix = opts.mixedSurfaces ?? (opts.mixedDropdown === true);
    let refusalDiagnostic;
    const refused = () => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: config.stopped, diagnostic: refusalDiagnostic });
    let baseline;
    const handles = [];
    try {
        if (descriptor.kind !== config.state.kind || descriptor.autoMarked !== true || descriptor.boxes.some(b => b.value !== '')) return refused();
        baseline = await page.evaluateHandle(readInputBoxesInPage, null, undefined, config.state, mix);
        if (!await baseline.evaluate((r, d) => JSON.stringify(r?.descriptor) === JSON.stringify(d), descriptor)) {
            refusalDiagnostic = await baseline.evaluate(r => r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined);
            return refused();
        }
        const expected = descriptor.boxes.map(() => '');
        const check = async (index, active = false) => {
            const state = await page.evaluateHandle(readInputBoxesInPage, baseline, index, config.state, mix);
            try {
                const stateCheck = await state.evaluate((r, values, focus, kind) => {
                    const ok = r?.descriptor?.kind === kind && r.descriptor.boxes.every((b, i) => b.value === values[i])
                        && (!focus || (document.activeElement === r.target && r.target.selectionStart === r.target.value.length && r.target.selectionEnd === r.target.value.length));
                    return { ok, diagnostic: !ok && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined };
                }, expected, active, config.state.kind);
                if (!stateCheck.ok) {
                    refusalDiagnostic = stateCheck.diagnostic;
                    return null;
                }
                if (active) return true; // Focus/prefix checks need no retained target handle.
                const handle = await state.getProperty('target');
                handles.push(handle);
                return handle.asElement();
            } finally { await state.dispose(); }
        };
        for (let i = 0; i < descriptor.boxes.length; i++) {
            if (stop()) return { status: 'aborted' };
            const element = await check(i);
            if (!element) return refused();
            await element.focus();
            for (const char of descriptor.boxes[i].answer) {
                if (stop()) return { status: 'aborted' };
                if (!await check(i, true)) return refused();
                if (stop()) return { status: 'aborted' };
                await element.type(char); // No Enter or replacement/retry. EP input events update cached answer.
                expected[i] += char;
                if (!await check(i, true)) return refused();
            }
        }
        if (stop()) return { status: 'aborted' };
        if (!await check(0)) return refused();
        opts.log?.(config.filled);
        // Fill-only phase for the mixed handler: verified fill, no Submit.
        if (opts.fillOnly) return { status: 'filled' };
        if (opts.enter) {
            const final = await page.evaluateHandle(readInputBoxesInPage, baseline, 'submit', config.state, mix);
            try {
                const finalCheck = await final.evaluate((r, kind) => ({
                    ok: r?.descriptor?.kind === kind && !!r.target,
                    diagnostic: !(r?.descriptor?.kind === kind && !!r.target) && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined,
                }), config.state.kind);
                if (!finalCheck.ok) {
                    refusalDiagnostic = finalCheck.diagnostic;
                    return refused();
                }
                const button = await final.getProperty('target');
                handles.push(button);
                const element = button.asElement();
                if (!element) return refused();
                const outcome = await clickVerifiedSubmit(page, element, async el => {
                    const last = await page.evaluateHandle(readInputBoxesInPage, baseline, 'submit', config.state, mix);
                    try {
                        const lastCheck = await last.evaluate((r, el, kind) => ({
                            ok: r?.descriptor?.kind === kind && r.target === el,
                            diagnostic: !(r?.descriptor?.kind === kind && r.target === el) && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined,
                        }), el, config.state.kind);
                        if (!lastCheck.ok) refusalDiagnostic = lastCheck.diagnostic;
                        return lastCheck.ok;
                    }
                    finally { await last.dispose(); }
                }, stop);
                if (outcome === 'aborted') return { status: 'aborted' };
                if (outcome !== 'clicked') return refused();
            } finally { await final.dispose(); }
        }
        // Conservative stop, not a claim that submission failed. Do not
        // continue answering through an unrecognized slide.
        const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: opts.enter ? opts.timeout : Infinity, detectQuestion: require('./detect-question').detectQuestion });
        if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
        if (transition.status === 'unsupported') return { status: 'stopped', reason: 'unsupported', message: config.transition };
        return refused();
    } catch { return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain', message: config.uncertain }; }
    finally {
        for (const h of handles) await h.dispose().catch(() => {});
        if (baseline) await baseline.dispose().catch(() => {});
    }
}

async function playTextboxRound(page, descriptor, opts) {
    return playInputBoxesRound(page, descriptor, opts, HANDLERS.textbox);
}
async function playNumberBoxRound(page, descriptor, opts) {
    return playInputBoxesRound(page, descriptor, opts, HANDLERS.numberbox);
}

module.exports = { playTextboxRound, playNumberBoxRound };
