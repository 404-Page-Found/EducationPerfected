const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installDropdownFixture } = require('./dropdown-fixture');
const { detectQuestion } = require('../lib/detect-question');
const { playDropdownRound } = require('../lib/dropdown-handler');
const { readDropdownsInPage } = require('../lib/dropdown-state');
(async () => {
    const server = createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH });
        const page = await browser.newPage();
        const setup = async () => {
            await page.goto('http://127.0.0.1:' + server.address().port + '/lesson');
            await page.evaluate(installDropdownFixture, 3);
            await page.evaluate(() => Object.assign(dropdownFixture.self.sectionData.activityGroup, { isAutoMarked: false, isSelfMarked: true }));
        };
        for (const enter of [true, false]) {
            await setup();
            const d = await detectQuestion(page);
            assert.equal(d.kind, 'dropdown', JSON.stringify(d));
            assert.equal(d.autoMarked, false);
            assert.equal(d.selfMarked, true);
            const result = await playDropdownRound(page, d, { enter, timeout: 300 });
            assert.equal(result.status, 'self-marked-filled');
            assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [0, 0]);
            assert.ok(await page.evaluate(() => [...dropdownFixture.group.querySelectorAll('select')].every(s => s.selectedIndex === 2)));
            assert.equal((await page.evaluate(readDropdownsInPage, null, 'submit', true)).guard, 'self-marked-no-submit');
        }
        for (const mode of ['unknown', 'string', 'conflict', 'assessment', 'mixed', 'changed']) {
            await setup();
            const d = await detectQuestion(page);
            await page.evaluate(mode => {
                const f = dropdownFixture, g = f.self.sectionData.activityGroup;
                if (mode === 'unknown') delete g.isSelfMarked;
                if (mode === 'string') g.isSelfMarked = 'true';
                if (mode === 'conflict') g.isAutoMarked = true;
                if (mode === 'assessment') f.self.model.gameMode = 2;
                if (mode === 'mixed') f.group.append(document.createElement('input'));
                if (mode === 'changed') f.afterChange = () => { g.isSelfMarked = false; };
            }, mode);
            assert.equal((await playDropdownRound(page, d, { enter: true, timeout: 100 })).status, 'stopped', mode);
            assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [0, 0], mode);
            if (mode !== 'changed') assert.equal(await page.evaluate(() => dropdownFixture.keys.length), 0, mode);
        }
        for (const flag of ['true', 1, null]) {
            await setup();
            await page.evaluate(flag => Object.assign(dropdownFixture.self.sectionData.activityGroup, { isAutoMarked: true, isSelfMarked: flag }), flag);
            const d = await detectQuestion(page);
            assert.equal(d.kind, 'unsupported');
            assert.equal((await playDropdownRound(page, d, { enter: true })).status, 'stopped');
            assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.length, dropdownFixture.submits]), [0, 0]);
        }
        console.log('Explicit self-marked dropdowns: fill-only in both modes; no submission/self-grade/Next; unsafe and changed states refused.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections(); server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
