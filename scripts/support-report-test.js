// Fixture coverage for lib/support-report.js: tallies, reason categories only,
// no free text leakage, and a copyable block. No browser, no network.
const assert = require('node:assert/strict');
const { createSupportReport, REASONS, TASK_TYPES, describeUnsupported, isValidDetail, BRANCHES } = require('../lib/support-report');

const empty = createSupportReport();
assert.ok(empty.isEmpty());
assert.match(empty.render('stopped'), /No task types were met/);

const report = createSupportReport();
report.record('text', 'answered');
report.record('text', 'answered');
report.record('choice', 'answered');
report.record('audio', 'refused', 'no-handler');
report.record('audio', 'refused', 'no-handler');
report.record('gaps', 'skipped', 'pre-submit-guard');
assert.ok(TASK_TYPES.has('text') && !TASK_TYPES.has('dog'));
report.record('unsupported', 'refused', 'unsupported-question');
assert.deepEqual(report.snapshot().find(r => r.kind === 'audio'), { kind: 'audio', answered: 0, refused: 2, skipped: 0, reasons: { 'no-handler': 2 } });
const text = report.render('completed');
assert.match(text, /- text: answered 2, refused 0, skipped 0\n/);
assert.match(text, /- audio: answered 0, refused 2, skipped 0 \(reasons: no-handler x2\)/);
assert.match(text, /- gaps: answered 0, refused 0, skipped 1 \(reasons: pre-submit-guard x1\)/);
assert.match(text, /Run ended: completed/);
assert.match(text, /No answers, question text or credentials/);

// Free text in reason or kind never reaches the report.
const leaky = createSupportReport();
leaky.record('What is the French for "dog"? hunter2', 'refused', 'the answer was chien');
const leakyText = leaky.render('password=hunter2');
for (const secret of ['hunter2', 'chien', 'French', 'dog']) assert.ok(!leakyText.includes(secret), `leaked ${secret}`);
assert.match(leakyText, /- unknown: answered 0, refused 1, skipped 0 \(reasons: other x1\)/);
assert.match(leakyText, /Run ended: other/);

assert.throws(() => report.record('text', 'maybe'));
assert.ok(REASONS.has('other'));

// Unsupported shape: branch from a fixed list, never the reason text.
const generic = describeUnsupported({
    kind: 'unsupported',
    reason: 'lesson slide with an unsupported question type (not text, choice, or audio)',
    diagnostic: { modelReadable: true, gameMode: 3, questionType: 9, componentCount: 2, componentTypes: ['FILE_UPLOADER_COMPONENT', 'My secret hunter2'], controls: { inputs: 1, textareas: 0, selects: 0, contentEditable: 0, canvases: 0, buttons: 3 } },
});
assert.deepEqual(generic, { branch: 'generic-slide', game_mode: 'lesson', question_type: 9, component_count: 2, components: ['FILE_UPLOADER_COMPONENT', 'UNLISTED_COMPONENT'], controls: { inputs: 1, textareas: 0, selects: 0, editable: 0, canvases: 0, buttons: 3 } });
const branchOf = d => describeUnsupported(d).branch;
assert.equal(branchOf({ assessment: true, reason: 'x' }), 'assessment');
assert.equal(branchOf({ dash: true, reason: 'Dash timed sprint round: other answer-bearing components' }), 'dash');
assert.equal(branchOf({ reason: 'Choice answering requires confirmed Smart Lesson practice mode; unknown modes (gameMode 7) are not supported' }), 'unknown-game-mode');
assert.equal(branchOf({ reason: "choice question detected, but EP's answer state could not be read (AngularJS scope unavailable)" }), 'scope-unreadable');
assert.equal(branchOf({ reason: 'Question detection failed: boom' }), 'detection-error');
assert.equal(branchOf({ reason: 'something new', diagnostic: { guard: 'start' } }), 'guard-refusal');
assert.equal(branchOf({ reason: 'something new the user typed: hunter2' }), 'other');
assert.equal(branchOf(null), 'other');
for (const d of [{}, { reason: 5 }, { diagnostic: 'x' }, { diagnostic: { componentTypes: 'nope', controls: [] } }]) assert.ok(isValidDetail(describeUnsupported(d)));
assert.ok(isValidDetail(generic) && BRANCHES.has(generic.branch));
assert.equal(describeUnsupported({ reason: 'x' }).question_type, -1, 'unreadable is -1');
assert.equal(describeUnsupported({ reason: 'x' }).game_mode, 'unknown');
assert.ok(!isValidDetail({ ...generic, components: ['My secret hunter2'] }) && !isValidDetail({ ...generic, controls: { ...generic.controls, inputs: 'lots' } }));
assert.equal(branchOf({ reason: 'choice option metadata is missing or unreadable; no answer was selected' }), 'missing-metadata');
assert.equal(branchOf({ reason: 'Multi-select with lesson inputs: unsafe, unsupported or changed renderer state' }), 'foreign-slide-surfaces');
assert.equal(branchOf({ reason: 'Lesson dropdowns: unsafe, unsupported or changed renderer state' }), 'foreign-dropdown');
assert.equal(branchOf({ reason: 'Lesson dropdowns with number boxes: unsafe, unsupported or changed renderer state' }), 'foreign-dropdown');
assert.equal(branchOf({ reason: 'Lesson textboxes: unsafe, unsupported or changed renderer state' }), 'foreign-textbox');
assert.equal(branchOf({ reason: 'Lesson number boxes: unsafe, unsupported or changed renderer state' }), 'foreign-textbox');
assert.equal(branchOf({ reason: 'question has editable controls outside the multi-select component; answering would submit them blank' }), 'foreign-multiselect');
assert.equal(branchOf({ reason: 'question has editable controls outside the editor; answering would submit them blank' }), 'foreign-formula');
assert.equal(branchOf({ reason: 'some other editable controls refusal' }), 'foreign-controls');
{
    const probe = { gameMode: 3, questionType: 9, componentCount: 1, componentTypes: ['DROPDOWN_COMPONENT'], controls: { inputs: 2, textareas: 0, selects: 4, contentEditable: 0, canvases: 0, buttons: 3 } };
    const d = describeUnsupported({ reason: 'Lesson dropdowns: unsafe, unsupported or changed renderer state', diagnostic: { guard: 'x', domSelectCount: 4 } }, probe);
    assert.deepEqual([d.branch, d.game_mode, d.question_type, d.component_count, d.components, d.controls.selects], ['foreign-dropdown', 'lesson', 9, 1, ['DROPDOWN_COMPONENT'], 4]);
    assert.ok(isValidDetail(d));
    const own = describeUnsupported({ reason: 'x', diagnostic: { gameMode: 1, questionType: 2 } }, probe);
    assert.deepEqual([own.game_mode, own.question_type, own.components], ['classic', 2, ['DROPDOWN_COMPONENT']], 'own fields win, gaps filled');
    assert.ok(isValidDetail(describeUnsupported({ reason: 'x' }, { gameMode: 'evil', componentTypes: ['SECRET'], controls: { inputs: 'a' } })));
}
const sample = {
    'no-identity': 'lesson text question without a stable identity (contentID/questionIndex missing from EP\'s question state)',
    'translation-mode': 'speaker slide with an unexpected translationMode (5); only Listening (2) and Dictation (3) were captured live',
    'accompanying-component': 'choice slide has other answer-bearing question components; answering one part would submit the rest blank',
    'multiple-components': 'multiple visible choice components; cannot safely associate answer state with one component',
    'renderer-association': 'formula choices lack a unique current renderer-to-option association; stopping instead of guessing',
    'foreign-choice': 'choice slide has editable controls outside the choice component; answering would submit them blank',
    'missing-metadata': 'a correct-marked choice option has no usable text; stopping with incomplete answer metadata',
};
for (const [branch, reason] of Object.entries(sample)) assert.equal(branchOf({ reason }), branch, branch);
assert.equal(branchOf({ reason: 'Question detection failed: no stable identity' }), 'detection-error');
assert.ok(!isValidDetail({ ...generic, branch: 'free text' }) && !isValidDetail({ ...generic, extra: 1 }));
const shaped = createSupportReport();
shaped.record('unsupported', 'refused', 'unsupported-question', { ...generic, branch: 'hunter2' });
assert.equal(shaped.details().length, 0, 'invalid detail is dropped');
shaped.record('unsupported', 'refused', 'unsupported-question', generic);
assert.deepEqual(shaped.details(), [{ kind: 'unsupported', reason: 'unsupported-question', detail: generic }]);
assert.match(shaped.render('stopped'), /unsupported detail: branch generic-slide, game mode lesson, question type 9, components FILE_UPLOADER_COMPONENT, UNLISTED_COMPONENT/);
assert.ok(!shaped.render('stopped').includes('hunter2'));
console.log('support-report-test passed');
