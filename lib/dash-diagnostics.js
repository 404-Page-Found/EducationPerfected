// Read-only Dash (timed sprint) capture (issue #230). A live Dash run on
// 2026-11-19 stopped at the Smart Lesson mode guard: the real round renders a
// multi-choice component under the CLASSIC game mode, with EP's QuizModel
// marking the sprint via isDash === true (public student chunk 171, QuizModel
// constructor, SHA-pinned in research/dash-source-map.md). No live capture of
// the round's question state exists yet, so this command records the
// STRUCTURE Page's next Dash round shows: fixed field names and recognized
// codes only, never question/answer text, option text, arbitrary metadata
// keys, class strings, ids or attribute values.
const BUILD = 'dash-diagnostics-v1';
function inspectDashInPage() {
    // Cached model properties must be own data properties. Accessors are not run.
    const data = (o, k) => o && typeof o === 'object' ? Object.getOwnPropertyDescriptor(o, k)?.value : undefined;
    const integer = v => Number.isSafeInteger(v) ? v : null;
    const bool = v => typeof v === 'boolean' ? v : null;
    const shape = (o, k) => {
        const d = o && typeof o === 'object' ? Object.getOwnPropertyDescriptor(o, k) : null;
        if (!d) return 'absent';
        if (!Object.hasOwn(d, 'value')) return 'accessor';
        const v = d.value;
        return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    };
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

    const result = { build: 'dash-diagnostics-v1', readOnly: true }; // literal: this function runs inside the page, module scope is unavailable

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

    // The game model hangs off the AngularJS scope's `self`, found by walking
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
        // options carry, never the option text or the answer itself.
        let correctStringTrue = null, correctBooleanTrue = null, correctFieldShapes = null;
        if (Array.isArray(options)) {
            correctStringTrue = options.filter(o => data(o, 'Correct') === 'true').length;
            correctBooleanTrue = options.filter(o => data(o, 'Correct') === true).length;
            correctFieldShapes = [...new Set(options.slice(0, 10).map(o => shape(o, 'Correct')))];
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
    // generic names EP's own templates use (chunk 171: "dash-timer" styles
    // exist in the starter templates; the in-round markup is the open
    // question this capture answers).
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
}
async function collectDashDiagnostics(page, { shouldStop = () => false, timeoutMs = 2000 } = {}) {
    if (shouldStop()) return { build: BUILD, guard: 'cancelled' };
    let timer;
    const pending = Promise.resolve().then(() => shouldStop() ? { build: BUILD, guard: 'cancelled' } : page.evaluate(inspectDashInPage))
        .catch(() => ({ build: BUILD, guard: 'inspection-unavailable' }));
    const deadline = Date.now() + Math.min(2000, Math.max(1, timeoutMs));
    const stop = new Promise(resolve => {
        const poll = () => {
            if (shouldStop()) resolve({ build: BUILD, guard: 'cancelled' });
            else if (Date.now() >= deadline) resolve({ build: BUILD, guard: 'timeout' });
            else timer = setTimeout(poll, Math.min(25, deadline - Date.now()));
        };
        poll();
    });
    try { return await Promise.race([pending, stop]); } finally { clearTimeout(timer); }
}
module.exports = { BUILD, inspectDashInPage, collectDashDiagnostics };
