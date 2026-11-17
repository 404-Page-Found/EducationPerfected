// Shared post-submit transition watch for the selection, box and mixed
// handlers: poll detection until the question key changes, a modal appears,
// or the lesson exit/continue buttons show. A caller-stop or an exhausted
// timeout is reported, never retried.
async function watchQuestionTransition(page, key, { shouldStop = () => false, timeout = Infinity, detectQuestion } = {}) {
    const deadline = Date.now() + timeout;
    while (!shouldStop() && Date.now() < deadline) {
        const current = await detectQuestion(page);
        const modal = await page.$('div[uib-modal-window=modal-window]');
        if (modal) { await modal.dispose(); return { status: 'modal' }; }
        if (current && typeof current.key === 'string' && current.key !== key) return { status: 'advanced' };
        if (current?.kind === 'unsupported') return { status: 'unsupported' };
        if (current === null && await page.evaluate(() => [...document.querySelectorAll('button.exit-button,button.continue-button')]
            .some(el => !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0)))) return { status: 'complete' };
        await new Promise(r => setTimeout(r, 100));
    }
    return shouldStop() ? { status: 'aborted' } : { status: 'timeout' };
}

module.exports = { watchQuestionTransition };
