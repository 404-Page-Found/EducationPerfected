// Read-only Dash (timed sprint) capture (issue #230). A live Dash run on
// 2026-11-19 stopped at the Smart Lesson mode guard: the real round renders a
// multi-choice component under the CLASSIC game mode, with EP's QuizModel
// marking the sprint via isDash === true (public student chunk 171, QuizModel
// constructor, SHA-pinned in research/dash-source-map.md). The capture records
// the STRUCTURE of the Dash round it is run at: fixed field names and
// recognized codes only, never question/answer text, option text, arbitrary
// metadata keys, class strings, ids or attribute values.
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
const BUILD = 'dash-diagnostics-v1';
const INSPECT_DASH_PROGRAM = '(() => {' + INSPECTION_HELPERS
    + KNOWN_COMPONENT_CODES
    + VISIBILITY_COUNTERS
    + `
    const result = { build: 'dash-diagnostics-v1', readOnly: true };
`
    + ASSESSMENT_SHELL_GUARD
    + ROUTING
    + MODEL_WALK
    + GAME_MODE_FLAGS
    + GAME_MODE_ASSESSMENT_GUARD
    + `
    const activity = data(data(model, 'contentSource'), 'selectedActivity');
    const selectedActivity = activity && typeof activity === 'object' ? {
        taskIdNull: data(activity, '_taskID') === null,
        activityType: integer(data(activity, '_activityType')),
        contentType: integer(data(activity, '_contentType')),
    } : null;
`
    + QUESTION_DEFS
    + COMPONENT_SUMMARY
    + `
    const validAnswers = data(q, 'validAnswers');

    // The timer/score candidates are the selector names already invented by
    // the synthetic fixture plus the generic names EP's own templates use
    // (chunk 171 starter templates reference dash-timer styles; the in-round
    // markup is the open question this capture answers).
    const timerCandidates = {};
    for (const selector of ['#dash-timer', '#dash-score', '.dash-timer', '.dash-score', '.game-timer',
        '.quiz-timer', '.countdown', '.timer', '.score', '[class*="timer"]', '[class*="Timer"]',
        '[id*="timer"]', '[id*="score"]', '[class*="score"]', '[class*="Score"]']) {
        const n = count(selector);
        if (n) timerCandidates[selector] = n;
    }

    return {
        ...result,
        guard: 'captured',
        routing,
        gameMode,
        isDash,
        sectionData: shape(self, 'sectionData'),
        selectedActivity,
        question: q ? {
            contentIdValid: Number.isSafeInteger(data(q, 'contentID')) && data(q, 'contentID') > 0,
            questionIndexValid: Number.isSafeInteger(data(q, 'questionIndex')) && data(q, 'questionIndex') >= 0,
            questionType: integer(data(q, 'questionType')),
            translationMode: integer(data(q, 'translationMode')),
            isEPQuestion: bool(data(q, 'isEPQuestion')),
            validAnswersShape: shape(q, 'validAnswers'),
            validAnswersCount: Array.isArray(validAnswers) ? validAnswers.length : null,
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
            timerCandidates,
        },
    };
})()`;
async function collectDashDiagnostics(page, { shouldStop, timeoutMs } = {}) {
    return collectInspection(page, { build: BUILD, program: INSPECT_DASH_PROGRAM, shouldStop, timeoutMs });
}
module.exports = { BUILD, INSPECT_DASH_PROGRAM, collectDashDiagnostics };
