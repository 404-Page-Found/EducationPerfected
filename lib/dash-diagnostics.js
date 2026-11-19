// Read-only Dash (timed sprint) capture (issue #230). A live Dash run on
// 2026-11-19 stopped at the Smart Lesson mode guard: the real round renders a
// multi-choice component under the CLASSIC game mode, with EP's QuizModel
// marking the sprint via isDash === true (public student chunk 171, QuizModel
// constructor, SHA-pinned in research/dash-source-map.md). No live capture of
// the round's question state exists yet, so this command records the
// STRUCTURE Page's next Dash round shows: fixed field names and recognized
// codes only, never question/answer text, option text, arbitrary metadata
// keys, class strings, ids or attribute values.
//
// The capture runs INSIDE the page; its program is composed from the shared
// helper source (lib/inspection.js) so the in-page code stays self-contained
// without duplicating the helpers.
const { INSPECTION_HELPERS, collectInspection } = require('./inspection');
const BUILD = 'dash-diagnostics-v1';
const INSPECT_DASH_PROGRAM = '(() => {' + INSPECTION_HELPERS + `
    const known = new Set(('ANNOTATED_QUESTION ANNOTATED_TEXT DEPTH DROPDOWN FILE_UPLOADER FILL_IN_GAPS'
        + ' FORMULA FREEFORM_WORKING HIGHLIGHT LONG_ANSWER MULTICHOICE NUMBER_BOX SCRATCH_PAD SOUND SOUND_RECORDER'
        + ' TEXT_BOX TYPE_ARROW TYPE_EQUALS TYPE_EXPONENT TYPE_GROUP TYPE_MATH_ENTITY TYPE_MATH_FUNCTION'
        + ' TYPE_MULTI_OPERATOR TYPE_NUMBER TYPE_OR TYPE_SUBSCRIPT_SUPERSCRIPT TYPE_TEXT TYPE_UNARY_OPERATOR'
        + ' WORKING_FORMULA').split(' ').map(c => c + '_COMPONENT'));
    const shown = el => !!el && !el.hidden
        && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0));
    const count = selector => {
        try { return [...document.querySelectorAll(selector)].filter(shown).length; } catch (e) { return null; }
    };

    const result = { build: 'dash-diagnostics-v1', readOnly: true };

    // Same refusal boundary as detection: an assessment shell is never read
    // for question state, even by a read-only capture.
    const assessmentControls = [...document.querySelectorAll('game-assessment-action-bar, game-assessment-side-bar, game-assessment-navigation-controls')];
    if (assessmentControls.some(el => shown(el)
        || [...el.querySelectorAll('button,a,input,select,textarea,[role="button"]')].some(shown))) {
        return { ...result, guard: 'assessment-mode' };
    }

    // The URL stays private; only the two routing facts a Dash session needs.
    const path = String(location && location.pathname || '');
    const routing = { pathIncludesDash: /dash/i.test(path), pathIncludesQuiz: /quiz/i.test(path) };

    // The game model hangs off the AngularJS scope's self, found by walking
    // up from a rendered anchor (the same approach as the question readers).
    const anchors = [
        ...document.querySelectorAll('div.multi-choice-component[role=radiogroup]'),
        document.querySelector('#question-text'),
        document.querySelector('#ep-question-container'),
        document.querySelector('.voice-speaker'),
        document.body,
    ].filter(Boolean);
    let self = null, model = null;
    for (const anchor of anchors) {
        for (let el = anchor, depth = 0; el && depth < 20; el = el.parentElement, depth++) {
            try {
                const scope = window.angular?.element?.(el)?.scope?.();
                const candidate = data(scope, 'self'), candidateModel = data(candidate, 'model');
                if (candidateModel) { self = candidate; model = candidateModel; break; }
            } catch { break; } // Do not fall through an unreadable scope to an ancestor.
        }
        if (model) break;
    }
    if (!model) return { ...result, guard: 'model-unreadable', routing };

    const gameMode = integer(data(model, 'gameMode'));
    const isDash = bool(data(model, 'isDash'));
    // Model-level assessment boundary: the DOM shell check above only covers
    // mounted controls, so gameMode is checked before any question state is
    // read.
    if (gameMode === 2) return { ...result, guard: 'assessment-mode', routing, gameMode, isDash };
    const activity = data(data(model, 'contentSource'), 'selectedActivity');
    const selectedActivity = activity && typeof activity === 'object' ? {
        taskIdNull: data(activity, '_taskID') === null,
        activityType: integer(data(activity, '_activityType')),
        contentType: integer(data(activity, '_contentType')),
    } : null;

    const q = data(model, '_currentQuestion');
    const def = data(q, 'questionDef');
    const defs = data(def, 'Components');
    const components = Array.isArray(defs) ? Array.from({ length: Math.min(defs.length, 20) }, (_, i) => {
        const c = data(defs, String(i)), code = data(c, 'ComponentTypeCode');
        const options = data(c, 'Options');
        const optionCount = Array.isArray(options) ? options.length : null;
        // Structural counts only: which fixed Correct representations the
        // options carry, never the option text or the answer itself. Indexed
        // reads go through property descriptors too: a getter on an array
        // index must not run (same accessor-free contract as the rest of the
        // capture).
        let correctStringTrue = null, correctBooleanTrue = null, correctFieldShapes = null;
        if (Array.isArray(options)) {
            correctStringTrue = 0;
            correctBooleanTrue = 0;
            const shapes = new Set();
            for (let i = 0; i < options.length; i++) {
                const option = data(options, String(i));
                const correct = data(option, 'Correct');
                if (correct === 'true') correctStringTrue++;
                if (correct === true) correctBooleanTrue++;
                if (i < 10) shapes.add(shape(option, 'Correct'));
            }
            correctFieldShapes = [...shapes];
        }
        return {
            type: known.has(code) ? code : 'UNLISTED_COMPONENT',
            allowMultiSelect: bool(data(c, 'AllowMultiSelect')),
            marked: integer(data(c, 'Marked')),
            optionsShape: shape(c, 'Options'),
            optionCount,
            correctStringTrue,
            correctBooleanTrue,
            correctFieldShapes,
        };
    }) : [];

    const validAnswers = data(q, 'validAnswers');

    // Fixed candidate selectors only; a match reports a count, never the
    // matched element's own markup. The timer/score candidates are the
    // selector names already invented by the synthetic fixture plus the
    // generic names EP's own templates use (chunk 171 starter templates
    // reference dash-timer styles; the in-round markup is the open question
    // this capture answers).
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
