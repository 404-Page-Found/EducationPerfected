// Read only the already-bound lesson model. A refused next renderer can still
// prove that Continue advanced, but never authorizes input on that next slide.
function infoSlideAdvancedInPage(baseline) {
    const model = baseline?.model, q = model?._currentQuestion;
    if (!model || model.gameMode !== 3 || model.isDash === true || !q) return false;
    if (!Number.isSafeInteger(q.contentID) || q.contentID <= 0
        || !Number.isSafeInteger(q.questionIndex) || q.questionIndex < 0) return false;
    const lesson = document.querySelector('#ep-question-container');
    const rendered = lesson?.querySelector('#question-container-group');
    if (!rendered || rendered.hidden || !(rendered.offsetParent !== null || rendered.getClientRects().length > 0)) return false;
    let bound = false;
    for (let node = rendered, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
        try {
            if (window.angular?.element(node)?.scope?.()?.self?.model === model) { bound = true; break; }
        } catch { /* an unreadable scope cannot establish association */ }
    }
    if (!bound) return false;
    const oldKey = baseline.descriptor?.key;
    return typeof oldKey === 'string' && oldKey !== `info-slide:${q.contentID}:${q.questionIndex}`;
}
module.exports = { infoSlideAdvancedInPage };
