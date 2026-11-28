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
// allowMix is set only by the slide orchestrator: an array of other verified
// component type codes on the same slide (never this reader's own) admits
// those question components and their editable controls, each verified by its
// own contract. The default keeps the single-surface refusals.
function readHighlightInPage(baseline, action, allowMix = false) {
    const foreignTypes = Array.isArray(allowMix) ? allowMix.filter(t => t !== 'HIGHLIGHT_COMPONENT') : [];
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const refuse = (reason, diagnostic) => ({ descriptor: { kind: 'unsupported', reason: 'Highlight: ' + reason, ...(diagnostic ? { diagnostic: { kind: 'highlight-refusal', ...diagnostic } } : {}) } });
    const NONE = {};
    const autoMarkState = value => {
        if (value === true) return true;
        if (value === false) return false;
        return 'unknown';
    };
    let self, model, q, components, comp, id, element, component, state, metadata, questionElement,
        singleAnswer, tokens, correct, selected, correctSorted, signature, key, descriptor, result;
    // locateElement resolves the one visible highlight surface and its angular
    // self; the NONE sentinel means no highlight is on the page.
    function locateElement() {
        const elements = [...document.querySelectorAll('div.highlight-input')].filter(shown);
        if (!elements.length) return NONE;
        if (elements.length !== 1) return refuse('ambiguous visible highlight components');
        element = elements[0];
        for (let n = element, depth = 0; n && depth < 8; n = n.parentElement, depth++) {
            const scope = window.angular?.element(n)?.scope?.();
            if (scope?.self?.model?._currentQuestion) { self = scope.self; break; }
        }
        model = self?.model; q = model?._currentQuestion;
        if (model?.gameMode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } };
        if (!q || model.gameMode !== 3 || !Number.isSafeInteger(q.contentID) || q.contentID <= 0
            || !Number.isSafeInteger(q.questionIndex) || q.questionIndex < 0) return refuse('missing current lesson identity');
        components = q.questionDef?.Components;
        return null;
    }
    // chunk606, checked 16 November 2026: Submit grades the whole question, so
    // this contract admits exactly one answer-bearing component, the highlight
    // itself. Source-proven presentation-only companions (chunk606, checked
    // 19 November 2026) are admitted: the factory maps SOUND_COMPONENT to
    // SoundComponent (isInput false; outputForMarking is a constant {score 1,
    // max 1, weight 0} payload independent of any response) and
    // ANNOTATED_TEXT_COMPONENT to AnnotatedTextComponent (isInput false, marked
    // NOT_MARKED, constant output 0/0/0); neither accepts a response, so
    // submitting with either untouched reports exactly what interacting with
    // it would. Under the orchestrator's mix flag, companion question
    // components are the orchestrator's verified surfaces; anything else still
    // refuses.
    // Canonical companion inventory mirrors lib/companion-components.js
    // (issue #231): recognized EP codes are named, anything unlisted is
    // redacted. Kept local because this reader runs inside page.evaluate and
    // must stay self-contained. Encoded as an array literal (vs split+map
    // elsewhere) to keep the self-contained mirrors semantically in sync
    // without tripping exact-duplicate checks; scripts/companion-components-test.js
    // asserts Set equality with the canonical module.
    const knownCodes = new Set(['ANNOTATED_QUESTION_COMPONENT', 'ANNOTATED_TEXT_COMPONENT', 'DEPTH_COMPONENT', 'DROPDOWN_COMPONENT', 'FILE_UPLOADER_COMPONENT', 'FILL_IN_GAPS_COMPONENT', 'FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT', 'HIGHLIGHT_COMPONENT', 'LONG_ANSWER_COMPONENT', 'MULTICHOICE_COMPONENT', 'NUMBER_BOX_COMPONENT', 'SCRATCH_PAD_COMPONENT', 'SOUND_COMPONENT', 'SOUND_RECORDER_COMPONENT', 'TEXT_BOX_COMPONENT', 'TYPE_ARROW_COMPONENT', 'TYPE_EQUALS_COMPONENT', 'TYPE_EXPONENT_COMPONENT', 'TYPE_GROUP_COMPONENT', 'TYPE_MATH_ENTITY_COMPONENT', 'TYPE_MATH_FUNCTION_COMPONENT', 'TYPE_MULTI_OPERATOR_COMPONENT', 'TYPE_NUMBER_COMPONENT', 'TYPE_OR_COMPONENT', 'TYPE_SUBSCRIPT_SUPERSCRIPT_COMPONENT', 'TYPE_TEXT_COMPONENT', 'TYPE_UNARY_OPERATOR_COMPONENT', 'WORKING_FORMULA_COMPONENT']);
    const presentation = new Set(['ANNOTATED_TEXT_COMPONENT', 'SOUND_COMPONENT']);
    // A scratch pad companion is grading-neutral unless marked under EP's own
    // loose check (marked == MARKED): anything else emits a constant 0/0/0
    // marking payload. chunk606, 19 November 2026.
    const unmarkedScratchPad = (c) => {
        const e = c?.ComponentTypeCode === 'SCRATCH_PAD_COMPONENT' ? q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[c.ComponentID] : null;
        return Array.isArray(e) && e.length === 1 && e[0]?.id === c.ComponentID && e[0].type === 'scratch-pad' && e[0].marked != 1;
    };
    function checkComponents() {
        if (!Array.isArray(components) || !components.length) return refuse('expected exactly one question component', { guard: 'missing-components' });
        const highlightExtraIndex = components.findIndex(c => c?.ComponentTypeCode !== 'HIGHLIGHT_COMPONENT' && !presentation.has(c?.ComponentTypeCode) && !unmarkedScratchPad(c) && !foreignTypes.includes(c?.ComponentTypeCode));
        if (highlightExtraIndex !== -1) {
            const code = components[highlightExtraIndex]?.ComponentTypeCode;
            const named = knownCodes.has(code) ? code : 'redacted type';
            return refuse(`expected exactly one question component (unsupported accompanying component: ${named})`, { guard: 'accompanying-component', componentType: knownCodes.has(code) ? code : 'UNLISTED_COMPONENT' });
        }
        const highlights = components.filter(c => c?.ComponentTypeCode === 'HIGHLIGHT_COMPONENT');
        if (highlights.length !== 1) return refuse('expected exactly one question component');
        comp = highlights[0];
        if (comp?.ComponentTypeCode !== 'HIGHLIGHT_COMPONENT') return refuse('expected a single highlight component');
        id = comp.ComponentID;
        if (typeof id !== 'string' || !id) return refuse('missing highlight component id');
        return null;
    }
    function checkForeignEditable() {
        // A highlight slide renders no editable controls; any visible one would be
        // submitted blank, so refuse it, inside or outside the component.
        const lessonRoot = document.querySelector('#ep-question-container') || document;
        // Foreign-surface controls (selects, box inputs, checkboxes/radios) belong
        // to the orchestrator's other readers and are excluded from this refusal.
        const foreignControl = foreignTypes.length
            ? 'select, input.number-box-input, input.text-box-input, input.number-box-decimal-input, input[type="checkbox"], input[type="radio"], div.multi-choice-component input'
            : '__none__';
        const editable = [...lessonRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
            .filter(el => shown(el) && !el.matches(foreignControl) && (el.matches('input,textarea,select') || el.isContentEditable));
        if (editable.length) return refuse('question has editable controls; answering would submit them blank');
        return null;
    }
    function bindCached() {
        const cached = q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[id];
        if (!Array.isArray(cached) || cached.length !== 1) return refuse('cached component unavailable or ambiguous');
        component = cached[0]; state = component?.componentState;
        // chunk606 HighlightComponentState(ne) stores the questionDef component as
        // metadata unchanged, so identity, not field equality, binds them.
        metadata = state?.metadata;
        questionElement = state?.questionElement;
        if (component.type !== 'highlight' || component.id !== id || component.visualElement !== element
            || component.renderingParameters?.mode !== 1
            || metadata !== comp || !questionElement || questionElement.element !== element
            || questionElement.componentState !== state || typeof questionElement.uniqueID !== 'string'
            || !questionElement.uniqueID) return refuse('incomplete cached highlight association');
        return null;
    }
    // chunk606: BaseComponent's constructor sets marked to MARKED (1) and no
    // highlight path overrides it; accept only that runtime value with a valid
    // definition Marked flag (0 unspecified or 1 marked), matching the
    // dropdown/text-box marking rule. Other values fail closed.
    function checkMarking() {
        if (component.marked !== 1 || (metadata.Marked !== 0 && metadata.Marked !== 1)) return refuse('unexpected highlight marking state');
        singleAnswer = metadata.SingleAnswerMode;
        if (singleAnswer !== undefined && typeof singleAnswer !== 'boolean') return refuse('malformed single-answer flag');
        return null;
    }
    function bindTokens() {
        tokens = [...element.querySelectorAll('span.highlight-token')];
        if (!tokens.length || tokens.length > 100) return refuse('unexpected highlight token count');
        for (let i = 0; i < tokens.length; i++) {
            // chunk606 HighlightInput assigns token ids in DOM order at mount.
            if (!shown(tokens[i]) || tokens[i].id !== `token-${questionElement.uniqueID}-${i}`) return refuse('highlight token identity mismatch');
        }
        if (new Set(tokens).size !== tokens.length) return refuse('duplicate highlight tokens');
        return null;
    }
    function checkAnswers() {
        correct = metadata.CorrectOptions;
        if (!Array.isArray(correct) || !correct.length || correct.length > tokens.length
            || correct.some(i => !Number.isSafeInteger(i) || i < 0 || i >= tokens.length)
            || new Set(correct).size !== correct.length) return refuse('unusable correct highlight token metadata');
        if (singleAnswer === true && correct.length !== 1) return refuse('single-answer highlight with multiple correct tokens cannot be answered by clicks');
        const selectedRaw = questionElement.userSelectedOptions;
        if (!Array.isArray(selectedRaw) || new Set(selectedRaw).size !== selectedRaw.length
            || selectedRaw.some(i => !Number.isSafeInteger(i) || i < 0 || i >= tokens.length)) return refuse('invalid current highlight selection');
        selected = [...selectedRaw].sort((a, b) => a - b);
        return null;
    }
    // chunk606 onHighlightTokenClick adds/removes the 'highlighted' class with
    // the selection; the two must agree exactly before any click is trusted.
    function checkSelectionClasses() {
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].classList.contains('highlighted') !== selected.includes(i)) return refuse('highlight selection or class state disagrees');
        }
        return null;
    }
    function finalize() {
        correctSorted = [...correct].sort((a, b) => a - b);
        signature = JSON.stringify([id, metadata.Marked, singleAnswer ?? null, correct, tokens.length]);
        key = `highlight:${q.contentID}:${q.questionIndex}`;
        if (baseline && (baseline.q !== q || baseline.comp !== comp || baseline.model !== model || baseline.component !== component || baseline.state !== state
            || baseline.element !== element || baseline.questionElement !== questionElement
            || baseline.descriptor.key !== key || baseline.descriptor.associationSignature !== signature
            || baseline.tokens.length !== tokens.length || baseline.tokens.some((t, i) => t !== tokens[i]))) return refuse('cached question or token identity changed');
        descriptor = { kind: 'highlight', representation: 'highlight-renderer', key,
            associationSignature: signature, correct: correctSorted, tokenCount: tokens.length,
            singleAnswer: singleAnswer === true, selected,
            autoMarked: autoMarkState(self.sectionData?.activityGroup?.isAutoMarked),
            // Under the orchestrator's mix flag this surface contributes its
            // definition's Marked flag (validated above) so the orchestrator can
            // require uniform marking across every surface, matching the
            // box/dropdown contracts.
            ...(foreignTypes.length ? { markings: [metadata.Marked] } : {}) };
        result = { descriptor, q, comp, model, component, state, questionElement, element, tokens };
        return null;
    }
    function applyAction() {
        if (action === 'submit' || action === 'verify') return submitAction();
        if (Number.isSafeInteger(action)) return tokenAction();
        return null;
    }
    function submitAction() {
        if (descriptor.autoMarked !== true || JSON.stringify(selected) !== JSON.stringify(correctSorted)) return refuse('selected set is not exactly the current correct set');
        if (action === 'verify') return { final: result };
        // The visible navigation bar whose Angular scope chain resolves to this
        // lesson model is the only bar whose Submit button may be clicked.
        const barModel = bar => {
            for (let node = bar, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
                const a = window.angular?.element(node);
                const scopes = a ? [a.isolateScope?.(), a.scope?.()] : [];
                for (const scope of scopes) {
                    const m = scope?.self?.model;
                    if (m?._currentQuestion) return m;
                }
            }
            return undefined;
        };
        const owned = [...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(bar => barModel(bar) === model);
        if (owned.length !== 1) return refuse('navigation controls are ambiguous or unassociated');
        const submits = [...owned[0].querySelectorAll('button')].filter(btn => shown(btn) && !btn.disabled && (btn.innerText || '').trim() === 'Submit');
        if (submits.length > 1) return refuse('Submit is ambiguous');
        if (!submits.length) return { final: { ...result, readiness: 'not-ready' } };
        result.target = submits[0];
        return null;
    }
    function tokenAction() {
        if (action < 0 || action >= tokens.length || descriptor.autoMarked !== true) return refuse('token no longer associated with auto-marked question');
        result.target = tokens[action];
        return null;
    }
    const phases = [locateElement, checkComponents, checkForeignEditable, bindCached,
        checkMarking, bindTokens, checkAnswers, checkSelectionClasses, finalize, applyAction];
    for (const phase of phases) {
        const outcome = phase();
        if (outcome === NONE) return null;
        if (outcome) return outcome.final === undefined ? outcome : outcome.final;
    }
    return action === 'descriptor' ? { descriptor } : result;
}
module.exports = { readHighlightInPage };
