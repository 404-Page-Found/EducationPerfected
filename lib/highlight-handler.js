const { readHighlightInPage } = require('./highlight-state');
const { detectQuestion } = require('./detect-question');

const ABORTED = { status: 'aborted' };
const refuse = message => ({ status: 'stopped', message: 'Highlight stopped: ' + message });
const read = (c, handle, mode) => c.page.evaluateHandle(readHighlightInPage, handle, mode, c.mix);
const sortedNumbers = set => [...set].sort((a, b) => a - b);

const selectionIs = (c, d) => d?.kind === 'highlight' && d.autoMarked === true
    && d.key === c.descriptor.key && d.associationSignature === c.descriptor.associationSignature
    && JSON.stringify(d.selected) === JSON.stringify(sortedNumbers(c.expected));

// True when the element, not overlapping content, is at the click point.
const isUncovered = (element, point) => element.evaluate((el, p) => {
    const hit = document.elementFromPoint(p.x, p.y);
    return hit === el || el.contains(hit);
}, point);

async function clickTokenOnce(c, element) {
    await element.scrollIntoView();
    const point = await element.clickablePoint();
    if (!await isUncovered(element, point)) return refuse('token covered by overlapping content; not clicked.');
    if (c.stop()) return ABORTED;
    await c.page.mouse.click(point.x, point.y); // Once: an uncertain click must not be retried.
    return null;
}

async function clickToken(c, index) {
    if (c.stop()) return ABORTED;
    const before = await read(c, c.baseline, index);
    let target;
    try {
        if (!selectionIs(c, await before.evaluate(r => r?.descriptor))) return refuse('answer or selection changed before input.');
        target = await before.getProperty('target');
        const element = target.asElement();
        if (!element) return refuse('token detached before click.');
        const clicked = await clickTokenOnce(c, element);
        if (clicked) return clicked;
    } finally {
        if (target) await target.dispose().catch(() => {});
        await before.dispose().catch(() => {});
    }
    c.expected.add(index);
    const after = await read(c, c.baseline, undefined);
    try {
        if (!selectionIs(c, await after.evaluate(r => r?.descriptor))) return refuse('trusted click did not produce the exact expected selection; no retry.');
    } finally { await after.dispose().catch(() => {}); }
    return null;
}

// Resolves to { result } or { final } (the verification handle).
async function awaitFinal(c) {
    const deadline = Date.now() + Math.min(Math.max(c.opts.timeout || 0, 0), 3000);
    for (;;) {
        if (c.stop()) return { result: ABORTED };
        const final = await read(c, c.baseline, c.opts.enter ? 'submit' : 'verify');
        if (!await final.evaluate(r => r?.readiness === 'not-ready') || Date.now() >= deadline) return { final };
        await final.dispose();
        await new Promise(r => setTimeout(r, 50));
    }
}

async function clickSubmit(c, final, held) {
    await c.opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
    held.button = await final.getProperty('target');
    const element = held.button.asElement();
    if (!element) return refuse('Submit unavailable.');
    await element.scrollIntoView();
    const point = await element.clickablePoint();
    const last = await read(c, c.baseline, 'submit');
    try {
        const same = await last.evaluate((r, el) => {
            if (!r || r.readiness || r.target !== el) return false;
            const d = r.descriptor;
            return d?.kind === 'highlight' && d.autoMarked === true;
        }, element);
        if (!same) return refuse('selection or Submit changed before click.');
    } finally { await last.dispose().catch(() => {}); }
    if (!await isUncovered(element, point)) return refuse('Submit covered by overlapping content; not clicked.');
    if (c.stop()) return ABORTED;
    await c.page.mouse.click(point.x, point.y); // Submit exactly once; no retry or Next recovery.
    return null;
}

async function verifyAndSubmit(c, final) {
    const held = {};
    try {
        if (!selectionIs(c, await final.evaluate(r => r?.descriptor))) return refuse('final selection could not be verified.');
        c.opts.log?.('Selected exact highlight answer set.');
        // The slide orchestrator fills every surface first and owns the
        // single whole-question Submit itself.
        if (c.opts.fillOnly) return { status: 'filled' };
        return c.opts.enter ? await clickSubmit(c, final, held) : null;
    } finally {
        if (held.button) await held.button.dispose().catch(() => {});
        await final.dispose().catch(() => {});
    }
}

async function submitIfRequested(c) {
    const waited = await awaitFinal(c);
    return waited.result || verifyAndSubmit(c, waited.final);
}

// Returns a result when this poll proves an outcome, else null.
async function pollOnce(c) {
    const modal = await c.page.$('div[uib-modal-window=modal-window]');
    if (modal) { await modal.dispose(); return { status: 'modal' }; }
    const current = await detectQuestion(c.page);
    if (current?.kind === 'unsupported') return { status: 'advanced' }; // The next detection pass reports the unsupported reason.
    if (current && typeof current.key === 'string' && current.key !== c.descriptor.key) return { status: 'advanced' };
    if (current !== null) return null;
    const finished = await c.page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
        .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)));
    return finished ? { status: 'complete' } : null;
}

async function awaitAdvance(c) {
    const end = c.opts.enter ? Date.now() + c.opts.timeout : Infinity;
    while (!c.stop() && Date.now() < end) {
        const outcome = await pollOnce(c);
        if (outcome) return outcome;
        await new Promise(r => setTimeout(r, 100));
    }
    return c.stop() ? ABORTED : refuse('round did not advance; no Next or submission retry.');
}

async function checkStart(c) {
    const { descriptor } = c;
    if (descriptor.autoMarked !== true || descriptor.representation !== 'highlight-renderer') return refuse('requires an explicit auto-marked renderer association.');
    if (!Array.isArray(descriptor.selected) || descriptor.selected.length) return refuse('requires an initially empty highlight selection; stored or prefilled answers are not corrected.');
    c.baseline = await read(c, null, undefined);
    const initial = await c.baseline.evaluate(r => r?.descriptor);
    return JSON.stringify(initial) === JSON.stringify(descriptor) ? null : refuse('question changed before selection.');
}

async function runRound(c) {
    const started = await checkStart(c);
    if (started) return started;
    for (const index of c.descriptor.correct) {
        const outcome = await clickToken(c, index);
        if (outcome) return outcome;
    }
    const submitOutcome = await submitIfRequested(c);
    return submitOutcome || awaitAdvance(c);
}

// Plays one highlight round: click each correct token once, verifying the full
// cached identity and exact selected set before and after every trusted click,
// then Submit once. Every refusal path stops and reports rather than guessing
// (issue #33); an uncertain click is never retried because it may have taken
// effect. Semi-auto selects only and leaves submission to the user.
async function playHighlightRound(page, descriptor, opts) {
    // The slide orchestrator passes mixedSurfaces (the established option
    // name from the box handlers): the companion surfaces' component codes,
    // admitted by every re-read. Single-surface rounds pass nothing.
    const c = { page, descriptor, opts, stop: opts.shouldStop || (() => false), mix: opts.mixedSurfaces, baseline: undefined, expected: new Set() };
    try {
        return await runRound(c);
    } catch {
        return refuse('inspection or input failed; no retry because input may have taken effect.');
    } finally {
        if (c.baseline) await c.baseline.dispose().catch(() => {});
    }
}
module.exports = { playHighlightRound };
