// Smoke test for the pinned Puppeteer setup: launches (or connects to) a browser and
// drives the EP mock in scripts/mock-ep.js through the same Puppeteer APIs index.js
// relies on. It does not run index.js itself (that would need EP credentials), so it
// validates the dependency setup, not the live site.
//
//   node scripts/smoke-test.js                 launch the browser Puppeteer manages
//   SMOKE_EXECUTABLE_PATH=/path/to/chrome node scripts/smoke-test.js
//                                              launch a browser you already have
//   SMOKE_BROWSER_URL=http://127.0.0.1:9222 node scripts/smoke-test.js
//                                              drive an already-running browser
//
// Exits 0 when every check passes.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { execFileSync } = require('node:child_process');
const { createServer, WORDS } = require('./mock-ep');

const CHECKS = [];
function check(name) {
    CHECKS.push(name);
    console.log(`  ok  ${name}`);
}

async function loginAndReachDashboard(page, origin) {
    await page.goto(`${origin}/app/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginId', { timeout: 5000 });
    const buttons = await page.$$('button');
    let loginButton = null;
    for (const handle of buttons) {
        const label = await handle.evaluate(el => (el.closest('form') ? el.innerText.trim() : null));
        if (label === 'Log in') loginButton = handle;
        else await handle.dispose();
    }
    assert.ok(loginButton, 'login button resolved by label');
    check('waitForSelector + $$ + ElementHandle.evaluate');

    await page.type('#loginId', 'someone@example.com');
    await page.type('#password', 'not-a-real-password');
    const fields = await page.evaluate((u, p) => {
        const user = document.querySelector(u);
        const pass = document.querySelector(p);
        return { user: user && user.value, pass: pass && pass.value, enabled: !user.disabled && !pass.disabled };
    }, '#loginId', '#password');
    assert.equal(fields.user, 'someone@example.com');
    assert.equal(fields.pass, 'not-a-real-password');
    check('page.type fills the login fields');

    const navigation = page.waitForNavigation({ timeout: 5000 }).catch(() => null);
    await loginButton.click();
    await navigation;
    await page.waitForSelector('main #single-spa-application\\:mfeGlobalNavigation\\:Tertiary', { timeout: 5000 });
    check('ElementHandle.click navigates, escaped #home_css selector matches');
}

async function readWordLists(page, origin) {
    await page.goto(`${origin}/task`, { waitUntil: 'domcontentloaded' });
    const readList = selector => page.$$eval(selector, els => els.map(el => el.innerText));
    const base = await readList('div.baseLanguage span');
    const target = await readList('div.targetLanguage span');
    assert.deepEqual(base, WORDS.map(w => w[0]));
    assert.deepEqual(target, WORDS.map(w => w[1]));
    check('$$eval reads the word lists');
}

async function testWrongAnswerModal(page) {
    await page.keyboard.type('wrong', { delay: 20 });
    assert.equal(await boxValue(), 'wrong');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[uib-modal-window=modal-window]', { timeout: 2000 });
    assert.equal(await page.$eval('#correct-answer-field', el => el.textContent), 'eins');
    check('keyboard.type/press + modal waitForSelector');

    await page.waitForFunction((q, a) => {
        const question = document.querySelector(q);
        const answer = document.querySelector(a);
        return !!question && !!answer && question.textContent.trim() !== '' && answer.textContent.trim() !== '';
    }, { timeout: 2000 }, '#question-field', '#correct-answer-field');
    check('waitForFunction reads the correction');

    const continued = await page.evaluate(css => {
        const button = document.querySelector(css);
        if (!button) return false;
        button.disabled = false;
        button.click();
        return true;
    }, '#continue-button');
    assert.equal(continued, true);
    await page.waitForFunction(() => document.querySelectorAll('[uib-modal-window]').length === 0, { timeout: 2000 });
    check('evaluate re-enables and clicks Continue');
}

async function testCorrectAnswers(page) {
    // Wait for the next question to appear after the modal is dismissed
    await page.waitForFunction(expected => document.querySelector('#question-text').textContent === expected,
        { timeout: 2000 }, WORDS[1][0]);

    for (const [base, answer] of WORDS.slice(1)) {
        const last = base === WORDS[WORDS.length - 1][0];
        assert.equal(await question(), base);
        await clearBox();
        await page.keyboard.type(answer, { delay: 20 });
        assert.equal(await boxValue(), answer);
        await page.keyboard.press('Enter');

        const advanced = await page.waitForFunction(isLast => {
            const questionEl = document.querySelector('#question-text');
            if (document.querySelectorAll('[uib-modal-window]').length > 0) return false;
            if (isLast) return questionEl === null && !document.querySelector('#answer-text');
            return questionEl !== null && questionEl.textContent !== '';
        }, { timeout: 2000 }, last).then(() => true).catch(() => false);

        assert.ok(advanced, last
            ? `round "${answer}" is the last one and reaches the completion state`
            : `round "${answer}" advances`);
    }
    check(`typed answers advance all ${WORDS.length} rounds`);
}

async function testCompletionExit(page, origin) {
    // Completion state: the question disappears and the exit button is clickable.
    assert.equal(await boxValue(), null);
    await page.waitForSelector('button.exit-button', { timeout: 2000 });
    const exit = await page.$('button.exit-button');
    const exitNav = page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => null);
    await exit.click();
    await exitNav;
    // After clicking Exit, we should be on the dashboard (main with the shell selector).
    await page.waitForSelector('main #single-spa-application\\:mfeGlobalNavigation\\:Tertiary', { timeout: 2000 });
    check('completion exit button resolves and clicks to dashboard');
}


async function readDashWordLists(page, origin) {
    // Classic Dash starter shares the word-list selectors (issue #230): the same
    // div.baseLanguage / div.targetLanguage markup as /task, so a classic timed
    // entry with no lists strands the run on modal-only learning. Captured Dash
    // choice/typed rounds do not use word lists (shipped answer or refusal).
    await page.goto(origin + '/dash-task', { waitUntil: 'domcontentloaded' });
    const readList = selector => page.$$eval(selector, els => els.map(el => el.innerText));
    const base = await readList('div.baseLanguage span');
    const target = await readList('div.targetLanguage span');
    assert.deepEqual(base, WORDS.map(w => w[0]));
    assert.deepEqual(target, WORDS.map(w => w[1]));
    check('$$eval reads the Dash word lists (shared selectors)');
}

async function driveDashSprint(page, origin, { route, label, rounds, totalLabel, shapeCheck }) {
    // Shared timed-sprint driver for the classic/typed Dash reconstructions
    // (issue #230): the classic selectors (#question-text + input#answer-text,
    // shared wrong-answer modal, timer/score/results chrome) with per-round
    // typing. A single copy avoids duplicating the sprint flow across variants.
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    assert.equal(await question(), 'one');
    check(`${label}: $eval reads the shared question`);
    if (shapeCheck) await shapeCheck();
    const timer = await page.$eval('.dash-timer', el => ({ text: el.textContent, hidden: el.hidden }));
    assert.ok(timer && !timer.hidden && timer.text.trim() !== '', `${label} timer must be visible during the sprint`);
    const timerStart = timer.text.trim();
    assert.equal(await page.$eval('.dash-score', el => el.textContent), '0');
    check(`${label}: timer countdown and score readout are present`);
    // Wrong answer still shows the shared correction modal on Dash.
    await page.keyboard.type('wrong', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.waitForSelector('[uib-modal-window=modal-window]', { timeout: 2000 });
    assert.equal(await page.$eval('#correct-answer-field', el => el.textContent), 'eins');
    // A wrong sprint answer must not increment the timed score.
    assert.equal(await page.$eval('.dash-score', el => el.textContent), '0', `${label} score stays 0 after a wrong answer`);
    check(`${label}: wrong answer shows the shared correction modal without scoring`);
    const continued = await page.evaluate(css => {
        const button = document.querySelector(css);
        if (!button) return false;
        button.disabled = false;
        button.click();
        return true;
    }, '#continue-button');
    assert.equal(continued, true);
    await page.waitForFunction(() => document.querySelectorAll('[uib-modal-window]').length === 0, { timeout: 2000 });
    check(`${label}: correction modal dismisses via Continue`);
    await page.waitForFunction(expected => document.querySelector('#question-text').textContent === expected, { timeout: 2000 }, WORDS[1][0]);
    // The sprint clock must tick while the run answers: a frozen timer would
    // still pass the presence check above, so require a decrement.
    await page.waitForFunction(start => {
        const el = document.querySelector('.dash-timer');
        return el && el.textContent.trim() !== start;
    }, { timeout: 4000 }, timerStart);
    const timerAfter = await page.$eval('.dash-timer', el => el.textContent.trim());
    assert.ok(Number.parseInt(timerAfter, 10) < Number.parseInt(timerStart, 10), `${label} timer must decrement during the sprint, got ${timerStart} -> ${timerAfter}`);
    check(`${label}: timer decrements during the sprint (${timerStart} -> ${timerAfter})`);
    let expectedScore = 0;
    const lastBase = rounds[rounds.length - 1][0];
    for (const [base, answer] of rounds) {
        const last = base === lastBase;
        assert.equal(await question(), base);
        await clearBox();
        await page.keyboard.type(answer, { delay: 20 });
        await page.keyboard.press('Enter');
        const advanced = await page.waitForFunction(isLast => {
            const questionEl = document.querySelector('#question-text');
            if (document.querySelectorAll('[uib-modal-window]').length > 0) return false;
            if (isLast) return questionEl === null && !document.querySelector('#answer-text');
            return questionEl !== null && questionEl.textContent !== '';
        }, { timeout: 2000 }, last).then(() => true).catch(() => false);
        assert.ok(advanced, last ? `${label}: last round reaches the results state` : `${label}: round "` + answer + '" advances');
        expectedScore += 1;
        assert.equal(await page.$eval('.dash-score', el => el.textContent), String(expectedScore), `${label} score must be ${expectedScore} after correct answer "${answer}"`);
    }
    check(`${label}: typed answers advance ${totalLabel} with scoring`);
    assert.equal(await boxValue(), null);
    await page.waitForSelector('.dash-results:not([hidden])', { timeout: 2000 });
    const resultsText = await page.$eval('.dash-results', el => el.textContent);
    assert.ok(resultsText.includes('Dash complete'), `${label} results interstitial must name the sprint, got: ` + resultsText);
    check(`${label}: results interstitial appears at sprint end`);
    await page.waitForSelector('button.exit-button', { timeout: 2000 });
    const exit = await page.$('button.exit-button');
    const exitNav = page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => null);
    await exit.click();
    await exitNav;
    await page.waitForSelector('main #single-spa-application\\:mfeGlobalNavigation\\:Tertiary', { timeout: 2000 });
    check(`${label}: completion exit button resolves and clicks to dashboard`);
}

async function testDashSprint(page, origin) {
    // Dash classic reconstruction (issue #230): synthetic full-sprint test sharing the
    // classic selectors, with fixture-invented timer, score and results.
    // The captured Dash shapes below are the live-grounded coverage.
    await driveDashSprint(page, origin, {
        route: '/dash-task/play',
        label: 'Dash',
        rounds: WORDS.slice(1),
        totalLabel: 'all ' + WORDS.length + ' sprint rounds',
    });
}

async function testDashTypedSprint(page, origin) {
    // Dash typed sprint (issue #230, #272-captured shape): QuizModel with
    // isDash, #question-text + input#answer-text, one Submit button, no choice
    // or speaker markup, plus the shared wrong-answer modal and completion
    // controls. The timer/score/results chrome stays fixture-invented.
    await driveDashSprint(page, origin, {
        route: '/dash-task/typed',
        label: 'Dash typed',
        rounds: WORDS.slice(1, 3),
        totalLabel: 'all 3 sprint rounds',
        shapeCheck: async () => {
            assert.equal(await page.$$eval('button.submit-button',
                els => els.filter(el => !el.hidden && el.offsetParent !== null).length), 1);
            assert.equal(await page.$('.multi-choice-component'), null);
            assert.equal(await page.$('.voice-speaker'), null);
            check('Dash typed: one Submit button, no choice or speaker markup');
        },
    });
}

async function testDashQuizSprint(page, origin) {
    // Dash choice sprint (issue #230, 2026-11-19 live capture): one
    // single-select multi-choice component on EP's QuizModel (isDash true),
    // one Submit button, no classic question/answer-text markup. The correct
    // option is read from EP's own shipped question state (the same source the
    // CLI reader uses), never hardcoded: the fixture only models the captured
    // structure, and the timer stays fixture-invented.
    await page.goto(`${origin}/dash-task/quiz`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.$('#question-text'), null);
    assert.equal(await page.$('#answer-text'), null);
    assert.equal(await page.$('.voice-speaker'), null);
    check('Dash choice: no classic question/box or speaker markup');
    assert.equal(await page.$$eval('.multi-choice-component', els => els.length), 1);
    const optionCount = await page.$$eval('.multi-choice-component .mcq-preview-option', els => els.length);
    assert.equal(optionCount, 4);
    assert.equal(await page.$$eval('button.submit-button',
        els => els.filter(el => !el.hidden && el.offsetParent !== null).length), 1);
    const timer = await page.$eval('#dash-timer', el => el.textContent.trim());
    assert.ok(timer !== '', 'Dash choice timer must be present during the sprint');
    assert.equal(await page.$eval('.quiz-score', el => el.textContent), '0');
    check('Dash choice: one 4-option group, one Submit button, timer and score present');
    for (let round = 0; round < 3; round += 1) {
        const last = round === 2;
        const correct = await page.evaluate(() => {
            const self = window.angular.element(document.body).scope().self;
            const options = self.model._currentQuestion.questionDef.Components[0].Options;
            return options.find(o => o.Correct === 'true').TextTemplate;
        });
        assert.ok(typeof correct === 'string' && correct !== '', 'Dash choice round ships one Correct flag');
        const options = await page.$$('.multi-choice-component .mcq-preview-option');
        let picked = false;
        for (const option of options) {
            const text = await option.evaluate(el => el.textContent.trim());
            if (text === correct) {
                await option.click();
                picked = true;
                break;
            }
        }
        assert.ok(picked, `Dash choice round ${round} contains its shipped correct option`);
        const prevIndex = await page.evaluate(() => {
            const self = window.angular.element(document.body).scope().self;
            return self.model._currentQuestion ? self.model._currentQuestion.questionIndex : null;
        });
        const submit = await page.$('button.submit-button');
        await submit.click();
        if (last) {
            await page.waitForFunction(() => !document.querySelector('.multi-choice-component') && !document.querySelector('button.submit-button'), { timeout: 2000 });
        } else {
            await page.waitForFunction(prev => {
                const self = window.angular.element(document.body).scope().self;
                return self.model._currentQuestion && self.model._currentQuestion.questionIndex !== prev;
            }, { timeout: 2000 }, prevIndex);
        }
        assert.equal(await page.$eval('.quiz-score', el => el.textContent), String(round + 1));
    }
    check('Dash choice: all 3 sprint rounds selected from the shipped answer with scoring');
    await page.waitForSelector('button.exit-button', { timeout: 2000 });
    const exit = await page.$('button.exit-button');
    const exitNav = page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => null);
    await exit.click();
    await exitNav;
    await page.waitForSelector('main #single-spa-application\\:mfeGlobalNavigation\\:Tertiary', { timeout: 2000 });
    check('Dash choice: completion exit button resolves and clicks to dashboard');
}

async function testDashNumberBoxShape(page, origin) {
    // Dash number-box shape (issue #230, second 2026-11-20 capture filed as
    // #282): one NUMBER_BOX_COMPONENT with empty validAnswers and no correct
    // flags, so the run must refuse by name. Smoke does not run the CLI loop,
    // so it pins the fixture shape the refusal is defined against: the box is
    // present, the classic/choice/speaker markup is absent, and the captured
    // model ships no answer.
    await page.goto(`${origin}/dash-task/number-box`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.$$eval('input.number-box-component', els => els.length), 1,
        'Dash number-box fixture must contain exactly one input');
    assert.equal(await page.$('#question-text'), null);
    assert.equal(await page.$('#answer-text'), null);
    assert.equal(await page.$('.multi-choice-component'), null);
    assert.equal(await page.$('.voice-speaker'), null);
    assert.equal(await page.$$eval('button.submit-button',
        els => els.filter(el => !el.hidden && el.offsetParent !== null).length), 1);
    const shape = await page.evaluate(() => {
        const self = window.angular.element(document.body).scope().self;
        const q = self.model._currentQuestion;
        return {
            isDash: self.model.isDash,
            questionType: q.questionType,
            translationMode: q.translationMode,
            validAnswers: q.validAnswers.length,
            component: q.questionDef.Components[0].ComponentTypeCode,
            flags: q.questionDef.Components[0].Options.map(o => String(o.Correct ?? '')),
        };
    });
    assert.equal(shape.isDash, true);
    assert.equal(shape.questionType, 6);
    assert.equal(shape.translationMode, 4);
    assert.equal(shape.validAnswers, 0);
    assert.equal(shape.component, 'NUMBER_BOX_COMPONENT');
    assert.ok(shape.flags.every(f => f !== 'true'), 'Dash number-box ships no correct flag');
    check('Dash number-box: refusal shape present (one box, no answer, no classic/choice markup)');
}

async function testHotkeyPreloadSurvival(page, origin) {
    const state = { refreshed: 0 };
    const doRefresh = async () => { state.refreshed += 1; };
    await page.exposeFunction('refresh', doRefresh);
    await page.evaluateOnNewDocument(() => {
        if (window.top !== window || window.__epHotkeysInstalled) return;
        window.__epHotkeysInstalled = true;
        document.addEventListener('keyup', event => {
            if (event.altKey && event.key.toLowerCase() === 'r') window.refresh();
        });
    });
    await page.goto(`${origin}/task`, { waitUntil: 'domcontentloaded' });
    await page.keyboard.down('Alt');
    await page.keyboard.press('r');
    await page.keyboard.up('Alt');

    const deadline = Date.now() + 2000;
    while (state.refreshed === 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(state.refreshed, 1);
    check('exposeFunction survives navigation via evaluateOnNewDocument');
}

async function testPageGoneError(page) {
    await page.close();
    const closed = await page.evaluate(() => 1).then(() => null).catch(e => e);
    const pageGone = /detached Frame|Execution context was destroyed|Cannot find context|Target closed|Session closed|Browser has been closed|Navigating was not successful/i;
    assert.ok(closed && pageGone.test(closed.message),
        `closing the page yields a recognisable error, got: ${closed && closed.message}`);
    check(`closing the page produces an isPageGoneError-style message ("${closed.message}")`);
}

let question, boxValue, clearBox;

async function main() {
    console.log(`Puppeteer executablePath: ${await puppeteer.executablePath()}`);
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Mock EP: ${origin}`);
    console.log(`Puppeteer ${require('puppeteer/package.json').version}, puppeteer-core ` +
        `${require('puppeteer-core/package.json').version}, Node ${process.version}`);

    let browser;
    let page;
    let launched = false;
    try {
        if (process.env.SMOKE_BROWSER_URL) {
            browser = await puppeteer.connect({ browserURL: process.env.SMOKE_BROWSER_URL, defaultViewport: null });
            console.log(`Connected to ${process.env.SMOKE_BROWSER_URL}`);
        } else {
            browser = await puppeteer.launch({
                headless: process.env.SMOKE_HEADFUL ? false : 'shell',
                defaultViewport: null,
                handleSIGINT: false,
                executablePath: process.env.SMOKE_EXECUTABLE_PATH || undefined,
            });
            launched = true;
        }
        const version = await browser.version();
        console.log(`Browser: ${version}`);
        check('browser started');

        // Always create a dedicated page; don't reuse the browser's first tab.
        page = await browser.newPage();

        // Host the mock under the origin index.js expects for the login form, using
        // request interception so the checks run against the same selectors as EP.
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.startsWith(origin)) return request.continue();
            return request.abort();
        });

        // Helpers that close over `page` and `origin`.
        question = () => page.$eval('#question-text', el => el.textContent).catch(() => null);
        boxValue = () => page.$eval('#answer-text', el => el.value).catch(() => null);
        clearBox = async () => {
            await page.click('#answer-text', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            assert.equal(await boxValue(), '');
        };

        // --- login flow ---
        await loginAndReachDashboard(page, origin);

        // --- word lists ---
        await readWordLists(page, origin);

        // --- task page ---
        await page.goto(`${origin}/task/play`, { waitUntil: 'domcontentloaded' });
        assert.equal(await question(), 'one');
        check('$eval reads the question');

        // Wrong answer -> correction modal
        await testWrongAnswerModal(page);

        // Right answers advance through every remaining round.
        await testCorrectAnswers(page);

        // Completion exit
        await testCompletionExit(page, origin);

        // --- Dash sprint (issue #230): classic synthetic + timed chrome ---
        await readDashWordLists(page, origin);
        await testDashSprint(page, origin);

        // --- Dash typed sprint (issue #230): #272-captured shape ---
        await testDashTypedSprint(page, origin);

        // --- Dash choice sprint (issue #230): 2026-11-19 captured shape ---
        await testDashQuizSprint(page, origin);

        // --- Dash number-box shape (issue #230, #282): refusal fixture ---
        await testDashNumberBoxShape(page, origin);

        // --- host bindings + preload ---
        await testHotkeyPreloadSurvival(page, origin);

        // --- page-gone error classification ---
        await testPageGoneError(page);

        console.log(`\nAll ${CHECKS.length} checks passed.`);
    } finally {
        if (page) {
            try { await page.close(); } catch { /* already closed */ }
        }
        if (browser) {
            try {
                if (launched) await browser.close();
                else await browser.disconnect();
            } catch { /* already gone */ }
        }
        server.close();
    }
}

// Report which browser Puppeteer itself would launch when no path is given.
function describeManagedBrowser() {
    if (process.env.SMOKE_EXECUTABLE_PATH || process.env.SMOKE_BROWSER_URL) return;
    try {
        const cli = require.resolve('puppeteer/lib/puppeteer/node/cli.js');
        const out = execFileSync(process.execPath, [cli, 'browsers', 'list'], { encoding: 'utf8' });
        console.log(`Puppeteer-managed browsers:\n${out.trim() || '  (none)'}`);
    } catch (e) {
        console.log(`Could not list Puppeteer-managed browsers: ${e.message}`);
    }
}

describeManagedBrowser();
main().catch(e => {
    console.error(`\nSmoke test FAILED: ${e && e.stack || e}`);
    process.exitCode = 1;
});
