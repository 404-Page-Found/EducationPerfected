// Inject a stop at the awaited browser proof response, using the real program.
const assert = require('node:assert/strict');
const Module = require('node:module');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { installGapsFixture } = require('./gaps-fixture');
const selectionModalMode=process.argv.includes('--selection-modal');
const gapsMode = process.argv.includes('--gaps')||selectionModalMode;
(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const savedEnv = { ...process.env };
    Object.assign(process.env, { EP_TEST_BOOT: '1', EP_LOGIN_URL: origin + '/app/login', EP_LOGIN_HOST: '127.0.0.1' });
    delete process.env.EP_EMAIL; delete process.env.EP_PASSWORD;
    let browser, controls, loginReady = false;
    const interception = { stopPromise: undefined, intercepted: false };
    const errors = [], originalError = console.error;
    console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };
    const load = Module._load, launchBrowser = puppeteer.launch.bind(puppeteer), log = console.log;
    Module._load = function (id, ...args) {
        const value = load.call(this, id, ...args);
        return id === 'puppeteer' ? new Proxy(value, { get(target, key) {
            return key === 'launch' ? async (...options) => { browser = await launchBrowser({...options[0],...(process.env.HANDLER_EXECUTABLE_PATH?{executablePath:process.env.HANDLER_EXECUTABLE_PATH}:{})}); return browser; } : target[key];
        } }) : value;
    };
    console.log = (...args) => { if (String(args[0]).includes('No credentials provided')) loginReady = true;
    log(...args); };
    try {
        const { launch } = await launchAndAwaitLogin(() => browser, () => loginReady);
        const page = (await browser.pages())[0];
        await page.type('#loginId', 'fixture-user');
        await page.type('#password', 'fixture-only');
        await page.click('form button');
        controls = await launch;
        await page.goto(origin + '/lesson');
        await armCompletionSurface(page, gapsMode, selectionModalMode);
        const evaluate = armStopInterception(page, controls, selectionModalMode, interception);
        controls.start();
        const finishBy = Date.now() + 12000;
        while (!interception.intercepted || ['running', 'stopping'].includes(controls.status().state)) {
            if (Date.now() >= finishBy) throw new Error('Completion stop checkpoint timed out');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        await interception.stopPromise;
        assert.equal(interception.intercepted, true);
        await assertCompletionOutcome(evaluate, gapsMode, selectionModalMode, errors);
        assert.equal(controls.status().state, 'stopped');
        console.log(gapsMode ? 'Stop during gaps completion proof stops quietly without an unproven-completion warning.' : 'Stop during completion proof prevents exit click.');
    } finally {
        Module._load = load; console.log = log; console.error = originalError;
        if (controls) await controls.close(); else if (browser) await browser.close();
        for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
        Object.assign(process.env, savedEnv);
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });


async function launchAndAwaitLogin(getBrowser, isLoginReady) {
    let launchFailure;
    const launch = require('../index').launchProgram();
    launch.catch(error => { launchFailure = error; });
    const deadline = Date.now() + 12000;
    while (!getBrowser() || !isLoginReady()) {
        if (launchFailure) throw launchFailure;
        if (Date.now() >= deadline) throw new Error('Local login checkpoint timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return { launch };
}

async function armCompletionSurface(page, gapsMode, selectionModalMode) {
    if (gapsMode) {
        await page.evaluate(installGapsFixture);
        await page.evaluate(selectionModalMode => {
            gapsFixture.complete = true;
            document.querySelector('#sa-navigation-controls button').addEventListener('click', () => {
                if(selectionModalMode){
                    const modal=document.createElement('div');modal.setAttribute('uib-modal-window','modal-window');modal.id='preserved-modal';document.body.append(modal);
                    return;
                }
                gapsFixture.group.remove();
                document.querySelector('#question-container-group')?.remove();
                gapsFixture.self.model._currentQuestion = null;
            });
        },selectionModalMode);
        return;
    }
    await page.evaluate(() => {
        document.querySelector('#ep-question-container').remove();
        const exit = document.createElement('button'); exit.className = 'exit-button'; document.body.append(exit);
        window.fixtureExitClicks = 0;
        exit.click = () => { window.fixtureExitClicks += 1; };
    });
}

function armStopInterception(page, controls, selectionModalMode, interception) {
    const evaluate = page.evaluate.bind(page);
    if (selectionModalMode) {
        const click=page.mouse.click.bind(page.mouse);
        page.mouse.click=async(...args)=>{
            await click(...args);
            if(!interception.intercepted&&await evaluate(()=>!!document.querySelector('#preserved-modal'))){
                interception.intercepted=true;interception.stopPromise=controls.stop();
            }
        };
    } else {
        page.evaluate = async (fn, ...args) => {
            const result = await evaluate(fn, ...args);
            if (!interception.intercepted && String(fn).includes('const button = document.querySelector(css)')) {
                interception.intercepted = true;
                interception.stopPromise = controls.stop();
            }
            return result;
        };
    }
    return evaluate;
}

async function assertCompletionOutcome(evaluate, gapsMode, selectionModalMode, errors) {
    if (selectionModalMode) {
        assert.equal(await evaluate(()=>!!document.querySelector('#preserved-modal')),true,'Stop before the next modal poll must not erase the dialog');
    }
    if (gapsMode) {
        assert.equal(await evaluate(() => gapsFixture.submits), 1);
        assert.ok(!errors.some(s => s.includes('without proof of task completion')), 'user stop must not emit an unproven-completion warning');
        return;
    }
    assert.equal(await evaluate(() => window.fixtureExitClicks), 0);
}
