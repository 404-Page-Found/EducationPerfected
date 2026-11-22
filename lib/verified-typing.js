// Typing that proves the text landed. In the desktop app's embedded browser
// (a Chromium webview guest) synthetic keyboard events dispatched over CDP
// never reach the page: page.type resolves, the focused element even changes,
// but the field stays empty (verified live against EP's login page: the value
// read back as "" after typing, while mouse clicks did submit). Real Chrome
// (the terminal CLI's browser) is unaffected, so type first and verify; when
// the value did not land, set it through the DOM with the native setter and
// bubbling input/change events, which the page's own scripts accept.
'use strict';

// Reads the field after typing and falls back to a DOM fill when the
// keystrokes did not land. Throws when neither path produces the value:
// submitting a half-filled credential form is worse than naming the failure.
async function typeVerified(page, selector, value) {
    await page.type(selector, value);
    const typed = await page.$eval(selector, el => el.value).catch(() => null);
    if (typed === value) return;
    const filled = await page.evaluate((css, text) => {
        const el = document.querySelector(css);
        if (!el) return null;
        // The native setter bypasses a framework's value property override;
        // the events let its change tracking see the fill.
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value === text;
    }, selector, value).catch(() => null);
    if (filled !== true) {
        throw new Error(`The field ${selector} did not accept the typed value in this browser.`);
    }
}

module.exports = { typeVerified };
