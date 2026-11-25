// Relay fixture tests with an in-memory KV and a mocked GitHub fetch. No network.
const assert = require('node:assert/strict');
const { TASK_TYPES: APP_TYPES, REASONS: APP_REASONS } = require('../lib/support-report');
const { REPORTABLE_REASONS } = require('../lib/support-sender');

const byName = (a, b) => a.localeCompare(b);

(async () => {
    const { default: worker, TASK_TYPES, REASONS, validate } = await import('../relay/worker.mjs');
    // Relay allow-lists stay in step with the app.
    assert.deepEqual([...TASK_TYPES].filter(t => t !== 'unknown').sort(byName), [...APP_TYPES].sort(byName));
    assert.deepEqual([...REASONS].sort(byName), [...REPORTABLE_REASONS].sort(byName));
    assert.ok([...APP_REASONS].includes('other'));

    function makeEnv(extra = {}) {
        const store = new Map();
        return {
            store,
            REPORTS: {
                async get(key, type) {
                    if (!store.has(key)) return null;
                    const v = store.get(key);
                    return type === 'json' ? JSON.parse(v) : v;
                },
                async put(key, value) { store.set(key, value); },
            },
            REPO: 'owner/repo', GITHUB_TOKEN: 'tok', DAILY_WRITE_CAP: '30', ...extra,
        };
    }
    const calls = [];
    const issues = new Map();
    let nextIssue = 1;
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        const method = options.method || 'GET';
        const m = url.match(/\/issues(?:\/(\d+))?$/);
        if (method === 'POST') { const n = nextIssue++; issues.set(n, { state: 'open', ...JSON.parse(options.body) }); return { ok: true, json: async () => ({ number: n }) }; }
        const n = Number(m[1]);
        if (method === 'PATCH') { Object.assign(issues.get(n), JSON.parse(options.body)); return { ok: true, json: async () => issues.get(n) }; }
        return { ok: true, json: async () => issues.get(n) };
    };
    const good = (over = {}) => JSON.stringify({ task_type: 'audio', reason: 'no-handler', app_version: '2026.11.26', schema: 1, ...over });
    const send = (env, body, init = {}) => worker.fetch(new Request('https://relay.test/', { method: 'POST', body, headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'secret-agent', ...init.headers } }), env);

    // Rejections: schema, extras, oversize, method, version format, enums, injection.
    const env = makeEnv();
    const bad = ['', 'nope', '[]', good({ extra: 1 }), good({ schema: 2 }), good({ app_version: 'v1.0' }), good({ app_version: '2026.13.1' }),
        good({ task_type: 'audio\n- injected' }), good({ reason: '`; drop' }), good({ task_type: 'x'.repeat(600) }), JSON.stringify({ task_type: 'audio', reason: 'no-handler', app_version: '2026.11.26' })];
    const statuses = await Promise.all(bad.map(async body => (await send(env, body)).status));
    statuses.forEach((status, i) => assert.ok([400, 413].includes(status), `rejected ${bad[i].slice(0, 30)}`));
    assert.equal((await worker.fetch(new Request('https://relay.test/', { method: 'GET' }), env)).status, 405);
    assert.equal(calls.length, 0);
    assert.equal(env.store.size, 0);

    // First report creates one issue with enum-only content, then counts.
    assert.equal((await send(env, good())).status, 204);
    assert.equal(calls.length, 1);
    const created = JSON.parse(calls[0].options.body);
    assert.equal(created.title, 'Task support: audio not handled (no-handler)');
    assert.deepEqual(created.labels, ['task-support']);
    await Array.from({ length: 8 }).reduce(chain => chain.then(() => send(env, good())), Promise.resolve());
    assert.equal(calls.length, 1, 'counting does not write to GitHub');
    await send(env, good());
    assert.equal(calls.length, 2, 'threshold 10 refreshes the body');
    assert.match(issues.get(1).body, /Reports so far: 10/);

    // No IP or header data in any outgoing call or KV value.
    const everything = JSON.stringify(calls.map(c => ({ u: c.url, b: c.options.body }))) + JSON.stringify([...env.store.entries()]);
    for (const leak of ['203.0.113.9', 'secret-agent']) assert.ok(!everything.includes(leak), `leaked ${leak}`);
    assert.deepEqual(Object.keys(calls[0].options.headers).sort(byName), ['Accept', 'Authorization', 'Content-Type', 'User-Agent', 'X-GitHub-Api-Version']);

    // Closed issue reopens on a newer app version only.
    issues.get(1).state = 'closed';
    const before = calls.length;
    await send(env, good());
    assert.equal(calls.length, before, 'same version does not reopen');
    await send(env, good({ app_version: '2026.12.1' }));
    assert.equal(issues.get(1).state, 'open');

    // Daily cap: reports are counted but not filed.
    const capped = makeEnv({ DAILY_WRITE_CAP: '1' });
    const n0 = calls.length;
    await send(capped, good({ task_type: 'gaps' }));
    await send(capped, good({ task_type: 'choice' }));
    assert.equal(calls.length - n0, 1);
    assert.equal(JSON.parse(capped.store.get('pair:choice:no-handler')).count, 1);

    // Kill switch, rate limit, GitHub failure.
    const n1 = calls.length;
    assert.equal((await send(makeEnv({ DISABLED: '1' }), good())).status, 204);
    assert.equal(calls.length, n1);
    const limited = makeEnv({ RATE_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal((await send(limited, good())).status, 429);
    assert.equal(limited.store.size, 0);
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('down'); };
    const failing = makeEnv();
    assert.equal((await send(failing, good())).status, 204);
    assert.equal(JSON.parse(failing.store.get('pair:audio:no-handler')).count, 1);
    globalThis.fetch = savedFetch;

    assert.ok(validate(good()));
    console.log('relay-test passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
