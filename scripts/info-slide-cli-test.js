const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { installInfoSlideFixture } = require('./info-slide-fixture');
(async () => {
    // Auto mode: the run advances information slides with one trusted
    // Continue click each and never submits; a completion control ends the
    // run as completed.
    let session;
    try {
        session = await bootFixtureCli('cli.js', 'Commands: start');
        const { child, page, wait } = session;
        await page.goto(session.origin + '/lesson');
        await page.evaluate(installInfoSlideFixture, {});
        child.stdin.write('mode auto\n'); await wait(() => session.output.includes('"mode":"auto"'));
        child.stdin.write('start\n');
        await wait(() => session.output.includes('Information slide: clicked Continue (no answer submitted).'));
        await page.evaluate(() => { infoSlideFixture.complete = true; });
        await wait(() => session.output.includes('Lesson completed.'));
        const [clicks, submits, advances] = await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits, infoSlideFixture.advances]);
        assert.ok(clicks.length >= 1 && clicks.every(c => c.trusted === true), JSON.stringify(clicks));
        assert.equal(submits, 0);
        assert.ok(advances >= 1);
        child.stdin.write('quit\n'); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0);
    } finally { await session?.cleanup(); }
    // Semi mode: guidance only, no click, no submit, run stops.
    session = undefined;
    try {
        session = await bootFixtureCli('cli.js', 'Commands: start');
        const { child, page, wait } = session;
        await page.goto(session.origin + '/lesson');
        await page.evaluate(installInfoSlideFixture, {});
        child.stdin.write('mode semi\n'); await wait(() => session.output.includes('"mode":"semi"'));
        child.stdin.write('start\n');
        await wait(() => session.output.includes('Information slide: nothing to answer. Run stopped. Click Continue in the browser to advance.'));
        assert.deepEqual(await page.evaluate(() => [infoSlideFixture.clicks, infoSlideFixture.submits]), [[], 0]);
        child.stdin.write('quit\n'); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0);
    } finally { await session?.cleanup(); }
    // A slide with answer controls still stops the real CLI unanswered.
    session = undefined;
    try {
        session = await bootFixtureCli('cli.js', 'Commands: start');
        const { child, page, wait } = session;
        await page.goto(session.origin + '/lesson');
        await page.evaluate(installInfoSlideFixture, {});
        await page.evaluate(() => {
            const i = document.createElement('input');
            document.querySelector('#ep-question-container').append(i);
            window.infoControlEvents = 0;
            window.infoControlEl = i;
            i.addEventListener('input', () => window.infoControlEvents++);
            i.addEventListener('keydown', () => window.infoControlEvents++);
            i.addEventListener('focus', () => window.infoControlEvents++);
            i.addEventListener('click', () => window.infoControlEvents++);
            i.addEventListener('change', () => window.infoControlEvents++);
        });
        child.stdin.write('start\n');
        await wait(() => session.output.includes('Answer loop stopping: non-text round requested a stop'));
        assert.ok(session.output.includes('answer controls'));
        assert.deepEqual(await page.evaluate(() => [window.infoControlEvents, infoSlideFixture.clicks, infoSlideFixture.submits, window.infoControlEl.value]), [0, [], 0, '']);
        child.stdin.write('quit\n'); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0);
    } finally { await session?.cleanup(); }
    console.log('Info slide CLI PASS: auto advances with trusted Continue only and completes, semi leaves the click to the user, answer controls still stop the run. Synthetic only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
