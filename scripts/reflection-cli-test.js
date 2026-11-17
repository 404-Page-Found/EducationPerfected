const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
async function boot(path = '/lesson-reflection') {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    await session.page.goto(session.origin + path);
    return session;
}
const counters = page => page.evaluate(() => [reflectionFixture.keys.length, reflectionFixture.inputs.length, reflectionFixture.submits, reflectionFixture.nexts]);
(async () => {
    for (const mode of ['auto', 'semi']) for (const approval of ['yes', 'no']) {
        let session;
        try {
            session = await boot(mode === 'semi' ? '/lesson-reflection?variant=unmarked' : '/lesson-reflection');
            const { child, page, wait } = session;
            child.stdin.write('mode ' + mode + '\n'); await wait(() => session.output.includes('"mode":"' + mode + '"'));
            child.stdin.write('start\n'); await wait(() => session.output.includes('Reflection text required for reflection:'));
            assert.deepEqual(await counters(page), [0, 0, 0, 0]);
            child.stdin.write('My own reflection.\n');
            await wait(() => session.output.includes('Reflection fill approval for reflection:'));
            assert.ok(session.output.includes('"My own reflection.". Type yes to fill this response only. No Submit or self-grade will be clicked.'));
            assert.deepEqual(await counters(page), [0, 0, 0, 0]);
            child.stdin.write(approval + '\n');
            if (approval === 'yes') {
                await wait(() => session.output.includes('Reflection filled with your approved text. Run stopped. Review, submit and self-mark in the browser.'));
                assert.deepEqual(await counters(page), [18, 18, 0, 0]);
                assert.equal(await page.evaluate(() => reflectionFixture.editor.textContent), 'My own reflection.');
            } else {
                await wait(() => session.output.includes('Reflection fill not approved; no input.'));
                assert.deepEqual(await counters(page), [0, 0, 0, 0]);
            }
            child.stdin.write('quit\n'); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0);
        } finally { await session?.cleanup(); }
    }
    for (const afterText of [false, true]) {
        let session;
        try {
            session = await boot(); const { child, page, wait } = session;
            child.stdin.write('start\n'); await wait(() => session.output.includes('Reflection text required for reflection:'));
            if (afterText) { child.stdin.write('My text\n'); await wait(() => session.output.includes('Reflection fill approval for reflection:')); }
            assert.equal((await page.evaluate(() => window.epTestStop())).state, 'stopped');
            await wait(() => session.output.includes('Reflection fill cancelled; no further input.'));
            assert.deepEqual(await counters(page), [0, 0, 0, 0]);
            child.stdin.write('quit\n'); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0);
        } finally { await session?.cleanup(); }
    }
    let session;
    try {
        session = await boot(); const { child, page, wait } = session;
        await page.evaluate(() => { reflectionFixture.component.visualElement = document.body; });
        child.stdin.write('start\n'); await wait(() => session.output.includes('Unsupported question diagnostic '));
        assert.ok(session.output.includes('"guard":"editor-association"'));
        assert.ok(!session.output.includes('Synthetic reflection slide.'));
        assert.deepEqual(await counters(page), [0, 0, 0, 0]);
        child.stdin.write('quit\n'); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0);
    } finally { await session?.cleanup(); }
    console.log('Reflection normal CLI PASS: text entry and separate typed-yes BEFORE input, auto/semi fill-only stop, no Submit or self-grade, denial and browser-stop cancellation in either prompt, content-free renderer refusal. Synthetic only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
