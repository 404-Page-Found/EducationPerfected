const { readWorkingFormulaInPage } = require('./working-formula-state');
const { clickVerifiedSubmit } = require('./submit-click');
const { watchQuestionTransition } = require('./transition-watch');

// Plays one working-formula round (issue #113): type each shipped correct
// working step into the maths editor one row at a time, verifying the full
// cached identity and the editor's own step read around every trusted input,
// then Submit once. Every refusal path stops and reports rather than
// guessing; an uncertain click is never retried because it may have taken
// effect. Semi-auto fills only and leaves submission to the user.
async function playWorkingFormulaRound(page, descriptor, opts) {
    const stop = opts.shouldStop || (() => false);
    let refusalDiagnostic;
    const refused = (message, guard) => ({ status: 'stopped', message: 'Working formula stopped: ' + message, diagnostic: refusalDiagnostic || (guard ? { phase: 'fill', guard } : undefined) });
    let baseline;
    try {
        if (descriptor.kind !== 'workingformula' || descriptor.representation !== 'working-formula-editor'
            || descriptor.autoMarked !== true || !Array.isArray(descriptor.steps) || !descriptor.steps.length) return refused('requires an explicit auto-marked editor association with shipped correct steps.', 'descriptor-mismatch');
        baseline = await page.evaluateHandle(readWorkingFormulaInPage, null, undefined);
        const initial = await baseline.evaluate(r => r?.descriptor);
        if (JSON.stringify(initial) !== JSON.stringify(descriptor)) return refused('question changed before input.', 'identity-mismatch');
        // The entered steps are the non-blank row values in order; they
        // must equal the intended prefix exactly before every next input.
        const prefixIs = async (handle, count) => {
            const values = await handle.evaluate(r => r?.rowValues || []);
            const nonBlank = values.filter(v => v !== '');
            return nonBlank.length === count && nonBlank.every((v, i) => v === descriptor.steps[i]);
        };
        for (let i = 0; i < descriptor.steps.length; i++) {
            if (stop()) return { status: 'aborted' };
            // Identity and the entered prefix must hold before every input.
            {
                const before = await page.evaluateHandle(readWorkingFormulaInPage, baseline, undefined);
                try {
                    if (!await before.evaluate((r, key, sig) => r?.descriptor?.kind === 'workingformula'
                        && r.descriptor.key === key && r.descriptor.associationSignature === sig
                        && r.descriptor.autoMarked === true, descriptor.key, descriptor.associationSignature)) return refused('question changed before input.', 'identity-mismatch');
                    if (!await prefixIs(before, i)) return refused('entered working no longer matches the intended steps; no retry.', 'prefix-mismatch');
                } finally { await before.dispose().catch(() => {}); }
            }
            // Row i exists already (EP mounts one blank row, and each add
            // leaves the focus in the new row) or comes from one trusted
            // click on the editor's own add-row button.
            const rowCount = await baseline.evaluate(r => r.input.rows.length);
            if (rowCount <= i) {
                const buttonHandle = await baseline.evaluateHandle(r => r.addButton);
                const element = buttonHandle.asElement();
                if (!element) { await buttonHandle.dispose().catch(() => {}); return refused('add-row button detached before click.', 'add-row-uncertain'); }
                await element.scrollIntoView();
                const point = await element.clickablePoint();
                if (!await element.evaluate((el, p) => {
                    const hit = document.elementFromPoint(p.x, p.y);
                    return hit === el || el.contains(hit);
                }, point)) { await buttonHandle.dispose().catch(() => {}); return refused('add-row button covered by overlapping content; not clicked.', 'add-row-uncertain'); }
                if (stop()) { await buttonHandle.dispose().catch(() => {}); return { status: 'aborted' }; }
                await page.mouse.click(point.x, point.y); // Once: an uncertain click must not be retried.
                await buttonHandle.dispose().catch(() => {});
                const added = await page.evaluateHandle(readWorkingFormulaInPage, baseline, undefined);
                try {
                    if (!await added.evaluate((r, count) => r?.input?.rows?.length > count, rowCount)) return refused('the trusted add-row click did not add a row; no retry.', 'add-row-uncertain');
                } finally { await added.dispose().catch(() => {}); }
            }
            // Type the step into row i's editor field and blur it closed.
            const field = await baseline.evaluateHandle((r, i) => {
                const row = r.input.rows[i];
                const item = row?.outerElement;
                const field = item?.querySelector('.row-content [contenteditable], .row-content textarea, .row-content input[type=text]');
                return field && (field.isContentEditable || field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') ? field : null;
            }, i);
            const fieldElement = field.asElement();
            if (!fieldElement) { await field.dispose().catch(() => {}); return refused('row editor field not found; no typed guess.', 'field-missing'); }
            if (stop()) { await field.dispose().catch(() => {}); return { status: 'aborted' }; }
            await fieldElement.click();
            // The click must land the focus in this row's editor; typing into
            // whatever else stayed active would answer into the void.
            if (!await fieldElement.evaluate(el => el === document.activeElement || el.contains(document.activeElement))) { await field.dispose().catch(() => {}); return refused('editor field did not take focus; no typed guess.', 'field-focus-uncertain'); }
            await page.keyboard.type(descriptor.steps[i]);
            // Blur finalises the row in EP (preFinalise/finalise on row blur);
            // clicking the editor background is not an answer control.
            await page.evaluate(() => { const bg = document.querySelector('div.formula-input .formula-list-background') || document.body; bg.dispatchEvent(new MouseEvent('click', { bubbles: true })); document.activeElement?.blur?.(); });
            await field.dispose().catch(() => {});
            const after = await page.evaluateHandle(readWorkingFormulaInPage, baseline, undefined);
            try {
                if (!await prefixIs(after, i + 1)) return refused('typed step did not land as the exact intended formula; no retry.', 'row-value-mismatch');
            } finally { await after.dispose().catch(() => {}); }
        }
        opts.log?.('Entered exact working steps.');
        // The verified fill proved the editor's own step read equals the
        // shipped correct steps; fill-only stops before Submit.
        if (opts.fillOnly) return { status: 'filled' };
        if (opts.enter) {
            // Wait out EP's asynchronous Submit enablement (bounded, like the
            // other rounds) before judging the read.
            const deadline = Date.now() + Math.min(Math.max(opts.timeout || 0, 0), 3000);
            let final;
            while (true) {
                if (stop()) return { status: 'aborted' };
                final = await page.evaluateHandle(readWorkingFormulaInPage, baseline, 'submit');
                if (!await final.evaluate(r => r?.readiness === 'not-ready') || Date.now() >= deadline) break;
                await final.dispose();
                final = null;
                await new Promise(r => setTimeout(r, 50));
            }
            if (!final) { refusalDiagnostic = { phase: 'submit-target', guard: 'final-state-mismatch' }; return refused('Submit state could not be verified.'); }
            let element;
            try {
                if (!await final.evaluate(r => r?.descriptor?.kind === 'workingformula' && !r.readiness && !!r.target)) { refusalDiagnostic = { phase: 'submit-target', guard: 'final-state-mismatch' }; return refused('Submit state could not be verified.'); }
                const button = await final.getProperty('target');
                element = button.asElement();
                if (!element) { await button.dispose().catch(() => {}); refusalDiagnostic = { phase: 'submit-target', guard: 'missing-submit' }; return refused('Submit unavailable.'); }
                await opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
                const outcome = await clickVerifiedSubmit(page, element, async el => {
                    const last = await page.evaluateHandle(readWorkingFormulaInPage, baseline, 'submit');
                    try { return !!await last.evaluate((r, el) => !r?.readiness && r?.target === el, el); } finally { await last.dispose().catch(() => {}); }
                }, stop);
                if (outcome === 'aborted') return { status: 'aborted' };
                if (outcome !== 'clicked') { refusalDiagnostic = { phase: 'submit', guard: outcome === 'changed' ? 'changed-before-submit' : 'submit-covered' }; return refused('Submit state changed before the click.'); }
            } finally {
                await final.dispose().catch(() => {});
            }
            if (stop()) return { status: 'aborted' };
        } else {
            // Semi mode: the verified fill stays for the user to review and
            // submit manually. Wait without a deadline for the question to
            // advance; our own filled slide reads as a working-formula
            // refusal (entered rows), which is not an advance.
            for (;;) {
                if (stop()) return { status: 'aborted' };
                const modal = await page.$('div[uib-modal-window=modal-window]');
                if (modal) { await modal.dispose(); return { status: 'modal' }; }
                const current = await require('./detect-question').detectQuestion(page);
                if (current && current.kind === 'unsupported' && !String(current.reason || '').startsWith('Working formula:')) return { status: 'advanced' };
                if (current && typeof current.key === 'string' && current.key !== descriptor.key) return { status: 'advanced' };
                if (current === null) {
                    const finished = await page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
                        .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)));
                    if (finished) return { status: 'complete' };
                }
                await new Promise(r => setTimeout(r, 100));
            }
        }
        const transition = await watchQuestionTransition(page, descriptor.key, { shouldStop: stop, timeout: opts.timeout, detectQuestion: require('./detect-question').detectQuestion });
        if (['advanced', 'modal', 'complete', 'aborted'].includes(transition.status)) return transition;
        refusalDiagnostic = { phase: 'post-submit', guard: transition.status === 'unsupported' ? 'unsupported-after-submit' : 'result-not-confirmed' };
        return refused('round did not advance after Submit; no retry.');
    } catch {
        return refused('inspection or input failed; no retry because input may have taken effect.', 'inspection-or-dispatch-uncertain');
    } finally {
        if (baseline) await baseline.dispose().catch(() => {});
    }
}
module.exports = { playWorkingFormulaRound };
