const assert = require('node:assert/strict');
const { createRunControls } = require('../lib/run-controls');
const { createBrowserControl } = require('../lib/browser-controls');
(async () => {
    let finish, restarts = 0, notified = 0, mode, refreshes = 0;
    const controls = createRunControls({
        run: () => new Promise(resolve => { finish = resolve; }),
        requestStop: () => finish?.(), setMode: value => { mode = value; },
        refresh: () => { refreshes += 1; }, inspect: () => ({ self: true }),
        inspectDash: () => ({ dash: true }), close: () => {},
    });
    controls.setAccuracy = value => ({ accuracy: value });
    controls.delay = value => value === 'bad' ? { error: 'bad range' } : { delay: value || 'off' };
    let restart = false;
    const restartAfterDrain = controls.restartAfterDrain;
    controls.restartAfterDrain = async () => { restarts += 1; return restartAfterDrain(); };
    const call = createBrowserControl({ controls, restartNeeded: () => restart, notify: async () => { notified += 1; } });
    assert.deepEqual(await call('status'), { state: 'stopped', mode: 'auto' });
    assert.equal(notified, 0);
    await call('mode', 'semi'); assert.equal(mode, 'semi');
    await call('refresh'); assert.equal(refreshes, 1);
    assert.deepEqual(await call('accuracy', '82'), { accuracy: '82' });
    await assert.rejects(call('inspect-self-mark'), /Unknown browser control/);
    await assert.rejects(call('inspect-dash'), /Unknown browser control/);
    await assert.rejects(call('inspect-components'), /Unknown browser control/);
    await assert.rejects(call('delay', 'bad'), /bad range/);
    await assert.rejects(call('close'), /Unknown browser control/);
    await assert.rejects(call('__proto__'), /Unknown browser control/);
    await call('start');
    await assert.rejects(call('mode', 'auto'), /Stop/);
    await assert.rejects(call('refresh'), /Stop/);
    await assert.rejects(call('inspect-dash'), /Unknown browser control/);
    restart = true;
    await call('start'); assert.equal(restarts, 1);
    restart = false;
    await call('stop');
    assert.equal(controls.status().state, 'stopped');
    const validation = createBrowserControl({ controls, validationOnly: true });
    for (const [action, value] of [['start'], ['refresh'], ['mode', 'auto'], ['accuracy', '82'], ['delay', 'off'], ['inspect-dash']]) {
        await assert.rejects(validation(action, value), /Validation session/);
    }
    await validation('status'); await validation('accuracy'); await validation('delay');
    await validation('stop');
    console.log('Browser control dispatch: parity, lifecycle guards, restart-after-drain, read-only validation and method allowlist pass.');
})().catch(error => { console.error(error); process.exitCode = 1; });
