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

const ABORTED = { status: 'aborted' };
const WATCH_DONE = ['advanced', 'modal', 'complete', 'aborted'];
const refused = c => ({ status: 'stopped', reason: 'unsafe-or-changed-state', message: c.stopped, diagnostic: c.diagnostic });
const refuseWith = (c, diagnostic) => { c.diagnostic = diagnostic; return refused(c); };

// A sub-round refusal keeps its own diagnostic, retold as a mixed stop.
const wrap = (c, result) => result.status === 'aborted' ? ABORTED : {
    status: 'stopped', reason: result.reason || 'unsafe-or-changed-state', message: c.stopped,
    ...(result.selectionDiagnostic ? { selectionDiagnostic: result.selectionDiagnostic } : {}),
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
};

const descriptorRefusal = c => {
    const { descriptor } = c;
    if (descriptor.kind !== 'dropdown-numberbox' || descriptor.autoMarked !== true
        || !Array.isArray(descriptor.dropdowns) || !Array.isArray(descriptor.boxes)
        || descriptor.dropdowns.some(d => d.filled) || descriptor.boxes.some(b => b.value !== '')
        || (c.withTextBoxes && descriptor.textBoxes.some(b => b.value !== ''))) return refused(c);
    return null;
};

// Allow-mix sets. A text-box surface admits itself into every companion
// reader's set; a two-surface slide keeps the original `true` contract.
// Without selects the readers admit exactly the other box surface.
function surfaceMixes(withDropdowns, withTextBoxes) {
    let numberBoxMix = ['TEXT_BOX_COMPONENT'];
    if (withDropdowns) numberBoxMix = withTextBoxes ? ['DROPDOWN_COMPONENT', 'TEXT_BOX_COMPONENT'] : true;
    return {
        dropdownMix: withTextBoxes ? ['NUMBER_BOX_COMPONENT', 'TEXT_BOX_COMPONENT'] : true,
        numberBoxMix,
        textBoxMix: withDropdowns ? ['DROPDOWN_COMPONENT', 'NUMBER_BOX_COMPONENT'] : ['NUMBER_BOX_COMPONENT'],
    };
}

// One verified fill-only sub-round; returns a stop result or null.
async function fillSurface(c, play, descriptor, mixedSurfaces, message) {
    const result = await play(c.page, descriptor, {
        ...c.opts, enter: false, fillOnly: true, mixedSurfaces,
        log: () => c.opts.log?.(message),
    });
    return result.status === 'filled' ? null : wrap(c, result);
}

async function fillSurfaces(c) {
    const { descriptor } = c;
    if (c.withDropdowns) {
        const stopped = await fillSurface(c, playDropdownRound, descriptor.dropdown, c.dropdownMix, 'Selected exact lesson dropdown answers.');
        if (stopped) return stopped;
    }
    const boxStop = await fillSurface(c, playNumberBoxRound, descriptor.numberBox, c.numberBoxMix, 'Filled exact lesson number-box answers.');
    if (boxStop) return boxStop;
    if (!c.withTextBoxes) return null;
    return fillSurface(c, playTextboxRound, descriptor.textBox, c.textBoxMix, 'Filled exact lesson textbox answers.');
}

async function watchTransition(c, timeout) {
    return watchQuestionTransition(c.page, c.descriptor.key, { shouldStop: c.stop, timeout, detectQuestion: require('./detect-question').detectQuestion });
}

// Semi mode: the user submits; watch the transition like the
// single-surface rounds do.
async function watchSemi(c) {
    c.opts.onWatching?.(); // test synchronisation point: every baseline is bound, the user may Submit now
    const transition = await watchTransition(c, Infinity);
    if (WATCH_DONE.includes(transition.status)) return transition;
    return refuseWith(c, { phase: 'post-fill', guard: transition.status === 'unsupported' ? 'unsupported-after-fill' : 'result-not-confirmed' });
}

// The submit target comes from the dropdown readiness poll when a dropdown
// surface is present (F4-popup timing).
async function resolveDropdownTarget(c) {
    c.baseline = await c.page.evaluateHandle(readDropdownsInPage, null, undefined, true, c.dropdownMix);
    const ready = await waitForDropdownSubmit(c.page, c.baseline, { shouldStop: c.stop, timeout: c.opts.timeout, mixedNumberBox: c.dropdownMix });
    if (ready.status === 'aborted') return ABORTED;
    if (ready.status !== 'ready') return refuseWith(c, { phase: 'submit-readiness', guard: ready.guard, submitState: ready.submitState });
    c.handles.push(ready.handle);
    const button = await ready.handle.getProperty('target');
    c.handles.push(button);
    return { element: button.asElement() };
}

// Wait out EP's asynchronous Submit enablement (bounded, like the gaps and
// multi-select rounds). Resolves to { result } or { final } (may be null).
async function awaitBoxSubmit(c) {
    const deadline = Date.now() + Math.min(Math.max(c.opts.timeout || 0, 0), 3000);
    for (;;) {
        if (c.stop()) return { result: ABORTED };
        const final = await c.page.evaluateHandle(readInputBoxesInPage, c.boxBaseline, 'submit', NUMBER_BOX_CONFIG, c.numberBoxMix);
        const waiting = await final.evaluate(r => r?.readiness === 'not-ready');
        if (!waiting || Date.now() >= deadline) return { final };
        await final.dispose();
        await new Promise(r => setTimeout(r, 50));
    }
}

// Otherwise the target comes from the number-box contract's final submit
// read, which owns the button.
async function resolveBoxTarget(c) {
    const waited = await awaitBoxSubmit(c);
    if (waited.result) return waited.result;
    const mismatch = () => refuseWith(c, { phase: 'submit-target', guard: 'final-state-mismatch' });
    const final = waited.final;
    c.handles.push(final);
    const finalOk = await final.evaluate(r => r?.descriptor?.kind === 'numberbox' && !r.readiness && !!r.target && r.descriptor.boxes.every(b => b.value === b.answer));
    if (!finalOk) return mismatch();
    const button = await final.getProperty('target');
    c.handles.push(button);
    return { element: button.asElement() };
}

// Click-time re-verification covers every surface, baseline-bound: a
// control changed between fill and click stops the Submit. The read
// that owns the button also proves it still targets this element.
async function verifyAllSurfaces(c, el) {
    if (c.withDropdowns) {
        const last = await c.page.evaluateHandle(readDropdownsInPage, c.baseline, 'submit', false, c.dropdownMix);
        let dropdownOk = false;
        try { dropdownOk = !!await last.evaluate((r, el) => r?.descriptor?.kind === 'dropdown' && r.target === el, el); } finally { await last.dispose(); }
        if (!dropdownOk) return false;
    }
    if (!await verifyBoxesSubmit(c.page, c.boxBaseline, NUMBER_BOX_CONFIG, c.numberBoxMix, 'numberbox', !c.withDropdowns, el)) return false;
    if (!c.withTextBoxes) return true;
    return verifyBoxesSubmit(c.page, c.textBoxBaseline, TEXTBOX_CONFIG, c.textBoxMix, 'textbox', false, el);
}

async function submitAndWatch(c) {
    const target = c.withDropdowns ? await resolveDropdownTarget(c) : await resolveBoxTarget(c);
    if (target.status) return target;
    const element = target.element;
    if (!element) return refuseWith(c, { phase: 'submit-target', guard: 'missing-submit' });
    await c.opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
    const outcome = await clickVerifiedSubmit(c.page, element, el => verifyAllSurfaces(c, el), c.stop);
    if (outcome === 'aborted') return ABORTED;
    if (outcome !== 'clicked') return refuseWith(c, { phase: 'submit', guard: outcome === 'changed' ? 'changed-before-submit' : 'submit-covered' });
    if (c.stop()) return ABORTED;
    const transition = await watchTransition(c, c.opts.timeout);
    if (WATCH_DONE.includes(transition.status)) return transition;
    return refuseWith(c, { phase: 'post-submit', guard: transition.status === 'unsupported' ? 'unsupported-after-submit' : 'result-not-confirmed' });
}

async function runBound(c) {
    // Bind a box baseline right after the verified fill: the click-time
    // re-read must prove the same components, definitions and accepted
    // answers still hold the typed values.
    c.boxBaseline = await c.page.evaluateHandle(readInputBoxesInPage, null, undefined, NUMBER_BOX_CONFIG, c.numberBoxMix);
    if (c.withTextBoxes) c.textBoxBaseline = await c.page.evaluateHandle(readInputBoxesInPage, null, undefined, TEXTBOX_CONFIG, c.textBoxMix);
    return c.opts.enter ? submitAndWatch(c) : watchSemi(c);
}

async function disposeAll(c) {
    for (const h of c.handles) await h.dispose().catch(() => {});
    for (const h of [c.baseline, c.boxBaseline, c.textBoxBaseline]) if (h) await h.dispose().catch(() => {});
}

async function playDropdownNumberBoxRound(page, descriptor, opts) {
    const withDropdowns = Array.isArray(descriptor?.dropdowns) && descriptor.dropdowns.length > 0;
    const withTextBoxes = Array.isArray(descriptor.textBoxes);
    const c = {
        page, descriptor, opts, withDropdowns, withTextBoxes, stop: opts.shouldStop || (() => false),
        stopped: withDropdowns
            ? 'Lesson dropdowns with number boxes stopped: changed or unsupported state; no retry.'
            : 'Lesson number boxes with text boxes stopped: changed or unsupported state; no retry.',
        diagnostic: undefined, handles: [], baseline: undefined, boxBaseline: undefined, textBoxBaseline: undefined,
        ...surfaceMixes(withDropdowns, withTextBoxes),
    };
    const refusal = descriptorRefusal(c);
    if (refusal) return refusal;
    const fillOutcome = await fillSurfaces(c);
    if (fillOutcome) return fillOutcome;
    if (c.stop()) return ABORTED;
    try {
        return await runBound(c);
    } catch {
        return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain', message: withDropdowns ? 'Lesson dropdowns with number boxes stopped: input result uncertain; no retry.' : 'Lesson number boxes with text boxes stopped: input result uncertain; no retry.' };
    } finally { await disposeAll(c); }
}

module.exports = { playDropdownNumberBoxRound };
