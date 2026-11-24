const { readInfoSlideInPage } = require('./info-slide-state');
const { detectQuestion } = require('./detect-question');
const { infoSlideAdvancedInPage } = require('./info-slide-advance');

// Plays one information-slide round (issue #327): nothing to answer, so the
// only action is one trusted click on the lesson's own Continue control -
// never Submit, never typed input, never a guessed answer. EP enables
// Continue after a 3s countdown (chunk171 InformationControls), so the
// handler waits for it within the caller's timeout. Every refusal stops and
// reports; an uncertain click is never retried because it may have taken
// effect. Semi-auto shows the guidance and leaves the click to the user.
async function playInfoSlideRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    const refused = message => ({ status: 'stopped', message: 'Information slide stopped: ' + message });
    if (descriptor.kind !== 'info-slide' || descriptor.representation !== 'information-slide') {
        return refused('descriptor is not a verified information slide.');
    }
    if (!opts.enter) {
        opts.log?.('Information slide: nothing to answer. Semi mode leaves the Continue click to you.');
        return { status: 'info-shown' };
    }
    let baseline;
    try {
        // Wait out EP's disabled "Ns remaining" countdown for the enabled
        // Continue, bounded by the caller's timeout.
        const readyDeadline = Date.now() + Math.min(Math.max(opts.timeout || 0, 0), 10000);
        let state;
        for (;;) {
            if (stop()) return { status: 'aborted' };
            state = await page.evaluateHandle(readInfoSlideInPage, null, 'advance');
            const d = await state.evaluate(r => r?.descriptor);
            if (!d || d.kind !== 'info-slide') {
                const reason = d?.kind === 'unsupported' ? d.reason : null;
                await state.dispose().catch(() => {});
                return refused(reason || 'slide changed before Continue.');
            }
            if (d.key !== descriptor.key) {
                await state.dispose().catch(() => {});
                return refused('question changed before Continue.');
            }
            if (!await state.evaluate(r => r?.readiness === 'not-ready')) break;
            await state.dispose();
            state = null;
            if (Date.now() >= readyDeadline) return refused('Continue never became available; nothing was clicked.');
            await new Promise(r => setTimeout(r, 200));
        }
        baseline = state;
        let button, menuPosition;
        try {
            button = await baseline.getProperty('target');
            const element = button.asElement();
            if (!element) return refused('Continue detached before click.');
            await element.scrollIntoView();
            const point = await element.clickablePoint();
            // Our floating controls share EP's bottom-right navigation area.
            // Move only our recognized shadow menu, never EP overlays, and
            // keep it usable while the one guarded click is in progress.
            menuPosition = await element.evaluateHandle((el, p) => {
                const menu = document.getElementById('educationperfected-controls');
                if (!menu || menu.localName !== 'ep-control-menu' || !menu.shadowRoot
                    || document.elementFromPoint(p.x, p.y) !== menu) return null;
                const properties = ['left', 'top', 'right', 'bottom'];
                const saved = properties.map(name => [name, menu.style.getPropertyValue(name), menu.style.getPropertyPriority(name)]);
                menu.style.setProperty('left', p.x >= innerWidth / 2 ? '12px' : 'auto');
                menu.style.setProperty('right', p.x >= innerWidth / 2 ? 'auto' : '12px');
                menu.style.setProperty('top', p.y >= innerHeight / 2 ? '12px' : 'auto');
                menu.style.setProperty('bottom', p.y >= innerHeight / 2 ? 'auto' : '12px');
                return { menu, saved };
            }, point);
            // Re-read under the baseline: the same slide, bar and button must
            // still be the advance target at click time.
            const last = await page.evaluateHandle(readInfoSlideInPage, baseline, 'advance');
            try {
                if (!await last.evaluate((r, el) => !!r && !r.readiness && r.target === el
                    && r.descriptor?.kind === 'info-slide', element)) {
                    return refused('slide or Continue changed before click.');
                }
            } finally { await last.dispose().catch(() => {}); }
            if (!await element.evaluate((el, p) => {
                const hit = document.elementFromPoint(p.x, p.y);
                return hit === el || el.contains(hit);
            }, point)) return refused('Continue covered by overlapping content; not clicked.');
            if (stop()) return { status: 'aborted' };
            await page.mouse.click(point.x, point.y); // Continue exactly once; no retry, never Submit.
        } finally {
            if (menuPosition) {
                await menuPosition.evaluate(state => {
                    if (!state?.menu?.isConnected) return;
                    for (const [name, value, priority] of state.saved) {
                        if (value) state.menu.style.setProperty(name, value, priority);
                        else state.menu.style.removeProperty(name);
                    }
                }).catch(() => {});
                await menuPosition.dispose().catch(() => {});
            }
            if (button) await button.dispose().catch(() => {});
        }
        opts.log?.('Information slide: clicked Continue (no answer submitted).');
        // Prove the advance: the question key changes, a modal appears, or
        // the lesson exit/continue controls show (task end).
        const end = Date.now() + Math.max(opts.timeout || 0, 0);
        for (;;) {
            if (stop()) return { status: 'aborted' };
            if (Date.now() >= end) break;
            const modal = await page.$('div[uib-modal-window=modal-window]');
            if (modal) { await modal.dispose(); return { status: 'modal' }; }
            const current = await detectQuestion(page);
            // Unsupported alone cannot prove advance. The already-bound model
            // must show a new valid identity on the visible lesson before a
            // fresh pass may classify it. The next renderer stays refused if unsafe.
            if (current && current.kind === 'unsupported' && await baseline.evaluate(infoSlideAdvancedInPage)) return { status: 'advanced' };
            if (current && current.kind === 'unsupported') return refused('post-Continue state is unsupported (' + (current.reason || 'no reason reported') + '); advance not proven, no retry.');
            if (current && typeof current.key === 'string' && current.key !== descriptor.key) return { status: 'advanced' };
            if (current === null) {
                const finished = await page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
                    .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)));
                if (finished) return { status: 'complete' };
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return stop() ? { status: 'aborted' } : refused('slide did not advance after Continue; no retry.');
    } catch {
        return refused('inspection or the Continue click failed; no retry because the click may have taken effect.');
    } finally {
        if (baseline) await baseline.dispose().catch(() => {});
    }
}
module.exports = { playInfoSlideRound };
