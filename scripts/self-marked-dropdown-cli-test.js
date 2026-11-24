const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { installPopupEmulation } = require('./dropdown-popup-test-helpers');
(async () => {
    for (const mode of ['auto', 'semi']) {
        const session = await bootFixtureCli('cli.js', 'Commands: start');
        try {
            const { page, child, wait } = session;
            await page.goto(session.origin + '/lesson-dropdown?count=3');
            await page.evaluate(() => Object.assign(dropdownFixture.self.sectionData.activityGroup, { isAutoMarked: false, isSelfMarked: true }));
            await installPopupEmulation(page);
            child.stdin.write('mode ' + mode + '\n');
            await wait(() => session.output.includes('"mode":"' + mode + '"'));
            const offset = session.output.length;
            child.stdin.write('start\n');
            await wait(() => session.output.slice(offset).includes('Self-marked dropdowns filled. Run stopped.'));
            assert.deepEqual(await page.evaluate(() => [dropdownFixture.submits, dropdownFixture.nexts]), [0, 0]);
            assert.ok(await page.evaluate(() => [...dropdownFixture.group.querySelectorAll('select')].every(s => s.selectedIndex === 2)));
            child.stdin.write('quit\n');
            await wait(() => child.exitCode !== null);
            assert.equal(child.exitCode, 0);
        } finally { await session.cleanup(); }
    }
    console.log('Self-marked dropdown CLI: both modes fill once and stop with manual review guidance.');
})().catch(e => { console.error(e); process.exitCode = 1; });
