// Dash timed sprint (issue #230) through the real CLI against the synthetic
// /dash-task fixture in scripts/mock-ep.js:
// - starting a timed run with an empty word list reports clearly (a dash timer
//   with nothing learned means every first answer is guessed from the
//   wrong-answer modal and each guess burns the clock) instead of silently
//   mistyping through the sprint;
// - after Refresh Words on the starter page, the same timed run completes
//   through the classic loop with no warning.
// The /dash-task/quiz page models the shape the 2026-11-19 live EP_DASH_INSPECT
// capture showed (one multi-choice component on EP's QuizModel: gameMode null,
// isDash true, one string-"true" correct option): the CLI answers the sprint
// in auto mode and completes it, and the read-only inspect-dash command still
// captures the round's structure. The same page off the dash route
// (/quiz-round) is unconfirmed and must refuse by name.
// Synthetic only; never touches the live site.
const { createServer } = require('./mock-ep');
const { cleanupTestProcess } = require('./test-process-cleanup');
const { bootCli, fixtureLogin } = require('./cli-test-harness');

(async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { child, wait, command, output } = bootCli(origin, {});
    let browser;
    try {
        const login = await fixtureLogin(wait, output);
        browser = login.browser;
        const page = login.page;
        await wait(() => output().includes('Commands: start'));

        // No refresh: the first question is unknown, so the timed run must say
        // so instead of silently guessing through the sprint.
        await page.goto(origin + '/dash-task/play');
        await command('start', '"state":"running"');
        await wait(() => output().includes('Timed task detected (dash timer)'));
        await command('stop', '"state":"stopped"');

        // After Refresh Words on the starter page, the same timed run warns no
        // more and completes through the classic loop.
        await page.goto(origin + '/dash-task');
        await command('refresh', 'Word Lists Refreshed. 5 entries');
        await page.goto(origin + '/dash-task/play');
        const offset = output().length;
        await command('start', '"state":"running"');
        await wait(() => output().slice(offset).includes('answerLoop Exited.'));
        if (output().slice(offset).includes('Timed task detected')) {
            throw new Error('timed warning printed despite a refreshed word list');
        }
        await command('status', '"state":"completed"');

        // The shape the 2026-11-19 live capture showed (multi-choice on EP's
        // QuizModel, gameMode null, isDash true): first the read-only capture
        // reports the round's structure and stays sanitised (no
        // fixture-private marker strings).
        await page.goto(origin + '/dash-task/quiz');
        let quizOffset = output().length;
        await command('inspect-dash', 'EP_DASH_INSPECT ');
        const inspectLine = output().slice(quizOffset).split('\n')
            .find(line => line.startsWith('EP_DASH_INSPECT '));
        if (!inspectLine) throw new Error('inspect-dash produced no EP_DASH_INSPECT line');
        const capture = JSON.parse(inspectLine.slice('EP_DASH_INSPECT '.length).trim());
        if (capture.guard !== 'captured' || capture.gameMode !== null || capture.isDash !== true) {
            throw new Error('unexpected dash capture: ' + inspectLine);
        }
        if (inspectLine.includes('private-')) throw new Error('dash capture leaked fixture content');

        // The same confirmed shape is then answered end to end in auto mode:
        // every round is selected from EP's own question state and submitted
        // once, and the sprint completes.
        quizOffset = output().length;
        await command('start', '"state":"running"');
        await wait(() => output().slice(quizOffset).includes('answerLoop Exited.'));
        const quizOut = output().slice(quizOffset);
        if ((quizOut.match(/Selected "private-option/g) || []).length !== 3) {
            throw new Error('Dash quiz rounds were not all selected and submitted: ' + quizOut);
        }
        await command('status', '"state":"completed"');

        // The same page off the dash route is not a confirmed Dash round: the
        // run must stop and name Dash instead of answering.
        await page.goto(origin + '/quiz-round');
        quizOffset = output().length;
        await command('start', '"state":"running"');
        await wait(() => output().slice(quizOffset).includes('answerLoop Exited.'));
        const offRouteOut = output().slice(quizOffset);
        if (!offRouteOut.includes('Dash timed sprint round detected outside a confirmed dash route')) {
            throw new Error('off-route Dash round did not refuse by name');
        }
        if (!offRouteOut.includes('inspect-dash')) {
            throw new Error('off-route refusal did not point at the inspect-dash capture');
        }
        if (offRouteOut.includes('Selected "')) {
            throw new Error('off-route Dash round was answered');
        }
        await command('status', '"state":"stopped"');

        console.log('Dash: unknown-question timed run warns; refreshed timed run completes without the warning; captured quiz shape is answered to completion; off-route round refuses by name; inspect-dash captures sanitised PASS. Synthetic only.');
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { cleanupTestProcess(child); } catch { /* already gone */ }
        try { server.close(); } catch { /* already closed */ }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
