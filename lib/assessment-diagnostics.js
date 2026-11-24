// Read-only Assessment capture (issue #33). Assessment answering stays
// disabled; this command only records the STRUCTURE of an Assessment page so a
// real capture can drive the renderer/markability mapping that
// research/assessment-question-state.md lists as the remaining unknown.
//
// Like the other captures it runs inside the page, records fixed field names,
// counts, shapes and recognized codes only, and never question text, answer
// text, option text, stored answers, ids, class strings or attribute values.
// It reads own data properties through descriptors (accessors are never run),
// calls no EP method (no getQuestionWithIndex, no marking, no storage call,
// no cleanup), fires no events and clicks nothing. It does NOT apply the
// refusal that question detection applies to an Assessment shell: reading
// the Assessment shape is its whole purpose, and it is still non-mutating.
// A page that is not an Assessment (gameMode other than 2) is refused.
const { INSPECTION_HELPERS, collectInspection } = require('./inspection');
const {
    KNOWN_COMPONENT_CODES,
    VISIBILITY_COUNTERS,
    ROUTING,
    MODEL_WALK,
    GAME_MODE_FLAGS,
    QUESTION_DEFS,
    COMPONENT_SUMMARY,
} = require('./question-inspection');
const BUILD = 'assessment-inspect-v1';
const INSPECT_ASSESSMENT_PROGRAM = '(() => {' + INSPECTION_HELPERS
    + KNOWN_COMPONENT_CODES
    + VISIBILITY_COUNTERS
    + `
    const result = { build: 'assessment-inspect-v1', readOnly: true };
`
    + ROUTING
    + MODEL_WALK
    + GAME_MODE_FLAGS
    + `
    if (gameMode !== 2) return { ...result, guard: 'not-assessment', routing, gameMode, isDash };
`
    + QUESTION_DEFS
    + COMPONENT_SUMMARY
    + `
    // Mounted-shell census: element and visible-button counts per fixed
    // custom element, never the element's text or markup.
    const shellCount = tag => {
        const els = [...document.querySelectorAll(tag)];
        return {
            elements: els.length,
            visible: els.filter(shown).length,
            visibleControls: els.reduce((n, el) => n + [...el.querySelectorAll('button,a,input,select,textarea,[role="button"]')].filter(shown).length, 0),
        };
    };
    // Shape-only probes of fixed stored-state keys on the current question.
    // Values are never read into the report.
    const storedKeys = ['UsersAnswer', 'UserState', 'QuestionState', 'Attempted', 'Seen', 'FlaggedForLater', 'Grade', 'ScoreFraction'];
    const stored = {};
    for (const key of storedKeys) stored[key] = shape(q, key);
    return {
        ...result,
        guard: 'captured',
        routing,
        gameMode,
        isDash,
        modelShapes: {
            _currentQuestion: shape(model, '_currentQuestion'),
            questions: shape(model, 'questions'),
            activityData: shape(self, 'activityData'),
            sectionData: shape(self, 'sectionData'),
        },
        question: q ? {
            contentIdValid: Number.isSafeInteger(data(q, 'contentID')) && data(q, 'contentID') > 0,
            questionIndexValid: Number.isSafeInteger(data(q, 'questionIndex')) && data(q, 'questionIndex') >= 0,
            questionType: integer(data(q, 'questionType')),
            translationMode: integer(data(q, 'translationMode')),
            componentCount: Array.isArray(defs) ? defs.length : null,
            components,
            componentsTruncated: Array.isArray(defs) && defs.length > 20,
            stored,
        } : null,
        shell: {
            actionBar: shellCount('game-assessment-action-bar'),
            sideBar: shellCount('game-assessment-side-bar'),
            navigationControls: shellCount('game-assessment-navigation-controls'),
        },
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
            canvases: count('canvas'),
        },
    };
})()`;
async function collectAssessmentDiagnostics(page, { shouldStop, timeoutMs } = {}) {
    return collectInspection(page, { build: BUILD, program: INSPECT_ASSESSMENT_PROGRAM, shouldStop, timeoutMs });
}
module.exports = { BUILD, INSPECT_ASSESSMENT_PROGRAM, collectAssessmentDiagnostics };
