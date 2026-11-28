const { readMultiChoiceInPage } = require('./multi-choice-state');

const ABORTED = { status: 'aborted' };
const refuse = message => ({ status: 'stopped', message: 'Multi-select stopped: ' + message });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = (c, handle, mode) => c.page.evaluateHandle(readMultiChoiceInPage, handle, mode, c.mix);
const isAutoChoice = d => d?.kind === 'choice' && d.autoMarked === true;

// Click one planned option. Returns a refusal/abort result or null.
async function clickOption(c, id) {
    const before = await read(c, c.baseline, id);
    let target;
    try {
        const d = await before.evaluate(r => r?.descriptor);
        if (!isAutoChoice(d) || !c.sameSelection(d)) return refuse(d?.reason || 'option association or selection changed.');
        target = await before.getProperty('target');
        const element = target.asElement();
        if (!element) return refuse('option detached before click.');
        if (c.stop()) return ABORTED;
        await element.click();
        return null;
    } finally {
        if (target) await target.dispose().catch(() => {});
        await before.dispose().catch(() => {});
    }
}

async function verifyClick(c, id) {
    const afterHandle = await read(c, c.baseline, undefined);
    const after = await afterHandle.evaluate(r => r?.descriptor);
    await afterHandle.dispose();
    if (!isAutoChoice(after)) return refuse(after?.reason || 'selection could not be verified.');
    if (c.descriptor.correct.includes(id)) c.expectedSelected.add(id);
    else c.expectedSelected.delete(id);
    const row = after.options.find(o => o.id === id);
    return !row || !c.sameSelection(after) ? refuse('trusted click did not produce the expected selected state; no retry.') : null;
}

async function selectOptions(c) {
    // Finite initial plan, never a retrying toggle loop. Preselected correct
    // options are left alone, preselected wrong options are deselected.
    const { descriptor } = c;
    const plan = descriptor.options.filter(o => o.selected !== descriptor.correct.includes(o.id)).map(o => o.id);
    c.expectedSelected = new Set(descriptor.options.filter(o => o.selected).map(o => o.id));
    c.sameSelection = d => Array.isArray(d?.options) && d.options.every(o => o.selected === c.expectedSelected.has(o.id));
    for (const id of plan) {
        if (c.stop()) return ABORTED;
        const clicked = await clickOption(c, id);
        if (clicked) return clicked;
        const verified = await verifyClick(c, id);
        if (verified) return verified;
    }
    return null;
}

// Resolves to { result } or { final } (the verification handle).
async function awaitFinal(c) {
    const deadline = Date.now() + Math.min(Math.max(c.opts.timeout || 0, 0), 3000);
    for (;;) {
        if (c.stop()) return { result: ABORTED };
        const final = await read(c, c.baseline, c.opts.enter ? 'submit' : 'verify');
        const waiting = await final.evaluate(r => r?.readiness === 'not-ready');
        if (!waiting || Date.now() >= deadline) return { final };
        await final.dispose();
        await sleep(50);
    }
}

async function clickSubmit(c, final, held) {
    await c.opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
    held.target = await final.getProperty('target');
    const element = held.target.asElement();
    if (!element) return refuse('Submit detached before click.');
    if (c.stop()) return ABORTED;
    // Re-read after handle retrieval, immediately before the trusted click.
    // Browser input and page state cannot be one atomic transaction; a
    // concurrent user/page mutation after this read remains a known limit.
    const last = await read(c, c.baseline, 'submit');
    try {
        const ready = await last.evaluate((r, button) => r?.descriptor?.kind === 'choice'
            && r.descriptor.autoMarked === true && !r.readiness && r.target === button, element);
        if (!ready) return refuse('selected set or Submit changed before click.');
    } finally { await last.dispose().catch(() => {}); }
    if (c.stop()) return ABORTED;
    await element.click(); // Once only: an exception may still mean graded.
    return null;
}

async function verifyAndSubmit(c, final) {
    const held = {};
    try {
        const d = await final.evaluate(r => r?.descriptor);
        if (!isAutoChoice(d)) return refuse(d?.reason || 'final exact selected set could not be verified.');
        c.opts.log?.('Selected exact multi-select answer set.');
        return c.opts.enter ? await clickSubmit(c, final, held) : null; // Semi-auto: caller waits; no Submit or Next.
    } finally {
        if (held.target) await held.target.dispose().catch(() => {});
        await final.dispose().catch(() => {});
    }
}

async function runSelection(c) {
    // A one-shot caller can bind inspection to its pre-input identities.
    c.baseline = await read(c, c.opts.baseline || null, undefined);
    const initial = await c.baseline.evaluate(r => r?.descriptor);
    if (JSON.stringify(initial) !== JSON.stringify(c.descriptor)) return refuse('question changed before selection.');
    const selected = await selectOptions(c);
    if (selected) return selected;
    if (c.stop()) return ABORTED;
    const waited = await awaitFinal(c);
    return waited.result || verifyAndSubmit(c, waited.final);
}

// Only trusted DOM clicks select/deselect. Every click gets a fresh complete
// object-identity/selection read; a partial result never reaches Submit.
async function playMultiChoiceSelection(page, descriptor, opts) {
    // The slide orchestrator passes mixedSurfaces (the established option
    // name from the box handlers): the companion surfaces' component codes,
    // admitted by every re-read. Single-surface rounds pass nothing.
    const c = { page, descriptor, opts, stop: opts.shouldStop || (() => false), mix: opts.mixedSurfaces, baseline: undefined };
    if (descriptor.representation !== 'multi-renderer' || descriptor.autoMarked !== true) return refuse('no verified auto-marked renderer association.');
    try {
        return await runSelection(c);
    } catch {
        return refuse('inspection or click failed; no submission retry because a click may already have taken effect.');
    } finally {
        if (c.baseline) await c.baseline.dispose().catch(() => {});
    }
}
module.exports = { playMultiChoiceSelection };
