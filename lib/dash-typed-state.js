// Dash typed round reader (issue #273). Answers ONLY the confirmed typed Dash
// round shape from the 2026-11-20 live EP_DASH_INSPECT capture (filed as
// #272): isDash true on a dash route, no sectionData, gameMode null/CLASSIC,
// questionType 0, translationMode 0, explicit non-EP/non-speaking flags, one
// usable validAnswers entry, no question components, and the classic
// #question-text + input#answer-text DOM with one Submit button, no speaker,
// no choice groups and no other editable controls. Every deviation refuses by
// name with { dash: true, diagnostic: { renderer: 'dash-typed', guard } }.
//
// Parallel to the Dash-choice path in lib/choice-state.js: a narrow reader,
// never a widened generic Dash handler. Audio/speaker Dash, multi-select
// Dash, mixed-surface Dash and formula/block-option Dash each need their own
// capture before any code; they refuse here by name.
//
// readDashTypedInPage runs INSIDE the page (via page.evaluate); it must stay
// self-contained: no references to anything outside its own body.
function readDashTypedInPage(el = null, descriptor = null, allowMix = false) {
    // No handle reads: the typed answer path types into input#answer-text via
    // trusted key events and re-detects the round, so there is no element
    // association to re-prove.
    if (el) return null;

    const visible = (node) => !!(node && (node.offsetParent !== null
        || (node.getClientRects && node.getClientRects().length > 0)));

    // The game model hangs off the AngularJS scope's `self`. EP nests
    // components, so walk up a few ancestors looking for a scope that has the
    // current question on it.
    const currentQuestionFrom = (node) => {
        if (!node || !window.angular || typeof angular.element !== 'function') return null;
        for (let at = node, depth = 0; at && depth < 8; at = at.parentElement, depth++) {
            try {
                const scope = angular.element(at).scope && angular.element(at).scope();
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

    const validIdentity = q => Number.isSafeInteger(q.contentID) && q.contentID > 0
        && Number.isSafeInteger(q.questionIndex) && q.questionIndex >= 0;

    // A typed Dash round shows the classic question/answer pair. Anything
    // else belongs to another reader (choice Dash, audio, lessons) or to the
    // generic fallback: return null, never refuse, so transitions and other
    // shapes are not misnamed here.
    const qt = document.querySelector('#question-text');
    const box = document.querySelector('input#answer-text');
    if (!visible(qt) || (qt.textContent || '').trim() === '') return null;
    if (!visible(box)) return null;

    const found = currentQuestionFrom(qt) || currentQuestionFrom(box);
    if (!found) return null;
    const { self, question: q } = found;
    if (self.model.gameMode === 2) return { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' };
    // Only Dash rounds belong here; classic and lesson shapes fall through to
    // the readers that own them.
    if (self.model.isDash !== true) return null;

    const dashRefuse = (guard, reason) => ({ kind: 'unsupported', dash: true, reason: `Dash timed sprint round: ${reason}`, diagnostic: { renderer: 'dash-typed', guard } });
    // Segment-boundary match: a "dash" path segment (dash, dash-task, ...),
    // never a substring like /learning/dashboard. Same boundary as dash-choice.
    const dashPath = String(typeof location !== 'undefined' && location && location.pathname || '');
    const onDashRoute = /(^|\/)dash([\/\-_.]|$)/i.test(dashPath);
    if (!onDashRoute) return { kind: 'unsupported', dash: true, reason: 'Dash timed sprint round detected outside a confirmed dash route; refusing an unconfirmed shape. Stop the run, type inspect-dash and send the EP_DASH_INSPECT line (read-only capture).' };
    // The captured Dash model has no sectionData (undefined live); one that
    // appears is an unverified shape.
    if (self.sectionData !== undefined) return dashRefuse('section-data', 'the Dash model carries sectionData; the captured round has none');
    if (Array.isArray(allowMix)) return dashRefuse('mixed-slide', 'a Dash round is single-surface only; mixed slides are not supported');
    // Captured gameMode null; chunk 171's QuizModel constructor sets
    // CLASSIC (1). Any other mode contradicts the model.
    const dashMode = self.model.gameMode;
    if (!(dashMode === null || dashMode === undefined || dashMode === 1)) return dashRefuse('game-mode', `unexpected gameMode ${Number.isSafeInteger(dashMode) ? dashMode : 'unreadable'} on a Dash model; only the captured null and chunk-171 CLASSIC (1) are confirmed`);
    if (!validIdentity(q)) return dashRefuse('identity', 'no stable identity (contentID/questionIndex missing from EP\'s question state)');
    // The #272 capture is a word-to-word typed round: questionType 0,
    // translationMode 0. Any other mode is an uncaptured layout.
    if (q.questionType !== 0) return dashRefuse('question-type', `unexpected questionType ${Number.isSafeInteger(q.questionType) ? q.questionType : 'unreadable'}; only the captured questionType 0 is confirmed`);
    if (q.translationMode !== 0) return dashRefuse('translation-mode', `unexpected translationMode ${Number.isSafeInteger(q.translationMode) ? q.translationMode : 'unreadable'}; only the captured translationMode 0 is confirmed`);
    // Explicit non-EP, non-speaking flags, as per the classic contract: only
    // a plain translation round is confirmed.
    if (q.isEPQuestion !== false || q.isSpeakingMode !== false) return dashRefuse('question-flags', 'the question flags are not the captured non-EP, non-speaking translation shape');
    const rawValid = q.validAnswers;
    if (!Array.isArray(rawValid) || rawValid.length === 0) return dashRefuse('answers-missing', 'accepted-answer metadata is missing or unreadable; no answer was typed');
    const usable = validAnswersOf(q);
    if (usable.length === 0) return dashRefuse('answers-unusable', 'the accepted answers have no usable text; stopping instead of guessing');
    if (rawValid.length !== 1 || usable.length !== 1) return dashRefuse('answers-count', `${rawValid.length} accepted answers; the captured round has exactly one`);
    // The captured round carries no question components (componentCount null):
    // any component definition is an unverified shape.
    const defs = q.questionDef ? q.questionDef.Components : undefined;
    if (Array.isArray(defs) ? defs.length !== 0 : (defs !== undefined && defs !== null)) return dashRefuse('component-count', `${Array.isArray(defs) ? defs.length : 'unreadable'} question components; the captured typed round has none`);
    const countVisible = selector => [...document.querySelectorAll(selector)].filter(visible).length;
    if (countVisible('.voice-speaker') !== 0) return dashRefuse('speaker', 'a speaker control is present; audio Dash needs its own capture before it is answered');
    if (countVisible('div.multi-choice-component[role=radiogroup]') !== 0) return dashRefuse('choice-present', 'a choice component is present; choice Dash is answered by the dash-choice reader, never mixed with typing');
    if (countVisible('button.submit-button') !== 1) return dashRefuse('submit-control', 'the round does not show exactly one Submit button; the captured typed round shows one');
    const dashRoot = document.querySelector('#ep-question-container') || document;
    const dashForeign = [...dashRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
        .filter(node => visible(node) && (node.matches('input,textarea,select') || node.isContentEditable) && node !== box);
    if (dashForeign.length) return dashRefuse('foreign-editable', 'editable controls outside the answer box; answering would submit them blank');

    return {
        kind: 'dash-typed',
        key: `dash-typed:${q.contentID}:${q.questionIndex}`,
        text: qt.textContent,
        answers: usable,
        questionType: 0,
        translationMode: 0,
        dash: true,
        // Dash has no sectionData/activityGroup (captured undefined), so the
        // Smart Lesson marking proof does not apply. Dash marks client-side:
        // chunk 171 QuizInGamePage.submitAnswer ->
        // markingManager.markAnswerWithSecondChance, the same path as the
        // captured dash-choice round. That is this round's auto-marking proof.
        autoMarked: true,
    };
}

module.exports = { readDashTypedInPage };
