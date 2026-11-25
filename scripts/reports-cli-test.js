// The `reports` CLI command shows and changes the anonymous support report
// setting in a real fixture session (settings are not persisted under the test boot).
const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');

(async () => {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    const { child, wait } = session;
    try {
        assert.match(session.output, /reports \[on\|off\]/);
        let offset = session.output.length;
        child.stdin.write('reports\n');
        await wait(() => session.output.slice(offset).includes('Support reports: '));
        assert.match(session.output.slice(offset), /Support reports: on; no relay is configured, so nothing is sent\. The local report block always prints\./);
        offset = session.output.length;
        child.stdin.write('reports off\n');
        await wait(() => session.output.slice(offset).includes('Support reports: off'));
        offset = session.output.length;
        child.stdin.write('status\n');
        await wait(() => session.output.slice(offset).includes('"supportReports"'));
        assert.match(session.output.slice(offset), /"supportReports":\{"enabled":false\}/);
        offset = session.output.length;
        child.stdin.write('reports maybe\n');
        await wait(() => session.output.slice(offset).includes('Use reports, reports on or reports off.'));
        child.stdin.write('reports on\n');
        await wait(() => session.output.includes('Support reports: on'));
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
    } finally {
        await session.cleanup();
    }
    console.log('Reports CLI PASS: show, off, status field, bad argument and on. Synthetic only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
