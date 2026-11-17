// One guarded trusted click on a proven Submit button, shared by the
// selection, box and mixed handlers. `stillTarget` re-reads state under the
// caller's own contract and must resolve true only when the same button is
// still the submission target. Returns 'changed' when that re-read fails,
// 'covered' when another element sits at the click point, 'aborted' when the
// caller stopped, or 'clicked' after exactly one trusted click. Never retries.
async function clickVerifiedSubmit(page, element, stillTarget, shouldStop = () => false) {
    await element.scrollIntoView();
    const point = await element.clickablePoint();
    if (!await stillTarget(element)) return 'changed';
    if (!await element.evaluate((el, p) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return hit === el || el.contains(hit);
    }, point)) return 'covered';
    if (shouldStop()) return 'aborted';
    await page.mouse.click(point.x, point.y); // One Submit, never Next or retry.
    return 'clicked';
}

module.exports = { clickVerifiedSubmit };
