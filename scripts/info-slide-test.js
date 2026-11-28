const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installInfoSlideFixture } = require('./info-slide-fixture');
const { installControlMenu } = require('../lib/browser-controls');
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
        // The real injected menu can cover EP's bottom-right Continue.
        // Reproduce with the actual shadow menu, both collapsed and expanded.
        await eachSequential([false, true], async expanded => {
            await setup();
            await page.evaluate(installControlMenu);
            await page.evaluate(expanded => {
                const button = document.querySelector('#sa-navigation-controls button');
                button.style.cssText = 'position:fixed;bottom:20px;right:30px;width:160px;height:32px';
                const menu = document.getElementById('educationperfected-controls');
                menu.style.top = 'auto'; menu.style.bottom = '12px';
                menu.shadowRoot.querySelector('details').open = expanded;
                window.savedMenuStyle = ['left', 'top', 'right', 'bottom'].map(name => menu.style.getPropertyValue(name));
            }, expanded);
            await page.waitForFunction(() => !document.querySelector('#sa-navigation-controls button').disabled);
            assert.equal(await page.evaluate(() => {
                const rect = document.querySelector('#sa-navigation-controls button').getBoundingClientRect();
                return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id;
            }), 'educationperfected-controls');
            result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 3000 });
            assert.equal(result.status, 'advanced', JSON.stringify(result));
            assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits]), [[{ trusted: true }], 0]);
            assert.equal(await page.evaluate(() => JSON.stringify(['left', 'top', 'right', 'bottom'].map(name => document.getElementById('educationperfected-controls').style.getPropertyValue(name))) === JSON.stringify(savedMenuStyle)), true);
        });
        // A foreign overlay still refuses, including one under our menu.
        await eachSequential([false, true], async withMenu => {
            await setup();
            if (withMenu) await page.evaluate(installControlMenu);
            await page.evaluate(withMenu => {
                const button = document.querySelector('#sa-navigation-controls button');
                button.style.cssText = 'position:fixed;bottom:20px;right:30px;width:160px;height:32px';
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;bottom:0;right:0;width:240px;height:70px;z-index:2147483645';
                document.body.append(overlay);
                if (withMenu) window.savedMenuStyle = ['left', 'top', 'right', 'bottom'].map(name => document.getElementById('educationperfected-controls').style.getPropertyValue(name));
            }, withMenu);
            result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 3000 });
            assert.equal(result.status, 'stopped', JSON.stringify(result));
            assert.match(result.message, /covered by overlapping content/);
            assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits]), [[], 0]);
            if (withMenu) assert.equal(await page.evaluate(() => JSON.stringify(['left', 'top', 'right', 'bottom'].map(name => document.getElementById('educationperfected-controls').style.getPropertyValue(name))) === JSON.stringify(savedMenuStyle)), true);
        });
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
        // Slide replaced mid-wait with an enabled Continue on the
        // replacement: the identity guard stops the round instead of
        // clicking the new slide's control.
        await setup({ countdownMs: 400 });
        const playing = playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 2000 });
        await new Promise(r => setTimeout(r, 250));
        await page.evaluate(() => { infoSlideFixture.q.questionIndex = 41; });
        result = await playing;
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.match(result.message, /question changed/);
        assert.deepEqual(await page.evaluate(() => infoSlideFixture.clicks), []);
        // Post-Continue unsupported is not proof of advance: refuse with the
        // detection reason, never retry the click.
        await setup();
        await page.evaluate(() => { infoSlideFixture.unsupportedAfterClick = true; });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 3000 });
        assert.equal(result.status, 'stopped', JSON.stringify(result));
        assert.match(result.message, /advance not proven/);
        assert.match(result.message, /unsupported question type/);
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks.length, infoSlideFixture.submits]), [1, 0]);
        // A new valid question identity proves advance even when the next
        // renderer is unsupported. The next round must still refuse it.
        await setup();
        await page.evaluate(() => {
            infoSlideFixture.unsupportedAfterClick = true;
            document.querySelector('#sa-navigation-controls button').addEventListener('click', () => { infoSlideFixture.q.questionIndex++; });
        });
        result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 3000 });
        assert.equal(result.status, 'advanced', JSON.stringify(result));
        const unsupportedNext = await detectQuestion(page);
        assert.equal(unsupportedNext.kind, 'unsupported');
        assert.equal((await playInfoSlideRound(page, unsupportedNext, { enter: true, timeout: 300 })).status, 'stopped');
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks.length, infoSlideFixture.submits]), [1, 0]);
        for (const mode of ['invalidIdentity', 'assessment', 'dash', 'unbound']) {
            await setup();
            await page.evaluate(mode => {
                const f = infoSlideFixture;
                f.unsupportedAfterClick = true;
                document.querySelector('#sa-navigation-controls button').addEventListener('click', () => {
                    f.q.questionIndex++;
                    if (mode === 'invalidIdentity') f.q.contentID = 0;
                    if (mode === 'assessment') f.self.model.gameMode = 2;
                    if (mode === 'dash') f.self.model.isDash = true;
                    if (mode === 'unbound') window.angular = { element: () => ({ scope: () => ({}) }) };
                });
            }, mode);
            result = await playInfoSlideRound(page, await detectQuestion(page), { enter: true, timeout: 300 });
            assert.equal(result.status, 'stopped', mode + JSON.stringify(result));
            assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks.length, infoSlideFixture.submits]), [1, 0], mode);
        }
        // Detection-level refusals: every deviation is unsupported, never an info-slide.
        const mutate = (name) => page.evaluate((m) => {
            const f = window.infoSlideFixture;
            const container = document.querySelector('#ep-question-container');
            const makeNoScope = () => ({ scope: () => ({}) });
            const appendControl = tag => {
                const el = document.createElement(tag);
                if (tag === 'button') el.textContent = 'Order me';
                if (tag === 'div') { el.setAttribute('contenteditable', ''); el.textContent = 'edit'; }
                (tag === 'button' ? document.querySelector('#question-container-group') : container).append(el);
            };
            const mutations = {
                questionType: () => { f.q.questionType = 8; },
                gameMode1: () => { f.self.model.gameMode = 1; },
                assessment: () => { f.self.model.gameMode = 2; },
                dash: () => { f.self.model.isDash = true; },
                identity: () => { f.q.contentID = 0; },
                component: () => { f.q.questionDef.Components = [{ ComponentTypeCode: 'SOUND_COMPONENT', ComponentID: 'snd-1' }]; },
                unlistedComponent: () => { f.q.questionDef.Components = [{ ComponentTypeCode: 'VIDEO_COMPONENT', ComponentID: 'vid-1' }]; },
                componentsUnreadable: () => { f.q.questionDef.Components = null; },
                input: () => appendControl('input'),
                textarea: () => appendControl('textarea'),
                select: () => appendControl('select'),
                canvas: () => appendControl('canvas'),
                button: () => appendControl('button'),
                contenteditable: () => appendControl('div'),
                speaker: () => { const s = document.createElement('div'); s.className = 'voice-speaker'; container.append(s); },
                noModel: () => { window.angular = { element: makeNoScope }; },
            };
            mutations[m]();
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
