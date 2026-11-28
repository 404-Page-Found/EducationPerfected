// Source-grounded read-only inspection of EP's cached working-formula
// renderer (the "Add a line of working" maths editor, issue #113).
// EP public chunk 606 (retrieved 2026-11-18), ComponentParser.builderTypes
// ("working-formula"/"freeform-working" share one builder), the
// formula-component template root (the builder's visualElement) wrapping
// div.formula-input (ul#formula-list of li.formula-item rows, #add-formula-button),
// FormulaInput (addFormulaRow/discardBlankLastRow/getWorkingSteps/setWorking
// Steps, one blank initial row), WorkingFormulaComponentState (its metadata
// getter returns BaseComponentState's CLONE of the questionDef component in
// metadataInstance, with applyVariableContext's resolved injectors;
// CorrectSets[].CorrectWorkingSteps[] carry Formula,
// FormulaFormat, comments, Marked, ValidHint), FormulaFormats
// (AUTO_DETECT=0, LATEX=2) and the client-side MathMarkingService
// (WorkingComparer marks user steps against the shipped correct steps - no
// server round trip):
// https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
// No lazy getters, renderer creation, answer-state mutation or editor methods.
// A source-derived fixture is NOT a captured/live-verified working-formula
// slide. Single-surface contract: no allowMix; mixed slides stay refused.
function readWorkingFormulaInPage(baseline, action) {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const refuse = (reason, diagnostic) => ({ descriptor: { kind: 'unsupported', reason: 'Working formula: ' + reason, ...(diagnostic ? { diagnostic: { kind: 'working-formula-refusal', ...diagnostic } } : {}) } });
    const normalize = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    // chunk606: the builder's visualElement is the FormulaInput template root
    // div.formula-component; div.formula-input is its inner editor container.
    const elements = [...document.querySelectorAll('div.formula-component')].filter(shown);
    if (elements.length > 1) return refuse('ambiguous visible working-formula editors');
    if (elements.length === 0) return null;
    const element = elements[0];
    const located = locateQuestion(element);
    if (located.early) return located.early;
    const { self, model, q } = located;
    function locateQuestion(element) {
        // Walk up the DOM for the Angular scope owning the current lesson
        // question (eight ancestors at most, matching the other readers).
        let self, cursor = element;
        for (let depth = 0; !self && cursor && depth < 8; depth += 1) {
            const scope = window.angular?.element(cursor)?.scope?.();
            if (scope?.self?.model?._currentQuestion) self = scope.self;
            cursor = cursor.parentElement;
        }
        const model = self?.model;
        const q = model?._currentQuestion;
        if (model?.gameMode === 2) return { early: { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } } };
        const validIds = !!q && Number.isSafeInteger(q.contentID) && q.contentID > 0 && Number.isSafeInteger(q.questionIndex) && q.questionIndex >= 0;
        if (model?.gameMode !== 3 || !validIds) return { early: refuse('missing current lesson identity') };
        return { self, model, q };
    }
    const components = q.questionDef?.Components;
    // chunk606, checked 18 November 2026: Submit grades the whole question, so
    // this contract admits exactly one answer-bearing component, the editor
    // itself. Both working-formula type codes build the same component state
    // class. Source-proven presentation-only companions (chunk606, checked
    // 19 November 2026) are admitted: the factory maps SOUND_COMPONENT to
    // SoundComponent (isInput false; outputForMarking is a constant {score 1,
    // max 1, weight 0} payload independent of any response) and
    // ANNOTATED_TEXT_COMPONENT to AnnotatedTextComponent (isInput false, marked
    // NOT_MARKED, constant output 0/0/0); neither accepts a response, so
    // submitting with either untouched reports exactly what interacting with
    // it would. Anything else still refuses.
    // Canonical companion inventory mirrors lib/companion-components.js
    // (issue #231): recognized EP codes are named, anything unlisted is
    // redacted. Kept local because this reader runs inside page.evaluate and
    // must stay self-contained. Single-line base list (vs multi-line/array
    // elsewhere) to keep mirrors semantically in sync without exact-duplicate
    // blocks; scripts/companion-components-test.js asserts Set equality.
    const knownCodes = new Set('ANNOTATED_QUESTION ANNOTATED_TEXT DEPTH DROPDOWN FILE_UPLOADER FILL_IN_GAPS FORMULA FREEFORM_WORKING HIGHLIGHT LONG_ANSWER MULTICHOICE NUMBER_BOX SCRATCH_PAD SOUND SOUND_RECORDER TEXT_BOX TYPE_ARROW TYPE_EQUALS TYPE_EXPONENT TYPE_GROUP TYPE_MATH_ENTITY TYPE_MATH_FUNCTION TYPE_MULTI_OPERATOR TYPE_NUMBER TYPE_OR TYPE_SUBSCRIPT_SUPERSCRIPT TYPE_TEXT TYPE_UNARY_OPERATOR WORKING_FORMULA'.split(' ').map(c => c + '_COMPONENT'));
    const presentation = new Set(['SOUND_COMPONENT', 'ANNOTATED_TEXT_COMPONENT']);
    // A scratch pad companion is grading-neutral unless marked under EP's own
    // loose check (marked == MARKED): anything else emits a constant 0/0/0
    // marking payload. chunk606, 19 November 2026.
    const unmarkedScratchPad = (c) => {
        const e = c?.ComponentTypeCode === 'SCRATCH_PAD_COMPONENT' ? q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[c.ComponentID] : null;
        return Array.isArray(e) && e.length === 1 && e[0]?.id === c.ComponentID && e[0].type === 'scratch-pad' && e[0].marked != 1;
    };
    const answerComponents = Array.isArray(components) ? components.filter(c => !presentation.has(c?.ComponentTypeCode) && !unmarkedScratchPad(c)) : [];
    const componentsRefusal = checkAnswerComponents();
    if (componentsRefusal) return componentsRefusal;
    function checkAnswerComponents() {
        if (!Array.isArray(components) || !components.length) return refuse('expected exactly one working-formula question component', { guard: 'missing-components' });
        const formulaExtraIndex = components.findIndex(c => !presentation.has(c?.ComponentTypeCode) && !unmarkedScratchPad(c) && !['WORKING_FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT'].includes(c?.ComponentTypeCode));
        const formulaExtra = formulaExtraIndex !== -1 ? components[formulaExtraIndex] : null;
        if (!formulaExtra && answerComponents.length === 1
            && ['WORKING_FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT'].includes(answerComponents[0]?.ComponentTypeCode)) return null;
        if (formulaExtra) return accompanyingRefusal(formulaExtra);
        return duplicateRefusal();
    }
    function accompanyingRefusal(formulaExtra) {
        const code = formulaExtra?.ComponentTypeCode;
        const named = knownCodes.has(code) ? code : 'redacted type';
        return refuse(`expected exactly one working-formula question component (unsupported accompanying component: ${named})`, { guard: 'accompanying-component', componentType: knownCodes.has(code) ? code : 'UNLISTED_COMPONENT' });
    }
    // No non-working companion, but the answer-component count/type is
    // wrong (duplicate working-formula editors, or only presentation
    // companions). Name the second working-formula definition when
    // present for diagnosability, but use a distinct guard so triage does
    // not confuse it with an accompanying non-working component.
    function duplicateRefusal() {
        const duplicateCode = answerComponents.length > 1 ? answerComponents[1]?.ComponentTypeCode : answerComponents[0]?.ComponentTypeCode;
        const duplicateNamed = typeof duplicateCode === 'string' ? (knownCodes.has(duplicateCode) ? duplicateCode : 'redacted type') : null;
        const suffix = duplicateNamed ? ` (extra component: ${duplicateNamed})` : '';
        const duplicateType = typeof duplicateCode === 'string' ? (knownCodes.has(duplicateCode) ? duplicateCode : 'UNLISTED_COMPONENT') : undefined;
        return refuse(`expected exactly one working-formula question component${suffix}`, { guard: 'answer-component-count', ...(duplicateType ? { componentType: duplicateType } : {}) });
    }
    const comp = answerComponents[0];
    const bound = bindComponent(comp);
    if (bound.refusal) return bound.refusal;
    const { id, component, state, input, addButton, metadata } = bound;
    function bindComponent(comp) {
        const id = comp.ComponentID;
        if (typeof id !== 'string' || !id) return { refusal: refuse('missing working-formula component id') };
        // Editable controls outside the editor would be submitted blank.
        const lessonRoot = document.querySelector('#ep-question-container') || document;
        const editable = [...lessonRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
            .filter(el => shown(el) && !element.contains(el) && (el.matches('input,textarea,select') || el.isContentEditable));
        if (editable.length) return { refusal: refuse('question has editable controls outside the editor; answering would submit them blank') };
        const cached = q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[id];
        if (!Array.isArray(cached) || cached.length !== 1) return { refusal: refuse('cached component unavailable or ambiguous') };
        const component = cached[0], state = component?.componentState;
        const metadata = state?.metadata;
        // chunk606: BaseComponent marks every component MARKED except AnnotatedText
        // and display types; accept only the runtime value with a valid definition
        // flag (0 unspecified or 1 marked), matching the other contracts.
        const associationRefusal = checkAssociation(comp, id, component, state, metadata);
        if (associationRefusal) return { refusal: associationRefusal };
        if (component.marked !== 1 || (comp.Marked !== 0 && comp.Marked !== 1)) return { refusal: refuse('unexpected working-formula marking state') };
        const input = state.formulaInput;
        if (!input || !Array.isArray(input.rows) || typeof input.getWorkingSteps !== 'function') return { refusal: refuse('cached formula input unavailable') };
        // The multi-line editor needs its add-row button; a single-mode editor
        // hides it (chunk606 template: add-buttons display none in singleMode).
        const addButton = [...element.querySelectorAll('#add-formula-button')].filter(shown);
        if (addButton.length !== 1) return { refusal: refuse('editor is not the multi-line shape (add-row button missing or ambiguous)') };
        return { id, component, state, input, addButton, metadata };
    }
    // chunk606: builderTypes maps "working-formula"/"freeform-working" to one
    // builder; the component record binds by builder type, markup id, the
    // FormulaInput template root and the state's cloned metadata.
    // BaseComponentState clones the questionDef component into
    // metadataInstance (ObjectHelper.cloneObject) and the working-formula
    // state's metadata getter returns that clone, so an identity check
    // against the questionDef component NEVER holds live; bind the clone by
    // its ComponentID and type code instead, as the multi-choice/choice
    // readers do. Each guard names its field so a refusal is diagnosable
    // without leaking content.
    function checkAssociation(comp, id, component, state, metadata) {
        const expectedType = comp.ComponentTypeCode === 'WORKING_FORMULA_COMPONENT' ? 'working-formula' : 'freeform-working';
        const associationChecks = [
            [() => !component || !state, 'no component state'],
            [() => component.type !== expectedType, 'builder type'],
            [() => component.id !== id || state.componentID !== id, 'component id'],
            [() => component.visualElement !== element, 'visual element'],
            [() => metadata?.ComponentID !== id || metadata.ComponentTypeCode !== comp.ComponentTypeCode, 'metadata'],
        ];
        for (const [failed, field] of associationChecks) {
            if (failed()) return refuse('incomplete cached working-formula association: ' + field);
        }
        return null;
    }
    // The answer source: exactly one shipped correct step set, every step a
    // single-line formula the math parser auto-detects or reads as LaTeX
    // (FormulaFormats AUTO_DETECT=0, LATEX=2; typed MathQuill input produces
    // LaTeX). Hint steps and multi-line steps are out of this contract.
    // Steps come from the state's metadata clone, not the raw questionDef:
    // applyVariableContext resolves variable injectors into the clone's
    // CorrectWorkingSteps, so the clone holds the live expected answers.
    const collected = collectSteps(metadata);
    if (collected.refusal) return collected.refusal;
    const steps = collected.steps;
    function collectSteps(metadata) {
        const sets = metadata.CorrectSets;
        if (!Array.isArray(sets) || sets.length !== 1 || !sets[0]) return { refusal: refuse(sets && sets.length > 1 ? 'ambiguous correct step sets' : 'no shipped correct steps; no answer source') };
        const rawSteps = sets[0].CorrectWorkingSteps;
        if (!Array.isArray(rawSteps) || !rawSteps.length || rawSteps.length > 20) return { refusal: refuse('unexpected correct step count') };
        const steps = [];
        for (const step of rawSteps) {
            const stepRefusal = checkStep(step);
            if (stepRefusal) return { refusal: stepRefusal };
            steps.push(normalize(step.Formula));
        }
        return { steps };
    }
    function checkStep(step) {
        if (!step || typeof step.Formula !== 'string' || !normalize(step.Formula)) return refuse('a correct step has no usable formula');
        if (step.Formula.includes('\n')) return refuse('a correct step spans multiple lines');
        if (step.FormulaFormat !== undefined && step.FormulaFormat !== null && step.FormulaFormat !== 0 && step.FormulaFormat !== 2) return refuse('a correct step uses an unsupported formula format');
        if (step.ValidHint === true) return refuse('a correct step is marked as a hint');
        return null;
    }
    // A fresh read requires every current row blank: stored or prefilled
    // working is never corrected, matching the other contracts'
    // untouched-state rule. A re-read against a baseline carries the round's
    // own entered rows; the handler verifies those as an exact prefix.
    const built = buildResult(comp, id, component, state, input, addButton, steps);
    if (built.refusal) return built.refusal;
    const result = built.result;
    function buildResult(comp, id, component, state, input, addButton, steps) {
        // A fresh read requires every current row blank: stored or prefilled
        // working is never corrected, matching the other contracts'
        // untouched-state rule. A re-read against a baseline carries the round's
        // own entered rows; the handler verifies those as an exact prefix.
        const rowValues = input.rows.map(row => normalize(row?.model?.value));
        if (!baseline && rowValues.some(value => value !== '')) return { refusal: refuse('the editor already holds entered working; stored or prefilled answers are not corrected') };
        const autoMarkState = value => {
            if (value === true) return true;
            if (value === false) return false;
            return 'unknown';
        };
        const autoMarked = autoMarkState(self.sectionData?.activityGroup?.isAutoMarked);
        // Filling a manually marked question leaves answers visible with no
        // grading contract, so like the other readers it refuses at read time
        // rather than at Submit.
        if (comp.Marked !== 1 || autoMarked !== true) return { refusal: refuse('the question is not automatically marked') };
        const signature = JSON.stringify([id, comp.ComponentTypeCode, comp.Marked, steps]);
        const key = `workingformula:${q.contentID}:${q.questionIndex}`;
        if (baseline && (baseline.q !== q || baseline.comp !== comp || baseline.model !== model
            || baseline.component !== component || baseline.state !== state || baseline.element !== element
            || baseline.input !== input || baseline.descriptor.key !== key
            || baseline.descriptor.associationSignature !== signature)) return { refusal: refuse('cached question or editor identity changed') };
        const descriptor = { kind: 'workingformula', representation: 'working-formula-editor', key,
            associationSignature: signature, steps, stepCount: steps.length, autoMarked };
        return { result: { descriptor, q, comp, model, component, state, input, element, addButton: addButton[0], rowValues } };
    }
    if (action === 'submit' || action === 'verify') {
        const actionOutcome = applyAction(result, steps);
        if (actionOutcome) return actionOutcome;
    }
    function applyAction(result, steps) {
        // The verified fill: the editor's own step read must equal the
        // shipped correct formulas exactly before Submit is considered.
        let entered;
        try { entered = (input.getWorkingSteps() || []).map(s => normalize(s?.formula)); } catch (e) { return refuse('editor working steps unreadable'); }
        if (JSON.stringify(entered) !== JSON.stringify(steps)) return refuse('entered working is not exactly the shipped correct steps');
        if (action === 'verify') return result;
        // The visible navigation bar whose Angular scope chain resolves to
        // this lesson model is the only bar whose Submit may be clicked.
        const ownerOf = bar => {
            let node = bar;
            for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                const ng = window.angular?.element(node);
                const owner = [ng?.isolateScope?.(), ng?.scope?.()].map(scope => scope?.self?.model).find(m => m?._currentQuestion);
                if (owner) return owner;
            }
            return undefined;
        };
        const owned = [...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(bar => ownerOf(bar) === model);
        if (owned.length !== 1) return refuse('navigation controls are ambiguous or unassociated');
        const buttons = [...owned[0].querySelectorAll('button')].filter(shown);
        const enabled = buttons.filter(btn => !btn.disabled && (btn.innerText || '').trim() === 'Submit');
        if (enabled.length > 1) return refuse('Submit is ambiguous');
        if (enabled.length === 0) return { ...result, readiness: 'not-ready' };
        result.target = enabled[0];
        return null;
    }
    return action === 'descriptor' ? { descriptor: result.descriptor } : result;
}
module.exports = { readWorkingFormulaInPage };
