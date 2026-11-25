// Fixture coverage for lib/support-sender.js with a fake fetch. No network.
const assert = require('node:assert/strict');
const { createSupportReport } = require('../lib/support-report');
const { createSupportSender, buildPayload, isEnabled, RELAY_URL } = require('../lib/support-sender');

(async () => {
    assert.equal(RELAY_URL, '', 'PR 1 ships with no relay URL, so nothing is sent');
    const report = createSupportReport();
    report.record('text', 'answered');
    report.record('audio', 'refused', 'no-handler');
    report.record('gaps', 'skipped', 'pre-submit-guard');
    report.record('choice', 'refused', 'stopped-by-user');
    report.record('What is "dog" hunter2 https://x.test', 'refused', 'the answer was chien');

    const calls = [];
    const fakeFetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
    const env = { EP_SUPPORT_RELAY_URL: 'https://relay.example.test/report' };

    // Disabled: no URL, env off, config off.
    for (const [e, c] of [[{}, {}], [{ ...env, EP_SUPPORT_REPORTS: 'off' }, {}], [env, { supportReports: false }]]) {
        assert.equal(isEnabled({ env: e, config: c }), false);
        assert.equal(await createSupportSender({ fetchImpl: fakeFetch, env: e, config: c, appVersion: '2026.11.26' }).sendRun(report), 0);
    }
    assert.equal(calls.length, 0);

    // Enabled: exactly four fields, enums only, once per pair per session, no stopped-by-user.
    const sender = createSupportSender({ fetchImpl: fakeFetch, env, appVersion: '2026.11.26' });
    assert.equal(await sender.sendRun(report), 3);
    assert.equal(calls.length, 3);
    const bodies = calls.map(c => JSON.parse(c.options.body));
    for (const body of bodies) assert.deepEqual(Object.keys(body).sort(), ['app_version', 'reason', 'schema', 'task_type']);
    assert.deepEqual(bodies.map(b => `${b.task_type}|${b.reason}`).sort(), ['audio|no-handler', 'gaps|pre-submit-guard', 'unknown|other']);
    const all = calls.map(c => c.options.body).join('');
    for (const secret of ['hunter2', 'chien', 'dog', 'x.test']) assert.ok(!all.includes(secret), `leaked ${secret}`);
    assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(Object.keys(calls[0].options.headers), ['Content-Type'], 'no extra headers');
    await sender.sendRun(report);
    assert.equal(calls.length, 3, 'same pairs are not sent twice in a session');

    // Failures never throw: 500, network error, timeout. One retry only.
    for (const failing of [async () => ({ ok: false }), async () => { throw new Error('offline'); }]) {
        let n = 0;
        const s = createSupportSender({ fetchImpl: async (...a) => { n++; return failing(...a); }, env, appVersion: '2026.11.26' });
        const r = createSupportReport(); r.record('audio', 'refused', 'no-handler');
        assert.equal(await s.sendRun(r), 0);
        assert.equal(n, 2, 'exactly one retry');
    }
    const hung = createSupportSender({ fetchImpl: (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), env, appVersion: '2026.11.26', timeoutMs: 20 });
    const r2 = createSupportReport(); r2.record('audio', 'refused', 'no-handler');
    assert.equal(await hung.sendRun(r2), 0);

    assert.deepEqual(buildPayload('nonsense', 'nonsense', '2026.11.26'), { task_type: 'unknown', reason: 'other', app_version: '2026.11.26', schema: 1 });
    console.log('support-sender-test passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
