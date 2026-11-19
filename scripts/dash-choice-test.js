// Dash multi-choice reader (issue #230): the choice reader answers ONLY the
// confirmed Dash round shape from the 2026-11-19 live EP_DASH_INSPECT capture
// (isDash true on a dash route, one single-select MULTICHOICE component with
// Marked 1, plain word options, exactly one string-"true" correct option) and
// refuses every deviation by name. Synthetic only; drives the real in-page
// reader against minimal DOM on a dash-routed fixture URL.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { readChoiceInPage } = require('../lib/choice-state');

// The model is passed as an evaluate argument, never interpolated into
// evaluated source (CodeQL js/bad-code-sanitization).
const installStub = (model) => { window.angular = { element: () => ({ scope: () => ({ self: { model } }) }) }; };
const OPTION_TEXTS = ['alpha', 'bravo', 'charlie', 'delta'];
const dom = (texts = OPTION_TEXTS, extra = '') => '<div class="multi-choice-component v-group single-select" role="radiogroup">'
    + texts.map(t => `<div class="mcq-preview-option" role="option"><div class="mcq-contents"><span>${t}</span></div></div>`).join('')
    + '</div>' + extra;
const question = (overrides = {}, componentOverrides = {}) => ({
    contentID: 99001,
    questionIndex: 0,
    questionType: 6,
    translationMode: 4,
    validAnswers: [],
    ...overrides,
    questionDef: {
        Components: [{
            ComponentTypeCode: 'MULTICHOICE_COMPONENT',
            AllowMultiSelect: false,
            Marked: 1,
            Options: OPTION_TEXTS.map(t => ({ TextTemplate: t, Correct: t === 'bravo' ? 'true' : 'false' })),
            ...componentOverrides,
        }, ...(overrides.extraComponents || [])],
    },
});
const MODEL = (q, modelOverrides = {}) => ({ gameMode: null, isDash: true, _currentQuestion: q, ...modelOverrides });

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: 'shell' });
    try {
        const page = (await browser.pages())[0];
        // A dash-routed page: setContent then keeps this URL.
        await page.goto(origin + '/dash-task/quiz');
        const run = async (html, model, allowMix = false) => {
            await page.setContent(html);
            await page.evaluate(installStub, model);
            return page.evaluate(readChoiceInPage, null, null, allowMix);
        };
        const refuse = (descriptor, guard) => {
            assert.equal(descriptor && descriptor.kind, 'unsupported', guard + ' did not refuse');
            assert.equal(descriptor.dash, true, guard + ' refusal is not flagged dash');
            assert.equal(descriptor.diagnostic && descriptor.diagnostic.guard, guard, 'wrong refusal guard: ' + JSON.stringify(descriptor));
        };

        // The captured shape is answered.
        const accepted = await run(dom(), MODEL(question()));
        assert.equal(accepted.kind, 'choice');
        assert.equal(accepted.dash, true);
        assert.equal(accepted.multi, false);
        assert.equal(accepted.autoMarked, true);
        assert.equal(accepted.key, 'choice:99001:0');
        assert.deepEqual(accepted.correct, ['bravo']);
        assert.equal(accepted.options.length, 4);
        assert.ok(accepted.options.every(o => o.visible === true));

        // Chunk-171's QuizModel CLASSIC gameMode is also confirmed.
        const classicMode = await run(dom(), MODEL(question(), { gameMode: 1 }));
        assert.equal(classicMode.kind, 'choice');
        assert.deepEqual(classicMode.correct, ['bravo']);

        // Refusals by name.
        refuse(await run(dom(), MODEL(question(), { gameMode: 3 })), 'game-mode');
        refuse(await run(dom(), MODEL(question()), ['TEXT_BOX_COMPONENT']), 'mixed-slide');
        refuse(await run(dom(), MODEL(question({}, { AllowMultiSelect: true }))), 'multi-select');
        refuse(await run(dom(), MODEL(question({}, { Marked: 0 }))), 'marking-flag');
        refuse(await run(dom(), MODEL(question({}, { Options: OPTION_TEXTS.map(t => ({ TextTemplate: t, Correct: 'false' })) }))), 'no-correct-option');
        refuse(await run(dom(), MODEL(question({}, { Options: OPTION_TEXTS.map(t => ({ TextTemplate: t, Correct: t === 'bravo' || t === 'delta' ? 'true' : 'false' })) }))), 'multiple-correct-options');
        refuse(await run(dom(), MODEL(question({}, { Options: OPTION_TEXTS.map(t => ({ TextTemplate: '`x`', Correct: t === 'bravo' ? 'true' : 'false' })) }))), 'option-template-format');
        refuse(await run(dom(), MODEL(question({}, { Options: OPTION_TEXTS.map(t => ({ TextTemplate: '[block\n' + t + '\n]', Correct: t === 'bravo' ? 'true' : 'false' })) }))), 'option-template-format');
        refuse(await run(dom(), MODEL(question({}, { Options: OPTION_TEXTS.map(t => ({ Correct: t === 'bravo' ? 'true' : 'false' })) }))), 'option-template');
        refuse(await run(dom(), MODEL(question({}, { Options: OPTION_TEXTS.map((t, i) => ({ TextTemplate: 'same', Correct: i === 1 ? 'true' : 'false' })) }))), 'duplicate-options');
        refuse(await run(dom(), MODEL(question({ extraComponents: [{ ComponentTypeCode: 'TEXT_BOX_COMPONENT' }] }))), 'companion-components');
        refuse(await run(dom(OPTION_TEXTS, '<input class="text-box-component">'), MODEL(question())), 'foreign-editable');
        refuse(await run(dom(), MODEL(question({ contentID: 0 }))), 'identity');
        refuse(await run(dom(), MODEL({ gameMode: null, isDash: true, _currentQuestion: { contentID: 99001, questionIndex: 0, questionDef: { Components: [
            { ComponentTypeCode: 'MULTICHOICE_COMPONENT', AllowMultiSelect: false, Marked: 1, Options: [{ TextTemplate: 'a', Correct: 'true' }] },
            { ComponentTypeCode: 'MULTICHOICE_COMPONENT', AllowMultiSelect: false, Marked: 1, Options: [{ TextTemplate: 'b', Correct: 'false' }] },
        ] } } })), 'component-count');

        // The model-level assessment boundary still wins over a Dash flag.
        const assessment = await run(dom(), MODEL(question(), { gameMode: 2 }));
        assert.equal(assessment.kind, 'unsupported');
        assert.equal(assessment.assessment, true);

        // Off the dash route the same model is unconfirmed and refuses.
        await page.goto('about:blank');
        const offRoute = await run(dom(), MODEL(question()));
        assert.equal(offRoute.kind, 'unsupported');
        assert.equal(offRoute.dash, true);
        assert.match(offRoute.reason, /Dash timed sprint round detected outside a confirmed dash route/);
        assert.match(offRoute.reason, /inspect-dash/);

        // Handle re-reads confirm the Dash model instead of gameMode 3.
        await page.goto(origin + '/dash-task/quiz');
        await run(dom(), MODEL(question()));
        const handle = await page.$('div.mcq-preview-option');
        const read = await handle.evaluate(readChoiceInPage, { key: 'choice:99001:0', dash: true });
        assert.deepEqual(read, { visible: true, text: 'alpha' });
        await handle.dispose();
        // A Dash model does not confirm a Smart Lesson descriptor, and a
        // non-Dash model does not confirm a Dash descriptor.
        const handle2 = await page.$('div.mcq-preview-option');
        const lessonRead = await handle2.evaluate(readChoiceInPage, { key: 'choice:99001:0' });
        assert.deepEqual(lessonRead, { visible: false, text: '' });
        await handle2.dispose();
        await page.evaluate(installStub, { gameMode: 3, _currentQuestion: { contentID: 99001, questionIndex: 0 } });
        const handle3 = await page.$('div.mcq-preview-option');
        const nonDashRead = await handle3.evaluate(readChoiceInPage, { key: 'choice:99001:0', dash: true });
        assert.deepEqual(nonDashRead, { visible: false, text: '' });
        await handle3.dispose();

        console.log('Dash choice reader: captured shape answered (gameMode null and CLASSIC); every deviation refuses by name; handle reads bind to the Dash model PASS. Synthetic only.');
    } finally {
        await browser.close().catch(() => {});
        try { server.close(); } catch { /* already closed */ }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
