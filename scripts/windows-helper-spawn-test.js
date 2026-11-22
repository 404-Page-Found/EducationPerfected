// Inert spawn adapter only. No process or credential store is touched.
'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const cp = require('node:child_process');
const original = cp.spawn;
const child = new EventEmitter();
let unrefs = 0;
child.unref = () => { unrefs++; };
try {
    cp.spawn = (command, args, options) => {
        assert.equal(command, 'inert-helper');
        assert.deepEqual(args, ['inert-argument']);
        assert.deepEqual(options, { stdio: 'ignore', windowsHide: true });
        return child;
    };
    const actual = require('../packaging/windows-helper-spawn').spawnBackgroundHelper('inert-helper', ['inert-argument']);
    assert.equal(actual, child, 'return the ChildProcess, not the undefined result of unref: callers must observe spawn/error');
    assert.equal(unrefs, 1);
} finally { cp.spawn = original; }
console.log('Background helper preserves its child handle and unrefs it exactly once.');
