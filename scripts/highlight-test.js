const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installHighlightFixture } = require('./highlight-fixture');
const { detectQuestion } = require('../lib/detect-question');
const { playHighlightRound } = require('../lib/highlight-handler');
// All cases share a browser page, so preserve sequential setup/input/assertion order.
const eachSequential = (values, run) => values.reduce((previous, value) => previous.then(() => run(value)), Promise.resolve());
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(); const origin = 'http://127.0.0.1:' + server.address().port;
        const setup = async (config) => { await page.goto(origin + '/lesson'); await page.evaluate(installHighlightFixture, config || {}); };
        // Happy path: detect, click the two correct tokens once each, one Submit, advance.
        await setup();
        const d = await detectQuestion(page);
        assert.equal(d.kind, 'highlight', JSON.stringify(d));
        assert.equal(d.key, 'highlight:1643503:0');
        assert.deepEqual(d.correct, [1, 2]);
        assert.equal(d.tokenCount, 5);
        assert.deepEqual(d.selected, []);
        assert.equal(d.autoMarked, true);
        const result = await playHighlightRound(page, d, { enter: true, timeout: 300 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => [highlightFixture.clicks, highlightFixture.submits]),
            [[{ index: 1, trusted: true }, { index: 2, trusted: true }], 1]);
        // Single-answer mode: exactly one correct token.
        await setup({ single: true, correct: [2] });
        const single = await detectQuestion(page);
        assert.equal(single.kind, 'highlight'); assert.equal(single.singleAnswer, true);
        assert.equal((await playHighlightRound(page, single, { enter: true, timeout: 300 })).status, 'advanced');
        assert.deepEqual(await page.evaluate(() => [highlightFixture.clicks, highlightFixture.submits]),
            [[{ index: 2, trusted: true }], 1]);
        // Semi-auto: exact set selected, no Submit, stop aborts the wait.
        await setup(); let selected = false;
        assert.equal((await playHighlightRound(page, await detectQuestion(page),
            { enter: false, timeout: 100, log: () => { selected = true; }, shouldStop: () => selected })).status, 'aborted');
        assert.deepEqual(await page.evaluate(() => [highlightFixture.questionElement.userSelectedOptions.slice().sort(), highlightFixture.submits]), [[1, 2], 0]);
        // Detection-level refusals: nothing is clicked or submitted.
        await eachSequential(['gameMode', 'assessment', 'mixed', 'secondHighlight', 'foreignEditable', 'editableInside',
            'wrongType', 'wrongId', 'visualMismatch', 'metadataIdentity', 'noCached', 'ambiguousCached', 'noQuestionElement',
            'elementMismatch', 'wrongState', 'runtimeUnmarked', 'markedInvalid', 'singleAnswerMulti', 'singleAnswerMalformed',
            'correctEmpty', 'correctString', 'correctOutOfRange', 'correctDuplicate', 'correctFloat', 'tokenIdMismatch',
            'hiddenToken', 'classMismatch', 'selectedForeign', 'selectedDuplicate', 'extraHighlightElement', 'reviewMode'], async mutation => {
            await setup(); await page.evaluate(m => {
                const f = highlightFixture;
                if (m === 'gameMode') f.self.model.gameMode = 1;
                if (m === 'assessment') f.self.model.gameMode = 2;
                if (m === 'mixed') f.q.questionDef.Components.push({ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'x' });
                if (m === 'secondHighlight') f.q.questionDef.Components.push({ ComponentTypeCode: 'HIGHLIGHT_COMPONENT', ComponentID: 'y' });
                if (m === 'foreignEditable') { const i = document.createElement('input'); document.querySelector('#ep-question-container').append(i); }
                if (m === 'editableInside') { const i = document.createElement('input'); f.element.append(i); }
                if (m === 'wrongType') f.component.type = 'multichoice';
                if (m === 'wrongId') f.component.id = 'other';
                if (m === 'visualMismatch') f.component.visualElement = document.body;
                if (m === 'metadataIdentity') f.state.metadata = JSON.parse(JSON.stringify(f.comp));
                if (m === 'noCached') f.q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: {} } } };
                if (m === 'ambiguousCached') f.q.cachedRenderers[1].identifiedComponents.baseComponents[f.comp.ComponentID].push(f.component);
                if (m === 'noQuestionElement') f.state.questionElement = null;
                if (m === 'elementMismatch') f.questionElement.element = document.body;
                if (m === 'wrongState') f.questionElement.componentState = {};
                if (m === 'runtimeUnmarked') f.component.marked = 2;
                if (m === 'markedInvalid') f.comp.Marked = 5;
                if (m === 'singleAnswerMulti') f.comp.SingleAnswerMode = true;
                if (m === 'singleAnswerMalformed') f.comp.SingleAnswerMode = 'yes';
                if (m === 'correctEmpty') f.comp.CorrectOptions = [];
                if (m === 'correctString') f.comp.CorrectOptions = ['1', '2'];
                if (m === 'correctOutOfRange') f.comp.CorrectOptions = [9];
                if (m === 'correctDuplicate') f.comp.CorrectOptions = [1, 1];
                if (m === 'correctFloat') f.comp.CorrectOptions = [1.5];
                if (m === 'tokenIdMismatch') f.tokens[0].id = 'token-other-0';
                if (m === 'hiddenToken') f.tokens[0].hidden = true;
                if (m === 'classMismatch') f.tokens[1].classList.add('highlighted');
                if (m === 'selectedForeign') f.questionElement.userSelectedOptions = [7];
                if (m === 'selectedDuplicate') f.questionElement.userSelectedOptions = [1, 1];
                if (m === 'extraHighlightElement') { const e = document.createElement('div'); e.className = 'highlight-input'; document.body.append(e); }
                if (m === 'reviewMode') f.component.renderingParameters.mode = 2;
            }, mutation);
            const desc = await detectQuestion(page);
            assert.equal(desc.kind, 'unsupported', mutation + ': ' + JSON.stringify(desc));
            if (mutation === 'assessment') assert.equal(desc.assessment, true, mutation);
            assert.deepEqual(await page.evaluate(() => [highlightFixture.clicks.length, highlightFixture.submits]), [0, 0], mutation);
        });
        // Detection passes but the handler refuses: no auto-marking proof or a
        // non-empty initial selection.
        await eachSequential(['manual', 'markingUnknown', 'preselected'], async mutation => {
            await setup(); await page.evaluate(m => {
                const f = highlightFixture;
                if (m === 'manual') f.self.sectionData.activityGroup.isAutoMarked = false;
                if (m === 'markingUnknown') delete f.self.sectionData.activityGroup.isAutoMarked;
                if (m === 'preselected') { f.questionElement.userSelectedOptions = [1]; f.tokens[1].classList.add('highlighted'); }
            }, mutation);
            const desc = await detectQuestion(page);
            assert.equal(desc.kind, 'highlight', mutation);
            if (mutation !== 'preselected') assert.notEqual(desc.autoMarked, true, mutation);
            assert.equal((await playHighlightRound(page, desc, { enter: true, timeout: 100 })).status, 'stopped', mutation);
            assert.deepEqual(await page.evaluate(() => [highlightFixture.clicks.length, highlightFixture.submits]), [0, 0], mutation);
        });
        // Mid-play mutations: an uncertain or changed state stops without retry.
        await eachSequential(['identity', 'answer', 'marking', 'ineffective', 'classTamper', 'extraSelection', 'submitReplacement', 'sameKeyNext'], async mutation => {
            await setup(); await page.evaluate(m => {
                const f = highlightFixture;
                if (m === 'ineffective') f.ignoreClicks = true;
                if (m === 'sameKeyNext') f.keepSame = true;
                f.afterClick = () => {
                    if (m === 'identity') f.q.cachedRenderers[1].identifiedComponents.baseComponents[f.comp.ComponentID] = [{ ...f.component }];
                    if (m === 'answer') f.comp.CorrectOptions = [0, 4];
                    if (m === 'marking') f.self.sectionData.activityGroup.isAutoMarked = false;
                    if (m === 'classTamper') f.tokens[1].classList.remove('highlighted');
                    if (m === 'extraSelection') { f.questionElement.userSelectedOptions.push(4); f.tokens[4].classList.add('highlighted'); }
                    if (m === 'submitReplacement') { const b = [...document.querySelectorAll('#sa-navigation-controls button')].find(x => x.textContent === 'Submit'); b?.remove(); }
                };
            }, mutation);
            const r = await playHighlightRound(page, await detectQuestion(page), { enter: true, timeout: 200 });
            assert.equal(r.status, 'stopped', mutation + ': ' + JSON.stringify(r));
            assert.equal(await page.evaluate(() => highlightFixture.submits), mutation === 'sameKeyNext' ? 1 : 0, mutation);
        });
        // Completion signals: Continue without a next question, and the exit button.
        await setup(); await page.evaluate(() => { highlightFixture.continueOnly = true; });
        assert.equal((await playHighlightRound(page, await detectQuestion(page), { enter: true, timeout: 400 })).status, 'complete');
        await setup(); await page.evaluate(() => { highlightFixture.complete = true; });
        assert.equal((await playHighlightRound(page, await detectQuestion(page), { enter: true, timeout: 400 })).status, 'complete');
        // A wrong-answer modal mid-wait surfaces as 'modal', not a silent retry.
        await setup(); await page.evaluate(() => { highlightFixture.keepSame = true; });
        const modalRun = playHighlightRound(page, await detectQuestion(page), { enter: true, timeout: 600 });
        await new Promise(r => setTimeout(r, 400));
        await page.evaluate(() => {
            const modal = document.createElement('div');
            modal.setAttribute('uib-modal-window', 'modal-window');
            document.body.append(modal);
        });
        assert.equal((await modalRun).status, 'modal');
        console.log('Highlight: trusted per-token exact selection, one Submit, single-answer, semi-auto, completion/modal signals, 32 initial refusals and 8 mid-play refusals PASS. Source-derived synthetic only.');
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
