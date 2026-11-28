// Named Dash refusal in every reader that would otherwise accept a Dash
// round's game mode (issue #230): EP's QuizModel reports the CLASSIC gameMode
// with isDash === true, so the classic-text and audio readers (which accept
// gameMode 1) and the typed and choice readers must each refuse a Dash model
// by name instead of answering or complaining about Smart Lesson mode. The
// shared lesson input-boxes reader (textbox and number-box configs) joined
// them after the second 2026-11-20 capture (#282): a Dash round mounting a
// NUMBER_BOX_COMPONENT must not hit the generic model-or-auto-mark lesson
// refusal.
// Synthetic only; drives the real in-page readers against minimal DOM.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { detectQuestionInPage } = require('../lib/detect-question');
const { readChoiceInPage } = require('../lib/choice-state');
const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('../lib/textbox-state');

const STUB = (model) => {
    window.angular = { element: () => ({ scope: () => ({ self: { model } }) }) };
};
const DASH_QUESTION = {
    contentID: 99001,
    questionIndex: 0,
    questionType: 0,
    questionDef: { Components: [{ ComponentTypeCode: 'MULTICHOICE_COMPONENT', AllowMultiSelect: false, Marked: 1,
        Options: [{ Correct: 'false' }, { Correct: 'true' }] }] },
};

(async () => {
    const browser = await puppeteer.launch({ headless: 'shell' });
    try {
        const page = (await browser.pages())[0];
        const refuseByName = (descriptor, reader) => {
            assert.equal(descriptor?.kind, 'unsupported', reader + ' did not refuse');
            assert.equal(descriptor.dash, true, reader + ' refusal is not flagged dash');
            assert.match(descriptor.reason, /Dash timed sprint round detected/, reader + ' refusal does not name Dash');
            assert.match(descriptor.reason, /inspect-dash/, reader + ' refusal does not point at the capture');
        };

        // classic text question on a Dash model
        await page.setContent('<table><tr><td id="question-text">word</td></tr></table>');
        await page.evaluate(STUB, { gameMode: 1, isDash: true, _currentQuestion: {} });
        refuseByName(await page.evaluate(detectQuestionInPage), 'classic-text');

        // audio task on a Dash model (audio accepts gameMode 1 without the guard)
        await page.setContent('<button class="voice-speaker">play</button>');
        await page.evaluate(STUB, { gameMode: 1, isDash: true, _currentQuestion: {} });
        refuseByName(await page.evaluate(detectQuestionInPage), 'audio');

        // typed lesson slide on a Dash model
        await page.setContent('<div id="ep-question-container"><input id="answer-text"></div>');
        await page.evaluate(STUB, { gameMode: 1, isDash: true, _currentQuestion: {} });
        refuseByName(await page.evaluate(detectQuestionInPage), 'typed');

        // choice slide on a Dash model
        await page.setContent('<div class="multi-choice-component" role="radiogroup">'
            + '<div class="mcq-preview-option" role="option">a</div>'
            + '<div class="mcq-preview-option" role="option">b</div></div>');
        await page.evaluate(STUB, { gameMode: 1, isDash: true, _currentQuestion: DASH_QUESTION });
        refuseByName(await page.evaluate(readChoiceInPage, null, null, false), 'choice');

        // number-box lesson inputs on a Dash model (the #282 capture's shape):
        // without the guard this reader fires its generic model-or-auto-mark
        // lesson refusal, never naming Dash
        await page.setContent('<input class="number-box-component">');
        await page.evaluate(STUB, { gameMode: null, isDash: true, _currentQuestion: {} });
        refuseByName((await page.evaluate(readInputBoxesInPage, null, 'descriptor', NUMBER_BOX_CONFIG) || {}).descriptor, 'numberbox');

        // text boxes share the reader and its Dash guard
        await page.setContent('<input class="text-box-component">');
        await page.evaluate(STUB, { gameMode: null, isDash: true, _currentQuestion: {} });
        refuseByName((await page.evaluate(readInputBoxesInPage, null, 'descriptor', TEXTBOX_CONFIG) || {}).descriptor, 'textbox');

        // A non-Dash classic model stays accepted (no isDash flag): the guard
        // must not block ordinary classic tasks.
        await page.setContent('<table><tr><td id="question-text">word</td></tr></table>');
        await page.evaluate(STUB, { gameMode: 1, _currentQuestion: {} });
        const classic = await page.evaluate(detectQuestionInPage);
        assert.equal(classic?.kind, 'text', 'classic text without isDash was refused');
        console.log('Dash refusal: classic, audio, typed, choice, number-box and textbox readers name Dash and stop; non-Dash classic unaffected PASS. Synthetic only.');
    } finally {
        await browser.close().catch(() => {});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
