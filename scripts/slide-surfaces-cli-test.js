const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');

// The composed slide's teardown must remove BOTH surfaces' groups so the
// CLI's completion watch sees the lesson end after the single Submit.
async function bootMixedCli() {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    await session.page.goto(session.origin + '/lesson-multi-number-box');
    await session.page.evaluate(() => {
        document.querySelector('#sa-navigation-controls button').addEventListener('click', () => {
            multiFixture.group.remove();
            dropdownNumberBoxFixture.group.remove();
            document.querySelector('#question-container-group').remove();
            multiFixture.self.model._currentQuestion = null;
            const exit = document.querySelector('button.exit-button');
            exit.hidden = false;
            exit.style.display = '';
        });
    });
    return session;
}

(async () => {
    // Auto mode fills every surface and submits once, with no typed approval.
    let session;
    try {
        session = await bootMixedCli();
        const { child, page, wait } = session;
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Lesson completed.'));
        const runOutput = session.output.slice(offset);
        assert.equal(runOutput.includes('approval'), false);
        assert.equal(runOutput.split('Filled exact lesson number-box answers.').length - 1, 1);
        assert.equal(runOutput.split('Selected exact multi-select answer set.').length - 1, 1);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.inputs.length, dropdownNumberBoxFixture.inputs.every(e => e.trusted), multiFixture.clicks, dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [3, true, [2, 0], 1, 0]);
        assert.deepEqual(await page.evaluate(() => dropdownNumberBoxFixture.submittedBoxValues), [['30', '30'], ['7', '7']]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session?.cleanup();
    }
    // Mixed marking across surfaces refuses with a content-free diagnostic
    // and zero input on any surface.
    try {
        session = await bootMixedCli();
        const { child, page, wait } = session;
        await page.evaluate(() => { multiFixture.comp.Marked = 0; });
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Unsupported question diagnostic '));
        const output = String(session.output.slice(offset));
        assert.equal(output.includes('"kind":"slide-surfaces-refusal"'), true);
        assert.equal(output.includes('"guard":"mixed-definition-marking"'), true);
        assert.equal(output.includes('approval'), false);
        assert.equal(['30', '7', 'Invented'].some(text => output.includes(text)), false);
        assert.deepEqual(await page.evaluate(() => [dropdownNumberBoxFixture.inputs.length, multiFixture.clicks.length, dropdownNumberBoxFixture.submits, dropdownNumberBoxFixture.nexts]), [0, 0, 0, 0]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session?.cleanup();
    }
    console.log('Slide-surfaces CLI: multi-select + number boxes auto-run with one Submit and no approval gate; mixed-marking refusal content-free PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
