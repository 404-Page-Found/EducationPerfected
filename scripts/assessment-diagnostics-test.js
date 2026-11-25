// Read-only Assessment capture (#33) and refusal naming, against synthetic
// fixtures only: the capture records fixed-name structure with no question or
// answer text, fires no events, clicks nothing, runs no accessors and calls no
// EP method; a non-Assessment page is refused; and a model-only Assessment
// (gameMode 2, shell not mounted) still stops by name instead of falling into
// the lesson-specific refusals Page saw in the 5 Nov 2026 live log
// ("missing current lesson identity", "no usable text").
// Never touches the live site.
const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { installGapsFixture } = require('./gaps-fixture');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectAssessmentDiagnostics, captureAssessment, createAssessmentWatcher } = require('../lib/assessment-diagnostics');

const REASON = 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled';
const SHELL = () => {
    const bar = document.createElement('game-assessment-action-bar');
    bar.innerHTML = '<button type="button">secret save label</button>';
    const side = document.createElement('game-assessment-side-bar');
    side.innerHTML = '<button type="button">q1</button><button type="button">q2</button>';
    const nav = document.createElement('game-assessment-navigation-controls');
    nav.innerHTML = '<button type="button">secret submit label</button>';
    document.body.append(bar, side, nav);
};

(async () => {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    const { page, origin, child, wait } = session;
    try {
        await page.goto(origin + '/lesson');
        await page.evaluate(installGapsFixture);
        await page.evaluate(() => {
            window.inspectionCounts = { events: 0, calls: 0, getters: 0 };
            for (const name of ['click', 'keydown', 'input', 'change', 'focus', 'submit']) {
                document.addEventListener(name, () => window.inspectionCounts.events++, true);
            }
        });

        // A lesson (gameMode 3) is not an Assessment: refused before any question state.
        const lesson = await collectAssessmentDiagnostics(page);
        assert.equal(lesson.guard, 'not-assessment');
        assert.equal(lesson.gameMode, 3);
        assert.equal('question' in lesson, false);

        // Assessment model plus mounted shell: the capture reads structure.
        await page.evaluate(() => {
            const self = window.angular.element(document.body).scope().self;
            self.model.gameMode = 2;
            const q = self.model._currentQuestion;
            q.UsersAnswer = 'private-stored-answer';
            q.Attempted = true;
            window.angular.element(document.body).scope().self.model.markAnswer = () => { window.inspectionCounts.calls++; };
            Object.defineProperty(q, 'UserState', { configurable: true, get() { window.inspectionCounts.getters++; throw new Error('accessor-must-not-run'); } });
        });
        await page.evaluate(SHELL);
        await page.evaluate(() => { const i = document.createElement('input'); i.type = 'password'; i.value = 'hunter2-secret'; document.body.append(i); });
        const result = await collectAssessmentDiagnostics(page);
        assert.equal(result.guard, 'captured');
        assert.equal(result.build, 'assessment-inspect-v1');
        assert.equal(result.readOnly, true);
        assert.equal(result.gameMode, 2);
        assert.equal(result.question.contentIdValid, true);
        assert.equal(result.question.components[0].type, 'FILL_IN_GAPS_COMPONENT');
        assert.equal(result.question.stored.UsersAnswer, 'string');
        assert.equal(result.question.stored.UserState, 'accessor');
        assert.equal(result.question.stored.Attempted, 'boolean');
        assert.equal(result.shell.actionBar.elements, 1);
        assert.equal(result.shell.sideBar.visibleControls, 2);
        assert.equal(result.shell.navigationControls.visibleControls, 1);
        const serialized = JSON.stringify(result);
        for (const marker of ['private-stored-answer', 'secret save label', 'secret submit label', 'accessor-must-not-run', 'beta', 'alpha', 'Synthetic', '1643503']) {
            assert.equal(serialized.includes(marker), false, marker);
        }
        // Read-only: no events, no EP method call, no accessor run.
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0, calls: 0, getters: 0 });

        // The real CLI prints the capture line while stopped.
        child.stdin.write('inspect-assessment\n');
        await wait(() => session.output.includes('EP_ASSESSMENT_INSPECT '));
        const line = session.output.split('\n').find(l => l.startsWith('EP_ASSESSMENT_INSPECT '));
        const cli = JSON.parse(line.slice('EP_ASSESSMENT_INSPECT '.length));
        assert.equal(cli.guard, 'captured');
        assert.equal(line.includes('private-stored-answer'), false);
        // Full capture file: written, owner-only, with text, model, DOM, controls, timers, focus.
        assert.ok(cli.file?.includes('assessment-captures'), 'file path reported');
        assert.equal('full' in cli, false);
        const fileText = fs.readFileSync(cli.file, 'utf8');
        const saved = JSON.parse(fileText);
        assert.equal(saved.summary.guard, 'captured');
        assert.equal(saved.full.model.gameMode, 2);
        assert.ok(fileText.includes('private-stored-answer'), 'full capture keeps stored-answer text for the owner');
        assert.ok(fileText.includes('secret save label') && fileText.includes('secret submit label'), 'shell button labels captured');
        assert.ok(saved.full.controls.some(c => c.shell === 'game-assessment-navigation-controls' && c.tag === 'button'));
        assert.ok(Array.isArray(saved.full.timers) && 'hasFocus' in saved.full.focus && saved.full.domNodeCount > 5);
        assert.equal(fileText.includes('accessor-must-not-run'), false);
        assert.equal(fileText.includes('hunter2-secret'), false, 'password value never written');
        assert.equal(JSON.stringify(saved.full.question).includes('[accessor]'), true);
        if (process.platform !== 'win32') assert.equal(fs.statSync(cli.file).mode & 0o077, 0);
        fs.rmSync(cli.file, { force: true });
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0, calls: 0, getters: 0 });

        // Passive watch: writes a capture only when the page changes; never an event.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-watch-'));
        const lines = [];
        const watcher = createAssessmentWatcher({ page, dir, log: l => lines.push(l), intervalMs: 50, minGapMs: 0 });
        await watcher.tick(); await watcher.tick();
        assert.equal(fs.readdirSync(dir).length, 1, 'unchanged page: one capture only');
        await page.evaluate(() => { const el = document.querySelector('#question-text') || document.body; el.append(' next-question'); });
        await watcher.tick();
        assert.equal(fs.readdirSync(dir).length, 2, 'changed page: a new capture');
        assert.ok(lines.every(l => l.startsWith('EP_ASSESSMENT_WATCH ')));
        let busy = true;
        const paused = createAssessmentWatcher({ page, dir, isBusy: () => busy });
        await paused.tick();
        assert.equal(fs.readdirSync(dir).length, 2, 'busy (answering run): no capture');
        busy = false;
        assert.equal(paused.start(), true); assert.equal(paused.start(), false); assert.equal(paused.stop(), true);
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0, calls: 0, getters: 0 });
        fs.rmSync(dir, { recursive: true, force: true });
        // Non-assessment page writes nothing.
        await page.goto(origin + '/lesson');
        const none = await captureAssessment(page, { dir: path.join(os.tmpdir(), 'ep-none-' + process.pid) });
        assert.equal(none.guard, 'not-assessment');
        assert.equal(fs.existsSync(path.join(os.tmpdir(), 'ep-none-' + process.pid)), false);
        await page.goto(origin + '/lesson');
        await page.evaluate(installGapsFixture);
        await page.evaluate(() => { window.angular.element(document.body).scope().self.model.gameMode = 2; });

        // Page without a game model reports that honestly.
        await page.goto(origin + '/learning/dashboard');
        assert.equal((await collectAssessmentDiagnostics(page)).guard, 'model-unreadable');

        // Model-only Assessment (shell not mounted): the real loop stops by
        // name, never with the lesson-specific messages from the live log.
        await page.goto(origin + '/lesson');
        await page.evaluate(installGapsFixture);
        await page.evaluate(() => {
            window.angular.element(document.body).scope().self.model.gameMode = 2;
            window.inspectionCounts = { events: 0 };
            for (const name of ['click', 'keydown', 'input', 'change', 'focus', 'submit']) document.addEventListener(name, () => window.inspectionCounts.events++, true);
        });
        child.stdin.write('mode auto\n');
        await wait(() => session.output.includes('"mode":"auto"'));
        const offset = session.output.length;
        child.stdin.write('start\n');
        await wait(() => session.output.slice(offset).includes('answerLoop Exited.'));
        const run = session.output.slice(offset);
        const runLines = new Set(run.split('\n'));
        assert.ok(run.includes(REASON), 'run names Assessment mode');
        for (const bad of ['missing current lesson identity', 'no usable text']) assert.equal(run.includes(bad) || runLines.has(bad), false, bad);
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0 });
        child.stdin.write('quit\n');
        await wait(() => child.exitCode !== null);
        assert.equal(child.exitCode, 0);
        console.log('Assessment diagnostics PASS: read-only structural capture, non-assessment refused, model-only Assessment stops by name with zero input. Synthetic only, no live Assessment.');
    } finally {
        await session.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
