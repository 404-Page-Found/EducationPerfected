// Shared boot harness for synthetic end-to-end CLI suites against mock-ep.
// Owns the one copy of the spawn/output/wait/command plumbing and the
// fixture sign-in so each suite only writes its own scenario. Test harness
// only; never part of the shipped program.
const { spawn } = require('node:child_process');
const path = require('node:path');
const puppeteer = require('puppeteer');

// Spawns bin/cli.js against the mock server. Returns the child plus
// wait/command helpers over its combined output; output() reads the log so
// far (assertions that need the raw text use it, never a stale snapshot).
function bootCli(origin, { extraEnv = {}, args = [] } = {}) {
    const env = { ...process.env, EP_TEST_BOOT: '1', EP_LOGIN_URL: origin + '/app/login', EP_LOGIN_HOST: '127.0.0.1', ...extraEnv };
    delete env.EP_EMAIL; delete env.EP_PASSWORD;
    const child = spawn(process.execPath, [path.join(__dirname, '../bin/cli.js'), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const wait = async predicate => {
        const limit = Date.now() + 15000;
        while (!predicate()) {
            if (child.exitCode !== null || Date.now() >= limit) throw new Error('CLI checkpoint failed: ' + output);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const command = async (text, expected) => {
        const offset = output.length;
        child.stdin.write(text + '\n');
        await wait(() => output.slice(offset).includes(expected));
    };
    return { child, wait, command, output: () => output };
}

// Connects to the CLI's harness browser and completes the mock sign-in form.
async function fixtureLogin(wait, output) {
    await wait(() => /EP_WS_ENDPOINT=(\S+)/.test(output()));
    const browser = await puppeteer.connect({ browserWSEndpoint: output().match(/EP_WS_ENDPOINT=(\S+)/)[1] });
    await browser.waitForTarget(target => target.type() === 'page');
    const page = (await browser.pages())[0];
    await page.waitForSelector('#loginId');
    await page.type('#loginId', 'fixture-user');
    await page.type('#password', 'fixture-only');
    await page.click('form button');
    return { browser, page };
}

// Start a complete mock CLI session for suites that exercise real controls.
async function createCliFixture(options) {
    const server = require('./mock-ep').createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cli = bootCli(origin, options);
    try {
        const login = await fixtureLogin(cli.wait, cli.output);
        await cli.wait(() => cli.output().includes('Commands: start'));
        return { server, origin, ...cli, ...login };
    } catch (error) {
        try { require('./test-process-cleanup').cleanupTestProcess(cli.child); } catch {}
        server.closeAllConnections();
        server.close();
        throw error;
    }
}
module.exports = { bootCli, fixtureLogin, createCliFixture };
