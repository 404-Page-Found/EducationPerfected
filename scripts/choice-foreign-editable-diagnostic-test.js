// A single-choice slide with an editable control outside the choice component is
// refused with a content-free shape (game mode, components, control counts), so a
// filed support report says what to build instead of "unknown".
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { setup } = require('./choice-renderer-fixture');
const { detectQuestion } = require('../lib/detect-question');
const { describeUnsupported, isValidDetail } = require('../lib/support-report');
(async () => {
    const server = createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
        const page = await browser.newPage();
        await setup(page, `http://127.0.0.1:${server.address().port}`);
        await page.evaluate(() => { (document.querySelector('#ep-question-container') || document.body).append(document.createElement('textarea')); document.body.append(Object.assign(document.createElement('p'), { textContent: 'SECRET-PAGE-TEXT' })); });
        const bad = await detectQuestion(page);
        assert.equal(bad.kind, 'unsupported');
        assert.match(bad.reason, /editable controls outside the choice component/);
        assert.equal(bad.diagnostic?.guard, 'foreign-editable');
        assert.equal(bad.diagnostic.gameMode, 3);
        assert.ok(bad.diagnostic.controls.textareas >= 1);
        const shape = describeUnsupported(bad);
        assert.equal(shape.branch, 'foreign-choice');
        assert.equal(shape.game_mode, 'lesson');
        assert.ok(shape.controls.textareas >= 1 && shape.controls.buttons >= 0);
        assert.ok(isValidDetail(shape));
        // Content-free: only fixed keys and counts, never page text.
        assert.deepEqual(Object.keys(shape).sort((a, b) => a.localeCompare(b)), ['branch', 'component_count', 'components', 'controls', 'game_mode', 'guard', 'guard_counts', 'question_type']);
        assert.ok(!/SECRET-PAGE-TEXT/.test(JSON.stringify(bad.diagnostic)));
        // The page probe fills the shape for a refusal site that carries none.
        const { readUnsupportedShape } = require('../lib/unsupported-shape');
        const { needsShapeProbe } = require('../lib/support-report');
        const bare = { kind: 'unsupported', reason: 'Lesson dropdowns: unsafe, unsupported or changed renderer state', diagnostic: { kind: 'dropdown-refusal', guard: 'x', domSelectCount: 1 } };
        assert.ok(needsShapeProbe(bare));
        const probe = await readUnsupportedShape(page);
        const filled = describeUnsupported(bare, probe);
        assert.equal(filled.branch, 'foreign-dropdown');
        assert.equal(filled.game_mode, 'lesson');
        assert.ok(filled.controls.textareas >= 1 && filled.components.length >= 1 && isValidDetail(filled));
        assert.ok(!/SECRET-PAGE-TEXT/.test(JSON.stringify(probe)));
        console.log('choice-foreign-editable-diagnostic-test passed');
    } finally { if (browser) await browser.close();
    await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exit(1); });
