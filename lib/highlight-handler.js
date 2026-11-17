const { readHighlightInPage } = require('./highlight-state');
const { detectQuestion } = require('./detect-question');

// Plays one highlight round: click each correct token once, verifying the full
// cached identity and exact selected set before and after every trusted click,
// then Submit once. Every refusal path stops and reports rather than guessing
// (issue #33); an uncertain click is never retried because it may have taken
// effect. Semi-auto selects only and leaves submission to the user.
async function playHighlightRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    // The slide orchestrator passes mixedSurfaces (the established option
    // name from the box handlers): the companion surfaces' component codes,
    // admitted by every re-read below. Single-surface rounds pass nothing.
    const mix = opts.mixedSurfaces;
    const refused = message => ({ status: 'stopped', message: 'Highlight stopped: ' + message });
    let baseline;
    try {
        if (descriptor.autoMarked !== true || descriptor.representation !== 'highlight-renderer') return refused('requires an explicit auto-marked renderer association.');
        if (!Array.isArray(descriptor.selected) || descriptor.selected.length) return refused('requires an initially empty highlight selection; stored or prefilled answers are not corrected.');
        baseline = await page.evaluateHandle(readHighlightInPage, null, undefined, mix);
        const initial = await baseline.evaluate(r => r?.descriptor);
        if (JSON.stringify(initial) !== JSON.stringify(descriptor)) return refused('question changed before selection.');
        const expected = new Set();
        const selectionIs = (d, set) => d?.kind === 'highlight' && d.autoMarked === true
            && d.key === descriptor.key && d.associationSignature === descriptor.associationSignature
            && JSON.stringify(d.selected) === JSON.stringify([...set].sort((a, b) => a - b));
        for (const index of descriptor.correct) {
            if (stop()) return { status: 'aborted' };
            const before = await page.evaluateHandle(readHighlightInPage, baseline, index, mix);
            let target;
            try {
                if (!selectionIs(await before.evaluate(r => r?.descriptor), expected)) return refused('answer or selection changed before input.');
                target = await before.getProperty('target');
                const element = target.asElement();
                if (!element) return refused('token detached before click.');
                await element.scrollIntoView();
                const point = await element.clickablePoint();
                if (!await element.evaluate((el, p) => {
                    const hit = document.elementFromPoint(p.x, p.y);
                    return hit === el || el.contains(hit);
                }, point)) return refused('token covered by overlapping content; not clicked.');
                if (stop()) return { status: 'aborted' };
                await page.mouse.click(point.x, point.y); // Once: an uncertain click must not be retried.
            } finally {
                if (target) await target.dispose().catch(() => {});
                await before.dispose().catch(() => {});
            }
            expected.add(index);
            const after = await page.evaluateHandle(readHighlightInPage, baseline, undefined, mix);
            try {
                if (!selectionIs(await after.evaluate(r => r?.descriptor), expected)) return refused('trusted click did not produce the exact expected selection; no retry.');
            } finally { await after.dispose().catch(() => {}); }
        }
        const deadline = Date.now() + Math.min(Math.max(opts.timeout || 0, 0), 3000);
        let final;
        while (true) {
            if (stop()) return { status: 'aborted' };
            final = await page.evaluateHandle(readHighlightInPage, baseline, opts.enter ? 'submit' : 'verify', mix);
            if (!await final.evaluate(r => r?.readiness === 'not-ready') || Date.now() >= deadline) break;
            await final.dispose();
            await new Promise(r => setTimeout(r, 50));
        }
        let button;
        try {
            if (!selectionIs(await final.evaluate(r => r?.descriptor), expected)) return refused('final selection could not be verified.');
            opts.log?.('Selected exact highlight answer set.');
            // The slide orchestrator fills every surface first and owns the
            // single whole-question Submit itself.
            if (opts.fillOnly) return { status: 'filled' };
            if (opts.enter) {
                button = await final.getProperty('target');
                const element = button.asElement();
                if (!element) return refused('Submit unavailable.');
                await element.scrollIntoView();
                const point = await element.clickablePoint();
                const last = await page.evaluateHandle(readHighlightInPage, baseline, 'submit', mix);
                try {
                    if (!await last.evaluate((r, el) => {
                        if (!r || r.readiness || r.target !== el) return false;
                        const d = r.descriptor;
                        return d?.kind === 'highlight' && d.autoMarked === true;
                    }, element)) return refused('selection or Submit changed before click.');
                } finally { await last.dispose().catch(() => {}); }
                if (!await element.evaluate((el, p) => {
                    const hit = document.elementFromPoint(p.x, p.y);
                    return hit === el || el.contains(hit);
                }, point)) return refused('Submit covered by overlapping content; not clicked.');
                if (stop()) return { status: 'aborted' };
                await page.mouse.click(point.x, point.y); // Submit exactly once; no retry or Next recovery.
            }
        } finally {
            if (button) await button.dispose().catch(() => {});
            await final.dispose().catch(() => {});
        }
        const end = opts.enter ? Date.now() + opts.timeout : Infinity;
        for (;;) {
            if (stop() || Date.now() >= end) break;
            const modal = await page.$('div[uib-modal-window=modal-window]');
            if (modal) { await modal.dispose(); return { status: 'modal' }; }
            const current = await detectQuestion(page);
            if (current && current.kind === 'unsupported') return { status: 'advanced' }; // The next detection pass reports the unsupported reason.
            if (current && typeof current.key === 'string' && current.key !== descriptor.key) return { status: 'advanced' };
            if (current === null) {
                const finished = await page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
                    .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)));
                if (finished) return { status: 'complete' };
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return stop() ? { status: 'aborted' } : refused('round did not advance; no Next or submission retry.');
    } catch {
        return refused('inspection or input failed; no retry because input may have taken effect.');
    } finally {
        if (baseline) await baseline.dispose().catch(() => {});
    }
}
module.exports = { playHighlightRound };
