// Per-round question detection for the answer loop.
//
// The classic flow knows exactly one question shape: text in #question-text,
// answered into input#answer-text. Smart Lessons/Assessments and the audio
// modes (Listening, Dictation) render different shapes, so every pass of the
// loop starts by asking the page what it is actually showing (issue #33, #32).
//
// The selector and state facts below were audited against the live EP app on
// 2026-10-30 (an Italian Smart Lesson choice slide, and Listening + Dictation
// modes on a vocabulary list), not derived from mocks. Live-verified:
//
//   - Smart Lesson slides mount under #ep-question-container and never render
//     #question-text. The prompt lives in #question-container-group as styled
//     spans (no semantic marker on the target word).
//   - A multiple-choice slide is div.multi-choice-component[role=radiogroup]
//     with div.mcq-preview-option[role=option] children. The per-option ids
//     (check, content-container, button-group) repeat per option, so only the
//     class hooks are safe to select on. (The selected-state styling was NOT
//     observed - no option was ever clicked - so selection is done with a
//     trusted click on the option element, not by reading classes.)
//   - Audio tasks render a .voice-speaker speaker button; #question-text
//     exists but is hidden and empty, and the answer still goes into the
//     visible input#answer-text. Listening and Dictation render the same
//     markup, differing only in prompt text, answer language and
//     translationMode (2 vs 3).
//   - Round identity fields on the same scope state: contentID was captured
//     as a number on both surfaces (lesson 1643503, audio 173943);
//     questionIndex was captured as a number (0) on both the lesson slide and
//     a Listening item (2026-10-30 follow-up read); translationMode was
//     captured as 2 (Listening) and 3 (Dictation), and 4 on the choice slide.
//   - The 2026-10-30 follow-up Listening probe confirmed CONTROLLER
//     self.sectionData === undefined (the earlier probe read the wrong model
//     path). Dictation's controller absence was not separately rechecked.
//     The list-context signal is contentSource.selectedActivity (see below).
//   - EP is an AngularJS app. The current question's data - including the
//     answers EP ships to the client - is readable before any submission from
//     the component scope:
//       multi-choice: scope.self.model._currentQuestion.questionDef
//           .Components[].Options[] with Correct === "true" on the right one
//           (verified live: the Correct option matched the rendered options)
//       translation/audio: scope.self.model._currentQuestion.validAnswers[]
//           .outputString (accepted answers, response language; verified live
//           on both Listening and Dictation items)
//     When that scope state is unreadable the descriptor says so explicitly;
//     the loop must stop and report rather than guess (no answer source is
//     better than a wrong one).
//
// NOT live-verified: the lesson short-answer ("typed") branch. No short-answer
// lesson slide was observed; that branch extrapolates the audio task's
// validAnswers shape to lesson slides with a visible answer box, and the
// fixtures exercise it only through the mock.
//
// Dash (timed sprint, issues #230/#273): live Dash runs on 2026-11-19 and
// 2026-11-20 stopped at the choice reader's Smart Lesson mode guard - the
// real rounds run on the QuizModel (gameMode CLASSIC, isDash === true), not
// Smart Lesson mode. The 19 November EP_DASH_INSPECT capture recorded the
// multi-choice round's shape, so the choice reader (lib/choice-state.js)
// answers the confirmed Dash multi-choice round on a dash route and refuses
// every other Dash shape by name; the 20 November capture (#272) recorded a
// typed round (#question-text + input#answer-text, questionType 0,
// translationMode 0, one validAnswers entry, no components), so the typed
// reader (lib/dash-typed-state.js) answers exactly that shape and refuses
// every deviation by name. The audio reader still refuses Dash rounds by
// name (dash: true): no such Dash layout has been captured. The shared
// lesson input-boxes reader (lib/textbox-state.js) names Dash the same way
// after the second 2026-11-20 capture (#282) showed a Dash round mounting a
// NUMBER_BOX_COMPONENT (with no shipped answer). Layouts those readers do
// not recognize still stop unanswered on the generic paths.
//
// detectQuestionInPage runs INSIDE the page (via page.evaluate); it must stay
// self-contained: no references to anything outside its own body.

/**
 * Classifies the question currently on screen.
 * @returns {null|object} null during round transitions, otherwise a descriptor:
 *   {kind:'text', text}                        classic word-to-word question
 *   {kind:'audio', key, answers[], translationMode}
 *   {kind:'choice', key, options[{text,visible}], correct[], multi, autoMarked}
 *   {kind:'typed', key, answers[], questionType}   lesson short-answer slide
 *   {kind:'dash-typed', key, text, answers[], dash}   Dash timed-sprint typed round (#272 shape)
 *   {kind:'dropdown', key, dropdowns[], autoMarked}   lesson dropdown slide
 *   {kind:'highlight', key, correct[], selected[], autoMarked}   Smart Lesson click-the-correct-tokens slide
 *   {kind:'info-slide', representation, key}  lesson information slide: nothing to answer; Continue only (#327)
 *   {kind:'unsupported', reason}               recognised shape, no answer source
 */
// One static Puppeteer callback serves detection (no arguments).
// Choice slides moved to lib/choice-state.js (17 November 2026); choice
// handle reads moved with them.
function detectQuestionInPage() {
    // Read existing cached objects only. No renderer initialization, conversion,
    // selection, text equivalence or positional assumptions. Public EP bundles:
    // 171 EPTestQuestion.cachedRenderers[MODE_QUESTION=1]; 606 ComponentIndex,
    // MultiChoiceComponentState.previewOptions and MCQPreviewOption element/option.

    const visible = (el) => !!(el && (el.offsetParent !== null
        || (el.getClientRects && el.getClientRects().length > 0)));

    // The game model hangs off the AngularJS scope's `self`. EP nests
    // components, so walk up a few ancestors looking for a scope that has the
    // current question on it.
    const currentQuestionFrom = (el) => {
        if (!el || !window.angular || typeof angular.element !== 'function') return null;
        for (let node = el, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
            try {
                const scope = angular.element(node).scope && angular.element(node).scope();
                const self = scope && scope.self;
                if (self && self.model && self.model._currentQuestion) {
                    return { self, question: self.model._currentQuestion };
                }
            } catch (e) { /* not a scoped node; keep walking */ }
        }
        return null;
    };

    const validAnswersOf = (q) => (Array.isArray(q.validAnswers) ? q.validAnswers : [])
        .map(a => a && a.outputString)
        .filter(s => typeof s === 'string' && s.trim() !== '');

    // How EP says this activity is graded, with provenance. Captured live
    // (2026-10-30) on a Smart Lesson at
    // scope.self.sectionData.activityGroup: isAutoMarked: true as a real
    // boolean (alongside isSelfMarked: false, QuestionMarkingStyle: -1). The
    // field was NEVER captured on an audio task, so its absence there proves
    // nothing. Fail closed everywhere: only an explicit boolean true is
    // "auto"; an explicit false is manual; anything else (missing field,
    // missing sectionData, non-boolean) is 'unknown', and handlers must not
    // treat unknown as auto.
    const autoMarkingOf = (self) => {
        try {
            const group = self?.sectionData?.activityGroup;
            if (!group) return 'unknown';
            if (group.isAutoMarked === true) return true;
            if (group.isAutoMarked === false) return false;
            return 'unknown';
        } catch (e) { return 'unknown'; }
    };

    // Whether controller sectionData EXISTS at all. Only undefined permits
    // considering the list allowance; null, a number or any other malformed
    // value is present-but-wrong. Controller absence was confirmed on Listening
    // in the 2026-10-30 follow-up, not separately rechecked on Dictation.
    const sectionDataPresentOf = (self) => {
        try {
            return !(self && self.sectionData === undefined);
        } catch (e) { return true; }   // unreadable: treat as present, never as the captured absent shape
    };

    // The follow-up Listening probe confirmed self.sectionData is undefined;
    // the earlier probe read the wrong game-model path. Dictation controller
    // absence remains inferred. The captured positive context signal is
    // model.contentSource.selectedActivity with
    //   _taskID: null        (not an assigned task)
    //   _activityType: 1     (vocabulary list)
    //   _contentType: 1      (translation content)
    // The inference "a self-test list game has no teacher-marking surface" is
    // exactly that - an inference from these field values, partially
    // corroborated by EP's own help centre distinguishing assigned work (with
    // marking options) from self-directed library learning. It is NOT proof:
    // the full captured shape must match, and anything else stays stopped.
    const selfTestListOf = (self) => {
        try {
            const sa = self && self.model && self.model.contentSource && self.model.contentSource.selectedActivity;
            if (!sa || typeof sa !== 'object') return false;
            return sa._taskID === null && sa._activityType === 1 && sa._contentType === 1;
        } catch (e) { return false; }
    };

    const validIdentity = q => Number.isSafeInteger(q.contentID) && q.contentID > 0
        && Number.isSafeInteger(q.questionIndex) && q.questionIndex >= 0;

    const knownComponentTypes = new Set([
        'ANNOTATED_QUESTION_COMPONENT', 'ANNOTATED_TEXT_COMPONENT', 'DEPTH_COMPONENT',
        'DROPDOWN_COMPONENT', 'FILE_UPLOADER_COMPONENT', 'FILL_IN_GAPS_COMPONENT',
        'FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT', 'HIGHLIGHT_COMPONENT',
        'LONG_ANSWER_COMPONENT', 'MULTICHOICE_COMPONENT', 'NUMBER_BOX_COMPONENT',
        'SCRATCH_PAD_COMPONENT', 'SOUND_COMPONENT', 'SOUND_RECORDER_COMPONENT',
        'TEXT_BOX_COMPONENT', 'TYPE_ARROW_COMPONENT', 'TYPE_EQUALS_COMPONENT',
        'TYPE_EXPONENT_COMPONENT', 'TYPE_GROUP_COMPONENT', 'TYPE_MATH_ENTITY_COMPONENT',
        'TYPE_MATH_FUNCTION_COMPONENT', 'TYPE_MULTI_OPERATOR_COMPONENT', 'TYPE_NUMBER_COMPONENT',
        'TYPE_OR_COMPONENT', 'TYPE_SUBSCRIPT_SUPERSCRIPT_COMPONENT', 'TYPE_TEXT_COMPONENT',
        'TYPE_UNARY_OPERATOR_COMPONENT', 'WORKING_FORMULA_COMPONENT',
    ]);
    const unsupportedLessonDiagnostic = rendered => {
        const found = currentQuestionFrom(rendered);
        const q = found?.question, model = found?.self?.model, components = q?.questionDef?.Components;
        const count = selector => [...rendered.querySelectorAll(selector)].filter(visible).length;
        return {
            modelReadable: Boolean(found),
            gameMode: Number.isSafeInteger(model?.gameMode) ? model.gameMode : null,
            questionType: Number.isSafeInteger(q?.questionType) ? q.questionType : null,
            componentCount: Array.isArray(components) ? components.length : null,
            componentTypes: Array.isArray(components) ? components.slice(0, 20).map(component => {
                const type = component?.ComponentTypeCode;
                return typeof type === 'string' && knownComponentTypes.has(type) ? type : 'UNLISTED_COMPONENT';
            }) : [],
            controls: {
                inputs: count('input'),
                textareas: count('textarea'),
                selects: count('select'),
                contentEditable: [...rendered.querySelectorAll('[contenteditable]')].filter(el => visible(el) && el.isContentEditable).length,
                canvases: count('canvas'),
                buttons: count('button'),
            },
        };
    };

    // 2. audio task (Listening / Dictation): speaker button instead of question text
    const speaker = [...document.querySelectorAll('.voice-speaker')].find(visible);
    if (speaker) {
        const found = currentQuestionFrom(speaker);
        if (!found) return { kind: 'unsupported', reason: 'audio task detected, but EP\'s answer state could not be read (AngularJS scope unavailable)' };
        const { self, question: q } = found;
        if (self.model.gameMode === 2) return { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' };
        // Dash (isDash on EP's QuizModel, issues #230/#273): named before the
        // mode band because Dash runs under the classic gameMode. Only the
        // captured choice and typed Dash layouts are answered; this Dash
        // audio shape is refused by name.
        if (self.model.isDash === true) return { kind: 'unsupported', dash: true, reason: 'Dash timed sprint round detected; only the captured choice and typed Dash layouts are answered. Stop the run, type inspect-dash and send the EP_DASH_INSPECT line (read-only capture).' };
        if (![1, 3].includes(self.model.gameMode)) return { kind: 'unsupported', reason: `Audio answering requires confirmed classic or Smart Lesson practice mode; unknown modes (gameMode ${Number.isSafeInteger(self.model.gameMode) ? self.model.gameMode : 'unreadable'}) are not supported` };
        // contentID alone does not identify a round: items repeat within a list
        // and the same item appears in both Listening and Dictation. The mode
        // (translationMode: 2 = Listening, 3 = Dictation) disambiguates.
        if (!validIdentity(q)) {
            return { kind: 'unsupported', reason: 'audio question without a stable identity (contentID/questionIndex missing from EP\'s question state)' };
        }
        // only the two captured audio modes are answered; any other speaker
        // slide is an unverified shape and stops
        if (q.translationMode !== 2 && q.translationMode !== 3) {
            return { kind: 'unsupported', reason: `speaker slide with an unexpected translationMode (${q.translationMode}); only Listening (2) and Dictation (3) were captured live` };
        }
        return {
            kind: 'audio',
            key: `audio:${q.contentID}:${q.questionIndex}:${q.translationMode}`,
            answers: validAnswersOf(q),
            translationMode: q.translationMode,
            autoMarked: autoMarkingOf(self),
            sectionDataPresent: sectionDataPresentOf(self),
            // positive identification of the captured self-test list context;
            // the caller may use it ONLY when sectionData is absent - the
            // captured live shape - never when a present sectionData is merely
            // unreadable
            selfTestList: selfTestListOf(self),
            // ClassicGameController.submitAnswer -> markAnswerWithSecondChance
            // -> non-EP markAnswerLP. QUESTION_DEFAULT auto-validates non-speaking
            // translation questions regardless of task assignment. Source chunk171,
            // retrieved 2026-11-04; user stopped diagnostic confirmed this shape.
            // Never claim autoMarked=true or borrow Smart Lesson section marking.
            classicAssignedAudio: self.model.gameMode === 1 && q.questionType === 0
                && q.isEPQuestion === false && q.isSpeakingMode === false
                && self.sectionData === undefined
                && self.model.contentSource?.selectedActivity?._activityType === 1
                && self.model.contentSource?.selectedActivity?._contentType === 1
                && Number.isSafeInteger(self.model.contentSource?.selectedActivity?._taskID)
                && self.model.contentSource.selectedActivity._taskID > 0,
            // Private in-process freshness check only; never logged or published.
            audioContextSignature: JSON.stringify([self.model.gameMode, q.questionType, q.isEPQuestion,
                q.isSpeakingMode, self.model.contentSource?.selectedActivity?._taskID,
                self.model.contentSource?.selectedActivity?._activityType,
                self.model.contentSource?.selectedActivity?._contentType]),
        };
    }

    // 3. classic text question
    const qt = document.querySelector('#question-text');
    if (visible(qt) && qt.textContent.trim() !== '') {
        const found = currentQuestionFrom(qt);
        if (found?.self.model.gameMode === 2) return { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' };
        // Dash rounds share the classic gameMode (isDash on EP's QuizModel,
        // issues #230/#273). The captured typed Dash shape is answered by
        // the dash-typed reader before this fallback; any other Dash round
        // showing classic markup is refused by name here.
        if (found?.self.model.isDash === true) return { kind: 'unsupported', dash: true, reason: 'Dash timed sprint round detected; only the captured choice and typed Dash layouts are answered. Stop the run, type inspect-dash and send the EP_DASH_INSPECT line (read-only capture).' };
        if (found?.self.model.gameMode !== 1) return { kind: 'unsupported', reason: `Classic text answering requires confirmed classic practice mode; unknown modes (gameMode ${found && Number.isSafeInteger(found.self.model.gameMode) ? found.self.model.gameMode : 'unreadable'}) are not supported` };
        return { kind: 'text', text: qt.textContent };
    }

    // 4. Smart Lesson short-answer slide: no #question-text, but a visible answer
    // box under the lesson container. NOT live-verified (see the header note):
    // extrapolated from the audio task's shape.
    const lesson = document.querySelector('#ep-question-container');
    if (lesson) {
        const box = document.querySelector('input#answer-text');
        if (box && visible(box)) {
            const found = currentQuestionFrom(box) || currentQuestionFrom(lesson);
            if (!found) return { kind: 'unsupported', reason: 'lesson text question detected, but EP\'s answer state could not be read (AngularJS scope unavailable)' };
            const { self, question: q } = found;
            if (self.model.gameMode === 2) return { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' };
            if (self.model.isDash === true) return { kind: 'unsupported', dash: true, reason: 'Dash timed sprint round detected; only the captured choice and typed Dash layouts are answered. Stop the run, type inspect-dash and send the EP_DASH_INSPECT line (read-only capture).' };
            if (self.model.gameMode !== 3) return { kind: 'unsupported', reason: `Typed lesson answering requires confirmed Smart Lesson practice mode; unknown modes (gameMode ${Number.isSafeInteger(self.model.gameMode) ? self.model.gameMode : 'unreadable'}) are not supported` };
            if (!validIdentity(q)) {
                return { kind: 'unsupported', reason: 'lesson text question without a stable identity (contentID/questionIndex missing from EP\'s question state)' };
            }
            return {
                kind: 'typed',
                key: `typed:${q.contentID}:${q.questionIndex}`,
                answers: validAnswersOf(q),
                questionType: q.questionType,
                autoMarked: autoMarkingOf(self),
            };
        }
        // a rendered lesson slide with neither a choice component, a speaker, nor
        // an answer box is a question type this program does not support
        const rendered = lesson.querySelector('#question-container-group');
        if (rendered && rendered.textContent.trim() !== '') {
            return {
                kind: 'unsupported',
                reason: 'lesson slide with an unsupported question type (not text, choice, or audio)',
                diagnostic: unsupportedLessonDiagnostic(rendered),
            };
        }
    }

    // nothing recognised: round transition, navigation, or task end
    return null;
}

const { readMultiChoiceInPage } = require('./multi-choice-state');
const { readGapsInPage } = require('./gaps-state');
const { readDropdownsInPage } = require('./dropdown-state');
const { readSlideSurfaces } = require('./slide-surfaces-state');
const { readChoiceInPage } = require('./choice-state');
const { readDashTypedInPage } = require('./dash-typed-state');
const { readHighlightInPage } = require('./highlight-state');
const { readReflectionInPage } = require('./reflection-state');
const { readWorkingFormulaInPage } = require('./working-formula-state');
const { readInfoSlideInPage } = require('./info-slide-state');
const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');

// EP's public student template mounts these controls only for gameMode 2
// (ASSESSMENT). Detect that shell before reading any question answer state:
// a whole-attempt assessment can autosave input, save on navigation and record
// focus. This is a refusal boundary, not question extraction.
// Source: main/mfe-hashed-assets-171-69df426caed962f89980.js, checked 8 Nov 2026.
function detectAssessmentBoundaryInPage() {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const controls = [...document.querySelectorAll('game-assessment-action-bar, game-assessment-side-bar, game-assessment-navigation-controls')];
    const mounted = controls.some(el => shown(el)
        || [...el.querySelectorAll('button,a,input,select,textarea,[role="button"]')].some(shown));
    if (!mounted) return null;
    return {
        kind: 'unsupported',
        assessment: true,
        reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled',
    };
}

/**
 * Returns typed, audio, choice, gaps, textbox, numberbox, unsupported, or null descriptors.
 * Runs detection in the page. Never throws on transient page states.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<null|object>}
 */
async function detectQuestion(page) {
    try {
        const assessment = await page.evaluate(detectAssessmentBoundaryInPage);
        if (assessment) return assessment;
        // A slide showing two or more recognised input surfaces belongs to
        // the slide orchestrator; each single-surface reader refuses it.
        const slideSurfaces = await readSlideSurfaces(page, 'descriptor');
        if (slideSurfaces) return slideSurfaces.descriptor;
        const dropdowns = await page.evaluate(readDropdownsInPage, null, 'descriptor');
        if (dropdowns) return dropdowns.descriptor;
        const textboxes = await page.evaluate(readInputBoxesInPage, null, 'descriptor', TEXTBOX_CONFIG);
        if (textboxes) return textboxes.descriptor;
        const numberBoxes = await page.evaluate(readInputBoxesInPage, null, 'descriptor', NUMBER_BOX_CONFIG);
        if (numberBoxes) return numberBoxes.descriptor;
        const gaps = await page.evaluate(readGapsInPage, null, 'descriptor');
        if (gaps) return gaps.descriptor;
        const multi = await page.evaluate(readMultiChoiceInPage, null, 'descriptor');
        if (multi) return multi.descriptor;
        const highlight = await page.evaluate(readHighlightInPage, null, 'descriptor');
        if (highlight) return highlight.descriptor;
        // A self-marked Reflection slide (one contenteditable editor, no other
        // editable controls) belongs to the reflection reader; every other
        // slide falls through to the generic reader unchanged.
        const reflection = await page.evaluate(readReflectionInPage, null, 'descriptor');
        if (reflection) return reflection.descriptor;
        // Choice slides belong to their own reader (extracted from this
        // monolith on 17 November 2026); the slide orchestrator composes a
        // choice surface with other verified surfaces under allowMix.
        // The Dash typed round (issue #273) is read before choice: its DOM
        // (#question-text + answer box, no radiogroup) is disjoint from the
        // choice shape, and a typed Dash model would otherwise hit the
        // choice reader's component-count refusal before its own reader runs.
        const dashTyped = await page.evaluate(readDashTypedInPage, null, null, false);
        if (dashTyped) return dashTyped;
        const choice = await page.evaluate(readChoiceInPage, null, null, false);
        if (choice) return choice;
        // The working-formula maths editor (issue #113) is single-surface
        // only for now: mixed slides stay refused by every reader.
        const workingFormula = await page.evaluate(readWorkingFormulaInPage, null, 'descriptor');
        if (workingFormula) return workingFormula.descriptor;
        // An information slide (issue #327, EP_INFORMATION questionType 7)
        // has nothing to answer: it is recognized after the claimed-surface
        // readers above. Its own guards refuse any visible answer surface,
        // including the speaker, classic text and typed-box shapes that
        // detectQuestionInPage handles later. Its handler never types,
        // selects or submits - it clicks the lesson's own Continue control.
        const infoSlide = await page.evaluate(readInfoSlideInPage, null, 'descriptor');
        if (infoSlide) return infoSlide.descriptor;
        return await page.evaluate(detectQuestionInPage);
    } catch (e) {
        if (/Execution context was destroyed|Cannot find context|detached Frame|Target closed|Session closed/i.test(String(e.message))) return null;
        return { kind: 'unsupported', reason: `Question detection failed: ${e.message}` };
    }
}

module.exports = { detectQuestionInPage, detectQuestion };
