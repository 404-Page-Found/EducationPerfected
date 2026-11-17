const assert = require('node:assert/strict');
const { bootFixtureCli, installSubmitExitTeardown } = require('./fixture-cli-session');

async function bootMixedCli(path = '/lesson-dropdown-number-box') {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    await session.page.goto(session.origin + path);
    await installSubmitExitTeardown(session, 'dropdownNumberBoxFixture');
    return session;
}

async function run(approval, succeed, options = {}) {
    const { prepare, path, prompt = '(4 dropdowns and 6 number boxes).' } = options;
    let session;
    try {
        const { child, page, wait } = (session = await bootMixedCli(path));
        if (prepare) await page.evaluate(prepare);
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Dropdown+number-box Submit approval required for dropdown:'));
        const promptOutput = session.output.slice(offset);
        assert.equal(promptOutput.split('Dropdown+number-box Submit approval required for dropdown:').length - 1, 1);
        assert.equal(promptOutput.includes(prompt), true);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.map(e => e.key), dropdownNumberBoxFixture.keys.every(e => e.trusted), dropdownNumberBoxFixture.changes.map(e => e.index), dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.inputs.every(e => e.trusted), dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [['F4', 'F4', 'F4', 'F4'], true, [2, 2, 2, 2], 17, true, 0, 0]);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('input.number-box-component')].map(input => input.value)), ['30', '94.20', '7', '3.5', '12', '0.25']);
        child.stdin.write(approval + '\n');
        if (succeed) {
            await wait(() => session.output.slice(offset).includes('Lesson completed.'));
            assert.equal(session.output.slice(offset).split('Selected exact lesson dropdown answers.').length - 1, 1);
            assert.equal(session.output.slice(offset).split('Filled exact lesson number-box answers.').length - 1, 1);
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [1, 0]);
        } else {
            await wait(() => session.output.slice(offset).includes('Dropdown+number-box Submit not approved; stopping without Submit.'));
            await wait(() => session.output.slice(offset).includes('Lesson dropdowns with number boxes stopped: changed or unsupported state; no retry.'));
            assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0]);
        }
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
        assert.equal(forbidden.some(text => output.includes(text)), false);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.keys.length, dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0, 0, 0]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session?.cleanup();
    }
}

(async () => {
    await run('yes', true);
    await run('no', false);
    await run('yes', true, { path: '/lesson-dropdown-number-box?variant=unmarked' });
    let session;
    try {
        session = await bootMixedCli();
        const { child, page, wait } = session;
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Dropdown+number-box Submit approval required for dropdown:'));
        const stopped = await page.evaluate(() => window.epTestStop());
        assert.equal(stopped.state, 'stopped');
        await wait(() => session.output.slice(offset).includes('Dropdown+number-box Submit approval cancelled; stopping without Submit.'));
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session?.cleanup();
    }
    await expectRefusal(() => { dropdownNumberBoxFixture.self.sectionData.activityGroup.isAutoMarked = false; }, 'not-explicit-auto-marked');
    await expectRefusal(() => { dropdownNumberBoxFixture.group.append(document.createElement('input')); }, 'mixed-editable-inputs');
    await expectRefusal(() => { dropdownNumberBoxFixture.q.questionDef.Components.push({ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'invented-text', Marked: 1 }); }, 'definitions-select-count');
    await expectRefusal(() => { dropdownNumberBoxFixture.q.questionDef.Components.find(d => d.ComponentID === 'box-0').Marked = 0; }, 'mixed-definition-marking');
    console.log('Dropdown+number-box normal CLI PASS: four dropdowns (four trusted F4, four committed changes) and six number boxes (17 trusted characters), typed-yes approval before one trusted Submit, non-yes denial and browser stop cancel without Submit, authored-unmarked slide completes, auto-mark/extra-control/definition-mix/mixed-marking refusal diagnostics content-free, proven completion, no Next, clean quit. Synthetic only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
