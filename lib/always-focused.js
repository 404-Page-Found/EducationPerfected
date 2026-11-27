// Always-focused page environment.
//
// Education Perfect tracks page focus (window blur/pagehide and the Page
// Visibility API) to warn or pause when its window loses focus. A managed run
// must keep answering while the user works in another window, so every task
// page presents itself as focused and visible to page scripts whatever the
// real OS-level state:
//   - document.hasFocus() reports true and the visibility getters report
//     "visible"/false;
//   - page scripts cannot register window blur/pagehide or document
//     visibilitychange listeners, nor assign the matching on* handlers, so a
//     real focus loss is never delivered to them;
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
        window.__epNativeFocus = Object.freeze({
            hasFocus: Document.prototype.hasFocus.bind(document),
            visibilityState: nativeGetter('visibilityState'),
            hidden: nativeGetter('hidden'),
        });
    }

    document.hasFocus = () => true;
    for (const [property, value] of [['visibilityState', 'visible'], ['hidden', false], ['webkitVisibilityState', 'visible'], ['webkitHidden', false]]) {
        Object.defineProperty(document, property, { configurable: true, get: () => value });
    }

    // Listener registration for page-level focus-loss signals is dropped;
    // everything else (including element-level blur) registers normally.
    // Removal passes through: removing what was never added is already a no-op.
    const blocked = (target, type) =>
        (target === window && (type === 'blur' || type === 'pagehide')) ||
        (target === document && (type === 'visibilitychange' || type === 'webkitvisibilitychange'));
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (blocked(this, type)) return;
        return originalAdd.call(this, type, listener, options);
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
