// Read-only Smart Lesson slide component capture (issue #231) against the
// synthetic /lesson fixture in scripts/mock-ep.js with the gaps fixture
// installed: the recorded structure is fixed-name and shape-only (no
// question/answer text, no class strings, no ids), the capture fires no page
// events and runs no accessors, and the same assessment shell boundary as
// question detection applies even to a read-only capture. The real CLI
// dispatches the command while stopped. Synthetic only; never touches the
// live site.
const assert = require('node:assert/strict');
const { bootFixtureCli } = require('./fixture-cli-session');
const { installGapsFixture } = require('./gaps-fixture');
const { collectComponentsDiagnostics } = require('../lib/components-diagnostics');

(async () => {
    const session = await bootFixtureCli('cli.js', 'Commands: start');
    const { page, origin } = session;
    try {
        await page.goto(origin + '/lesson');
        await page.evaluate(installGapsFixture);
        await page.evaluate(() => {
            window.inspectionCounts = { events: 0 };
            for (const name of ['click', 'keydown', 'input', 'change', 'focus']) {
                document.addEventListener(name, () => window.inspectionCounts.events++, true);
            }
        });
        const result = await collectComponentsDiagnostics(page);
        assert.equal(result.guard, 'captured');
        assert.equal(result.build, 'components-inspect-v1');
        assert.equal(result.readOnly, true);
        assert.equal(result.sectionData, 'object');
        assert.equal(result.gameMode, 3);
        assert.equal(result.question.contentIdValid, true);
        assert.equal(result.question.questionIndexValid, true);
        assert.equal(result.question.componentCount, 1);
        const gaps = result.question.components[0];
        assert.equal(gaps.type, 'FILL_IN_GAPS_COMPONENT');
        assert.equal(gaps.marked, 1);
        assert.equal(gaps.optionsShape, 'absent');
        assert.equal(gaps.optionCount, null);
        assert.equal(result.dom.choiceGroups, 0);
        assert.equal(result.dom.inputs, 0);
        assert.equal(result.dom.contentEditables, 0);
        // Sanitised: no fixture content strings anywhere in the report.
        const serialized = JSON.stringify(result);
        assert.equal(serialized.includes('beta'), false);
        assert.equal(serialized.includes('alpha'), false);
        assert.equal(serialized.includes('Synthetic'), false);
        // Read-only: no input, click, key, change or focus events fired.
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0 });

        // Companions: a proven presentation-only code reports its fixed name;
        // an unlisted code reports the literal UNLISTED_COMPONENT, never the
        // page's own code text.
        await page.evaluate(() => {
            const q = window.angular.element(document.body).scope().self.model._currentQuestion;
            q.questionDef.Components.push(
                { ComponentTypeCode: 'SOUND_COMPONENT', ComponentID: 'snd-1', Marked: 0 },
                { ComponentTypeCode: 'WEIRD_NEW_COMPONENT', ComponentID: 'wz-1', Options: [{ Correct: 'true' }, { Correct: 'false' }] },
            );
        });
        const mixed = await collectComponentsDiagnostics(page);
        assert.equal(mixed.question.componentCount, 3);
        assert.deepEqual(mixed.question.components.map(c => c.type),
            ['FILL_IN_GAPS_COMPONENT', 'SOUND_COMPONENT', 'UNLISTED_COMPONENT']);
        const unlisted = mixed.question.components[2];
        assert.equal(unlisted.optionsShape, 'array');
        assert.equal(unlisted.optionCount, 2);
        assert.equal(unlisted.correctStringTrue, 1);
        assert.equal(unlisted.correctBooleanTrue, 0);
        assert.deepEqual(unlisted.correctFieldShapes, ['string']);
        assert.equal(unlisted.accessorOptionSlots, 0);
        assert.equal(JSON.stringify(mixed).includes('WEIRD'), false);

        // The editable census counts fixed selectors only.
        await page.evaluate(() => {
            const input = document.createElement('input');
            document.getElementById('ep-question-container').append(input);
            const editable = document.createElement('div');
            editable.setAttribute('contenteditable', 'true');
            editable.style.cssText = 'display:block;width:10px;height:10px';
            document.getElementById('ep-question-container').append(editable);
        });
        const editableSeen = await collectComponentsDiagnostics(page);
        assert.equal(editableSeen.dom.inputs, 1);
        assert.equal(editableSeen.dom.contentEditables, 1);

        // An accessor on an Options index must not run; that option simply
        // reports its fields as unreadable and the capture still completes.
        await page.evaluate(() => {
            const q = window.angular.element(document.body).scope().self.model._currentQuestion;
            const options = q.questionDef.Components[2].Options;
            window.inspectionCounts.getters = 0;
            Object.defineProperty(options, '0', { configurable: true,
                get() { window.inspectionCounts.getters++; throw new Error('option-accessor-must-not-run'); } });
        });
        const accessorRun = await collectComponentsDiagnostics(page);
        assert.equal(accessorRun.question.components[2].optionCount, 2);
        assert.equal(accessorRun.question.components[2].correctStringTrue, 0);
        assert.equal(accessorRun.question.components[2].accessorOptionSlots, 1);
        assert.equal(JSON.stringify(accessorRun).includes('option-accessor-must-not-run'), false);
        assert.deepEqual(await page.evaluate(() => window.inspectionCounts), { events: 0, getters: 0 });

        // Model-level assessment boundary: gameMode 2 stops the capture before
        // any question state is read, even without the mounted assessment shell.
        await page.evaluate(() => { window.angular.element(document.body).scope().self.model.gameMode = 2; });
        const assessmentModel = await collectComponentsDiagnostics(page);
        assert.equal(assessmentModel.guard, 'assessment-mode');
        assert.equal(assessmentModel.gameMode, 2);
        assert.equal('question' in assessmentModel, false);
        await page.evaluate(() => { window.angular.element(document.body).scope().self.model.gameMode = 3; });

        // The assessment shell boundary applies even to a read-only capture,
        // and the capture reads no answer state behind it.
        await page.goto(origin + '/lesson-assessment');
        const assessment = await collectComponentsDiagnostics(page);
        assert.equal(assessment.guard, 'assessment-mode');
        assert.deepEqual(await page.evaluate(() => window.assessmentCounts),
            { clicks: 0, inputs: 0, keys: 0, submits: 0, answerReads: 0 });

        // A page without a game model reports that honestly.
        await page.goto(origin + '/learning/dashboard');
        const noModel = await collectComponentsDiagnostics(page);
        assert.equal(noModel.guard, 'model-unreadable');

        // The real CLI dispatches the command while stopped and prints the
        // sanitised capture line.
        await page.goto(origin + '/lesson');
        await page.evaluate(installGapsFixture);
        session.child.stdin.write('inspect-components\n');
        await session.wait(() => session.output.includes('EP_COMPONENTS_INSPECT '));
        const line = session.output.split('\n').find(l => l.startsWith('EP_COMPONENTS_INSPECT '));
        const cliCapture = JSON.parse(line.slice('EP_COMPONENTS_INSPECT '.length));
        assert.equal(cliCapture.guard, 'captured');
        assert.equal(cliCapture.question.components[0].type, 'FILL_IN_GAPS_COMPONENT');
        assert.equal(line.includes('beta'), false);
        console.log('Components diagnostics: sanitised capture, companions and unlisted codes, no side effects or accessors, assessment shell and model guards, real-CLI dispatch PASS. Synthetic only.');
    } finally {
        await session.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
