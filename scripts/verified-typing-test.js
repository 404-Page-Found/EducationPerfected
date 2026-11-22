'use strict';
// Unit tests for lib/verified-typing.js with a stub page: the desktop app's
// embedded browser silently drops CDP keystrokes, so typing must be verified
// and fall back to a DOM fill. (The DOM-fill body itself is covered by the
// live webview-guest probe; here the control flow is what matters.)

const assert = require('node:assert/strict');
const { typeVerified } = require('../lib/verified-typing');

const stubPage = ({ typeLands, fillLands = true }) => {
    const fields = new Map();
    return {
        calls: [],
        async type(selector, value) {
            this.calls.push(['type', selector]);
            if (typeLands) fields.set(selector, value);
        },
        async $eval(selector, fn) {
            this.calls.push(['$eval', selector]);
            return fn({ value: fields.get(selector) || '' });
        },
        async evaluate(fn, selector, value) {
            this.calls.push(['evaluate', selector]);
            if (fillLands) fields.set(selector, value);
            return fillLands ? true : null;
        },
        value(selector) { return fields.get(selector); },
    };
};

(async () => {
    // Normal browser: typing lands, no fallback needed.
    {
        const page = stubPage({ typeLands: true });
        await typeVerified(page, '#loginId', 'user@example.com');
        assert.deepEqual(page.calls.map(([name]) => name), ['type', '$eval']);
        assert.equal(page.value('#loginId'), 'user@example.com');
    }
    // Embedded webview guest: keystrokes land nothing, the DOM fill rescues.
    {
        const page = stubPage({ typeLands: false });
        await typeVerified(page, '#password', 's3cret!');
        assert.deepEqual(page.calls.map(([name]) => name), ['type', '$eval', 'evaluate']);
        assert.equal(page.value('#password'), 's3cret!');
    }
    // A field that rejects both paths throws instead of submitting empty.
    {
        const page = stubPage({ typeLands: false, fillLands: false });
        await assert.rejects(
            typeVerified(page, '#loginId', 'user@example.com'),
            /did not accept the typed value/);
    }
    console.log('verified-typing tests passed');
})().catch(error => { console.error(error); process.exit(1); });
