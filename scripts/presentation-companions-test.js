// Presentation-only companions (issue #231): chunk606 proves SOUND_COMPONENT
// (SoundComponent: isInput false, constant score 1/max 1/weight 0 marking
// output) and ANNOTATED_TEXT_COMPONENT (AnnotatedTextComponent: isInput false,
// marked NOT_MARKED, 0/0/0 output) cannot take a response or change the
// weighted mark, so the gaps, highlight and working-formula readers admit
// them as companions. Answer-bearing companions still refuse. Synthetic only.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installGapsFixture } = require('./gaps-fixture');
const { installHighlightFixture } = require('./highlight-fixture');
const { detectQuestion } = require('../lib/detect-question');

const SOUND = { ComponentTypeCode: 'SOUND_COMPONENT', ComponentID: 'snd-1', Marked: 0 };
const ANNOTATED = { ComponentTypeCode: 'ANNOTATED_TEXT_COMPONENT', ComponentID: 'ann-1', Marked: 0 };
const LONG_ANSWER = { ComponentTypeCode: 'LONG_ANSWER_COMPONENT', ComponentID: 'la-1', Marked: 1 };
const SCRATCH_PAD = { ComponentTypeCode: 'SCRATCH_PAD_COMPONENT', ComponentID: 'pad-1', Marked: 0 };

(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'shell' });
        const page = await browser.newPage(); const origin = 'http://127.0.0.1:' + server.address().port;
        const push = (defs) => page.evaluate(ds => {
            const f = window.gapsFixture || window.highlightFixture || window.workingFormulaFixture;
            f.q.questionDef.Components.push(...ds.map(d => ({ ...d })));
        }, defs);

        // highlight + presentation companions: detected and answered as before
        const setupHighlight = async () => { await page.goto(origin + '/lesson'); await page.evaluate(installHighlightFixture, {}); };
        await setupHighlight(); await push([SOUND, ANNOTATED]);
        assert.equal((await detectQuestion(page)).kind, 'highlight', 'highlight with sound+annotated companions refused');
        await setupHighlight(); await push([LONG_ANSWER]);
        const hlRefused = await detectQuestion(page);
        assert.equal(hlRefused.kind, 'unsupported', 'highlight with long-answer companion did not refuse');
        assert.match(hlRefused.reason, /exactly one question component/);

        // gaps + presentation companions (gaps admitted annotated text already;
        // sound joins it from the same source proof)
        const setupGaps = async () => { await page.goto(origin + '/lesson'); await page.evaluate(installGapsFixture); };
        await setupGaps(); await push([SOUND]);
        assert.equal((await detectQuestion(page)).kind, 'gaps', 'gaps with sound companion refused');
        await setupGaps(); await push([LONG_ANSWER]);
        const gapsRefused = await detectQuestion(page);
        assert.equal(gapsRefused.kind, 'unsupported', 'gaps with long-answer companion did not refuse');
        assert.match(gapsRefused.reason, /unsupported accompanying component: LONG_ANSWER_COMPONENT/);

        // working-formula + presentation companions
        const setupFormula = () => page.goto(origin + '/lesson-working-formula');
        await setupFormula(); await push([SOUND, ANNOTATED]);
        assert.equal((await detectQuestion(page)).kind, 'workingformula', 'working-formula with sound+annotated companions refused');
        await setupFormula(); await push([LONG_ANSWER]);
        const wfRefused = await detectQuestion(page);
        assert.equal(wfRefused.kind, 'unsupported', 'working-formula with long-answer companion did not refuse');

        // textbox + presentation companions: the count contracts account for
        // companions (their registered components keep base keys equal)
        const setupTextbox = () => page.goto(origin + '/lesson-textbox');
        const addTextboxCompanion = (def, component) => page.evaluate(({ d, c }) => {
            const f = window.textboxFixture;
            f.q.questionDef.Components.push({ ...d });
            if (c) f.base[d.ComponentID] = [c];
        }, { d: def, c: component });
        await setupTextbox();
        await addTextboxCompanion(SOUND, { type: 'sound', isInput: false, id: 'snd-1' });
        await addTextboxCompanion(ANNOTATED, { type: 'annotated-text', isInput: false, id: 'ann-1' });
        assert.equal((await detectQuestion(page)).kind, 'textbox', 'textbox with sound+annotated companions refused');
        await setupTextbox();
        await addTextboxCompanion(LONG_ANSWER, { type: 'long-answer', isInput: true, id: 'la-1' });
        assert.equal((await detectQuestion(page)).kind, 'unsupported', 'textbox with long-answer companion did not refuse');

        // scratch pad: admitted only when the cached runtime component proves
        // the pad is unmarked; a marked, unknown-type or unverifiable pad stays
        // answer-bearing and refuses (chunk606: unmarked pads emit a constant
        // NOT_MARKED 0/0/0 marking payload, marked pads are scored)
        const withPad = (component) => page.evaluate(c => {
            const f = window.highlightFixture;
            f.q.questionDef.Components.push({ ComponentTypeCode: 'SCRATCH_PAD_COMPONENT', ComponentID: 'pad-1', Marked: 0 });
            if (c) f.q.cachedRenderers[1].identifiedComponents.baseComponents['pad-1'] = [c];
        }, component);
        await setupHighlight(); await withPad(null);
        assert.equal((await detectQuestion(page)).kind, 'unsupported', 'unverifiable scratch pad did not refuse');
        await setupHighlight(); await withPad({ type: 'scratch-pad', marked: 1, id: 'pad-1' });
        assert.equal((await detectQuestion(page)).kind, 'unsupported', 'marked scratch pad did not refuse');
        await setupHighlight(); await withPad({ type: 'sound', marked: 2, id: 'pad-1' });
        assert.equal((await detectQuestion(page)).kind, 'unsupported', 'wrong-type cached pad did not refuse');
        await setupHighlight(); await withPad({ type: 'scratch-pad', marked: 2, id: 'pad-1' });
        assert.equal((await detectQuestion(page)).kind, 'highlight', 'unmarked scratch pad companion refused');
        await setupGaps(); await push([SCRATCH_PAD]);
        const gapsPad = await detectQuestion(page);
        assert.equal(gapsPad.kind, 'unsupported', 'gaps with unverifiable scratch pad did not refuse');
        assert.match(gapsPad.reason, /unsupported accompanying component: SCRATCH_PAD_COMPONENT/);

        console.log('Presentation companions: sound/annotated-text admitted by gaps, highlight, working-formula and textbox readers; unmarked scratch pad admitted only on runtime proof; answer-bearing companions still refuse PASS. Synthetic only.');
    } finally {
        await browser?.close().catch(() => {});
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
