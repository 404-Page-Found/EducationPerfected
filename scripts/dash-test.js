// Dash support (issue #237): shared classic selectors plus provisional timed
// sprint chrome. Unit + synthetic CLI coverage only; no live Dash capture.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer, WORDS } = require('./mock-ep');
const {
  DASH_TIMER_CSS,
  DASH_SCORE_CSS,
  DASH_RESULTS_CSS,
  DASH_PACING_NOTE,
  DASH_ACCURACY_NOTE,
  DASH_EMPTY_WORDLIST_NOTE,
  detectDashInPage,
  isDashPage,
  isDashCompletion,
} = require('../lib/dash');
const { bootCli, fixtureLogin } = require('./cli-test-harness');
const { cleanupTestProcess } = require('./test-process-cleanup');

(async () => {
  // Unit: constants and in-page predicate shape.
  assert.equal(DASH_TIMER_CSS, '.dash-timer');
  assert.equal(DASH_SCORE_CSS, '.dash-score');
  assert.equal(DASH_RESULTS_CSS, '.dash-results');
  assert.ok(DASH_PACING_NOTE.includes('text 2-6s') && DASH_PACING_NOTE.includes('delay off'));
  assert.ok(DASH_ACCURACY_NOTE.includes('perfect') && DASH_ACCURACY_NOTE.toLowerCase().includes('dash'));
  assert.ok(DASH_EMPTY_WORDLIST_NOTE.toLowerCase().includes('timed') && DASH_EMPTY_WORDLIST_NOTE.includes('word lists'));
  assert.equal(typeof detectDashInPage, 'function');
  // The in-page predicate must stay self-contained (runs inside evaluate).
  assert.ok(!detectDashInPage.toString().includes('require('), 'detectDashInPage must not close over modules');
  console.log('  ok  Dash constants and guidance text');

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'shell', defaultViewport: null, handleSIGINT: false });
    const page = await browser.newPage();

    // Fixture audit: Dash starter shares the classic word-list selectors.
    await page.goto(`${origin}/dash-task`, { waitUntil: 'domcontentloaded' });
    const base = await page.$$eval('div.baseLanguage span', (els) => els.map((el) => el.innerText));
    const target = await page.$$eval('div.targetLanguage span', (els) => els.map((el) => el.innerText));
    assert.deepEqual(base, WORDS.map((w) => w[0]));
    assert.deepEqual(target, WORDS.map((w) => w[1]));
    console.log('  ok  Dash starter shares div.baseLanguage/div.targetLanguage');

    // Fixture audit: Dash round shares #question-text + input#answer-text and
    // adds the provisional timed chrome.
    await page.goto(`${origin}/dash-task/play`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.$eval('#question-text', (el) => el.textContent), 'one');
    assert.ok(await page.$eval('#answer-text', (el) => el.tagName === 'INPUT'));
    assert.ok(await page.$eval(DASH_TIMER_CSS, (el) => !el.hidden && el.textContent.trim() !== ''));
    assert.equal(await page.$eval(DASH_SCORE_CSS, (el) => el.textContent), '0');
    assert.equal(await page.$eval(DASH_RESULTS_CSS, (el) => el.hidden), true);
    console.log('  ok  Dash round shares classic selectors plus timer/score/results');

    // Detection: Dash play is Dash, classic play is not.
    assert.equal(await isDashPage(page), true);
    await page.goto(`${origin}/task/play`, { waitUntil: 'domcontentloaded' });
    assert.equal(await isDashPage(page), false);
    assert.equal(await isDashCompletion(page), false);
    await page.goto(`${origin}/dash-task/play`, { waitUntil: 'domcontentloaded' });
    assert.equal(await isDashCompletion(page), false);
    console.log('  ok  Dash detection distinguishes sprint from classic');

    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Integration: real CLI answers the Dash sprint end to end (shared loop).
  {
    const cliServer = createServer();
    await new Promise((resolve) => cliServer.listen(0, '127.0.0.1', resolve));
    const cliOrigin = `http://127.0.0.1:${cliServer.address().port}`;
    const { child, wait, command, output } = bootCli(cliOrigin);
    let cliBrowser;
    try {
      const login = await fixtureLogin(wait, output);
      cliBrowser = login.browser;
      const page = login.page;
      await wait(() => output().includes('Commands: start'));
      await page.goto(`${cliOrigin}/dash-task`);
      await command('refresh', 'Word Lists Refreshed. 5 entries');
      await page.goto(`${cliOrigin}/dash-task/play`);
      await command('start', '"state":"running"');
      await wait(() => output().includes('Dash sprint detected'));
      assert.ok(output().includes('text 2-6s'), 'Dash pacing note must name the shared text range');
      assert.ok(output().includes('perfect for this Dash sprint'), 'default perfect Dash accuracy note expected');
      await wait(() => output().includes('answerLoop Exited.'), 15000);
      await command('status', '"state":"completed"');
      // Completion proves both the shared exit control and the provisional
      // results interstitial: the run clicked exit after the results showed.
      assert.ok(output().includes('"reason":"completed"') || output().includes('"state":"completed"'));
      console.log('  ok  Real CLI completes the Dash sprint with Dash-aware logging');
    } finally {
      if (cliBrowser) await cliBrowser.close().catch(() => {});
      try { cleanupTestProcess(child); } catch {}
      cliServer.close();
    }
    server.close();
  }

  // Empty-list rule: no word lists reports loudly with the Dash timed cost,
  // instead of silently mistyping the sprint.
  assert.ok(
    DASH_EMPTY_WORDLIST_NOTE.includes('modal') || DASH_EMPTY_WORDLIST_NOTE.toLowerCase().includes('clock'),
    'empty-list note must call out the timed-sprint cost'
  );
  console.log('  ok  Dash empty-list guidance names the timed cost');

  console.log('Dash: shared selectors, timer/score/results fixture, detection, real-CLI sprint completion PASS. Synthetic only.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
