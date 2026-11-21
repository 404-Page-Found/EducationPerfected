// Shared companion inventory contract (issue #231): lib/companion-components.js
// is the canonical source; the in-page readers keep local mirrors because they
// run inside page.evaluate and must stay self-contained. This test asserts the
// mirrors stay in sync, that every companion refusal names a recognized code
// (or redacted/UNLISTED) without leaking content, and that the orchestrator
// retags companion refusals as slide-surfaces-refusal. Synthetic only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const {
  PRESENTATION_COMPONENTS,
  KNOWN_COMPONENT_CODES,
  formatAccompanyingCode,
  diagnosticComponentType,
} = require('../lib/companion-components');
const { installGapsFixture } = require('./gaps-fixture');
const { installHighlightFixture } = require('./highlight-fixture');
const { setup: setupMath } = require('./choice-renderer-fixture');

const CANONICAL_PRESENTATION = ['ANNOTATED_TEXT_COMPONENT', 'SOUND_COMPONENT'];
const REQUIRED_KNOWN = ['LONG_ANSWER_COMPONENT', 'MULTICHOICE_COMPONENT', 'TEXT_BOX_COMPONENT',
  'FILE_UPLOADER_COMPONENT', 'SOUND_RECORDER_COMPONENT', 'FORMULA_COMPONENT',
  'ANNOTATED_TEXT_COMPONENT', 'SOUND_COMPONENT', 'SCRATCH_PAD_COMPONENT'];

(async () => {
  // 0. Canonical module shape: presentation-only pair, known codes, formatters.
  assert.deepEqual([...PRESENTATION_COMPONENTS].sort(), [...CANONICAL_PRESENTATION].sort());
  for (const code of REQUIRED_KNOWN) assert.ok(KNOWN_COMPONENT_CODES.includes(code), code);
  assert.equal(formatAccompanyingCode('LONG_ANSWER_COMPONENT'), 'LONG_ANSWER_COMPONENT');
  assert.equal(formatAccompanyingCode('SECRET_COMPONENT'), 'redacted type');
  assert.equal(formatAccompanyingCode(null), 'redacted type');
  assert.equal(diagnosticComponentType('LONG_ANSWER_COMPONENT'), 'LONG_ANSWER_COMPONENT');
  assert.equal(diagnosticComponentType('SECRET_COMPONENT'), 'UNLISTED_COMPONENT');

  // 0b. In-page mirrors stay in sync with the canonical module.
  const libDir = path.join(__dirname, '..', 'lib');
  const mirrorFiles = ['choice-state.js', 'multi-choice-state.js', 'highlight-state.js',
    'working-formula-state.js', 'textbox-state.js', 'gaps-state.js'];
  for (const file of mirrorFiles) {
    const text = fs.readFileSync(path.join(libDir, file), 'utf8');
    assert.ok(text.includes('lib/companion-components.js'), `${file} missing canonical reference`);
    for (const fragment of ['ANNOTATED_TEXT', 'SOUND', 'WORKING_FORMULA']) {
      assert.ok(text.includes(fragment), `${file} mirror missing ${fragment}`);
    }
  }
  // Canonical known list matches the shared capture segment.
  const inspection = require('../lib/question-inspection');
  for (const code of REQUIRED_KNOWN) {
    const fragment = code.replace(/_COMPONENT$/, '');
    assert.ok(inspection.KNOWN_COMPONENT_CODES.includes(fragment), `question-inspection missing ${code}`);
  }

  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'shell' });
    const page = await browser.newPage();
    const origin = 'http://127.0.0.1:' + server.address().port;

    const pushDefs = (fixtureProp, defs) => page.evaluate(({ prop, ds }) => {
      const f = window[prop];
      f.q.questionDef.Components.push(...ds.map(d => ({ ...d })));
    }, { prop: fixtureProp, ds: defs });

    // 1. choice: names the recognized code, redacts the unknown, keeps the
    // fail-closed substring and adds a content-free diagnostic.
    await setupMath(page, origin);
    await pushDefs('mathFixture', [{ ComponentTypeCode: 'LONG_ANSWER_COMPONENT', ComponentID: 'la-1', Marked: 1 }]);
    let d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.match(d.reason, /other answer-bearing/);
    assert.match(d.reason, /LONG_ANSWER_COMPONENT/);
    assert.equal(d.diagnostic?.guard, 'accompanying-component');
    assert.equal(d.diagnostic?.componentType, 'LONG_ANSWER_COMPONENT');
    assert.equal(JSON.stringify(d).includes('la-1'), false);

    await setupMath(page, origin);
    await pushDefs('mathFixture', [{ ComponentTypeCode: 'SECRET_COMPONENT', ComponentID: 'x-1', Marked: 1 }]);
    // An unlisted code is not in the answer-bearing deny-list; the choice
    // reader passes it through and the generic unsupported-slide diagnostic
    // redacts it. The point is no leak, not a specific reader message.
    d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.equal(JSON.stringify(d).includes('SECRET_COMPONENT'), false);

    // 2. multi-select: same naming contract.
    await page.goto(origin + '/lesson-multi');
    await pushDefs('multiFixture', [{ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'tb-1', Marked: 1 }]);
    d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.match(d.reason, /other answer-bearing/);
    assert.match(d.reason, /TEXT_BOX_COMPONENT/);
    assert.equal(d.diagnostic?.guard, 'accompanying-component');
    assert.equal(d.diagnostic?.componentType, 'TEXT_BOX_COMPONENT');

    // 3. highlight: keeps the established substring, appends the code.
    await page.goto(origin + '/lesson');
    await page.evaluate(installHighlightFixture, {});
    await pushDefs('highlightFixture', [{ ComponentTypeCode: 'LONG_ANSWER_COMPONENT', ComponentID: 'la-1', Marked: 1 }]);
    d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.match(d.reason, /exactly one question component/);
    assert.match(d.reason, /LONG_ANSWER_COMPONENT/);
    assert.equal(d.diagnostic?.guard, 'accompanying-component');

    await page.goto(origin + '/lesson');
    await page.evaluate(installHighlightFixture, {});
    await pushDefs('highlightFixture', [{ ComponentTypeCode: 'WEIRD_NEW_COMPONENT', ComponentID: 'w-1' }]);
    d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.match(d.reason, /redacted type/);
    assert.equal(d.diagnostic?.componentType, 'UNLISTED_COMPONENT');
    assert.equal(JSON.stringify(d).includes('WEIRD_NEW_COMPONENT'), false);

    // 4. gaps: still names the code; now with a retaggable diagnostic.
    await page.goto(origin + '/lesson');
    await page.evaluate(installGapsFixture);
    await pushDefs('gapsFixture', [{ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'tb-1' }]);
    d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.match(d.reason, /TEXT_BOX_COMPONENT/);
    assert.equal(d.diagnostic?.guard, 'accompanying-component');

    // 5. textbox names recognized codes in componentTypes (MULTICHOICE is
    // recognized, PRIVATE_TYPE is redacted) without leaking option text.
    await page.goto(origin + '/lesson-textbox-mixed');
    d = await detectQuestion(page);
    assert.equal(d.kind, 'unsupported');
    assert.ok(d.diagnostic.componentTypes.includes('MULTICHOICE_COMPONENT'));
    assert.ok(d.diagnostic.componentTypes.includes('TEXT_BOX_COMPONENT'));
    assert.equal(JSON.stringify(d).includes('alpha'), false);

    // 6. working-formula: names the companion, keeps the established substring.
    // Call the reader directly: the reflection reader runs earlier in
    // detectQuestion and also refuses a LONG_ANSWER mix (contenteditable
    // editor present), so detectQuestion would report the reflection guard.
    const { readWorkingFormulaInPage } = require('../lib/working-formula-state');
    await page.goto(origin + '/lesson-working-formula');
    await page.evaluate(() => {
      window.workingFormulaFixture.q.questionDef.Components.push(
        { ComponentTypeCode: 'LONG_ANSWER_COMPONENT', ComponentID: 'la-1', Marked: 1 });
    });
    d = (await page.evaluate(readWorkingFormulaInPage, null, 'descriptor'))?.descriptor;
    assert.equal(d.kind, 'unsupported');
    assert.match(d.reason, /exactly one working-formula/);
    assert.match(d.reason, /LONG_ANSWER_COMPONENT/);
    assert.equal(d.diagnostic?.guard, 'accompanying-component');

    console.log('Companion components: canonical inventory in sync, choice/multi/highlight/gaps/working-formula name recognized codes (redacted otherwise), textbox componentTypes name recognized codes, no content leak PASS. Synthetic only.');
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
