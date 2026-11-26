// Relay fixture tests with an in-memory KV and a mocked GitHub fetch. No network.
const assert = require('node:assert/strict');
const { TASK_TYPES: APP_TYPES, REASONS: APP_REASONS, BRANCHES: APP_BRANCHES, GAME_MODES: APP_GAME_MODES, COMPONENT_CODES: APP_CODES, CONTROL_KEYS: APP_CONTROLS } = require('../lib/support-report');
const { REPORTABLE_REASONS } = require('../lib/support-sender');

const byName = (a, b) => a.localeCompare(b);

(async () => {
    const { default: worker, Pair, Cap, TASK_TYPES, REASONS, validate, BRANCHES, GAME_MODES, COMPONENT_CODES, CONTROL_KEYS, pairKey } = await import('../relay/worker.mjs');
    // Relay allow-lists stay in step with the app.
    assert.deepEqual([...TASK_TYPES].filter(t => t !== 'unknown').sort(byName), [...APP_TYPES].sort(byName));
    assert.deepEqual([...REASONS].sort(byName), [...REPORTABLE_REASONS].sort(byName));
    assert.ok([...APP_REASONS].includes('other'));
    assert.deepEqual([...BRANCHES].sort(byName), [...APP_BRANCHES].sort(byName));
    assert.deepEqual([...GAME_MODES].sort(byName), [...APP_GAME_MODES].sort(byName));
    assert.deepEqual([...COMPONENT_CODES].sort(byName), [...APP_CODES].sort(byName));
    assert.deepEqual([...CONTROL_KEYS].sort(byName), [...APP_CONTROLS].sort(byName));

    // In-memory stand-ins for KV (`store`) and the two Durable Object namespaces (`durable`, kept
    // separate so a broken KV fallback cannot pass). Records are JSON under the pair name.
    function makeEnv(extra = {}) {
        const store = new Map();
        const durable = new Map();
        const namespace = make => {
            const instances = new Map();
            return {
                idFromName: name => name,
                get(name) {
                    if (!instances.has(name)) {
                        const slot = k => (k === 'rec' ? name : `${name}/${k}`);
                        const state = { storage: {
                            async get(k) { return durable.has(slot(k)) ? JSON.parse(durable.get(slot(k))) : undefined; },
                            async put(k, v) { durable.set(slot(k), JSON.stringify(v)); },
                        } };
                        instances.set(name, make(state));
                    }
                    const instance = instances.get(name);
                    return { fetch: request => instance.fetch(request) };
                },
            };
        };
        const env = {
            store,
            durable,
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
        env.PAIRS = namespace(state => new Pair(state, env));
        env.CAP = namespace(state => new Cap(state, env));
        return env;
    }
    const calls = [];
    const issues = new Map();
    let nextIssue = 1;
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        const method = options.method || 'GET';
        const m = url.match(/\/issues(?:\/(\d+))?$/);
        if (method === 'POST') { await new Promise(r => setTimeout(r, 5)); const n = nextIssue++; issues.set(n, { state: 'open', ...JSON.parse(options.body) }); return { ok: true, json: async () => ({ number: n }) }; }
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
    assert.equal(env.store.size + env.durable.size, 0);

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
    const everything = JSON.stringify(calls.map(c => ({ u: c.url, b: c.options.body }))) + JSON.stringify([...env.store.entries(), ...env.durable.entries()]);
    for (const leak of ['203.0.113.9', 'secret-agent']) assert.ok(!everything.includes(leak), `leaked ${leak}`);
    assert.deepEqual(Object.keys(calls[0].options.headers).sort(byName), ['Accept', 'Authorization', 'Content-Type', 'User-Agent', 'X-GitHub-Api-Version']);

    // Closed issue reopens on a newer app version only.
    issues.get(1).state = 'closed';
    const before = calls.length;
    await send(env, good());
    assert.equal(calls.length, before, 'same version does not reopen');
    await send(env, good({ app_version: '2026.12.1' }));
    assert.equal(issues.get(1).state, 'open');

    // Two reports for a new pair arriving together file one issue and count both.
    const race = makeEnv();
    const r0 = calls.length;
    await Promise.all([send(race, good({ task_type: 'typed' })), send(race, good({ task_type: 'typed' }))]);
    assert.equal(calls.length - r0, 1, 'concurrent reports file one issue');
    assert.equal(JSON.parse(race.durable.get('pair:typed:no-handler')).count, 2);

    // A record left in KV by the old code is picked up on the first report.
    const migrated = makeEnv();
    migrated.store.set('pair:text:no-handler', JSON.stringify({ issue: 7, count: 4, maxVersion: '2026.11.22' }));
    await send(migrated, good({ task_type: 'text', app_version: '2026.11.22' }));
    assert.equal(JSON.parse(migrated.durable.get('pair:text:no-handler')).count, 5);
    assert.equal(calls.length, r0 + 1, 'migrated record has an issue, so no new one is filed');

    // Daily cap: reports are counted but not filed.
    const capped = makeEnv({ DAILY_WRITE_CAP: '1' });
    const n0 = calls.length;
    await send(capped, good({ task_type: 'gaps' }));
    await send(capped, good({ task_type: 'choice' }));
    assert.equal(calls.length - n0, 1);
    assert.equal(JSON.parse(capped.durable.get('pair:choice:no-handler')).count, 1);

    // Detailed report: the shape of an unsupported round. One issue per refusal branch, shapes listed in the body.
    const detail = (over = {}) => JSON.stringify({
        task_type: 'unsupported', reason: 'unsupported-question', app_version: '2026.11.27', schema: 1,
        branch: 'generic-slide', game_mode: 'lesson', question_type: 9, component_count: 1,
        components: ['FILE_UPLOADER_COMPONENT'], controls: { inputs: 1, textareas: 0, selects: 0, editable: 0, canvases: 0, buttons: 2 }, ...over,
    });
    const v2 = makeEnv();
    const d0 = calls.length;
    assert.equal((await send(v2, detail())).status, 204);
    assert.equal(calls.length - d0, 1);
    const detailIssue = JSON.parse(calls.at(-1).options.body);
    assert.equal(detailIssue.title, 'Task support: unsupported not handled (unsupported-question, generic-slide)');
    assert.match(detailIssue.body, /branch \w[\w-]*, game mode lesson, question type 9, 1 components \(FILE_UPLOADER_COMPONENT\), controls buttons 2, canvases 0, editable 0, inputs 1, selects 0, textareas 0/);
    assert.ok(v2.durable.has('pair:unsupported:unsupported-question:generic-slide'));
    assert.equal((await send(v2, detail())).status, 204);
    assert.equal(calls.length - d0, 1, 'same shape only counts');
    await send(v2, detail({ question_type: 12 }));
    assert.equal(calls.length - d0, 2, 'a new shape refreshes the body');
    assert.match([...issues.values()].at(-1).body, /x2: branch [\w-]+, game mode lesson, question type 9/);
    assert.match([...issues.values()].at(-1).body, /x1: branch [\w-]+, game mode lesson, question type 12/);
    await send(v2, detail({ branch: 'dash' }));
    assert.equal(calls.length - d0, 3, 'a different branch files its own issue');
    assert.equal(pairKey({ task_type: 'unsupported', reason: 'unsupported-question' }), 'pair:unsupported:unsupported-question', 'schema 1 key is unchanged');
    const badDetail = [
        detail({ branch: 'free text' }), detail({ game_mode: 'mode 4' }), detail({ question_type: 'nine' }), detail({ question_type: 100 }), detail({ question_type: -2 }), detail({ component_count: 1.5 }), detail({ controls: { inputs: 100, textareas: 0, selects: 0, editable: 0, canvases: 0, buttons: 0 } }), detail({ question_type: null }),
        detail({ components: ['What is the French for dog'] }), detail({ components: new Array(9).fill('DEPTH_COMPONENT') }),
        detail({ controls: { inputs: 1 } }), detail({ controls: { inputs: 1, textareas: 0, selects: 0, editable: 0, canvases: 0, buttons: 0, text: 1 } }),
        detail({ extra: 1 }), detail({ task_type: 'audio' }), detail({ reason: 'no-handler' }),
        JSON.stringify({ ...JSON.parse(detail()), branch: undefined }), detail({ components: 'FILE_UPLOADER_COMPONENT' }),
    ];
    for (const body of badDetail) assert.equal(validate(body), null, `rejected ${body.slice(0, 60)}`);
    assert.ok(validate(detail()));
    assert.ok(new TextEncoder().encode(detail({ components: new Array(8).fill('TYPE_SUBSCRIPT_SUPERSCRIPT_COMPONENT') })).length < 1024, 'largest report fits the cap');

    // Kill switch, rate limit, GitHub failure.
    const n1 = calls.length;
    assert.equal((await send(makeEnv({ DISABLED: '1' }), good())).status, 204);
    assert.equal(calls.length, n1);
    const limited = makeEnv({ RATE_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal((await send(limited, good())).status, 429);
    assert.equal(limited.store.size + limited.durable.size, 0);
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('down'); };
    const failing = makeEnv();
    assert.equal((await send(failing, good())).status, 204);
    assert.equal(JSON.parse(failing.durable.get('pair:audio:no-handler')).count, 1);
    globalThis.fetch = savedFetch;

    assert.ok(validate(good()));
    console.log('relay-test passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
