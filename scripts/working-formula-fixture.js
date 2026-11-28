// Invented source-derived fixture, not captured student DOM: one slide with
// EP's working-formula maths editor ("Add a line of working", EP chunk606:
// formula-input template, FormulaInput rows/addFormulaRow/getWorkingSteps,
// BaseComponentState clones the questionDef component into metadataInstance
// and the state's metadata getter returns that clone, typed rows finalise
// on blur). The editor fields are plain contenteditable spans
// standing in for MathQuill fields; the contract under test is the row model
// and step read-back, not MathQuill internals. variant 'unmarked' authors the
// definition Marked 0; 'delayed' disables Submit and re-enables it 120ms
// after each input (EP's asynchronous enablement); 'prefilled' starts with a
// row already entered; 'twosets' ships two correct sets; 'hints' marks a
// step ValidHint; 'freeform' uses FREEFORM_WORKING_COMPONENT with no
// CorrectSets; 'misbound' points the cached record's visualElement at the
// wrong node. steps overrides the three-step default.
function installWorkingFormulaFixture(variant, steps) {
    const old = document.querySelector('.multi-choice-component');
    const self = window.angular.element(old).scope().self, q = self.model._currentQuestion;
    self.model.gameMode = 3;
    if (variant === 'unmarked') self.sectionData.activityGroup.isAutoMarked = false;
    const stepList = steps || ['V = lwh', String.raw`V = 5 \times 4 \times 3`, String.raw`V = 60\,\text{cm}^3`];
    const marked = variant === 'unmarked' ? 0 : 1;
    const correctSteps = stepList.map((formula, i) => ({ Formula: formula, FormulaFormat: 2, CommentPreFormula: '', CommentPostFormula: '', Marked: true, ValidHint: variant === 'hints' && i === 1 }));
    const def = {
        ComponentTypeCode: variant === 'freeform' ? 'FREEFORM_WORKING_COMPONENT' : 'WORKING_FORMULA_COMPONENT',
        ComponentID: 'working-0', Marked: marked,
        ...(variant === 'freeform' ? {} : { CorrectSets: variant === 'twosets' ? [{ CorrectWorkingSteps: correctSteps }, { CorrectWorkingSteps: correctSteps }] : [{ CorrectWorkingSteps: correctSteps }] }),
    };
    q.questionDef.Components = [def];
    // chunk606: BaseComponentState clones the questionDef component into
    // metadataInstance (ObjectHelper.cloneObject); the working-formula
    // state's metadata getter returns that clone, never the def object
    // itself. Model both exactly so an identity binding in the reader fails
    // here the way it does live.
    const state = { componentID: def.ComponentID, metadataInstance: JSON.parse(JSON.stringify(def)) };
    Object.defineProperty(state, 'metadata', { get() { return this.metadataInstance; } });
    // chunk606: the builder's visualElement is the FormulaInput template root
    // div.formula-component; div.formula-input is its inner editor container.
    const element = document.createElement('div');
    element.className = 'formula-component';
    element.innerHTML = '<div class="formula-input v-group h-align-center" style="position:relative"><div class="formula-list-background"><ul id="formula-list" class="formula-list"></ul></div>'
        + '<div id="add-buttons" class="add-buttons"><button id="add-formula-button" class="add-formula-button add-button fill"><span>Add a line of working</span></button></div></div>';
    old.replaceWith(element);
    const list = element.querySelector('#formula-list');
    const normalize = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const f = window.workingFormulaFixture = { self, q, def, state, element, submits: 0, nexts: 0, finalized: [] };
    const input = state.formulaInput = {
        rows: [],
        getWorkingSteps() { return this.rows.filter(r => !r.isBlank).map(r => ({ formula: r.model.value, formulaFormat: r.model.valueFormat })); },
        addFormulaRow(value, id, comment, activate) {
            const li = document.createElement('li');
            li.className = 'formula-item h-group v-align-top';
            li.innerHTML = '<div class="row-content fill needsclick" style="display:block;min-height:20px"><span class="mq-editable-field" contenteditable="true" style="display:inline-block;min-width:120px;min-height:18px"></span></div>';
            const row = {
                model: { value: value || '', valueFormat: 0, isHint: false, comment: comment || null, id: id || 'row-' + this.rows.length },
                outerElement: li,
                get isBlank() { return normalize(this.model.value) === ''; },
            };
            const field = li.querySelector('[contenteditable]');
            field.textContent = value || '';
            field.addEventListener('input', () => { row.model.value = field.textContent; });
            field.addEventListener('blur', () => {
                if (row.isBlank) return;
                // Immediate feedback: EP marks each finalised step against the
                // shipped correct steps (client-side WorkingComparer).
                const entered = input.getWorkingSteps().map(s => normalize(s.formula));
                const correct = (def.CorrectSets?.[0]?.CorrectWorkingSteps || []).map(s => normalize(s.Formula));
                const index = entered.length - 1;
                row.answerFeedback = entered[index] === correct[index] ? 'CORRECT' : 'INCORRECT';
                input.answerStatus = { solutionComplete: JSON.stringify(entered) === JSON.stringify(correct) };
                f.finalized.push(row.answerFeedback);
            });
            list.appendChild(li);
            this.rows.push(row);
            if (activate !== false) field.focus();
            return row;
        },
    };
    // chunk606 FormulaInput.notifyAttached: one blank row to start.
    input.addFormulaRow('', 'row-0', null, false, false, null, false);
    if (variant === 'prefilled') input.rows[0].model.value = 'V = lwh';
    element.querySelector('#add-formula-button').addEventListener('click', () => { input.addFormulaRow('', null, null, true); });
    q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: { 'working-0': [{ type: def.ComponentTypeCode === 'WORKING_FORMULA_COMPONENT' ? 'working-formula' : 'freeform-working', id: 'working-0', visualElement: element, componentState: state, marked: 1, renderingParameters: { mode: 1 } }] } } } };
    if (variant === 'misbound') q.cachedRenderers[1].identifiedComponents.baseComponents['working-0'][0].visualElement = document.createElement('div');
    document.querySelector('#question-container-group').textContent = 'Synthetic prism slide: find the volume, showing working.';
    document.addEventListener('click', e => {
        const button = e.target.closest('#sa-navigation-controls button');
        if (button && button.textContent.trim() !== 'Submit') f.nexts++;
    }, true);
    // A fresh Submit button without the lesson page's own listeners; the
    // 'delayed' variant models EP's asynchronous enablement as a debounce.
    const previous = [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit');
    const submit = document.createElement('button');
    submit.textContent = 'Submit';
    previous.replaceWith(submit);
    const hold = () => {
        submit.disabled = true;
        clearTimeout(f.enableTimer);
        f.enableTimer = setTimeout(() => { if (!f.neverEnable) submit.disabled = false; }, 120);
    };
    if (variant === 'delayed') {
        // Disabled at mount; only answer input starts the debounce that
        // re-enables, like EP's own asynchronous validation.
        submit.disabled = true;
        document.addEventListener('input', hold, true);
    }
    submit.addEventListener('click', () => {
        f.submits++;
        const entered = input.getWorkingSteps().map(s => normalize(s.formula));
        const correct = (def.CorrectSets?.[0]?.CorrectWorkingSteps || []).map(s => normalize(s.Formula));
        if (JSON.stringify(entered) === JSON.stringify(correct)) {
            // A correct answer advances the question; EP remounts a fresh
            // blank editor for the next one.
            q.questionIndex++;
            while (input.rows.length > 0) { input.rows.pop().outerElement.remove(); }
            input.addFormulaRow('', 'row-0', null, false);
        }
    });
}
module.exports = { installWorkingFormulaFixture };
