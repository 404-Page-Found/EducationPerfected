// Electron guests are CDP webview targets. Puppeteer's browser.pages() only
// returns page targets, so it cannot find this app's embedded guest. Wait for
// the guest explicitly, including the first-render race, never the file://
// control window. The app creates exactly one guest in its locked partition.
'use strict';
async function selectEmbeddedPage(browser, { timeout = 10000 } = {}) {
    const target = await browser.waitForTarget(target => target.type() === 'webview', { timeout });
    const page = await target.page();
    if (!page) throw new Error('The embedded browser page is not ready. Retry opening the browser.');
    return page;
}
module.exports = { selectEmbeddedPage };
