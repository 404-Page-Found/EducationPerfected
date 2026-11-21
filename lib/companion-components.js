// Canonical question-component companion inventory (issue #231).
// Source: EP public chunk606, checked 19 November 2026 (14,736,150 bytes),
// research/component-companion-inventory.md.
//
// Policy (chosen explicitly, fail-closed-with-report):
// - SOUND_COMPONENT and ANNOTATED_TEXT_COMPONENT are proven presentation-only
//   (isInput false; constant response-independent marking payloads) and are
//   admitted as companions by every single-surface reader.
// - SCRATCH_PAD_COMPONENT is admitted only on runtime proof it is unmarked
//   under EP's own loose check (marked == MARKED fails): exactly one
//   baseComponents entry, builder type 'scratch-pad', matching component id.
//   A marked, wrong-type, ambiguous or unverifiable pad stays answer-bearing
//   and refuses the slide.
// - FILE_UPLOADER_COMPONENT and SOUND_RECORDER_COMPONENT stay refused by
//   product decision (19 November 2026): EP auto-marks both full marks either
//   way, but the upload/recording is a real student response.
// - Every other unlisted type code refuses with `redacted type`; recognized
//   EP codes are named. Never carry template text or page content.
//
// In-page readers (lib/*-state.js) run inside page.evaluate and must stay
// self-contained, so they keep local copies of these sets. Those copies are
// mirrors of this canonical module: scripts/companion-components-test.js
// asserts they stay in sync. Node-side code (diagnostics, tests) should
// require this module instead of copying the lists.

const PRESENTATION_COMPONENTS = Object.freeze([
  'ANNOTATED_TEXT_COMPONENT',
  'SOUND_COMPONENT',
]);

const KNOWN_COMPONENT_CODES = Object.freeze([
  'ANNOTATED_QUESTION_COMPONENT',
  'ANNOTATED_TEXT_COMPONENT',
  'DEPTH_COMPONENT',
  'DROPDOWN_COMPONENT',
  'FILE_UPLOADER_COMPONENT',
  'FILL_IN_GAPS_COMPONENT',
  'FORMULA_COMPONENT',
  'FREEFORM_WORKING_COMPONENT',
  'HIGHLIGHT_COMPONENT',
  'LONG_ANSWER_COMPONENT',
  'MULTICHOICE_COMPONENT',
  'NUMBER_BOX_COMPONENT',
  'SCRATCH_PAD_COMPONENT',
  'SOUND_COMPONENT',
  'SOUND_RECORDER_COMPONENT',
  'TEXT_BOX_COMPONENT',
  'TYPE_ARROW_COMPONENT',
  'TYPE_EQUALS_COMPONENT',
  'TYPE_EXPONENT_COMPONENT',
  'TYPE_GROUP_COMPONENT',
  'TYPE_MATH_ENTITY_COMPONENT',
  'TYPE_MATH_FUNCTION_COMPONENT',
  'TYPE_MULTI_OPERATOR_COMPONENT',
  'TYPE_NUMBER_COMPONENT',
  'TYPE_OR_COMPONENT',
  'TYPE_SUBSCRIPT_SUPERSCRIPT_COMPONENT',
  'TYPE_TEXT_COMPONENT',
  'TYPE_UNARY_OPERATOR_COMPONENT',
  'WORKING_FORMULA_COMPONENT',
]);

const ANSWER_BEARING_CODES = Object.freeze([
  'ANNOTATED_QUESTION_COMPONENT',
  'DROPDOWN_COMPONENT',
  'FILL_IN_GAPS_COMPONENT',
  'FORMULA_COMPONENT',
  'FREEFORM_WORKING_COMPONENT',
  'FILE_UPLOADER_COMPONENT',
  'HIGHLIGHT_COMPONENT',
  'LONG_ANSWER_COMPONENT',
  'MULTICHOICE_COMPONENT',
  'NUMBER_BOX_COMPONENT',
  'SOUND_RECORDER_COMPONENT',
  'TEXT_BOX_COMPONENT',
  'WORKING_FORMULA_COMPONENT',
]);

function isKnownComponentCode(code) {
  return typeof code === 'string' && KNOWN_COMPONENT_CODES.includes(code);
}

// Content-free naming for refusals: recognized EP codes by name, anything
// else the literal 'redacted type'. Never returns page content.
function formatAccompanyingCode(code) {
  return isKnownComponentCode(code) ? code : 'redacted type';
}

// Diagnostic-safe variant: recognized codes by name, anything else the
// literal 'UNLISTED_COMPONENT' (matches components-diagnostics convention).
function diagnosticComponentType(code) {
  return isKnownComponentCode(code) ? code : 'UNLISTED_COMPONENT';
}

module.exports = {
  PRESENTATION_COMPONENTS,
  KNOWN_COMPONENT_CODES,
  ANSWER_BEARING_CODES,
  isKnownComponentCode,
  formatAccompanyingCode,
  diagnosticComponentType,
};
