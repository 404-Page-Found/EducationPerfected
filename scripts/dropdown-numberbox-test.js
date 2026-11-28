const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playDropdownNumberBoxRound } = require('../lib/dropdown-numberbox-handler');
const baseDiag = { kind: 'dropdown-numberbox-refusal', domSelectCount: 4, domBoxCount: 6 };
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        const setup = async (variant = '') => {
            await page.goto(origin + '/lesson-dropdown-number-box' + (variant ? '?variant=' + variant : ''));
            await page.evaluate(() => { const b = document.querySelector('#sa-navigation-controls button'), clone = b.cloneNode(true); clone.textContent = 'Next Question'; b.parentElement.append(clone); clone.click(); clone.remove(); });
            assert.equal(await page.evaluate(() => dropdownNumberBoxFixture.nexts), 1);
            await page.evaluate(() => { dropdownNumberBoxFixture.nexts = 0; });
        };
        await setup();
        let d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        assert.equal(d.dropdowns.length, 4); assert.equal(d.boxes.length, 6);
        assert.deepEqual(d.dropdowns.map(x => x.answer), ['Tenth', 'Hundredth', 'Tenth', 'Unit']);
        assert.deepEqual(d.boxes.map(x => x.answer), ['30', '94.20', '7', '3.5', '12', '0.25']);
        const result = await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 300 });
        assert.equal(result.status, 'advanced');
        assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedSelections), [['Tenth', 'Tenth'], ['Hundredth', 'Hundredth'], ['Tenth', 'Tenth'], ['Unit', 'Unit']]);
        assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedBoxValues), [['30', '30'], ['94.20', '94.20'], ['7', '7'], ['3.5', '3.5'], ['12', '12'], ['0.25', '0.25']]);
        const expectedKeys = Array.from({ length: 4 }, (_, i) => ['Home', 'ArrowDown', 'ArrowDown'].map(key => ({ id: 'dropdown-' + i, key, trusted: true }))).flat();
        assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.keys), expectedKeys);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.changes.length, dropdownNumberBoxFixture.changes.every(e => e.trusted), dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.inputs.every(e => e.trusted), dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts, dropdownNumberBoxFixture.q.questionIndex]), [8, true, 17, true, 1, 0, 1]);
        // Fill-only: every answer filled, never submitted.
        await setup(); d = await detectQuestion(page); let filled = 0;
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: false, timeout: 0, log: () => { filled++; }, shouldStop: () => filled >= 2 })).status, 'aborted');
        assert.deepEqual(await page.evaluate(() => [...dropdownNumberBoxFixture.group.querySelectorAll('select')].map(el => el.options[el.selectedIndex].textContent)), ['Tenth', 'Hundredth', 'Tenth', 'Unit']);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('input.number-box-component')].map(el => el.value)), ['30', '94.20', '7', '3.5', '12', '0.25']);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts, dropdownNumberBoxFixture.q.questionIndex]), [0, 0, 0]);
        // Authored-unmarked slide (Page's live shape: all ten Marked 0) completes.
        await setup('unmarked'); d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 300 })).status, 'advanced');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [1, 0]);
        // Single-surface slides still pass through to the single-surface readers.
        await setup();
        await page.evaluate(() => { [...dropdownNumberBoxFixture.group.querySelectorAll('select')].forEach(el => el.remove()); });
        let pass = await detectQuestion(page);
        assert.equal(pass.kind, 'unsupported'); assert.equal(pass.diagnostic.kind, 'numberbox-refusal'); assert.equal(pass.diagnostic.guard, 'component-count');
        await setup();
        await page.evaluate(() => { [...dropdownNumberBoxFixture.group.querySelectorAll('input.number-box-component')].forEach(el => el.parentElement.remove()); });
        pass = await detectQuestion(page);
        assert.equal(pass.kind, 'unsupported'); assert.equal(pass.diagnostic.kind, 'dropdown-refusal'); assert.equal(pass.diagnostic.guard, 'definitions-select-count');
        // Refusals: exact guard, content-free diagnostic, no input, no Submit.
        const simpleGuards = {
            manual: 'not-explicit-auto-marked',
            extraDef: 'definitions-select-count',
            mixedMarking: 'mixed-definition-marking',
            duplicate: 'shuffled-description-duplicate',
            twoCorrect: 'correct-option',
            noneCorrect: 'correct-option',
            unmarked: 'component-marked',
            foreign: 'visual-element',
            disabled: 'select-control-or-model',
            boxDisabled: 'box-shape',
            boxNonNumeric: 'numeric-metadata',
            boxStoredMismatch: 'stored-value',
            boxEmptyOptions: 'state-shape',
            boxUnmarked: 'state-shape',
            badRounding: 'numeric-metadata',
            tamperedInjector: 'state-shape',
            extraNumberBox: 'component-count',
            unassociated: 'component-association',
        };
        for (const mutation of Object.keys(simpleGuards)) {
            await setup();
            await page.evaluate(m => {
                const f = dropdownNumberBoxFixture, dc = f.base['dropdown-0'][0], ds = dc.componentState, bc = f.base['box-0'][0], bs = bc.componentState;
                const mutations = {
                    manual: () => { f.self.sectionData.activityGroup.isAutoMarked = false; },
                    extraDef: () => { f.q.questionDef.Components.push({ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'invented-text', Marked: 1 }); },
                    // Each surface uniform but the union mixed: dropdowns Marked 1,
                    // every number box authored Marked 0 (definition and metadata,
                    // like the unmarked variant) - only the orchestrator refuses.
                    mixedMarking: () => { f.q.questionDef.Components.filter(d => d.ComponentTypeCode === 'NUMBER_BOX_COMPONENT').forEach(d => { d.Marked = 0; f.base[d.ComponentID][0].componentState.metadataInstance.Marked = 0; }); },
                    duplicate: () => { ds._shuffledOptions[1].Description = ds._shuffledOptions[2].Description; },
                    twoCorrect: () => { ds.originalDropDownOptions[0].Correct = 'true'; },
                    noneCorrect: () => { ds._shuffledOptions[2].Correct = 'false'; },
                    unmarked: () => { dc.marked = 0; },
                    foreign: () => { dc.visualElement = document.body; },
                    disabled: () => { dc.dropDownList.disabled = true; },
                    boxDisabled: () => { bc.textBox.disabled = true; },
                    boxNonNumeric: () => { const def = f.q.questionDef.Components.find(d => d.ComponentID === 'box-0'); def.Options = ['abc']; bs.metadataInstance.Options = ['abc']; bs.optionsInjector = [{ parts: [{ text: 'abc' }] }]; bs.answerOptions = ['abc']; },
                    boxStoredMismatch: () => { bs.userAnswer = 'x'; },
                    boxEmptyOptions: () => { bs.answerOptions = []; },
                    boxUnmarked: () => { bc.marked = 0; },
                    badRounding: () => { bs.metadataInstance.RoundingTypeCode = 'BOGUS'; f.q.questionDef.Components.find(d => d.ComponentID === 'box-0').RoundingTypeCode = 'BOGUS'; },
                    tamperedInjector: () => { bs.optionsInjector[0].parts[0].text = 'tampered'; },
                    extraNumberBox: () => { const input = document.createElement('input'); input.className = 'number-box-component'; const span = document.createElement('span'); span.append(input); f.group.append(span); },
                    unassociated: () => { f.base['box-0'] = [{ ...bc, textBox: document.createElement('input') }]; },
                };
                mutations[m]();
            }, mutation);
            const bad = await detectQuestion(page);
            assert.equal(bad.kind, 'unsupported', mutation);
            assert.equal(bad.diagnostic.kind, 'dropdown-numberbox-refusal', mutation);
            assert.equal(bad.diagnostic.guard, simpleGuards[mutation], mutation);
            assert.equal(bad.diagnostic.domSelectCount, 4, mutation);
            assert.equal(bad.diagnostic.domBoxCount, mutation === 'extraNumberBox' ? 7 : 6, mutation);
            assert.equal((await playDropdownNumberBoxRound(page, bad, { enter: true, timeout: 50 })).status, 'stopped', mutation);
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0, 0, 0], mutation);
        }
        // Extra editable control: content-free mixed-editable-inputs diagnostic.
        await setup();
        await page.evaluate(() => { dropdownNumberBoxFixture.group.append(document.createElement('input')); });
        {
            const bad = await detectQuestion(page);
            assert.equal(bad.kind, 'unsupported');
            assert.deepEqual(bad.diagnostic, {
                ...baseDiag,
                guard: 'mixed-editable-inputs',
                extraCount: 1,
                extras: [{ tag: 'input', type: 'text' }],
                definitions: { total: 10, byType: { dropdown: 4, numberBox: 6 }, marked: 10, unmarked: 0, invalidMarked: 0 },
            });
            assert.equal((await playDropdownNumberBoxRound(page, bad, { enter: true, timeout: 50 })).status, 'stopped');
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        }
        // Assessment shell: refused with no diagnostic, like every other surface.
        await setup();
        await page.evaluate(() => { dropdownNumberBoxFixture.self.model.gameMode = 2; });
        {
            const bad = await detectQuestion(page);
            assert.equal(bad.kind, 'unsupported'); assert.equal(bad.assessment, true); assert.equal(bad.diagnostic, undefined);
            assert.equal((await playDropdownNumberBoxRound(page, bad, { enter: true, timeout: 50 })).status, 'stopped');
        }
        // A prefilled number box is never overwritten: detection succeeds but the round stops before any input.
        await setup();
        await page.evaluate(() => { const c = dropdownNumberBoxFixture.base['box-0'][0]; c.textBox.value = '3'; c.componentState.userAnswer = '3'; c.componentState.isUserAnswerSet = true; });
        d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        assert.equal(d.boxes[0].value, '3');
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 50 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        // Mid-run tamper stops before Submit: dropdown answer swap after the first change.
        await setup(); d = await detectQuestion(page);
        await page.evaluate(() => {
            const f = dropdownNumberBoxFixture, c = f.base['dropdown-0'][0];
            f.afterChange = () => { c.componentState._shuffledOptions[2].Correct = 'false'; };
        });
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 50 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0]);
        // Semi mode (enter:false): fills, then watches while the user submits.
        await setup(); d = await detectQuestion(page);
        {
            // Submit only once the handler has bound its baselines and is
            // watching: a click during the fill or baseline reads is a
            // legitimate stop, not the case under test.
            let watching; const isWatching = new Promise(r => { watching = r; });
            const round = playDropdownNumberBoxRound(page, d, { enter: false, timeout: 300, onWatching: watching });
            await Promise.race([isWatching, round.then(r => { throw new Error('round ended before watching: ' + JSON.stringify(r)); })]);
            assert.equal(await page.evaluate(() => dropdownNumberBoxFixture.changes.length === 8 && dropdownNumberBoxFixture.inputs.length === 17), true);
            await page.evaluate(() => { [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit').click(); });
            assert.equal((await round).status, 'advanced');
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [1, 0]);
        }
        // Mid-run tamper during box typing: a changed accepted answer stops before Submit.
        await setup(); d = await detectQuestion(page);
        await page.evaluate(() => {
            const f = dropdownNumberBoxFixture, c = f.base['box-0'][0];
            f.afterInput = () => { if (f.inputs.length === 1) c.componentState.answerOptions = ['31']; };
        });
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 50 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0]);
        // Shared assertions for the surface-mix completion cases below.
        const sixSubmittedBoxes = [['30', '30'], ['94.20', '94.20'], ['7', '7'], ['3.5', '3.5'], ['12', '12'], ['0.25', '0.25']];
        const sevenSubmittedBoxes = [...sixSubmittedBoxes, ['88', '88']];
        const submittedBoxValues = () => page.evaluate(() => dropdownNumberBoxFixture.submittedBoxValues);
        const submittedOnceNoNext = async () => assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [1, 0]);
        const unmarkedCompletes = async variant => {
            await setup(variant); d = await detectQuestion(page);
            assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
            assert.equal(d.marked, false);
            assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 300 })).status, 'advanced');
            await submittedOnceNoNext();
        };
        // Three surfaces (Page's live shape): dropdowns + number boxes + one
        // text box answer together under one Submit.
        await setup('textbox');
        d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        assert.equal(d.dropdowns.length, 4); assert.equal(d.boxes.length, 6); assert.equal(d.textBoxCount, 1);
        assert.deepEqual(d.textBoxes.map(x => x.answer), ['circumference']);
        {
            const result = await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 300 });
            assert.equal(result.status, 'advanced', JSON.stringify(result));
            assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedSelections), [['Tenth', 'Tenth'], ['Hundredth', 'Hundredth'], ['Tenth', 'Tenth'], ['Unit', 'Unit']]);
            assert.deepEqual(await submittedBoxValues(), sixSubmittedBoxes);
            assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedTextBoxValues), [['circumference', 'circumference']]);
            await submittedOnceNoNext();
        }
        // Three surfaces, every definition authored unmarked: completes.
        await unmarkedCompletes('textbox-unmarked');
        // Three surfaces: a prefilled text box stops the round with no input.
        await setup('textbox');
        await page.evaluate(() => { const c = dropdownNumberBoxFixture.base['text-0'][0]; c.textBox.value = 'x'; c.componentState.userAnswer = 'x'; c.componentState.isUserAnswerSet = true; });
        d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 50 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        // Three surfaces: marking mixed only on the text-box surface refuses
        // at detection with the orchestrator's uniform-marking guard.
        await setup('textbox');
        await page.evaluate(() => {
            const f = dropdownNumberBoxFixture;
            f.q.questionDef.Components.filter(d => d.ComponentTypeCode !== 'TEXT_BOX_COMPONENT').forEach(d => { d.Marked = 0; f.base[d.ComponentID][0].componentState.metadataInstance.Marked = 0; });
        });
        {
            const bad = await detectQuestion(page);
            assert.equal(bad.kind, 'unsupported');
            assert.equal(bad.diagnostic.kind, 'dropdown-numberbox-refusal');
            assert.equal(bad.diagnostic.guard, 'mixed-definition-marking');
            assert.equal(bad.diagnostic.domTextBoxCount, 1);
            assert.equal((await playDropdownNumberBoxRound(page, bad, { enter: true, timeout: 50 })).status, 'stopped');
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        }
        // Three surfaces: a text-box contract failure passes through retagged.
        await setup('textbox');
        await page.evaluate(() => { dropdownNumberBoxFixture.base['text-0'][0].componentState.metadataInstance.Options = ['other']; });
        {
            const bad = await detectQuestion(page);
            assert.equal(bad.kind, 'unsupported');
            assert.equal(bad.diagnostic.kind, 'dropdown-numberbox-refusal');
            assert.equal(bad.diagnostic.domTextBoxCount, 1);
            assert.equal((await playDropdownNumberBoxRound(page, bad, { enter: true, timeout: 50 })).status, 'stopped');
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        }
        // Three surfaces: a text-box accepted-answer swap mid-run stops before Submit.
        await setup('textbox'); d = await detectQuestion(page);
        await page.evaluate(() => {
            const f = dropdownNumberBoxFixture, c = f.base['text-0'][0];
            f.afterInput = () => { c.componentState.answerOptions = ['other']; };
        });
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 50 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0]);
        // Number boxes + one text box, no dropdowns (Page's live refusal
        // shape): fills and submits once, no dropdown round.
        await setup('boxes-textbox');
        d = await detectQuestion(page);
        assert.equal(d.kind, 'dropdown-numberbox', JSON.stringify(d));
        assert.equal(d.dropdownCount, 0); assert.equal(d.boxes.length, 7); assert.equal(d.textBoxCount, 1);
        {
            const result = await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 300 });
            assert.equal(result.status, 'advanced', JSON.stringify(result));
            assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedSelections), []);
            assert.deepEqual(await submittedBoxValues(), sevenSubmittedBoxes);
            assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedTextBoxValues), [['circumference', 'circumference']]);
            await submittedOnceNoNext();
        }
        // Number boxes + text box, every definition authored unmarked: completes.
        await unmarkedCompletes('boxes-textbox-unmarked');
        // Number boxes + text box with a stray select: routed to dropdown
        // verification, which refuses the unverified select; no input.
        await setup('boxes-textbox');
        await page.evaluate(() => { dropdownNumberBoxFixture.group.append(document.createElement('select')); });
        {
            const bad = await detectQuestion(page);
            assert.equal(bad.kind, 'unsupported');
            assert.equal(bad.diagnostic.kind, 'dropdown-numberbox-refusal');
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits]), [0, 0, 0]);
        }
        // Number boxes + text box: a text-box accepted-answer swap mid-run
        // stops before Submit.
        await setup('boxes-textbox'); d = await detectQuestion(page);
        await page.evaluate(() => {
            const f = dropdownNumberBoxFixture, c = f.base['text-0'][0];
            f.afterInput = () => { c.componentState.answerOptions = ['other']; };
        });
        assert.equal((await playDropdownNumberBoxRound(page, d, { enter: true, timeout: 50 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0]);
        console.log('Dropdown+number-box mixed-slide fixtures PASS: four dropdowns and six number boxes filled (12 trusted keys / 8 trusted changes / 17 trusted characters), one Submit with no typed approval; fill-only without Submit; authored-unmarked slide completes; single-surface slides pass through; 19 refusals plus assessment and prefill stops with no input; mid-run tampers stop before Submit; semi mode fills then watches the user Submit; three-surface slides (dropdowns + number boxes + text box) detect, fill and submit once, marked and unmarked, with prefill, mixed-marking, contract-failure and mid-run tamper stops; number-box + text-box slides without dropdowns detect, fill and submit once, marked and unmarked, with stray-select and mid-run tamper stops. Synthetic Linux only.');
    } finally { if (browser) await browser.close();
    await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
