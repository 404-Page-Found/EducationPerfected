// Fixture coverage for lib/support-report.js: tallies, reason categories only,
// no free text leakage, and a copyable block. No browser, no network.
const assert = require('node:assert/strict');
const { createSupportReport, REASONS, TASK_TYPES } = require('../lib/support-report');

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
assert.match(text, /Nothing was sent/);

// Free text in reason or kind never reaches the report.
const leaky = createSupportReport();
leaky.record('What is the French for "dog"? hunter2', 'refused', 'the answer was chien');
const leakyText = leaky.render('password=hunter2');
for (const secret of ['hunter2', 'chien', 'French', 'dog']) assert.ok(!leakyText.includes(secret), `leaked ${secret}`);
assert.match(leakyText, /- unknown: answered 0, refused 1, skipped 0 \(reasons: other x1\)/);
assert.match(leakyText, /Run ended: other/);

assert.throws(() => report.record('text', 'maybe'));
assert.ok(REASONS.has('other'));
console.log('support-report-test passed');
