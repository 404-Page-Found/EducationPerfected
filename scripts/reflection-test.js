const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { playReflectionRound, validReflectionText } = require('../lib/reflection-handler');
const { readReflectionInPage } = require('../lib/reflection-state');
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
        const setup = async (variant = '') => { await page.goto(origin + '/lesson-reflection' + (variant ? '?variant=' + variant : '')); };
        const counters = () => page.evaluate(() => [reflectionFixture.keys.length, reflectionFixture.inputs.length, reflectionFixture.submits, reflectionFixture.nexts]);
        const noInput = [0, 0, 0, 0];
        const text = 'My own reflection.';
        for (const enter of [true, false]) for (const variant of ['', 'unmarked']) {
            await setup(variant); const d = await detectQuestion(page);
            assert.equal(d.kind, 'reflection', JSON.stringify(d));
            assert.deepEqual(Object.keys(d).sort((a, b) => a.localeCompare(b)), ['empty', 'key', 'kind']);
            assert.equal((await playReflectionRound(page, d, { enter, requestText: async () => text })).status, 'reflection-filled');
            assert.equal(await page.evaluate(() => reflectionFixture.editor.textContent), text);
            assert.deepEqual(await counters(), [text.length, text.length, 0, 0]);
            assert.equal(await page.evaluate(() => [...reflectionFixture.keys, ...reflectionFixture.inputs].every(e => e.trusted)), true);
            // Restart refuses existing work, even with another text provider.
            assert.equal((await playReflectionRound(page, await detectQuestion(page), { requestText: async () => 'replacement' })).status, 'stopped');
            assert.deepEqual(await counters(), [text.length, text.length, 0, 0]);
        }
        for (const value of [false, undefined, '', ' ', 'bad\ntext', 'non\u00a0breaking', '<html>', 'x'.repeat(2001), '\u202esecret']) {
            await setup();
            assert.equal(validReflectionText(value), false);
            assert.equal((await playReflectionRound(page, await detectQuestion(page), { requestText: async () => value })).status, 'stopped');
            assert.deepEqual(await counters(), noInput);
        }
        await setup(); assert.equal((await playReflectionRound(page, await detectQuestion(page))).status, 'stopped');
        assert.deepEqual(await counters(), noInput);
        const mutations = [
            () => { reflectionFixture.self.model.gameMode = 2; },
            () => { reflectionFixture.self.sectionData.activityGroup.isAutoMarked = true; },
            () => { reflectionFixture.self.sectionData.activityGroup.isSelfMarked = false; },
            () => { reflectionFixture.q.questionDef.Components.push({}); },
            () => { reflectionFixture.q.questionDef.Components[0].Marked = 9; },
            () => { reflectionFixture.q.cachedRenderers = {}; },
            () => { reflectionFixture.state.metadata.ComponentID = 'wrong'; },
            () => { reflectionFixture.component.visualElement = document.body; },
            () => { reflectionFixture.component.renderingParameters.mode = 2; },
            () => { reflectionFixture.component.marked = 0; },
            () => { reflectionFixture.group.append(document.createElement('input')); },
            () => { reflectionFixture.state.answerHTML = 'saved private work'; },
            () => { const modal = document.createElement('div'); modal.setAttribute('uib-modal-window', 'modal-window'); modal.textContent = 'private modal'; document.body.append(modal); },
        ];
        for (const mutation of mutations) {
            await setup(); await page.evaluate(mutation);
            const d = await detectQuestion(page); assert.equal(d.kind, 'unsupported', JSON.stringify(d));
            assert.ok(!/private|Synthetic reflection slide/.test(JSON.stringify(d)));
            assert.deepEqual(await counters(), noInput);
            // Changes while waiting for user approval also cause zero input.
            await setup(); const original = await detectQuestion(page);
            assert.equal((await playReflectionRound(page, original, { requestText: async () => { await page.evaluate(mutation); return text; } })).status, 'stopped');
            assert.deepEqual(await counters(), noInput);
        }
        await setup(); let stopped = false;
        assert.equal((await playReflectionRound(page, await detectQuestion(page), { shouldStop: () => stopped, requestText: async () => { stopped = true; return text; } })).status, 'aborted');
        assert.deepEqual(await counters(), noInput);
        await setup(); await page.evaluate(() => { reflectionFixture.afterInput = () => { reflectionFixture.component.marked = 0; }; });
        assert.equal((await playReflectionRound(page, await detectQuestion(page), { requestText: async () => text })).status, 'stopped');
        assert.deepEqual(await counters(), [1, 1, 0, 0]);
        await setup(); await page.evaluate(() => { reflectionFixture.editor.textContent = 'existing'; });
        assert.equal((await playReflectionRound(page, await detectQuestion(page), { requestText: async () => text })).status, 'stopped');
        assert.deepEqual(await counters(), noInput);
        // Atomic verifier: a live edit with the caret at its new end must not
        // pass using the earlier empty snapshot. No subsequent key is sent.
        await setup();
        const baseline = await page.evaluateHandle(readReflectionInPage, null, undefined);
        await page.evaluate(() => {
            const el = reflectionFixture.editor;
            el.focus(); el.textContent = 'external edit';
            const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        });
        assert.equal(await page.evaluate(readReflectionInPage, baseline, { verify: true, expected: '', focus: true }), false);
        assert.deepEqual(await counters(), noInput);
        await baseline.dispose();
        await page.goto(origin + '/lesson'); assert.equal((await detectQuestion(page)).kind, 'choice');
        console.log('Reflection handler PASS: user-authored fill-only, trusted input, no Submit/Next, marked/unmarked, auto/semi, no default text, prefilled and changed-state refusals, Assessment and unrelated choice unchanged. Synthetic only.');
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
