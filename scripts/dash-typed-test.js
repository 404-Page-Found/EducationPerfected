// Dash typed reader (issue #273): the dash-typed reader answers ONLY the
// confirmed typed Dash round shape from the 2026-11-20 live EP_DASH_INSPECT
// capture (filed as #272: isDash true on a dash route, no sectionData,
// gameMode null/CLASSIC, questionType 0, translationMode 0, explicit
// non-EP/non-speaking flags, one usable validAnswers entry, no components,
// #question-text + input#answer-text with one Submit button, no speaker, no
// choice groups, no other editable controls) and refuses every deviation by
// name. Synthetic only; drives the real in-page reader against minimal DOM on
// a dash-routed fixture URL.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { readDashTypedInPage } = require('../lib/dash-typed-state');

// The model is passed as an evaluate argument, never interpolated into
// evaluated source (CodeQL js/bad-code-sanitization).
const installStub = (self) => { window.angular = { element: () => ({ scope: () => ({ self }) }) }; };
const dom = (extra = '') => '<table><tr><td id="question-text">one</td>'
    + '<td><input id="answer-text" autocomplete="off"></td></tr></table>'
    + '<button class="submit-button nice-button positive-green">Submit</button>'
    + '<button class="exit-button" hidden>Exit</button>' + extra;
const question = (overrides = {}) => ({
    contentID: 99101,
    questionIndex: 0,
    questionType: 0,
    translationMode: 0,
    isEPQuestion: false,
    isSpeakingMode: false,
    validAnswers: [{ outputString: 'eins' }],
    ...overrides,
});
const MODEL = (q, modelOverrides = {}) => ({ gameMode: null, isDash: true, _currentQuestion: q, ...modelOverrides });

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'shell' });
        const page = (await browser.pages())[0];
        // A dash-routed page: setContent then keeps this URL.
        await page.goto(origin + '/dash-task/typed');
        const run = async (html, model, allowMix = false) => {
            await page.setContent(html);
            await page.evaluate(installStub, model?.model ? model : { model });
            return page.evaluate(readDashTypedInPage, null, null, allowMix);
        };
        const refuse = (descriptor, guard) => {
            assert.equal(descriptor?.kind, 'unsupported', guard + ' did not refuse');
            assert.equal(descriptor.dash, true, guard + ' refusal is not flagged dash');
            assert.equal(descriptor.diagnostic?.guard, guard, 'wrong refusal guard: ' + JSON.stringify(descriptor));
            assert.equal(descriptor.diagnostic?.renderer, 'dash-typed', 'wrong refusal renderer: ' + JSON.stringify(descriptor));
        };

        // The captured shape is answered.
        const accepted = await run(dom(), MODEL(question()));
        assert.equal(accepted.kind, 'dash-typed');
        assert.equal(accepted.dash, true);
        assert.equal(accepted.autoMarked, true);
        assert.equal(accepted.key, 'dash-typed:99101:0');
        assert.deepEqual(accepted.answers, ['eins']);
        assert.equal(accepted.text, 'one');

        // Chunk-171's QuizModel CLASSIC gameMode is also confirmed.
        const classicMode = await run(dom(), MODEL(question(), { gameMode: 1 }));
        assert.equal(classicMode.kind, 'dash-typed');
        assert.deepEqual(classicMode.answers, ['eins']);

        // Refusals by name.
        refuse(await run(dom(), MODEL(question(), { gameMode: 3 })), 'game-mode');
        refuse(await run(dom(), MODEL(question(), { gameMode: undefined })), 'game-mode');
        refuse(await run(dom(), { model: MODEL(question()), sectionData: { activityGroup: { isAutoMarked: true } } }), 'section-data');
        refuse(await run(dom(), MODEL(question()), ['TEXT_BOX_COMPONENT']), 'mixed-slide');
        refuse(await run(dom(), MODEL(question({ contentID: 0 }))), 'identity');
        refuse(await run(dom(), MODEL(question({ questionType: 6 }))), 'question-type');
        refuse(await run(dom(), MODEL(question({ translationMode: 4 }))), 'translation-mode');
        refuse(await run(dom(), MODEL(question({ isEPQuestion: true }))), 'question-flags');
        refuse(await run(dom(), MODEL(question({ isSpeakingMode: true }))), 'question-flags');
        refuse(await run(dom(), MODEL(question({ validAnswers: [] }))), 'answers-missing');
        refuse(await run(dom(), MODEL(question({ validAnswers: undefined }))), 'answers-missing');
        refuse(await run(dom(), MODEL(question({ validAnswers: [{ outputString: '' }] }))), 'answers-unusable');
        refuse(await run(dom(), MODEL(question({ validAnswers: [{ outputString: 'eins' }, { outputString: 'zwei' }] }))), 'answers-count');
        refuse(await run(dom(), MODEL(question({ questionDef: { Components: [{ ComponentTypeCode: 'TEXT_BOX_COMPONENT' }] } }))), 'component-count');
        refuse(await run(dom('<button class="voice-speaker">play</button>'), MODEL(question())), 'speaker');
        refuse(await run(dom('<div class="multi-choice-component" role="radiogroup"><div class="mcq-preview-option">a</div></div>'), MODEL(question())), 'choice-present');
        refuse(await run(dom().replace('<button class="submit-button', '<button hidden class="submit-button'), MODEL(question())), 'submit-control');
        refuse(await run(dom() + '<button class="submit-button">Again</button>', MODEL(question())), 'submit-control');
        refuse(await run(dom().replace('<button class="exit-button" hidden>Exit</button>', ''), MODEL(question())), 'exit-control');
        refuse(await run(dom('<input class="text-box-component">'), MODEL(question())), 'foreign-editable');

        // Not a typed candidate: no question/answer markup (e.g. the choice
        // Dash shape) falls through to other readers, never refuses here.
        await page.setContent('<div class="multi-choice-component" role="radiogroup"></div>');
        await page.evaluate(installStub, { model: MODEL(question()) });
        assert.equal(await page.evaluate(readDashTypedInPage, null, null, false), null, 'choice-shaped DOM must fall through');

        // Not a Dash round: a classic model falls through to the classic reader.
        const classic = await run(dom(), { gameMode: 1, _currentQuestion: question() });
        assert.equal(classic, null, 'non-Dash typed shape must fall through');

        // The model-level assessment boundary still wins over a Dash flag.
        // Typed-Dash also proves the refusal carries the assessment marker
        // (not merely kind unsupported).
        const assessed = await run(dom(), MODEL(question(), { gameMode: 2 }));
        assert.equal(assessed.kind, 'unsupported');
        assert.equal(assessed.assessment, true);
        assert.match(assessed.reason || '', /Assessment/);

        // Off the dash route the same model is unconfirmed and refuses.
        // The typed round names the capture command so the operator can
        // ground the shape read-only.
        await page.goto('about:blank');
        const away = await run(dom(), MODEL(question()));
        assert.equal(away.kind, 'unsupported');
        assert.equal(away.dash, true);
        assert.match(away.reason, /Dash timed sprint round detected outside a confirmed dash route/);
        assert.match(away.reason, /inspect-dash/);

        // A "dash" substring inside another word (/learning/dashboard) is
        // not a dash route: the match is segment-bound.
        await page.goto(origin + '/learning/dashboard');
        const board = await run(dom(), MODEL(question()));
        assert.equal(board.kind, 'unsupported');
        assert.equal(board.dash, true);
        assert.match(board.reason, /outside a confirmed dash route/);

        console.log('Dash typed reader: captured shape answered (gameMode null and CLASSIC); every deviation refuses by name; non-candidates fall through PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { server.close(); } catch { /* already closed */ }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
