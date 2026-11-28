const { readInfoSlideInPage } = require('./info-slide-state');
const { detectQuestion } = require('./detect-question');
const { infoSlideAdvancedInPage } = require('./info-slide-advance');

const ABORTED = { status: 'aborted' };
const refuse = message => ({ status: 'stopped', message: 'Information slide stopped: ' + message });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Our floating controls share EP's bottom-right navigation area.
// Move only our recognized shadow menu, never EP overlays, and
// keep it usable while the one guarded click is in progress.
function nudgeMenu(element, point) {
    return element.evaluateHandle((el, p) => {
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
}

async function restoreMenu(menuPosition) {
    if (!menuPosition) return;
    await menuPosition.evaluate(state => {
        if (!state?.menu?.isConnected) return;
        for (const [name, value, priority] of state.saved) {
            if (value) state.menu.style.setProperty(name, value, priority);
            else state.menu.style.removeProperty(name);
        }
    }).catch(() => {});
    await menuPosition.dispose().catch(() => {});
}

// Checks one read of the slide; returns a refusal or null when it is the
// expected slide.
async function slideRefusal(state, descriptor) {
    const d = await state.evaluate(r => r?.descriptor);
    if (!d || d.kind !== 'info-slide') {
        return refuse((d?.kind === 'unsupported' ? d.reason : null) || 'slide changed before Continue.');
    }
    return d.key === descriptor.key ? null : refuse('question changed before Continue.');
}

// Wait out EP's disabled "Ns remaining" countdown for the enabled
// Continue, bounded by the caller's timeout. Resolves to { result } or { state }.
async function waitReady(c) {
    const readyDeadline = Date.now() + Math.min(Math.max(c.opts.timeout || 0, 0), 10000);
    for (;;) {
        if (c.stop()) return { result: ABORTED };
        const state = await c.page.evaluateHandle(readInfoSlideInPage, null, 'advance');
        const refusal = await slideRefusal(state, c.descriptor);
        if (refusal) {
            await state.dispose().catch(() => {});
            return { result: refusal };
        }
        if (!await state.evaluate(r => r?.readiness === 'not-ready')) return { state };
        await state.dispose();
        if (Date.now() >= readyDeadline) return { result: refuse('Continue never became available; nothing was clicked.') };
        await sleep(200);
    }
}

// Guarded final checks, then exactly one click. Returns a result or null.
async function guardedClick(c, baseline, element, point) {
    // Re-read under the baseline: the same slide, bar and button must
    // still be the advance target at click time.
    const last = await c.page.evaluateHandle(readInfoSlideInPage, baseline, 'advance');
    try {
        if (!await last.evaluate((r, el) => !!r && !r.readiness && r.target === el
            && r.descriptor?.kind === 'info-slide', element)) {
            return refuse('slide or Continue changed before click.');
        }
    } finally { await last.dispose().catch(() => {}); }
    const uncovered = await element.evaluate((el, p) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return hit === el || el.contains(hit);
    }, point);
    if (!uncovered) return refuse('Continue covered by overlapping content; not clicked.');
    if (c.stop()) return ABORTED;
    await c.page.mouse.click(point.x, point.y); // Continue exactly once; no retry, never Submit.
    return null;
}

async function clickContinue(c, baseline) {
    let button, menuPosition;
    try {
        button = await baseline.getProperty('target');
        const element = button.asElement();
        if (!element) return refuse('Continue detached before click.');
        await element.scrollIntoView();
        const point = await element.clickablePoint();
        menuPosition = await nudgeMenu(element, point);
        return await guardedClick(c, baseline, element, point);
    } finally {
        await restoreMenu(menuPosition);
        if (button) await button.dispose().catch(() => {});
    }
}

// Unsupported alone cannot prove advance. The already-bound model
// must show a new valid identity on the visible lesson before a
// fresh pass may classify it. The next renderer stays refused if unsafe.
async function classifyUnsupported(baseline, current) {
    if (await baseline.evaluate(infoSlideAdvancedInPage)) return { status: 'advanced' };
    return refuse('post-Continue state is unsupported (' + (current.reason || 'no reason reported') + '); advance not proven, no retry.');
}

// Returns a result when this poll proves an outcome, else null.
async function pollOnce(c, baseline) {
    const modal = await c.page.$('div[uib-modal-window=modal-window]');
    if (modal) { await modal.dispose(); return { status: 'modal' }; }
    const current = await detectQuestion(c.page);
    if (current?.kind === 'unsupported') return classifyUnsupported(baseline, current);
    if (current && typeof current.key === 'string' && current.key !== c.descriptor.key) return { status: 'advanced' };
    if (current !== null) return null;
    const finished = await c.page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
        .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)));
    return finished ? { status: 'complete' } : null;
}

// Prove the advance: the question key changes, a modal appears, or
// the lesson exit/continue controls show (task end).
async function awaitAdvance(c, baseline) {
    const end = Date.now() + Math.max(c.opts.timeout || 0, 0);
    for (;;) {
        if (c.stop()) return ABORTED;
        if (Date.now() >= end) break;
        const outcome = await pollOnce(c, baseline);
        if (outcome) return outcome;
        await sleep(100);
    }
    return c.stop() ? ABORTED : refuse('slide did not advance after Continue; no retry.');
}

// Plays one information-slide round (issue #327): nothing to answer, so the
// only action is one trusted click on the lesson's own Continue control -
// never Submit, never typed input, never a guessed answer. EP enables
// Continue after a 3s countdown (chunk171 InformationControls), so the
// handler waits for it within the caller's timeout. Every refusal stops and
// reports; an uncertain click is never retried because it may have taken
// effect. Semi-auto shows the guidance and leaves the click to the user.
async function playInfoSlideRound(page, descriptor, opts) {
    const c = { page, descriptor, opts, stop: opts.shouldStop || (() => false) };
    if (descriptor.kind !== 'info-slide' || descriptor.representation !== 'information-slide') {
        return refuse('descriptor is not a verified information slide.');
    }
    if (!opts.enter) {
        opts.log?.('Information slide: nothing to answer. Semi mode leaves the Continue click to you.');
        return { status: 'info-shown' };
    }
    let baseline;
    try {
        const ready = await waitReady(c);
        if (ready.result) return ready.result;
        baseline = ready.state;
        const clicked = await clickContinue(c, baseline);
        if (clicked) return clicked;
        opts.log?.('Information slide: clicked Continue (no answer submitted).');
        return await awaitAdvance(c, baseline);
    } catch {
        return refuse('inspection or the Continue click failed; no retry because the click may have taken effect.');
    } finally {
        if (baseline) await baseline.dispose().catch(() => {});
    }
}
module.exports = { playInfoSlideRound };
