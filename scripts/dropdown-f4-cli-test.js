const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { installDropdownFixture } = require('./dropdown-fixture');

(async () => {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    const { child, page, origin, wait } = session;
    try {
        await page.goto(origin + '/lesson');
        await page.evaluate(installDropdownFixture, 1);
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
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('Lesson completed.'));
        assert.equal(session.output.slice(offset).includes('approval'), false);
        assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.map(event => event.key), dropdownFixture.keys.every(event => event.trusted), dropdownFixture.changes.map(event => event.index), dropdownFixture.submits, dropdownFixture.nexts]), [['F4'], true, [2], 1, 0]);
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally { await session.cleanup(); }
    {
        // Detection refusal: no approval prompt, no input, no Submit.
        const session = await bootFixtureCli('cli.js', 'Commands: start');
        const { child, page, origin, wait } = session;
        try {
            await page.goto(origin + '/lesson');
            await page.evaluate(installDropdownFixture, 1);
            await page.evaluate(() => { dropdownFixture.base['dropdown-0'][0].componentState._shuffledOptions[2].Correct = 'false'; });
            const offset = session.output.length;
            child.stdin.write('start\n');
            await wait(() => session.output.slice(offset).includes('Unsupported question diagnostic '));
            const output = session.output.slice(offset);
            assert.equal(output.includes('"guard":"correct-option"'), true);
            assert.equal(output.includes('approval'), false);
            assert.deepEqual(await page.evaluate(() => [dropdownFixture.keys.length, dropdownFixture.submits, dropdownFixture.nexts]), [0, 0, 0]);
            child.stdin.write('quit\n');
            await wait(() => child.exitCode !== null);
            assert.equal(child.exitCode, 0);
        } finally { await session.cleanup(); }
    }
    console.log('Dropdown F4 normal CLI PASS: default input, owned trace, one dropdown, one trusted Submit with no typed approval, detection refusal prints its guard with no approval prompt and no Submit, proven completion, no Next, clean quit. Synthetic Linux only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
