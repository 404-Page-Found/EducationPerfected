// A profile that is already signed in lands on the app shell, never the login
// form: startup must continue at once instead of waiting 60s for the form.
const assert = require('node:assert/strict');
const { bootCli } = require('./cli-test-harness');
(async () => {
    const server = require('./mock-ep').createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cli = bootCli(origin, { extraEnv: { EP_LOGIN_URL: origin + '/learning/dashboard' } });
    const started = Date.now();
    try {
        await cli.wait(() => cli.output().includes('Commands: start'));
        const out = cli.output();
        assert.ok(out.includes('Already logged in; skipping the login page.'), out);
        assert.ok(!out.includes('did not appear within 60s'), out);
        assert.ok(!out.includes('No credentials provided'), out);
        assert.ok(Date.now() - started < 15000);
        console.log('Already-logged-in startup: continues without waiting for the login form.');
    } finally {
        try { require('./test-process-cleanup').cleanupTestProcess(cli.child); } catch {}
        server.closeAllConnections();
        server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
