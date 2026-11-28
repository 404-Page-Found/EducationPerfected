// Always-focused page environment.
//
// Education Perfect tracks page focus (window blur/pagehide and the Page
// Visibility API) to warn or pause when its window loses focus. A managed run
// must keep answering while the user works in another window, so every task
// page presents itself as focused and visible to page scripts whatever the
// real OS-level state:
//   - document.hasFocus() reports true and the visibility getters report
//     "visible"/false;
//   - page scripts cannot observe window blur/pagehide or visibilitychange:
//     page-level listener registrations for them are dropped (a window blur
//     listener still sees element-level blurs, which carry the element as
//     target, never the window), and the matching on* handlers cannot be
//     assigned, so a real focus loss is never delivered to them;
//   - the genuine platform state stays readable to EducationPerfected itself
//     through window.__epNativeFocus, stashed before the overrides: the
//     dropdown F4 recovery (#397) still probes the real focus when deciding
//     whether to raise the window, and the popup trace keeps recording it.
// Element-level focus handling (form logic on inputs and selects) is
// untouched: only window-level and document-level focus-loss observation is
// blocked.
'use strict';

// Runs inside the page before any page script (evaluateOnNewDocument) and once
// on the current document. Self-contained: no closure references survive
// serialization. Idempotent per document: the guard also keeps a re-install
// from replacing the stashed native probes with already-overridden ones.
function installAlwaysFocusedInPage() {
    if (window.__epAlwaysFocused) return;
    window.__epAlwaysFocused = true;
    if (!window.__epNativeFocus) {
        const nativeGetter = name => {
            const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
            return descriptor?.get ? descriptor.get.bind(document) : () => undefined;
        };
        // Non-writable, non-enumerable, frozen: page scripts cannot overwrite
        // the probes with an assignment or find them by enumerating window.
        // Configurable stays true only so a fresh install on a reused window
        // (never in practice; each document is fresh) could be repaired.
        Object.defineProperty(window, '__epNativeFocus', {
            configurable: true,
            writable: false,
            enumerable: false,
            value: Object.freeze({
                hasFocus: Document.prototype.hasFocus.bind(document),
                visibilityState: nativeGetter('visibilityState'),
                hidden: nativeGetter('hidden'),
            }),
        });
    }

    document.hasFocus = () => true;
    for (const [property, value] of [['visibilityState', 'visible'], ['hidden', false], ['webkitVisibilityState', 'visible'], ['webkitHidden', false]]) {
        Object.defineProperty(document, property, { configurable: true, get: () => value });
    }

    // Page-level focus-loss observation is dropped; everything else registers
    // normally. pagehide and visibilitychange are inherently page-level (the
    // latter bubbles from document to window), so their window and document
    // registrations go. Window blur is filtered at dispatch instead: a
    // capture-phase window listener legitimately observes element blurs, so
    // the wrapper skips only events whose target is the window itself.
    const pageOnly = (target, type) =>
        type === 'pagehide' ? target === window
            : (type === 'visibilitychange' || type === 'webkitvisibilitychange') && (target === window || target === document);
    const invoke = (listener, target, event) => {
        if (typeof listener === 'function') return listener.call(target, event);
        if (listener && typeof listener.handleEvent === 'function') return listener.handleEvent(event);
    };
    // listener -> Map<capture, wrapper>: native registration ignores a repeat
    // of the same callback with the same capture value, and removal matches on
    // both, so the wrapper store is keyed the same way.
    const wrapped = new WeakMap();
    // DOM converts options.capture to a boolean, so the map key does too: a
    // truthy non-boolean capture is the same registration slot as true.
    const captureOf = options => options === true || (options !== null && typeof options === 'object' && Boolean(options.capture));
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (!listener) return originalAdd.call(this, type, listener, options);
        if (pageOnly(this, type)) return;
        if (this === window && type === 'blur') {
            const opts = options && typeof options === 'object' ? options : null;
            // An already-aborted signal makes the registration a native no-op.
            if (opts?.signal?.aborted) return;
            const capture = captureOf(options);
            let byCapture = wrapped.get(listener);
            if (!byCapture) { byCapture = new Map(); wrapped.set(listener, byCapture); }
            if (byCapture.has(capture)) return;
            // once must count accepted deliveries, not suppressed window blurs,
            // so it is registered without once and self-removes on the first
            // element blur it actually passes through.
            const wrapper = opts?.once
                ? event => {
                    if (event.target === window) return;
                    byCapture.delete(capture);
                    originalRemove.call(window, type, wrapper, { capture });
                    invoke(listener, window, event);
                }
                : function (event) { if (event.target !== window) invoke(listener, this, event); };
            byCapture.set(capture, wrapper);
            // An abort removes the native registration; drop the map entry with
            // it, but never a newer registration that reused the same slot.
            opts?.signal?.addEventListener('abort', () => {
                if (byCapture.get(capture) === wrapper) byCapture.delete(capture);
            }, { once: true });
            return originalAdd.call(this, type, wrapper, opts ? { ...opts, once: false } : options);
        }
        return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        // Only window blur registrations were wrapped; substitute the wrapper
        // there and there alone, matching removal on the same capture value.
        if (this === window && type === 'blur' && listener) {
            const capture = captureOf(options);
            const wrapper = wrapped.get(listener)?.get(capture);
            if (wrapper) {
                wrapped.get(listener).delete(capture);
                return originalRemove.call(this, type, wrapper, options);
            }
        }
        return originalRemove.call(this, type, listener, options);
    };

    // In Blink the on* accessors on body and frameset are aliases that write
    // the window handler map directly (verified: body.onblur and body.onpagehide
    // both fire on window-dispatched events), bypassing the window properties
    // above. Swallow them on their prototypes the same way.
    for (const proto of [window.HTMLBodyElement?.prototype, window.HTMLFrameSetElement?.prototype]) {
        if (!proto) continue;
        for (const property of ['onblur', 'onpagehide']) {
            Object.defineProperty(proto, property, { configurable: true, get: () => null, set: () => { } });
        }
    }
    // The matching content attributes (<body onblur=...>, setAttribute) compile
    // handlers without touching those accessors. setAttribute is intercepted;
    // anything else that plants the attribute (parser, setAttributeNode) is
    // stripped by observation - removing the content attribute deactivates the
    // compiled handler.
    const aliasAttribute = (target, name) =>
        (name === 'onblur' || name === 'onpagehide') && target instanceof Element &&
        (target.tagName === 'BODY' || target.tagName === 'FRAMESET');
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (aliasAttribute(this, String(name).toLowerCase())) return;
        return originalSetAttribute.call(this, name, value);
    };
    const stripAliasAttributes = () => {
        for (const el of document.querySelectorAll('body[onblur],body[onpagehide],frameset[onblur],frameset[onpagehide]')) {
            el.removeAttribute('onblur');
            el.removeAttribute('onpagehide');
        }
    };
    // The install runs before parsing, so the root element may not exist yet:
    // observe the document itself and strip once parsing finishes.
    new MutationObserver(records => {
        for (const record of records) {
            if (aliasAttribute(record.target, record.attributeName)) record.target.removeAttribute(record.attributeName);
        }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['onblur', 'onpagehide'] });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stripAliasAttributes, { once: true });
    else stripAliasAttributes();

    // The matching on* handler properties are swallowed the same way:
    // assignments do nothing and reads report no handler.
    for (const [target, property] of [[window, 'onblur'], [window, 'onpagehide'], [document, 'onvisibilitychange'], [document, 'onwebkitvisibilitychange']]) {
        Object.defineProperty(target, property, { configurable: true, get: () => null, set: () => { } });
    }
}

/**
 * Installs the always-focused environment on every future document of the page
 * and on the current one.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function installAlwaysFocused(page) {
    await page.evaluateOnNewDocument(installAlwaysFocusedInPage);
    await page.evaluate(installAlwaysFocusedInPage).catch(() => { });
}

module.exports = { installAlwaysFocused, installAlwaysFocusedInPage };
