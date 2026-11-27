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
            return descriptor && descriptor.get ? descriptor.get.bind(document) : () => undefined;
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
    const wrapped = new WeakMap();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (!listener) return originalAdd.call(this, type, listener, options);
        if (pageOnly(this, type)) return;
        if (this === window && type === 'blur') {
            const wrapper = function (event) { if (event.target !== window) invoke(listener, this, event); };
            wrapped.set(listener, wrapper);
            return originalAdd.call(this, type, wrapper, options);
        }
        return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        const wrapper = listener ? wrapped.get(listener) : undefined;
        return originalRemove.call(this, type, wrapper || listener, options);
    };

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
