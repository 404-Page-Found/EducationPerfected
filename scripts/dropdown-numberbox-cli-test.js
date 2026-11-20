const assert = require('node:assert/strict');
const { bootFixtureCli, installSubmitExitTeardown, stripCliStatusLines } = require('./fixture-cli-session');

async function bootMixedCli(path = '/lesson-dropdown-number-box') {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    await session.page.goto(session.origin + path);
    await installSubmitExitTeardown(session, 'dropdownNumberBoxFixture');
    return session;
}

// Auto mode fills and submits with no typed approval: the run drives the
// whole question end to end after one `start`.
async function run(options = {}) {
    const { prepare, path, textBox = false, dropdowns = true, extraBoxes = 0 } = options;
    let session;
    try {
        const { child, page, wait } = (session = await bootMixedCli(path));
        if (prepare) await page.evaluate(prepare);
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Lesson completed.'));
        const runOutput = session.output.slice(offset);
        assert.equal(runOutput.includes('approval'), false);
        assert.equal(runOutput.split('Selected exact lesson dropdown answers.').length - 1, dropdowns ? 1 : 0);
        assert.equal(runOutput.split('Filled exact lesson number-box answers.').length - 1, 1);
        assert.equal(runOutput.split('Filled exact lesson textbox answers.').length - 1, textBox ? 1 : 0);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.map(e => e.key), dropdownNumberBoxFixture.keys.every(e => e.trusted), dropdownNumberBoxFixture.changes.map(e => e.index), dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.inputs.every(e => e.trusted), dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [dropdowns ? ['F4', 'F4', 'F4', 'F4'] : [], true, dropdowns ? [2, 2, 2, 2] : [], (textBox ? 30 : 17) + extraBoxes * 2, true, 1, 0]);
        assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedBoxValues), [['30', '30'], ['94.20', '94.20'], ['7', '7'], ['3.5', '3.5'], ['12', '12'], ['0.25', '0.25'], ...Array.from({ length: extraBoxes }, () => ['88', '88'])]);
        if (textBox) assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedTextBoxValues), [['circumference', 'circumference']]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session?.cleanup();
    }
}

async function expectRefusal(prepare, guard, options = {}) {
    const { path, forbidden = ['Tenth', 'Hundredth', 'Unit', '30', '94.2', '3.5', '0.25'] } = options;
    let session;
    try {
        session = await bootMixedCli(path);
        const { child, page, wait } = session;
        await page.evaluate(prepare);
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Unsupported question diagnostic '));
        const output = String(session.output.slice(offset));
        assert.equal(output.includes(`"guard":"${guard}"`), true);
        assert.equal(output.includes('approval'), false);
        assert.equal(forbidden.some(text => stripCliStatusLines(output).includes(text)), false);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0, 0, 0]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session?.cleanup();
    }
}

(async () => {
    await run();
    await run({ path: '/lesson-dropdown-number-box?variant=unmarked' });
    await run({ path: '/lesson-dropdown-number-box?variant=textbox', textBox: true });
    await run({ path: '/lesson-dropdown-number-box?variant=textbox-unmarked', textBox: true });
    await run({ path: '/lesson-dropdown-number-box?variant=boxes-textbox-unmarked', textBox: true, dropdowns: false, extraBoxes: 1 });
    await expectRefusal(() => { dropdownNumberBoxFixture.self.sectionData.activityGroup.isAutoMarked = false; }, 'not-explicit-auto-marked');
    await expectRefusal(() => { dropdownNumberBoxFixture.group.append(document.createElement('input')); }, 'mixed-editable-inputs');
    await expectRefusal(() => { dropdownNumberBoxFixture.q.questionDef.Components.push({ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'invented-text', Marked: 1 }); }, 'definitions-select-count');
    await expectRefusal(() => { dropdownNumberBoxFixture.q.questionDef.Components.find(d => d.ComponentID === 'box-0').Marked = 0; }, 'mixed-definition-marking');
    console.log('Dropdown+number-box normal CLI PASS: auto mode fills four dropdowns (four trusted F4, four committed changes) and six number boxes (17 trusted characters) then submits once with no typed approval; authored-unmarked slide completes; three-surface slides (one text box, 13 more trusted characters) complete marked and unmarked; a number-box + text-box slide without dropdowns completes (no dropdown round); auto-mark/extra-control/definition-mix/mixed-marking refusal diagnostics content-free with no approval prompt, proven completion, no Next, clean quit. Synthetic only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
