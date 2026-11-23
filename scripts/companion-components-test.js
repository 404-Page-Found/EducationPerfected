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
  ANSWER_BEARING_CODES,
  formatAccompanyingCode,
  diagnosticComponentType,
} = require('../lib/companion-components');
const { installGapsFixture } = require('./gaps-fixture');
const { installHighlightFixture } = require('./highlight-fixture');
const { setup: setupMath } = require('./choice-renderer-fixture');

const REQUIRED_KNOWN = ['LONG_ANSWER_COMPONENT', 'MULTICHOICE_COMPONENT', 'TEXT_BOX_COMPONENT',
  'FILE_UPLOADER_COMPONENT', 'SOUND_RECORDER_COMPONENT', 'FORMULA_COMPONENT',
  'ANNOTATED_TEXT_COMPONENT', 'SOUND_COMPONENT', 'SCRATCH_PAD_COMPONENT'];

(async () => {
  // 0. Canonical module shape: presentation-only pair, known codes, formatters.
  assert.deepEqual([...PRESENTATION_COMPONENTS].sort((a, b) => a.localeCompare(b)), ['ANNOTATED_TEXT_COMPONENT', 'SOUND_COMPONENT'].sort((a, b) => a.localeCompare(b)));
  for (const code of REQUIRED_KNOWN) assert.ok(KNOWN_COMPONENT_CODES.includes(code), code);
  assert.equal(formatAccompanyingCode('LONG_ANSWER_COMPONENT'), 'LONG_ANSWER_COMPONENT');
  assert.equal(formatAccompanyingCode('SECRET_COMPONENT'), 'redacted type');
  assert.equal(formatAccompanyingCode(null), 'redacted type');
  assert.equal(diagnosticComponentType('LONG_ANSWER_COMPONENT'), 'LONG_ANSWER_COMPONENT');
  assert.equal(diagnosticComponentType('SECRET_COMPONENT'), 'UNLISTED_COMPONENT');

  // 0b. In-page mirrors stay semantically in sync with the canonical module.
  // Each reader keeps a self-contained copy (different encodings to avoid
  // exact-duplicate blocks); compare Set equality, not source substrings.
  const canonicalKnownSorted = [...KNOWN_COMPONENT_CODES].sort((a, b) => a.localeCompare(b));
  const canonicalPresSorted = [...PRESENTATION_COMPONENTS].sort((a, b) => a.localeCompare(b));
  const extractKnownCodes = (text) => {
    const idx = text.search(/KNOWN_COMPONENT_CODES\s*=\s*new Set|knownCodes\s*=\s*new Set/);
    assert.ok(idx !== -1, 'knownCodes mirror not found');
    const slice = text.slice(idx, idx + 3000);
    // Space-joined encodings (base names + suffix, or full codes split by
    // space): the only uppercase space-joined literals in these readers are
    // the known list itself (answer-bearing/presentation use single-code
    // array literals), so collecting them is safe.
    const spacePieces = [...slice.matchAll(/'([A-Z_ ]+)'/g)].map(m => m[1]).filter(s => /^[A-Z_ ]+$/.test(s) && s.includes(' '));
    if (spacePieces.length) {
      const tokens = spacePieces.join(' ').split(/\s+/).filter(Boolean).map(t => t.endsWith('_COMPONENT') ? t : t + '_COMPONENT');
      return [...new Set(tokens)].sort((a, b) => a.localeCompare(b));
    }
    const end = slice.indexOf(']);');
    const block = end !== -1 ? slice.slice(0, end) : slice;
    const codes = [...block.matchAll(/'([A-Z_]+_COMPONENT)'/g)].map(m => m[1]);
    assert.ok(codes.length, 'known full-code list not found');
    return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
  };
  const extractPresentation = (text) => {
    const m = text.match(/(?:presentation|presentationCodes|PRESENTATION_COMPONENTS)\s*=\s*new Set\(\[([^\]]+)\]\)/);
    if (!m) return null;
    const codes = [...m[1].matchAll(/'([A-Z_]+_COMPONENT)'/g)].map(x => x[1]);
    return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
  };
  const extractAnswerBearing = (text) => {
    const m = text.match(/answerBearingCodes\s*=\s*\[([^\]]+)\]/);
    if (!m) return null;
    return [...m[1].matchAll(/'([A-Z_]+_COMPONENT)'/g)].map(x => x[1]);
  };
  const libDir = path.join(__dirname, '..', 'lib');
  const mirrorFiles = ['choice-state.js', 'multi-choice-state.js', 'highlight-state.js',
    'working-formula-state.js', 'textbox-state.js', 'gaps-state.js', 'info-slide-state.js'];
  // The info-slide reader refuses every component, so it mirrors only the
  // known-codes list (to name refusals); no presentation or answer-bearing
  // admission applies to it.
  const knownOnly = new Set(['info-slide-state.js']);
  // Canonical answer-bearing minus the choice readers' own component type:
  // choice/multi exclude MULTICHOICE_COMPONENT (their own surface, handled via
  // the choices list) and rely on scratchPadAnswerBearing for the conditional
  // SCRATCH_PAD_COMPONENT (absent from the canonical answer-bearing list).
  const canonicalBearingMinusOwn = [...ANSWER_BEARING_CODES].filter(c => c !== 'MULTICHOICE_COMPONENT').sort((a, b) => a.localeCompare(b));
  for (const file of mirrorFiles) {
    const text = fs.readFileSync(path.join(libDir, file), 'utf8');
    assert.ok(text.includes('lib/companion-components.js'), `${file} missing canonical reference`);
    assert.deepEqual(extractKnownCodes(text), canonicalKnownSorted, `${file} knownCodes mirror out of sync`);
    if (!knownOnly.has(file)) {
      const pres = extractPresentation(text);
      if (pres) {
        assert.deepEqual(pres, canonicalPresSorted, `${file} presentation mirror out of sync`);
      } else {
        // Choice/multi-choice admit presentation companions via the
        // answer-bearing deny-list (no explicit presentation Set): the
        // presentation pair must be known but not answer-bearing.
        const bearing = extractAnswerBearing(text);
        assert.ok(bearing, `${file} has neither presentation nor answer-bearing list`);
        for (const code of canonicalPresSorted) assert.ok(!bearing.includes(code), `${file} marks presentation ${code} answer-bearing`);
      }
      const bearing = extractAnswerBearing(text);
      if (bearing) {
        assert.deepEqual([...new Set(bearing)].sort((a, b) => a.localeCompare(b)), canonicalBearingMinusOwn, `${file} answerBearingCodes mirror out of sync (expected canonical minus MULTICHOICE_COMPONENT)`);
      }
    }
  }
  // Shared capture segment derives from the canonical module (no copied list).
  const inspection = require('../lib/question-inspection');
  const inspectionSource = fs.readFileSync(path.join(libDir, 'question-inspection.js'), 'utf8');
  assert.ok(inspectionSource.includes('companion-components'), 'question-inspection not wired to canonical module');
  for (const code of KNOWN_COMPONENT_CODES) {
    assert.ok(inspection.KNOWN_COMPONENT_CODES.includes(code), `question-inspection missing ${code}`);
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
