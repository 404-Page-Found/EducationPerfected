// Source-grounded read-only inspection of EP's cached working-formula
// renderer (the "Add a line of working" maths editor, issue #113).
// EP public chunk 606 (retrieved 2026-11-18), ComponentParser.builderTypes
// ("working-formula"/"freeform-working" share one builder), the formula-input
// template (ul#formula-list of li.formula-item rows, #add-formula-button),
// FormulaInput (addFormulaRow/discardBlankLastRow/getWorkingSteps/setWorking
// Steps, one blank initial row), WorkingFormulaComponentState (metadata IS the
// questionDef component; CorrectSets[].CorrectWorkingSteps[] carry Formula,
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
    const refuse = reason => ({ descriptor: { kind: 'unsupported', reason: 'Working formula: ' + reason } });
    const normalize = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const elements = [...document.querySelectorAll('div.formula-input')].filter(shown);
    if (elements.length > 1) return refuse('ambiguous visible working-formula editors');
    if (elements.length === 0) return null;
    const element = elements[0];
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
    if (model?.gameMode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } };
    const validIds = !!q && Number.isSafeInteger(q.contentID) && q.contentID > 0 && Number.isSafeInteger(q.questionIndex) && q.questionIndex >= 0;
    if (model?.gameMode !== 3 || !validIds) return refuse('missing current lesson identity');
    const components = q.questionDef?.Components;
    // chunk606, checked 18 November 2026: Submit grades the whole question, so
    // this first contract admits exactly one component, the editor itself.
    // Both working-formula type codes build the same component state class.
    if (!Array.isArray(components) || components.length !== 1
        || !['WORKING_FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT'].includes(components[0]?.ComponentTypeCode)) return refuse('expected exactly one working-formula question component');
    const comp = components[0];
    const id = comp.ComponentID;
    if (typeof id !== 'string' || !id) return refuse('missing working-formula component id');
    // Editable controls outside the editor would be submitted blank.
    const lessonRoot = document.querySelector('#ep-question-container') || document;
    const editable = [...lessonRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
        .filter(el => shown(el) && !element.contains(el) && (el.matches('input,textarea,select') || el.isContentEditable));
    if (editable.length) return refuse('question has editable controls outside the editor; answering would submit them blank');
    const cached = q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[id];
    if (!Array.isArray(cached) || cached.length !== 1) return refuse('cached component unavailable or ambiguous');
    const component = cached[0], state = component?.componentState;
    // chunk606: builderTypes maps "working-formula"/"freeform-working" to one
    // builder; the component record binds by type, id, visual element and the
    // state whose metadata IS the questionDef component object.
    const expectedType = comp.ComponentTypeCode === 'WORKING_FORMULA_COMPONENT' ? 'working-formula' : 'freeform-working';
    if (component.type !== expectedType || component.id !== id || component.visualElement !== element
        || !state || state.metadata !== comp) return refuse('incomplete cached working-formula association');
    // chunk606: BaseComponent marks every component MARKED except AnnotatedText
    // and display types; accept only the runtime value with a valid definition
    // flag (0 unspecified or 1 marked), matching the other contracts.
    if (component.marked !== 1 || (comp.Marked !== 0 && comp.Marked !== 1)) return refuse('unexpected working-formula marking state');
    const input = state.formulaInput;
    if (!input || !Array.isArray(input.rows) || typeof input.getWorkingSteps !== 'function') return refuse('cached formula input unavailable');
    // The multi-line editor needs its add-row button; a single-mode editor
    // hides it (chunk606 template: add-buttons display none in singleMode).
    const addButton = [...element.querySelectorAll('#add-formula-button')].filter(shown);
    if (addButton.length !== 1) return refuse('editor is not the multi-line shape (add-row button missing or ambiguous)');
    // The answer source: exactly one shipped correct step set, every step a
    // single-line formula the math parser auto-detects or reads as LaTeX
    // (FormulaFormats AUTO_DETECT=0, LATEX=2; typed MathQuill input produces
    // LaTeX). Hint steps and multi-line steps are out of this contract.
    const sets = comp.CorrectSets;
    if (!Array.isArray(sets) || sets.length !== 1 || !sets[0]) return refuse(sets && sets.length > 1 ? 'ambiguous correct step sets' : 'no shipped correct steps; no answer source');
    const rawSteps = sets[0].CorrectWorkingSteps;
    if (!Array.isArray(rawSteps) || !rawSteps.length || rawSteps.length > 20) return refuse('unexpected correct step count');
    const steps = [];
    for (const step of rawSteps) {
        if (!step || typeof step.Formula !== 'string' || !normalize(step.Formula)) return refuse('a correct step has no usable formula');
        if (step.Formula.includes('\n')) return refuse('a correct step spans multiple lines');
        if (step.FormulaFormat !== undefined && step.FormulaFormat !== null && step.FormulaFormat !== 0 && step.FormulaFormat !== 2) return refuse('a correct step uses an unsupported formula format');
        if (step.ValidHint === true) return refuse('a correct step is marked as a hint');
        steps.push(normalize(step.Formula));
    }
    // A fresh read requires every current row blank: stored or prefilled
    // working is never corrected, matching the other contracts'
    // untouched-state rule. A re-read against a baseline carries the round's
    // own entered rows; the handler verifies those as an exact prefix.
    const rowValues = input.rows.map(row => normalize(row?.model?.value));
    if (!baseline && rowValues.some(value => value !== '')) return refuse('the editor already holds entered working; stored or prefilled answers are not corrected');
    const autoMarked = self.sectionData?.activityGroup?.isAutoMarked === true ? true : self.sectionData?.activityGroup?.isAutoMarked === false ? false : 'unknown';
    // Filling a manually marked question leaves answers visible with no
    // grading contract, so like the other readers it refuses at read time
    // rather than at Submit.
    if (comp.Marked !== 1 || autoMarked !== true) return refuse('the question is not automatically marked');
    const signature = JSON.stringify([id, comp.ComponentTypeCode, comp.Marked, steps]);
    const key = `workingformula:${q.contentID}:${q.questionIndex}`;
    if (baseline && (baseline.q !== q || baseline.comp !== comp || baseline.model !== model
        || baseline.component !== component || baseline.state !== state || baseline.element !== element
        || baseline.input !== input || baseline.descriptor.key !== key
        || baseline.descriptor.associationSignature !== signature)) return refuse('cached question or editor identity changed');
    const descriptor = { kind: 'workingformula', representation: 'working-formula-editor', key,
        associationSignature: signature, steps, stepCount: steps.length, autoMarked };
    const result = { descriptor, q, comp, model, component, state, input, element, addButton: addButton[0], rowValues };
    if (action === 'submit' || action === 'verify') {
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
    }
    return action === 'descriptor' ? { descriptor } : result;
}
module.exports = { readWorkingFormulaInPage };
