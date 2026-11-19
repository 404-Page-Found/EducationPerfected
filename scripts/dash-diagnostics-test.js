// Read-only Dash capture (issue #230) against the synthetic /dash-task/quiz
// fixture in scripts/mock-ep.js: the recorded structure is fixed-name and
// shape-only (no question/answer text, no class strings, no ids), the capture
// fires no page events and runs no accessors, and the same assessment shell
// boundary as question detection applies even to a read-only capture.
// Synthetic only; never touches the live site.
const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { collectDashDiagnostics } = require('../lib/dash-diagnostics');

(async () => {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    const { page, origin } = session;
    try {
        await page.goto(origin + '/dash-task/quiz');
        await page.evaluate(() => {
            window.inspectionCounts = { events: 0 };
            for (const name of ['click', 'keydown', 'input', 'change', 'focus']) {
                document.addEventListener(name, () => window.inspectionCounts.events++, true);
            }
        });
        const result = await collectDashDiagnostics(page);
        assert.equal(result.guard, 'captured');
        assert.equal(result.build, 'dash-diagnostics-v1');
        assert.equal(result.readOnly, true);
        assert.equal(result.gameMode, 1);
        assert.equal(result.isDash, true);
        assert.equal(result.sectionData, 'absent');
        assert.deepEqual(result.selectedActivity, { taskIdNull: true, activityType: 1, contentType: 1 });
        assert.equal(result.routing.pathIncludesDash, true);
        assert.equal(result.question.contentIdValid, true);
        assert.equal(result.question.questionIndexValid, true);
        assert.equal(result.question.questionType, 0);
        assert.equal(result.question.componentCount, 1);
        const component = result.question.components[0];
        assert.equal(component.type, 'MULTICHOICE_COMPONENT');
        assert.equal(component.allowMultiSelect, false);
        assert.equal(component.marked, 1);
        assert.equal(component.optionsShape, 'array');
        assert.equal(component.optionCount, 4);
        assert.equal(component.correctStringTrue, 1);
        assert.equal(component.correctBooleanTrue, 0);
        assert.deepEqual(component.correctFieldShapes, ['string']);
        assert.equal(result.dom.choiceGroups, 1);
        assert.equal(result.dom.choiceOptions, 4);
        assert.equal(result.dom.submitButtons, 1);
        assert.equal(result.dom.questionText, 0);
        assert.equal(result.dom.answerText, 0);
        assert.equal(result.dom.timerCandidates['#dash-timer'], 1);
        // Sanitised: no fixture-private marker strings anywhere in the report.
        const serialized = JSON.stringify(result);
        assert.equal(serialized.includes('private-'), false);
        assert.equal(serialized.includes('accessor-must-not-run'), false);
        // Read-only: no input, click, key, change or focus events fired.
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0 });

        // The assessment shell boundary applies even to a read-only capture,
        // and the capture reads no answer state behind it.
        await page.goto(origin + '/lesson-assessment');
        const assessment = await collectDashDiagnostics(page);
        assert.equal(assessment.guard, 'assessment-mode');
        assert.deepEqual(await page.evaluate(() => window.assessmentCounts),
            { clicks: 0, inputs: 0, keys: 0, submits: 0, answerReads: 0 });

        // A page without a game model reports that honestly.
        await page.goto(origin + '/learning/dashboard');
        const noModel = await collectDashDiagnostics(page);
        assert.equal(noModel.guard, 'model-unreadable');
        console.log('Dash diagnostics: sanitised capture, no side effects, assessment and model-less guards hold PASS. Synthetic only.');
    } finally {
        await session.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
