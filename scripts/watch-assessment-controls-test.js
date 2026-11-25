const assert = require('node:assert/strict');
(async () => {
    {
        let state = 'stopped', closes = 0;
        const base = { status: () => ({ state }), close: () => { closes++; return Promise.resolve(); } };
        let evals = 0;
        const page = { evaluate: async () => { evals++; return 'sig'; } };
        const { attachAssessmentControls } = require('../lib/assessment-diagnostics');
        const c = attachAssessmentControls(base, page, () => {});
        assert.deepEqual(c.watchAssessment(''), { watching: false, captures: 0 });
        assert.equal(c.watchAssessment('ON').watching, true);
        assert.equal(c.watchAssessment('off').watching, false);
        assert.throws(() => c.watchAssessment('bogus'), /Usage/);
        state = 'running';
        assert.throws(() => c.watchAssessment('on'), /Stop before watching/);
        assert.throws(() => c.inspectAssessment(), /Stop before/);
        state = 'stopped';
        c.watchAssessment('on');
        await c.close();
        assert.equal(c.watchAssessment('status').watching, false, 'close stops the watcher');
        assert.equal(closes, 1);
        const { pageRecorder } = require('../lib/assessment-diagnostics');
        const rec = pageRecorder();
        assert.equal(rec.attach(base), base, 'no page seen: controls unchanged');
        assert.equal(rec.selectPage([page, {}]), page);
    }
    console.log('Watch-assessment controls: on/off/status, usage, busy refusal, close stops watcher passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
(async () => {
    const { armWatchFromEnv } = require('../lib/assessment-diagnostics');
    const calls = [], out = { write: t => calls.push(t) };
    const controls = { watchAssessment: arg => { calls.push('arg:' + arg); return { watching: true, captures: 0 }; } };
    assert.equal(armWatchFromEnv(controls, {}, out), false);
    assert.equal(armWatchFromEnv(controls, { EP_WATCH_ASSESSMENT: '0' }, out), false);
    assert.equal(calls.length, 0);
    assert.equal(armWatchFromEnv(controls, { EP_WATCH_ASSESSMENT: '1 ' }, out), true);
    assert.equal(calls[0], 'arg:on');
    console.log('Watch pre-arm from EP_WATCH_ASSESSMENT passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
