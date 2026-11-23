const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installInfoSlideFixture } = require('./info-slide-fixture');
const { detectQuestion } = require('../lib/detect-question');
const { playInfoSlideRound } = require('../lib/info-slide-handler');
// All cases share a browser page, so preserve sequential setup/input/assertion order.
const eachSequential = (values, run) => values.reduce((previous, value) => previous.then(() => run(value)), Promise.resolve());
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage(); const origin = 'http://127.0.0.1:' + server.address().port;
        const setup = async (config) => { await page.goto(origin + '/lesson'); await page.evaluate(installInfoSlideFixture, config || {}); };
        // Happy path: detect the information slide, wait out the countdown,
        // one trusted Continue click, advance. Nothing is typed or submitted.
        await setup();
        let d = await detectQuestion(page);
        assert.equal(d.kind, 'info-slide', JSON.stringify(d));
        assert.equal(d.key, 'info-slide:1643503:0');
        assert.equal(d.representation, 'information-slide');
        let result = await playInfoSlideRound(page, d, { enter: true, timeout: 3000 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits, infoSlideFixture.advances]),
            [[{ trusted: true }], 0, 1]);
        // The advance produced a new slide identity for the next pass.
        d = await detectQuestion(page);
        assert.equal(d.key, 'info-slide:1643503:1');
        // The countdown is waited out, not treated as missing.
        await setup({ countdownMs: 600 });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 3000 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        // Semi-auto: guidance only, no click, no submit.
        await setup();
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: false, timeout: 3000 });
        assert.equal(result.status, 'info-shown', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits]), [[], 0]);
        // Completion: the lesson exit control appears after Continue.
        await setup();
        await page.evaluate(() => { infoSlideFixture.complete = true; });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 3000 });
        assert.equal(result.status, 'complete', JSON.stringify(result));
        // No advance within the budget: stopped, exactly one click, no retry.
        await setup();
        await page.evaluate(() => { infoSlideFixture.keepSame = true; });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 400 });
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks.length, infoSlideFixture.submits]), [1, 0]);
        // Continue never enables: nothing is clicked.
        await setup({ neverReady: true });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 300 });
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits]), [[], 0]);
        // A visible enabled Submit beside Continue: never advance past it.
        await setup({ submitAlso: true });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 300 });
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.match(result.message, /Submit/);
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits]), [[], 0]);
        // Two enabled Continue buttons: ambiguous, no click.
        await setup({ secondContinue: true });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 300 });
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.match(result.message, /ambiguous/);
        assert.deepEqual(await page.evaluate(() => infoSlideFixture.clicks), []);
        // Slide replaced mid-wait: the round stops instead of clicking the new slide's control.
        await setup({ neverReady: true });
        const playing = playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 2000 });
        await new Promise(r => setTimeout(r, 250));
        await page.evaluate(() => { infoSlideFixture.q.questionIndex = 41; });
        result = await playing;
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.deepEqual(await page.evaluate(() => infoSlideFixture.clicks), []);
        // Detection-level refusals: every deviation is unsupported, never an info-slide.
        const mutate = (name) => page.evaluate((m) => {
            const f = window.infoSlideFixture;
            if (m === 'questionType') f.q.questionType = 8;
            if (m === 'gameMode1') f.self.model.gameMode = 1;
            if (m === 'assessment') f.self.model.gameMode = 2;
            if (m === 'dash') f.self.model.isDash = true;
            if (m === 'identity') f.q.contentID = 0;
            if (m === 'component') f.q.questionDef.Components = [{ ComponentTypeCode: 'SOUND_COMPONENT', ComponentID: 'snd-1' }];
            if (m === 'unlistedComponent') f.q.questionDef.Components = [{ ComponentTypeCode: 'VIDEO_COMPONENT', ComponentID: 'vid-1' }];
            if (m === 'componentsUnreadable') f.q.questionDef.Components = null;
            if (m === 'input') { const i = document.createElement('input'); document.querySelector('#ep-question-container').append(i); }
            if (m === 'textarea') { const t = document.createElement('textarea'); document.querySelector('#ep-question-container').append(t); }
            if (m === 'select') { const s = document.createElement('select'); document.querySelector('#ep-question-container').append(s); }
            if (m === 'canvas') { const c = document.createElement('canvas'); document.querySelector('#ep-question-container').append(c); }
            if (m === 'button') { const b = document.createElement('button'); b.textContent = 'Order me'; document.querySelector('#question-container-group').append(b); }
            if (m === 'contenteditable') { const e = document.createElement('div'); e.setAttribute('contenteditable', ''); e.textContent = 'edit'; document.querySelector('#ep-question-container').append(e); }
            if (m === 'speaker') { const s = document.createElement('div'); s.className = 'voice-speaker'; document.querySelector('#ep-question-container').append(s); }
            if (m === 'noModel') { window.angular = { element: () => ({ scope: () => ({}) }) }; }
        }, name);
        await eachSequential([
            'questionType', 'gameMode1', 'assessment', 'dash', 'identity',
            'component', 'unlistedComponent', 'componentsUnreadable',
            'input', 'textarea', 'select', 'canvas', 'button', 'contenteditable',
            'speaker', 'noModel',
        ], async (name) => {
            await setup();
            await mutate(name);
            const refused = await detectQuestion(page);
            assert.equal(refused.kind, 'unsupported', `${name}: ${JSON.stringify(refused)}`);
            // questionType 8 with no controls falls through to the generic
            // fallback refusal; the rest refuse by name.
            if (name === 'questionType') assert.match(refused.reason, /unsupported question type/);
            if (name === 'assessment') assert.equal(refused.assessment, true);
            if (name === 'dash') assert.equal(refused.dash, true);
            if (name === 'component') assert.match(refused.reason, /SOUND_COMPONENT/);
            if (name === 'unlistedComponent') assert.match(refused.reason, /UNLISTED_COMPONENT/);
            if (name === 'input') assert.match(refused.reason, /answer controls/);
            if (name === 'button') assert.match(refused.reason, /answer controls/);
            if (name === 'speaker') assert.match(refused.reason, /answer surface/);
        });
        console.log('info-slide-test: ok');
    } finally {
        if (browser) await browser.close();
        server.close();
    }
})().catch(e => { console.error(e); process.exit(1); });
