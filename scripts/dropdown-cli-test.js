const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { expectedPopupChanges, expectedPopupKeys, installPopupEmulation } = require('./dropdown-popup-test-helpers');

async function installSubmitCompletion(page) {
    await page.evaluate(() => {
        const submit = document.querySelector('#sa-navigation-controls button');
        submit.addEventListener('click', () => {
            dropdownFixture.group.remove();
            document.querySelector('#question-container-group').remove();
            dropdownFixture.self.model._currentQuestion = null;
            const exit = document.querySelector('button.exit-button');
            exit.hidden = false;
            exit.style.display = '';
        });
    });
}

async function bootDropdownCli(count, extraEnv = {}, variant = '') {
    const session = await bootFixtureCli('cli.js', 'Commands: start', extraEnv);
    await session.page.goto(session.origin + '/lesson-dropdown?count=' + count + (variant ? '&variant=' + variant : ''));
    return session;
}

async function assertMultiDropdownSuccess(count, extraEnv = {}, variant = '') {
    const session = await bootDropdownCli(count, extraEnv, variant);
    const { child, page, wait } = session;
    try {
        await installPopupEmulation(page);
        await installSubmitCompletion(page);
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Lesson completed.'));
        const runOutput = session.output.slice(offset);
        assert.equal(runOutput.includes('approval'), false, count);
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(count), count);
        assert.deepEqual(await page.evaluate(() => dropdownFixture.changes), expectedPopupChanges(count), count);
        assert.equal(runOutput.split('Selected exact lesson dropdown answers.').length - 1, 1, count);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [1, 0], count);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0, count);
    } finally {
        await session.cleanup();
    }
}

async function assertMidSequenceFailure() {
    const session = await bootDropdownCli(3);
    const { child, page, wait } = session;
    try {
        await installPopupEmulation(page, { closeOnArrowAt: 1 });
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Lesson dropdowns stopped: changed or unsupported state; no retry.'));
        const refusalOutput = session.output.slice(offset);
        const refusalLines = new Set(refusalOutput.split('\n'));
        assert.equal(refusalLines.has('Dropdown refusal diagnostic {"phase":"after-popup-arrow","dropdownIndex":1,"keyDispatchesReturned":6,"guard":"popup-closed-before-commit","dropdownCount":3}'), true);
        assert.equal(refusalOutput.includes('Dropdown Submit approval required'), false);
        assert.equal(refusalOutput.includes('Selected exact lesson dropdown answers.'), false);
        assert.deepEqual(await page.evaluate(() => dropdownFixture.keys), expectedPopupKeys(3, true));
        assert.deepEqual(await page.evaluate(() => dropdownFixture.changes), expectedPopupChanges(1));
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [0, 0]);
        child.stdin.write('status\nquit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session.cleanup();
    }
}

async function assertCliRefusal(count, variant, mutate, diagnosticLine, forbiddenText) {
    const session = await bootDropdownCli(count, {}, variant);
    const { child, page, wait } = session;
    try {
        await page.evaluate(mutate);
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Lesson dropdowns: unsafe, unsupported or changed renderer state'));
        const refusalOutput = session.output.slice(offset);
        assert.equal(refusalOutput.split('\n').includes(diagnosticLine), true);
        assert.equal(refusalOutput.includes(forbiddenText), false);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.length, dropdownFixture.submits, dropdownFixture.nexts]), [0, 0, 0]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session.cleanup();
    }
}

async function assertDetectionRefusal() {
    await assertCliRefusal(3, '', () => { dropdownFixture.base['dropdown-0'][0].marked = 0; }, 'Unsupported question diagnostic {"kind":"dropdown-refusal","guard":"component-marked","domSelectCount":3}', 'Radius');
}

async function assertVariableTemplateRefusal() {
    await assertCliRefusal(1, 'variables', () => { dropdownFixture.base['dropdown-0'][0].componentState.descInjectors[0].parts[0].text = 'tampered'; }, 'Unsupported question diagnostic {"kind":"dropdown-refusal","guard":"raw-original-options","domSelectCount":1}', '42 right');
}

async function assertMixedEditableRefusal() {
    await assertCliRefusal(2, '', () => {
        const slider = document.createElement('input'); slider.type = 'range'; dropdownFixture.group.append(slider);
        const working = document.createElement('textarea'); working.readOnly = true; dropdownFixture.group.append(working);
        const textBox = document.createElement('input'); textBox.className = 'text-box-component'; dropdownFixture.group.append(textBox);
    }, 'Unsupported question diagnostic {"kind":"dropdown-refusal","guard":"mixed-editable-inputs","domSelectCount":2,"extraCount":3,"extras":[{"tag":"input","type":"range"},{"tag":"textarea","readOnly":true},{"tag":"input","type":"text","answerBox":"text-box"}],"definitions":{"total":2,"byType":{"dropdown":2},"marked":2,"unmarked":0,"invalidMarked":0}}', 'Radius');
}

(async () => {
    await assertMultiDropdownSuccess(2);
    await assertMultiDropdownSuccess(3);
    await assertMultiDropdownSuccess(5, { EP_DROPDOWN_INPUT: 'legacy' });
    await assertMultiDropdownSuccess(1, {}, 'variables');
    await assertMidSequenceFailure();
    await assertDetectionRefusal();
    await assertVariableTemplateRefusal();
    await assertMixedEditableRefusal();
    console.log('Dropdown normal CLI PASS: F4 popup handles two, three and five dropdowns in order plus a variable-template slide, ignores EP_DROPDOWN_INPUT=legacy, submits once with no typed approval, stops a mid-sequence failure without Submit, and prints the sanitized mid-sequence, detection, injector and mixed-editable refusal diagnostics. Synthetic Linux only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
