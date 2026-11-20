// Read-only Smart Lesson slide component capture (issue #231). A slide that
// pairs a supported question with an unrecognized accompanying component is
// refused in full ("unsupported accompanying component: <CODE|redacted
// type>"), and until now only the refusal's single first code was visible.
// This capture records the slide's whole questionDef.Components STRUCTURE:
// fixed field names and recognized codes only, never question/answer text,
// option text, arbitrary metadata keys, class strings, ids or attribute
// values. The inventory of which codes are presentation-only vs
// answer-bearing lives in research/component-companion-inventory.md; this
// capture is how a real slide's codes reach that inventory.
//
// The capture runs INSIDE the page; its program is composed from the shared
// helper source (lib/inspection.js) and the shared capture segments
// (lib/question-inspection.js) so the in-page code stays self-contained
// without duplicating the helpers.
const { INSPECTION_HELPERS, collectInspection } = require('./inspection');
const {
    KNOWN_COMPONENT_CODES,
    VISIBILITY_COUNTERS,
    ASSESSMENT_SHELL_GUARD,
    ROUTING,
    MODEL_WALK,
    GAME_MODE_FLAGS,
    GAME_MODE_ASSESSMENT_GUARD,
    QUESTION_DEFS,
    COMPONENT_SUMMARY,
} = require('./question-inspection');
const BUILD = 'components-inspect-v1';
const INSPECT_COMPONENTS_PROGRAM = '(() => {' + INSPECTION_HELPERS
    + KNOWN_COMPONENT_CODES
    + VISIBILITY_COUNTERS
    + `
    const result = { build: 'components-inspect-v1', readOnly: true };
`
    + ASSESSMENT_SHELL_GUARD
    + ROUTING
    + MODEL_WALK
    + GAME_MODE_FLAGS
    + GAME_MODE_ASSESSMENT_GUARD
    + `
    // Scope: this capture exists for refused Smart Lesson slides (issue #231).
    // Dash rounds have their own inspect-dash capture and classic tasks carry
    // no component inventory, so only gameMode 3 proceeds to question state.
    if (gameMode !== 3) return { ...result, guard: 'not-smart-lesson', routing, gameMode, isDash };
`
    + QUESTION_DEFS
    + COMPONENT_SUMMARY
    + `
    // Fixed selectors only, counts only: which answer surfaces the slide
    // shows, plus the editable-control census the foreign-editable refusals
    // guard (an input/textarea/select/contenteditable outside the reader's own
    // component stops the slide). No element markup is ever reported.
    return {
        ...result,
        guard: 'captured',
        routing,
        gameMode,
        isDash,
        sectionData: shape(self, 'sectionData'),
        question: q ? {
            contentIdValid: Number.isSafeInteger(data(q, 'contentID')) && data(q, 'contentID') > 0,
            questionIndexValid: Number.isSafeInteger(data(q, 'questionIndex')) && data(q, 'questionIndex') >= 0,
            questionType: integer(data(q, 'questionType')),
            translationMode: integer(data(q, 'translationMode')),
            componentCount: Array.isArray(defs) ? defs.length : null,
            components,
            componentsTruncated: Array.isArray(defs) && defs.length > 20,
        } : null,
        dom: {
            questionText: count('#question-text'),
            answerText: count('input#answer-text'),
            speaker: count('.voice-speaker'),
            choiceGroups: count('div.multi-choice-component[role=radiogroup]'),
            choiceOptions: count('div.multi-choice-component[role=radiogroup] div.mcq-preview-option'),
            submitButtons: count('button.submit-button'),
            exitButton: count('.exit-button'),
            inputs: count('input'),
            textareas: count('textarea'),
            selects: count('select'),
            contentEditables: count('[contenteditable]'),
        },
    };
})()`;
async function collectComponentsDiagnostics(page, { shouldStop, timeoutMs } = {}) {
    return collectInspection(page, { build: BUILD, program: INSPECT_COMPONENTS_PROGRAM, shouldStop, timeoutMs });
}
module.exports = { BUILD, INSPECT_COMPONENTS_PROGRAM, collectComponentsDiagnostics };
