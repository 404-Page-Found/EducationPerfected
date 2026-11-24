const assert = require('node:assert/strict');
const { createRunControls } = require('../lib/run-controls');
(async () => {
    {
        let on = false, startCalls = 0, stopCalls = 0;
        const watcher = { start: () => { startCalls++; on = true; return true; }, stop: () => { stopCalls++; on = false; }, running: () => on, captures: () => 3 };
        let release;
        const watched = createRunControls({ run: () => new Promise(r => { release = r; }), requestStop: () => {}, setMode: () => {}, refresh: () => {}, assessmentWatcher: watcher, close: () => {} });
        assert.deepEqual(watched.watchAssessment(''), { watching: false, captures: 3 });
        assert.deepEqual(watched.watchAssessment('ON'), { watching: true, captures: 3 });
        assert.deepEqual(watched.watchAssessment('off'), { watching: false, captures: 3 });
        assert.throws(() => watched.watchAssessment('bogus'), /Usage/);
        watched.start(); await Promise.resolve();
        assert.throws(() => watched.watchAssessment('on'), /Stop before watching/);
        assert.equal(startCalls, 1);
        release(); await watched.stop();
        watcher.start(); await watched.close(); assert.equal(stopCalls >= 2, true, 'close stops the watcher');
        const none = createRunControls({ run: () => {}, requestStop: () => {}, setMode: () => {}, refresh: () => {}, close: () => {} });
        assert.throws(() => none.watchAssessment('on'), /unavailable/);
    }
    console.log('Watch-assessment controls: on/off/status, usage, busy refusal, close stops watcher passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
