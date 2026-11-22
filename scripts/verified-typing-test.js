'use strict';
// Unit tests for lib/verified-typing.js with a stub page: the desktop app's
// embedded browser silently drops CDP keystrokes, so typing must be verified
// and fall back to a DOM fill.

const assert = require('node:assert/strict');
const { typeVerified } = require('../lib/verified-typing');

const stubPage = ({ typeLands }) => {
    const fields = new Map();
    return {
        calls: [],
        async type(selector, value) {
            this.calls.push(['type', selector, value]);
            if (typeLands) fields.set(selector, value);
        },
        async $eval(selector, fn) {
            this.calls.push(['$eval', selector]);
            return fn({ value: fields.get(selector) || '' });
        },
        async evaluate(fn, selector, value) {
            this.calls.push(['evaluate', selector]);
            if (typeLands) throw new Error('fallback must not run after a successful type');
            fields.set(selector, value);
            // Exercise the real fallback body against a minimal DOM double.
            const el = {
                value: '',
                listeners: [],
                dispatchEvent(event) { this.listeners.push(event.type); },
            };
            const document = { querySelector: css => (css === selector ? el : null) };
            const window = { HTMLInputElement: function () {} };
            Object.defineProperty(window.HTMLInputElement, 'prototype', { value: {} });
            Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
                set(text) { this.value = text; },
            });
            const Event = function (type, opts) { return { type, bubbles: Boolean(opts && opts.bubbles) }; };
            return new Function('document', 'window', 'Event', `return (${fn.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(value)})`)(document, window, Event);
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
        const page = stubPage({ typeLands: false });
        page.evaluate = async () => null;
        await assert.rejects(
            typeVerified(page, '#loginId', 'user@example.com'),
            /did not accept the typed value/);
    }
    console.log('verified-typing tests passed');
})().catch(error => { console.error(error); process.exit(1); });
