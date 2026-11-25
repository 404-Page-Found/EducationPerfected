const { readGapsInPage } = require('./gaps-state');
// Own one attempt across inspection, filling and one trusted Submit click.
// Never calls an answer loop, Next, marking internals or a second input after Submit.
function createSubmitGapsOnce({ fillGapsOnce }) {
    let attempted = false;
    return async function submitGapsOnce(page, { shouldStop = () => false } = {}) {
        if (attempted) return { status: 'refused', reason: 'attempt-consumed' };
        attempted = true;
        let baseline, final, button;
        try {
            if (shouldStop()) return { status: 'aborted' };
            baseline = await page.evaluateHandle(readGapsInPage);
            const initial = await baseline.evaluate(r => r?.descriptor);
            if (initial?.kind !== 'gaps' || initial.autoMarked !== true || !initial.gaps?.length
                || initial.gaps.some(g => g.filled)) return { status: 'refused', reason: 'unsafe-or-changed-state' };
            if (shouldStop()) return { status: 'aborted' };
            const filled = await fillGapsOnce(page, { shouldStop, expectedDescriptor: initial });
            if (filled.status === 'aborted') return { status: 'aborted', reason: 'fill-cancelled-input-may-be-partial' };
            if (filled.status !== 'filled-only') return { status: 'stopped', reason: 'fill-not-verified' };
            if (shouldStop()) return { status: 'aborted' };
            const waited = await waitForSubmitReady(page, baseline, shouldStop);
            if (waited.aborted) return { status: 'aborted' };
            final = waited.final;
            const verified = await verifySubmitTarget(page, baseline, final);
            if (verified.reason) return { status: 'refused', reason: verified.reason };
            button = verified.button;
            if (shouldStop()) return { status: 'aborted' };
            await page.mouse.click(verified.point.x, verified.point.y); // At most once. EP may automatically advance; do nothing there.
            return { status: 'submitted-once' }; // Dispatch only, not a marking/acceptance claim.
        } catch {
            return { status: 'stopped', reason: 'inspection-or-dispatch-uncertain' }; // Never print page exceptions. No retry.
        } finally {
            for (const handle of [button, final, baseline]) if (handle) await handle.dispose().catch(() => {});
        }
    };
}
// Waits out EP's not-ready window (bounded), keeping the last live handle.
async function waitForSubmitReady(page, baseline, shouldStop) {
    const deadline = Date.now() + 1000;
    while (true) {
        if (shouldStop()) return { aborted: true };
        const final = await page.evaluateHandle(readGapsInPage, baseline, 'submit');
        if (!await final.evaluate(r => r?.readiness === 'not-ready') || Date.now() >= deadline) return { final };
        await final.dispose();
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

// Re-reads the state around the Submit target and proves the clickable point
// is the button itself. Returns {reason} on any mismatch, else {button, point}.
async function verifySubmitTarget(page, baseline, final) {
    if (!await final.evaluate(r => r?.descriptor?.kind === 'gaps' && r.descriptor.autoMarked === true
        && r.descriptor.gaps.every(g => g.filled) && !r.readiness && !!r.target)) return { reason: 'unsafe-or-changed-state' };
    const button = await final.getProperty('target');
    const element = button.asElement();
    if (!element) return { reason: 'unsafe-or-changed-state' };
    await element.scrollIntoView();
    const point = await element.clickablePoint();
    const last = await page.evaluateHandle(readGapsInPage, baseline, 'submit');
    try {
        if (!await last.evaluate((r, el) => r?.descriptor?.kind === 'gaps' && r.descriptor.autoMarked === true
            && r.descriptor.gaps.every(g => g.filled) && !r.readiness && r.target === el, element)) return { reason: 'unsafe-or-changed-state' };
    } finally { await last.dispose(); }
    if (!await element.evaluate((el, p) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return hit === el || el.contains(hit);
    }, point)) return { reason: 'submit-covered' };
    return { button, point };
}
module.exports = { createSubmitGapsOnce };
