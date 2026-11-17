// User-authored Reflection only. Never invent an answer, copy model feedback,
// select a self-grade, retry, or continue to the next question.
const { readReflectionInPage } = require('./reflection-state');
const STOPPED = 'Reflection stopped: changed or unsupported state; no retry.';
function validReflectionText(text) {
    return typeof text === 'string' && text.length <= 2000 && text.trim().length > 0
        && !/[\u0000-\u001f\u007f-\u009f\u00a0\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/u.test(text);
}
async function playReflectionRound(page, descriptor, opts = {}) {
    const stop = opts.shouldStop || (() => false);
    const refused = () => ({ status: 'stopped', message: STOPPED });
    if (stop()) return { status: 'aborted' };
    if (descriptor?.kind !== 'reflection' || descriptor.empty !== true || typeof opts.requestText !== 'function') return refused();
    let baseline, editor;
    try {
        baseline = await page.evaluateHandle(readReflectionInPage, null, undefined);
        if (!await baseline.evaluate((r, d) => JSON.stringify(r?.descriptor) === JSON.stringify(d), descriptor)) return refused();
        // The CLI collects the user's exact text and a separate typed yes before
        // input. Waiting for text never detaches the original question baseline.
        const text = await opts.requestText({ key: descriptor.key });
        if (stop()) return { status: 'aborted' };
        if (!validReflectionText(text)) return refused();
        let expected = '';
        // Baseline, live text and caret are checked in one synchronous page
        // read, not a snapshot followed by a later caret evaluation.
        const check = async (focus = false) => await page.evaluate(readReflectionInPage, baseline, { verify: true, expected, focus }) === true;
        if (!await check()) return refused();
        editor = await baseline.getProperty('editor');
        await editor.asElement().focus();
        for (const char of text) {
            if (stop()) return { status: 'aborted' };
            if (!await check(true)) return refused();
            if (stop()) return { status: 'aborted' };
            await editor.asElement().type(char);
            expected += char;
            if (!await check(true)) return refused();
        }
        if (stop()) return { status: 'aborted' };
        return { status: 'reflection-filled' };
    } catch { return { status: 'stopped', message: 'Reflection stopped: input outcome uncertain; no retry.' }; }
    finally { for (const h of [editor, baseline]) if (h) await h.dispose().catch(() => {}); }
}
module.exports = { validReflectionText, playReflectionRound };
