const { readGapsInPage } = require('./gaps-state');
const { detectQuestion } = require('./detect-question');

const ABORTED = { status: 'aborted' };
const prefix = (d, n) => d?.kind === 'gaps' && d.autoMarked === true && d.gaps.every((g, i) => g.filled === (i < n));
const refuse = message => ({ status: 'stopped', message: 'Drag-and-drop gaps stopped: ' + message });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = (c, handle, mode) => c.page.evaluateHandle(readGapsInPage, handle, mode, c.mix);

// Focus the option, re-read, and press Enter once. Returns a refusal/abort
// result, or null when the key was pressed.
async function focusAndPress(c, element, i) {
    // A trusted key event follows EP's own accessible interaction path.
    // focus() can trigger page listeners, so re-read after focusing too.
    await element.focus();
    const ready = await read(c, c.baseline, i);
    try {
        const same = await ready.evaluate((r, el, n) => r?.descriptor?.kind === 'gaps' && r.descriptor.autoMarked === true
            && r.target === el && document.activeElement === el && r.descriptor.gaps.every((g, j) => g.filled === (j < n)), element, i);
        if (!same) return refuse('focused option or gap changed.');
    } finally { await ready.dispose(); }
    if (c.stop()) return ABORTED;
    await element.press('Enter'); // Once: an uncertain key must not be retried.
    return null;
}

async function selectBeforeInput(c, i) {
    const before = await read(c, c.baseline, i);
    let target;
    try {
        if (!prefix(await before.evaluate(r => r?.descriptor), i)) return refuse('answer or selection changed before input.');
        target = await before.getProperty('target');
        const element = target.asElement();
        if (!element) return refuse('option detached.');
        return await focusAndPress(c, element, i);
    } finally {
        if (target) await target.dispose().catch(() => {});
        await before.dispose().catch(() => {});
    }
}

async function fillGap(c, i) {
    if (c.stop()) return ABORTED;
    const early = await selectBeforeInput(c, i);
    if (early) return early;
    const after = await read(c, c.baseline, undefined);
    try {
        if (!prefix(await after.evaluate(r => r?.descriptor), i + 1)) return refuse('trusted key did not produce the exact expected answer prefix; no retry.');
    } finally { await after.dispose(); }
    return null;
}

async function checkInitial(c) {
    const { descriptor } = c;
    if (descriptor.autoMarked !== true || descriptor.representation !== 'gaps-renderer' || descriptor.gaps.some(g => g.filled)) return refuse('requires explicit auto-marking and initially empty gaps.');
    c.baseline = await read(c, null, undefined);
    const initial = await c.baseline.evaluate(r => r?.descriptor);
    return JSON.stringify(initial) === JSON.stringify(descriptor) ? null : refuse('question changed before selection.');
}

// Resolves to { result } to stop, or { final } with the verification handle.
async function awaitFinal(c) {
    const deadline = Date.now() + Math.min(Math.max(c.opts.timeout || 0, 0), 3000);
    for (;;) {
        if (c.stop()) return { result: ABORTED };
        const final = await read(c, c.baseline, c.opts.enter ? 'submit' : 'verify');
        if (!await final.evaluate(r => r?.readiness === 'not-ready') || Date.now() >= deadline) return { final };
        await final.dispose();
        await sleep(50);
    }
}

async function clickSubmit(c, final, held) {
    await c.opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
    held.button = await final.getProperty('target');
    const element = held.button.asElement();
    if (!element) return refuse('Submit unavailable.');
    const last = await read(c, c.baseline, 'submit');
    try {
        const same = await last.evaluate((r, el) => r?.descriptor?.kind === 'gaps' && r.descriptor.autoMarked === true
            && !r.readiness && r.target === el, element);
        if (!same) return refuse('answers or Submit changed before click.');
    } finally { await last.dispose(); }
    if (c.stop()) return ABORTED;
    await element.click(); // Submit exactly once; no retry or Next recovery.
    return null;
}

async function verifyAndSubmit(c, final) {
    const held = {};
    try {
        if (!prefix(await final.evaluate(r => r?.descriptor), c.descriptor.gaps.length)) return refuse('final answers could not be verified.');
        c.opts.log?.('Filled exact drag-and-drop gap answers.');
        // The slide orchestrator fills every surface first and owns the
        // single whole-question Submit itself.
        if (c.opts.fillOnly) return { status: 'filled' };
        return c.opts.enter ? await clickSubmit(c, final, held) : null;
    } finally {
        if (held.button) await held.button.dispose().catch(() => {});
        await final.dispose().catch(() => {});
    }
}

async function pollAdvance(c) {
    const end = c.opts.enter ? Date.now() + c.opts.timeout : Infinity;
    while (!c.stop() && Date.now() < end) {
        const modal = await c.page.$('div[uib-modal-window=modal-window]');
        if (modal) { await modal.dispose(); return { status: 'modal' }; }
        const complete = await c.page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
            .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)));
        const current = await detectQuestion(c.page);
        if (complete && current === null) return { status: 'complete' };
        if (current && typeof current.key === 'string' && current.key !== c.descriptor.key) return { status: 'advanced' };
        await sleep(100);
    }
    return c.stop() ? ABORTED : refuse('round did not advance; no Next or submission retry.');
}

async function runRound(c) {
    const initial = await checkInitial(c);
    if (initial) return initial;
    for (let i = 0; i < c.descriptor.gaps.length; i++) {
        const stopped = await fillGap(c, i);
        if (stopped) return stopped;
    }
    const waited = await awaitFinal(c);
    if (waited.result) return waited.result;
    const submitted = await verifyAndSubmit(c, waited.final);
    return submitted || await pollAdvance(c);
}

async function playGapsRound(page, descriptor, opts) {
    // The slide orchestrator passes mixedSurfaces (the established option
    // name from the box handlers): the companion surfaces' component codes,
    // admitted by every re-read. Single-surface rounds pass nothing.
    const c = { page, descriptor, opts, stop: opts.shouldStop || (() => false), mix: opts.mixedSurfaces, baseline: undefined };
    try {
        return await runRound(c);
    } catch {
        return refuse('inspection or input failed; no retry because input may have taken effect.');
    } finally {
        if (c.baseline) await c.baseline.dispose().catch(() => {});
    }
}
module.exports = { playGapsRound };
