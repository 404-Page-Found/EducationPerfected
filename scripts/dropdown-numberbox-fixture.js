// Invented source-derived fixture, not captured student DOM: one slide with
// four dropdowns and six number boxes, merging the dropdown and input-box
// fixture shapes (EP chunk606). variant 'unmarked' authors every definition
// Marked 0, matching Page's live slide (all ten components authored unmarked,
// runtime marked 1). dropdownAnswers overrides the dropdown answer list; an
// empty array builds a number-box (+ optional text-box) slide with no
// dropdowns; numberBoxItems overrides the six-box list (Page's live
// seven-box/one-text-box composition passes seven).
function installDropdownNumberBoxFixture(variant, numberBoxDefinition, textBoxItem, dropdownAnswers, numberBoxItems, keepMulti) {
    // Linear equivalent of template.split(/({[^}]+})/g) plus
    // /^\{[^}]+\}$/ test: every "{" .. next "}" with at least one char
    // between is an expression (inner "{" allowed per EP splitParts).
    // Preserves source grammar while avoiding super-linear backtracking.
    // NOTE: intentionally buffer-accumulating (substring/indexOf mix) so this
    // page-serialized fixture stays self-contained yet token-distinct from
    // the textbox/dropdown fixtures for Sonar CPD.
    const splitTemplate = template => {
        const res = [];
        let buf = '';
        for (let k = 0; k < template.length;) {
            if (template[k] !== '{') { buf += template[k++]; continue; }
            const shut = template.indexOf('}', k + 1);
            if (shut < 0 || shut === k + 1) { buf += template[k++]; continue; }
            res.push(buf, template.substring(k, shut + 1));
            buf = '';
            k = shut + 1;
        }
        res.push(buf);
        return res;
    };
    const isExpressionPart = part => part.length > 2 && part[0] === '{' && part[part.length - 1] === '}' && part.slice(1, -1).indexOf('}') === -1;
    const injectorFrom = template => ({ parts: splitTemplate(template).map(seg => isExpressionPart(seg) ? { temporaryVariable: { expression: seg.slice(1, -1) } } : { text: seg }) });
    const old = document.querySelector('.multi-choice-component');
    const self = window.angular.element(old).scope().self, q = self.model._currentQuestion, base = {}, group = document.createElement('div');
    self.model.gameMode = 3;
    // keepMulti: a multi-select fixture already owns the page - keep its
    // definition, renderer cache and component group, and take over its
    // definition marking, so the slide carries both surfaces.
    if (keepMulti) {
        Object.assign(base, q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents || {});
        q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: base } } };
        const multiDef = (q.questionDef.Components || []).find(c => c && c.ComponentTypeCode === 'MULTICHOICE_COMPONENT');
        if (multiDef) multiDef.Marked = variant === 'unmarked' ? 0 : 1;
    } else {
        q.questionDef.Components = [];
        q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: base } } };
    }
    group.className = 'synthetic-dropdown-numberbox-container';
    if (keepMulti) { old.after(group); } else { old.replaceWith(group); }
    const marked = variant === 'unmarked' ? 0 : 1;
    const f = window.dropdownNumberBoxFixture = { self, q, group, base, keys: [], changes: [], inputs: [], submits: 0, nexts: 0 };
    const angular = window.angular;
    window.angular = { ...angular, element: el => el === group ? { scope: () => ({ self }) } : angular.element(el) };
    document.querySelector('#question-container-group').textContent = 'Synthetic rounding slide: choose four answers and round six numbers.';
    document.addEventListener('click', e => {
        const button = e.target.closest('#sa-navigation-controls button');
        if (button && button.textContent.trim() !== 'Submit') f.nexts++;
    }, true);
    for (const [i, answer] of (dropdownAnswers || ['Tenth', 'Hundredth', 'Tenth', 'Unit']).entries()) {
        const id = 'dropdown-' + i;
        const options = [{ Description: 'wrong', Correct: 'false', Validity: 'true', SortOrder: 0 }, { Description: answer, Correct: 'true', Validity: 'true', SortOrder: 1 }];
        const def = { ComponentTypeCode: 'DROPDOWN_COMPONENT', ComponentID: id, Marked: marked, Options: JSON.parse(JSON.stringify(options)), DefaultSelection: { Description: '', Correct: 'false', Validity: 'true', SortOrder: 0 } };
        q.questionDef.Components.unshift(def);
        const metadata = JSON.parse(JSON.stringify(def));
        const original = metadata.Options.concat();
        const blank = { Description: '', Correct: 'false', Validity: 'true', SortOrder: 0 };
        const shuffled = [blank, ...metadata.Options];
        const state = { metadataInstance: metadata, originalDropDownOptions: original, descInjectors: options.map(o => injectorFrom(o.Description)), correctInjectors: options.map(o => injectorFrom(o.Correct)), _shuffledOptions: shuffled, _selectedOption: metadata.DefaultSelection };
        const select = document.createElement('select');
        select.id = id;
        for (const option of shuffled) { const o = document.createElement('option'); o.textContent = option.Description; select.append(o); }
        select.selectedIndex = 0;
        group.append(document.createTextNode(' Place ' + (i + 1) + ': '), select);
        const component = { id, componentState: state, visualElement: select, dropDownList: select, marked: 1, renderingParameters: { mode: 1 } };
        base[id] = [component];
        select.addEventListener('keydown', e => { f.keys.push({ id, key: e.key, trusted: e.isTrusted }); f.beforeKey?.(e); });
        select.addEventListener('change', e => { const text = select.options[select.selectedIndex].text; state._selectedOption = original.find(o => o.Description.trim() === text.trim()) || null; f.changes.push({ id, index: select.selectedIndex, trusted: e.isTrusted }); f.afterChange?.(); });
    }
    const items = numberBoxItems || [
        { id: 'box-0', answer: '30' },
        { id: 'box-1', answer: '94.2', definition: { RoundingTypeCode: 'DP', RoundingAmount: 2 } },
        { id: 'box-2', answer: '7' },
        { id: 'box-3', answer: '3.5', definition: { RoundingTypeCode: 'DP', RoundingAmount: 1 } },
        { id: 'box-4', answer: '12' },
        { id: 'box-5', answer: '0.25', definition: { RoundingTypeCode: 'DP', RoundingAmount: 2 } },
    ];
    for (const item of items) {
        const def = Object.assign({ ComponentTypeCode: 'NUMBER_BOX_COMPONENT', ComponentID: item.id, Marked: marked, InitialText: '', Options: [item.raw || item.answer] }, numberBoxDefinition, item.definition);
        q.questionDef.Components.unshift(def); // Metadata order deliberately differs from DOM.
        const input = document.createElement('input');
        input.className = 'number-box-component';
        // EP chunk606: number boxes wrap the input in a script-position span
        // that becomes the component's visualElement.
        const visual = document.createElement('span');
        visual.appendChild(input);
        group.append(document.createTextNode(' Round: '), visual);
        const metadataInstance = JSON.parse(JSON.stringify(def));
        const state = { metadataInstance, answerOptions: [item.answer], optionsInjector: def.Options.map(injectorFrom), variableOptions: [{ Code: 'synthetic-case', Value: 'true' }], injectedInitialText: '', userAnswer: '', isUserAnswerSet: false };
        const component = { id: item.id, componentState: state, visualElement: visual, textBox: input, renderingParameters: { mode: 1 }, marked: 1 };
        base[item.id] = [component];
        input.addEventListener('input', e => {
            f.inputs.push({ id: item.id, trusted: e.isTrusted });
            state.userAnswer = input.value;
            state.isUserAnswerSet = true;
            f.afterInput?.();
        });
    }
    // Optional third surface: one lesson text box (EP chunk606
    // NewTextBoxComponent: visualElement IS the input, never wrapped).
    if (textBoxItem) {
        const def = Object.assign({ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: textBoxItem.id, Marked: marked, InitialText: '', Options: [textBoxItem.raw || textBoxItem.answer] }, { CaseSensitive: true, MarkPunctuation: false, IgnoredCharacters: '' });
        q.questionDef.Components.unshift(def);
        const input = document.createElement('input');
        input.className = 'text-box-component';
        group.append(document.createTextNode(' Answer: '), input);
        const metadataInstance = JSON.parse(JSON.stringify(def));
        const state = { metadataInstance, answerOptions: [textBoxItem.answer], optionsInjector: def.Options.map(injectorFrom), variableOptions: [{ Code: 'synthetic-case', Value: 'true' }], injectedInitialText: '', userAnswer: '', isUserAnswerSet: false };
        base[textBoxItem.id] = [{ id: textBoxItem.id, componentState: state, visualElement: input, textBox: input, renderingParameters: { mode: 1 }, marked: 1 }];
        input.addEventListener('input', e => {
            f.inputs.push({ id: textBoxItem.id, trusted: e.isTrusted });
            state.userAnswer = input.value;
            state.isUserAnswerSet = true;
            f.afterInput?.();
        });
    }
    const oldSubmit = [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit');
    const submit = oldSubmit.cloneNode(true);
    oldSubmit.replaceWith(submit);
    // 'delayed' variant: EP enables Submit asynchronously after its own
    // validation accepts the filled inputs - model it as a debounce: every
    // input event re-disables the button, which re-enables shortly after.
    if (variant === 'delayed') {
        submit.disabled = true;
        document.addEventListener('input', () => {
            submit.disabled = true;
            clearTimeout(f.enableTimer);
            f.enableTimer = setTimeout(() => { if (!f.neverEnable) submit.disabled = false; }, 120);
        }, true);
    }
    submit.addEventListener('click', () => {
        f.submittedSelections = [...group.querySelectorAll('select')].map(el => [el.options[el.selectedIndex].textContent, base[el.id][0].componentState._selectedOption?.Description]);
        f.submittedBoxValues = [...group.querySelectorAll('input.number-box-component')].map(el => { const entry = Object.values(base).flat().find(c => c.textBox === el); return [el.value, entry?.componentState.userAnswer]; });
        f.submittedTextBoxValues = [...group.querySelectorAll('input.text-box-component')].map(el => { const entry = Object.values(base).flat().find(c => c.textBox === el); return [el.value, entry?.componentState.userAnswer]; });
        f.submits++;
        q.questionIndex++;
    });
}
module.exports = { installDropdownNumberBoxFixture };
