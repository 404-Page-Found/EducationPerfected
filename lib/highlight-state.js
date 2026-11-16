// Source-grounded read-only inspection of EP's cached highlight renderer.
// EP public chunk 606 (retrieved 2026-11-16), VirtualComponentParser
// builderTypes.highlight, BaseComponent (type/id/marked), HighlightComponent
// (createVisualElement/getQuestionElement/outputForMarking), HighlightInput
// (span.highlight-token ids token-{uniqueID}-{index}, click toggles
// userSelectedOptions), HighlightComponentState (metadata getters, correct,
// marking), ComponentStateFactory (state metadata IS the questionDef
// component object for HIGHLIGHT_COMPONENT):
// https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
// No lazy getters, renderer creation, answer-state mutation or selection methods.
// A source-derived fixture is NOT a captured/live-verified highlight slide.
function readHighlightInPage(baseline, action) {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const refuse = reason => ({ descriptor: { kind: 'unsupported', reason: 'Highlight: ' + reason } });
    const elements = [...document.querySelectorAll('div.highlight-input')].filter(shown);
    if (!elements.length) return null;
    if (elements.length !== 1) return refuse('ambiguous visible highlight components');
    const element = elements[0];
    let self;
    for (let n = element, depth = 0; n && depth < 8; n = n.parentElement, depth++) {
        const scope = window.angular?.element(n)?.scope?.();
        if (scope?.self?.model?._currentQuestion) { self = scope.self; break; }
    }
    const model = self?.model, q = model?._currentQuestion;
    if (model?.gameMode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } };
    if (!q || model.gameMode !== 3 || !Number.isSafeInteger(q.contentID) || q.contentID <= 0
        || !Number.isSafeInteger(q.questionIndex) || q.questionIndex < 0) return refuse('missing current lesson identity');
    const components = q.questionDef?.Components;
    // chunk606, checked 16 November 2026: Submit grades the whole question, so
    // this first contract admits exactly one component, the highlight itself.
    // Companion types (sound/annotated text) stay refused rather than mixed in.
    if (!Array.isArray(components) || components.length !== 1) return refuse('expected exactly one question component');
    const comp = components[0];
    if (comp?.ComponentTypeCode !== 'HIGHLIGHT_COMPONENT') return refuse('expected a single highlight component');
    const id = comp.ComponentID;
    if (typeof id !== 'string' || !id) return refuse('missing highlight component id');
    // A highlight slide renders no editable controls; any visible one would be
    // submitted blank, so refuse it, inside or outside the component.
    const lessonRoot = document.querySelector('#ep-question-container') || document;
    const editable = [...lessonRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
        .filter(el => shown(el) && (el.matches('input,textarea,select') || el.isContentEditable));
    if (editable.length) return refuse('question has editable controls; answering would submit them blank');
    const cached = q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[id];
    if (!Array.isArray(cached) || cached.length !== 1) return refuse('cached component unavailable or ambiguous');
    const component = cached[0], state = component?.componentState;
    // chunk606 HighlightComponentState(ne) stores the questionDef component as
    // metadata unchanged, so identity, not field equality, binds them.
    const metadata = state?.metadata;
    const questionElement = state?.questionElement;
    if (component.type !== 'highlight' || component.id !== id || component.visualElement !== element
        || component.renderingParameters?.mode !== 1
        || metadata !== comp || !questionElement || questionElement.element !== element
        || questionElement.componentState !== state || typeof questionElement.uniqueID !== 'string'
        || !questionElement.uniqueID) return refuse('incomplete cached highlight association');
    // chunk606: BaseComponent's constructor sets marked to MARKED (1) and no
    // highlight path overrides it; accept only that runtime value with a valid
    // definition Marked flag (0 unspecified or 1 marked), matching the
    // dropdown/text-box marking rule. Other values fail closed.
    if (component.marked !== 1 || (metadata.Marked !== 0 && metadata.Marked !== 1)) return refuse('unexpected highlight marking state');
    const singleAnswer = metadata.SingleAnswerMode;
    if (singleAnswer !== undefined && typeof singleAnswer !== 'boolean') return refuse('malformed single-answer flag');
    const tokens = [...element.querySelectorAll('span.highlight-token')];
    if (!tokens.length || tokens.length > 100) return refuse('unexpected highlight token count');
    for (let i = 0; i < tokens.length; i++) {
        // chunk606 HighlightInput assigns token ids in DOM order at mount.
        if (!shown(tokens[i]) || tokens[i].id !== `token-${questionElement.uniqueID}-${i}`) return refuse('highlight token identity mismatch');
    }
    if (new Set(tokens).size !== tokens.length) return refuse('duplicate highlight tokens');
    const correct = metadata.CorrectOptions;
    if (!Array.isArray(correct) || !correct.length || correct.length > tokens.length
        || correct.some(i => !Number.isSafeInteger(i) || i < 0 || i >= tokens.length)
        || new Set(correct).size !== correct.length) return refuse('unusable correct highlight token metadata');
    if (singleAnswer === true && correct.length !== 1) return refuse('single-answer highlight with multiple correct tokens cannot be answered by clicks');
    const selectedRaw = questionElement.userSelectedOptions;
    if (!Array.isArray(selectedRaw) || new Set(selectedRaw).size !== selectedRaw.length
        || selectedRaw.some(i => !Number.isSafeInteger(i) || i < 0 || i >= tokens.length)) return refuse('invalid current highlight selection');
    const selected = [...selectedRaw].sort((a, b) => a - b);
    // chunk606 onHighlightTokenClick adds/removes the 'highlighted' class with
    // the selection; the two must agree exactly before any click is trusted.
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].classList.contains('highlighted') !== selected.includes(i)) return refuse('highlight selection or class state disagrees');
    }
    const correctSorted = [...correct].sort((a, b) => a - b);
    const signature = JSON.stringify([id, metadata.Marked, singleAnswer ?? null, correct, tokens.length]);
    const key = `highlight:${q.contentID}:${q.questionIndex}`;
    if (baseline && (baseline.q !== q || baseline.comp !== comp || baseline.model !== model || baseline.component !== component || baseline.state !== state
        || baseline.element !== element || baseline.questionElement !== questionElement
        || baseline.descriptor.key !== key || baseline.descriptor.associationSignature !== signature
        || baseline.tokens.length !== tokens.length || baseline.tokens.some((t, i) => t !== tokens[i]))) return refuse('cached question or token identity changed');
    const descriptor = { kind: 'highlight', representation: 'highlight-renderer', key,
        associationSignature: signature, correct: correctSorted, tokenCount: tokens.length,
        singleAnswer: singleAnswer === true, selected,
        autoMarked: self.sectionData?.activityGroup?.isAutoMarked === true ? true : self.sectionData?.activityGroup?.isAutoMarked === false ? false : 'unknown' };
    const result = { descriptor, q, comp, model, component, state, questionElement, element, tokens };
    if (action === 'submit' || action === 'verify') {
        if (descriptor.autoMarked !== true || JSON.stringify(selected) !== JSON.stringify(correctSorted)) return refuse('selected set is not exactly the current correct set');
        if (action === 'verify') return result;
        const modelOf = el => {
            for (let node = el, n = 0; node && n < 8; node = node.parentElement, n++) {
                const a = window.angular?.element(node);
                for (const scope of a ? [a.isolateScope?.(), a.scope?.()] : []) {
                    if (scope?.self?.model?._currentQuestion) return scope.self.model;
                }
            }
            return null;
        };
        const bars = [...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(b => modelOf(b) === model);
        if (bars.length !== 1) return refuse('navigation controls are ambiguous or unassociated');
        const buttons = [...bars[0].querySelectorAll('button')].filter(b => shown(b) && !b.disabled && (b.innerText || '').trim() === 'Submit');
        if (buttons.length !== 1) {
            if (buttons.length > 1) return refuse('Submit is ambiguous');
            return { ...result, readiness: 'not-ready' };
        }
        result.target = buttons[0];
    } else if (Number.isSafeInteger(action)) {
        if (action < 0 || action >= tokens.length || descriptor.autoMarked !== true) return refuse('token no longer associated with auto-marked question');
        result.target = tokens[action];
    }
    return action === 'descriptor' ? { descriptor } : result;
}
module.exports = { readHighlightInPage };
