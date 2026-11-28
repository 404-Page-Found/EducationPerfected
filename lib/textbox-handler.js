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

const ABORTED = { status: 'aborted' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = (c, handle, mode) => c.page.evaluateHandle(readInputBoxesInPage, handle, mode, c.config.state, c.mix);
const refused = c => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: c.config.stopped, diagnostic: c.diagnostic });

// Re-read and verify the typed prefix (and focus when active). Returns the
// target element, true for an active check, or null (diagnostic recorded).
async function check(c, index, active = false) {
    const state = await read(c, c.baseline, index);
    try {
        const stateCheck = await state.evaluate((r, values, focus, kind) => {
            const ok = r?.descriptor?.kind === kind && r.descriptor.boxes.every((b, i) => b.value === values[i])
                && (!focus || (document.activeElement === r.target && r.target.selectionStart === r.target.value.length && r.target.selectionEnd === r.target.value.length));
            return { ok, diagnostic: !ok && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined };
        }, c.expected, active, c.config.state.kind);
        if (!stateCheck.ok) {
            c.diagnostic = stateCheck.diagnostic;
            return null;
        }
        if (active) return true; // Focus/prefix checks need no retained target handle.
        const handle = await state.getProperty('target');
        c.handles.push(handle);
        return handle.asElement();
    } finally { await state.dispose(); }
}

async function typeBox(c, i) {
    if (c.stop()) return ABORTED;
    const element = await check(c, i);
    if (!element) return refused(c);
    await element.focus();
    for (const char of c.descriptor.boxes[i].answer) {
        if (c.stop()) return ABORTED;
        if (!await check(c, i, true)) return refused(c);
        if (c.stop()) return ABORTED;
        await element.type(char); // No Enter or replacement/retry. EP input events update cached answer.
        c.expected[i] += char;
        if (!await check(c, i, true)) return refused(c);
    }
    return null;
}

async function fillAll(c) {
    for (let i = 0; i < c.descriptor.boxes.length; i++) {
        const stopped = await typeBox(c, i);
        if (stopped) return stopped;
    }
    if (c.stop()) return ABORTED;
    return await check(c, 0) ? null : refused(c);
}

// Wait out EP's asynchronous Submit enablement (bounded, like the
// gaps and multi-select rounds). Resolves to { result } or { final }.
async function awaitSubmit(c) {
    const deadline = Date.now() + Math.min(Math.max(c.opts.timeout || 0, 0), 3000);
    for (;;) {
        if (c.stop()) return { result: ABORTED };
        const final = await read(c, c.baseline, 'submit');
        const waiting = await final.evaluate(r => r?.readiness === 'not-ready');
        if (!waiting || Date.now() >= deadline) return { final };
        await final.dispose();
        await sleep(50);
    }
}

async function lastCheck(c, el) {
    const last = await read(c, c.baseline, 'submit');
    try {
        const result = await last.evaluate((r, el, kind) => ({
            ok: r?.descriptor?.kind === kind && r.target === el,
            diagnostic: !(r?.descriptor?.kind === kind && r.target === el) && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined,
        }), el, c.config.state.kind);
        if (!result.ok) c.diagnostic = result.diagnostic;
        return result.ok;
    } finally { await last.dispose(); }
}

async function submitFinal(c, final) {
    const finalCheck = await final.evaluate((r, kind) => ({
        ok: r?.descriptor?.kind === kind && !!r.target,
        diagnostic: !(r?.descriptor?.kind === kind && !!r.target) && r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined,
    }), c.config.state.kind);
    if (!finalCheck.ok) {
        c.diagnostic = finalCheck.diagnostic;
        return refused(c);
    }
    const button = await final.getProperty('target');
    c.handles.push(button);
    const element = button.asElement();
    if (!element) return refused(c);
    await c.opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
    const outcome = await clickVerifiedSubmit(c.page, element, el => lastCheck(c, el), c.stop);
    if (outcome === 'aborted') return ABORTED;
    return outcome === 'clicked' ? null : refused(c);
}

async function submitRound(c) {
    const waited = await awaitSubmit(c);
    if (waited.result) return waited.result;
    try {
        return await submitFinal(c, waited.final);
    } finally { await waited.final.dispose(); }
}

async function afterSubmit(c) {
    // Conservative stop, not a claim that submission failed. Do not
    // continue answering through an unrecognized slide.
    const transition = await watchQuestionTransition(c.page, c.descriptor.key, { shouldStop: c.stop, timeout: c.opts.enter ? c.opts.timeout : Infinity, detectQuestion: require('./detect-question').detectQuestion });
    if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
    if (transition.status === 'unsupported') return { status: 'stopped', reason: 'unsupported', message: c.config.transition };
    return refused(c);
}

async function runRound(c) {
    const { descriptor, config } = c;
    if (descriptor.kind !== config.state.kind || descriptor.autoMarked !== true || descriptor.boxes.some(b => b.value !== '')) return refused(c);
    c.baseline = await read(c, null, undefined);
    if (!await c.baseline.evaluate((r, d) => JSON.stringify(r?.descriptor) === JSON.stringify(d), descriptor)) {
        c.diagnostic = await c.baseline.evaluate(r => r?.descriptor?.kind === 'unsupported' ? r.descriptor.diagnostic : undefined);
        return refused(c);
    }
    c.expected = descriptor.boxes.map(() => '');
    const filled = await fillAll(c);
    if (filled) return filled;
    c.opts.log?.(config.filled);
    // Fill-only phase for the mixed handler: verified fill, no Submit.
    if (c.opts.fillOnly) return { status: 'filled' };
    if (c.opts.enter) {
        const submitted = await submitRound(c);
        if (submitted) return submitted;
    }
    return afterSubmit(c);
}

async function playInputBoxesRound(page, descriptor, opts, config) {
    // Set only by the mixed-slide handler: every internal re-read then
    // allows the verified companion surfaces alongside.
    const mix = opts.mixedSurfaces ?? (opts.mixedDropdown === true);
    const c = { page, descriptor, opts, config, mix, stop: opts.shouldStop || (() => false), handles: [], baseline: undefined, diagnostic: undefined, expected: [] };
    try {
        return await runRound(c);
    } catch { return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain', message: config.uncertain }; }
    finally {
        for (const h of c.handles) await h.dispose().catch(() => {});
        if (c.baseline) await c.baseline.dispose().catch(() => {});
    }
}

async function playTextboxRound(page, descriptor, opts) {
    return playInputBoxesRound(page, descriptor, opts, HANDLERS.textbox);
}
async function playNumberBoxRound(page, descriptor, opts) {
    return playInputBoxesRound(page, descriptor, opts, HANDLERS.numberbox);
}

module.exports = { playTextboxRound, playNumberBoxRound };
