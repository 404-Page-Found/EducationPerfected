const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');

// Shared harness for the composed slide-surfaces suites so the test files
// carry only their surface-specific assertions.
async function bootComposedSlide(route) {
    const server = createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = await puppeteer.launch({ headless: true, executablePath: process.env.HANDLER_EXECUTABLE_PATH || undefined });
    const page = await browser.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
    const close = async () => { try { await browser.close(); } finally { await new Promise(r => server.close(r)); } };
    return {
        page,
        setup: () => page.goto(origin + route),
        detect: () => detectQuestion(page),
        close,
    };
}

// Arms a mutation to run inside the page when the multi surface's click
// count reaches clickCount, then plays the round and returns its result.
// The mutation callback is serialized; it runs in page context only.
async function playTamperedRound(page, setup, detect, round, clickCount, mutation) {
    await setup();
    const d = await detect();
    await page.evaluate(({ clickCount, source }) => {
        multiFixture.mutateOnClick = () => {
            if (multiFixture.clicks.length !== clickCount) return;
            (0, eval)(source)();
        };
    }, { clickCount, source: mutation.toString() });
    return round(d);
}

module.exports = { bootComposedSlide, playTamperedRound };
