// Shared click-time re-verification for the mixed-slide handlers (the
// dropdown+number-box handler and the slide orchestrator): a baseline-bound
// input-box submit read must prove the same components, definitions and
// accepted answers still hold the typed values, and when this surface owns
// the Submit, that the read still targets the exact button being clicked.
const { readInputBoxesInPage } = require('./textbox-state');

async function verifyBoxesSubmit(page, baselineHandle, config, mix, kind, ownsTarget, el) {
    const last = await page.evaluateHandle(readInputBoxesInPage, baselineHandle, 'submit', config, mix);
    try {
        return !!await last.evaluate((r, el, kind, ownsTarget) => r?.descriptor?.kind === kind && (!ownsTarget || r.target === el) && r.descriptor.boxes.every(b => b.value === b.answer), el, kind, ownsTarget);
    } finally { await last.dispose(); }
}

module.exports = { verifyBoxesSubmit };
