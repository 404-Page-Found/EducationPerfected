// Fixture coverage for lib/support-sender.js with a fake fetch. No network.
const assert = require('node:assert/strict');
const { createSupportReport, describeUnsupported } = require('../lib/support-report');
const { createSupportSender, buildPayload, isEnabled, RELAY_URL } = require('../lib/support-sender');

(async () => {
    assert.equal(RELAY_URL, 'https://ep-support-relay.404-page-found.workers.dev');
    assert.equal(isEnabled({ env: {}, config: {} }), true, 'on by default with the built-in relay');
    assert.equal(isEnabled({ env: { EP_TEST_BOOT: '1' }, config: {} }), false, 'test boots never use the built-in relay');
    const report = createSupportReport();
    report.record('text', 'answered');
    report.record('audio', 'refused', 'no-handler');
    report.record('gaps', 'skipped', 'pre-submit-guard');
    report.record('choice', 'refused', 'stopped-by-user');
    report.record('What is "dog" hunter2 https://x.test', 'refused', 'the answer was chien');

    const calls = [];
    const fakeFetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
    const env = { EP_SUPPORT_RELAY_URL: 'https://relay.example.test/report' };

    // Disabled: test boot (no URL), env off, config off.
    await Promise.all([[{ EP_TEST_BOOT: '1' }, {}], [{ ...env, EP_SUPPORT_REPORTS: 'off' }, {}], [env, { supportReports: false }]].map(async ([e, c]) => {
        assert.equal(isEnabled({ env: e, config: c }), false);
        assert.equal(await createSupportSender({ fetchImpl: fakeFetch, env: e, config: c, appVersion: '2026.11.26' }).sendRun(report), 0);
    }));
    assert.equal(calls.length, 0);

    // Enabled: exactly four fields, enums only, once per pair per session, no stopped-by-user.
    const sender = createSupportSender({ fetchImpl: fakeFetch, env, appVersion: '2026.11.26' });
    assert.equal(await sender.sendRun(report), 3);
    assert.equal(calls.length, 3);
    const bodies = calls.map(c => JSON.parse(c.options.body));
    for (const body of bodies) assert.deepEqual(Object.keys(body).sort((a, b) => a.localeCompare(b)), ['app_version', 'reason', 'schema', 'task_type']);
    assert.deepEqual(bodies.map(b => `${b.task_type}|${b.reason}`).sort((a, b) => a.localeCompare(b)), ['audio|no-handler', 'gaps|pre-submit-guard', 'unknown|other']);
    const all = calls.map(c => c.options.body).join('');
    for (const secret of ['hunter2', 'chien', 'dog', 'x.test']) assert.ok(!all.includes(secret), `leaked ${secret}`);
    assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(Object.keys(calls[0].options.headers), ['Content-Type'], 'no extra headers');
    await sender.sendRun(report);
    assert.equal(calls.length, 3, 'same pairs are not sent twice in a session');

    // Failures never throw: 500, network error, timeout. One retry only.
    await Promise.all([async () => ({ ok: false }), async () => { throw new Error('offline'); }].map(async failing => {
        let n = 0;
        const s = createSupportSender({ fetchImpl: async (...a) => { n++; return failing(...a); }, env, appVersion: '2026.11.26' });
        const r = createSupportReport(); r.record('audio', 'refused', 'no-handler');
        assert.equal(await s.sendRun(r), 0);
        assert.equal(n, 2, 'exactly one retry');
    }));
    const hung = createSupportSender({ fetchImpl: (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), env, appVersion: '2026.11.26', timeoutMs: 20 });
    const r2 = createSupportReport(); r2.record('audio', 'refused', 'no-handler');
    assert.equal(await hung.sendRun(r2), 0);

    assert.deepEqual(buildPayload('nonsense', 'nonsense', '2026.11.26'), { task_type: 'unknown', reason: 'other', app_version: '2026.11.26', schema: 1 });
    // An unsupported refusal carries its content-free shape, in its own body.
    const shape = describeUnsupported({ kind: 'unsupported', reason: 'lesson slide with an unsupported question type (not text, choice, or audio)', diagnostic: { modelReadable: true, gameMode: 3, questionType: 9, componentCount: 1, componentTypes: ['LONG_ANSWER_COMPONENT'], controls: { inputs: 0, textareas: 1, selects: 0, contentEditable: 0, canvases: 0, buttons: 1 } } });
    const r3 = createSupportReport();
    r3.record('unsupported', 'refused', 'unsupported-question', shape);
    const c3 = [];
    const s3 = createSupportSender({ fetchImpl: async (u, o) => { c3.push(JSON.parse(o.body)); return { ok: true }; }, env, appVersion: '2026.11.27' });
    assert.equal(await s3.sendRun(r3), 1);
    assert.deepEqual(c3[0], { task_type: 'unsupported', reason: 'unsupported-question', app_version: '2026.11.27', schema: 1, branch: 'generic-slide', game_mode: 'lesson', question_type: 9, component_count: 1, components: ['LONG_ANSWER_COMPONENT'], controls: { inputs: 0, textareas: 1, selects: 0, editable: 0, canvases: 0, buttons: 1 }, guard: 'unknown', guard_counts: {} });
    assert.ok(JSON.stringify(c3[0]).length < 1024);
    // A second branch in the same session still sends.
    r3.record('unsupported', 'refused', 'unsupported-question', { ...shape, branch: 'dash' });
    assert.equal(await s3.sendRun(r3), 1);
    assert.equal(c3.at(-1).branch, 'dash');
    // Without a valid shape it falls back to the four-field schema 1 report.
    const r4 = createSupportReport();
    r4.record('unsupported', 'refused', 'unsupported-question');
    const c4 = [];
    await createSupportSender({ fetchImpl: async (u, o) => { c4.push(JSON.parse(o.body)); return { ok: true }; }, env, appVersion: '2026.11.27' }).sendRun(r4);
    assert.deepEqual(c4, [{ task_type: 'unsupported', reason: 'unsupported-question', app_version: '2026.11.27', schema: 1 }]);
    assert.equal(Object.keys(buildPayload('unsupported', 'unsupported-question', '2026.11.27', { branch: 'free text' })).length, 4);
    console.log('support-sender-test passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
