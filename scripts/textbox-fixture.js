// Invented sanitized source-derived fixtures, not captured account DOM.
// EP chunk606: text boxes and number boxes share componentState answer state;
// number boxes add numeric rounding/error metadata. The state builds one
// BasicVariableInjector per raw option template and applyVariableContext
// resolves {expression} templates in place on answerOptions, so an item with
// `raw` keeps the template in def/metadata while answerOptions is resolved.
function installInputBoxFixture(config) {
    // Linear equivalent of template.split(/({[^}]+})/g): every "{"
    // .. next "}" with at least one char between is a delimiter (inner
    // "{" allowed per EP splitParts). Preserves source grammar while
    // avoiding super-linear backtracking (S8786).
    // NOTE: page-serialized fixture cannot require a shared module, so this
    // scanner mirrors the dropdown/numberbox splitParts grammar (see
    // scripts/dropdown-fixture.js and scripts/dropdown-numberbox-fixture.js);
    // keep the copies in sync.
    const splitTemplate = template => {
        const parts = [];
        let pos = 0;
        while (true) {
            let open = template.indexOf('{', pos);
            let validOpen = -1, validClose = -1;
            while (open !== -1) {
                const close = template.indexOf('}', open + 1);
                if (close === -1) break;
                if (close > open + 1) { validOpen = open; validClose = close; break; }
                open = template.indexOf('{', open + 1);
            }
            if (validOpen === -1) { parts.push(template.slice(pos)); break; }
            parts.push(template.slice(pos, validOpen));
            parts.push(template.slice(validOpen, validClose + 1));
            pos = validClose + 1;
        }
        return parts;
    };
    const isExpressionPart = part => part.length > 2 && part.codePointAt(0) === 123 && part.codePointAt(part.length - 1) === 125 && part.indexOf('}', 1) === part.length - 1;
    const injectorFrom = template => ({ parts: splitTemplate(template).map(part => isExpressionPart(part) ? { temporaryVariable: { expression: part.slice(1, -1) } } : { text: part }) });
    const old = document.querySelector('.multi-choice-component');
    const self = window.angular.element(old).scope().self, q = self.model._currentQuestion;
    self.model.gameMode = 3;
    const group = document.createElement('div');
    group.className = 'synthetic-input-box-container';
    old.replaceWith(group);
    q.questionDef.Components = [];
    const base = {};
    q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: base } } };
    const f = window[config.fixtureName] = { self, q, group, base, inputs: [], submits: 0, nexts: 0, initialQuestionIndex: q.questionIndex };
    document.addEventListener('click', e => {
        const button = e.target.closest('#sa-navigation-controls button');
        if (button && button.textContent.trim() !== 'Submit') f.nexts++;
    }, true);
    const angular = window.angular;
    window.angular = { ...angular, element: el => el === group ? { scope: () => ({ self }) } : angular.element(el) };
    for (const item of config.items) {
        const def = {
            ComponentTypeCode: config.componentType,
            ComponentID: item.id,
            Marked: 1,
            InitialText: '',
            Options: [item.raw || item.answer],
            ...config.definition,
            ...(item.definition || {}),
        };
        q.questionDef.Components.unshift(def); // Metadata order deliberately differs from DOM.
        const input = document.createElement('input');
        input.className = config.inputClass;
        // EP chunk606: number boxes wrap the input in a script-position span
        // that becomes the component's visualElement; text boxes do not.
        let visual = input;
        if (config.wrapsInput) {
            visual = document.createElement('span');
            visual.appendChild(input);
        }
        group.append(visual);
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
        input.addEventListener('keydown', e => { if (e.key === 'Enter') f.submits++; });
    }
    // Mixed slides: extra definition components (never answer-bearing in the
    // base map) plus their extra editable controls, modelling for example a
    // MULTICHOICE_COMPONENT's one radio input per option (EP chunk606).
    for (const extra of config.extraComponents || []) q.questionDef.Components.unshift({ Marked: 1, ...extra });
    for (const control of config.extraControls || []) {
        if (control.trackEvents) f.radioEvents = [];
        for (let index = 0; index < control.count; index++) {
            const el = document.createElement(control.tag);
            if (control.type) el.type = control.type;
            if (control.name) el.name = control.name;
            if (control.value) el.value = `${control.value}-${index}`;
            if (control.trackEvents) {
                el.addEventListener('input', () => f.radioEvents.push('input'));
                el.addEventListener('change', () => f.radioEvents.push('change'));
            }
            if (control.label) {
                const label = document.createElement('label');
                label.textContent = `${control.label}-${index}`;
                label.appendChild(el);
                group.append(label);
            } else {
                group.append(el);
            }
        }
    }
    const oldButton = [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit');
    const submit = oldButton.cloneNode(true);
    oldButton.replaceWith(submit);
    submit.addEventListener('click', () => { f.submits++; q.questionIndex++; });
}

const numberBoxDefinition = {
    RoundingTypeCode: 'NONE',
    RoundingAmount: 0,
    AcceptableErrorTypeCode: 'ABS',
    AcceptableErrorValue: 0,
    Height: 0,
    Width: 0,
    ScriptPosition: 'normal',
    TextAlignment: 'left',
    Score: 1,
};

const inputBoxFixtures = {
    textbox: {
        fixtureName: 'textboxFixture',
        componentType: 'TEXT_BOX_COMPONENT',
        inputClass: 'text-box-component',
        definition: { CaseSensitive: true, MarkPunctuation: false, IgnoredCharacters: '' },
        items: [
            { id: 'box-b', answer: 'beta' },
            { id: 'box-a', answer: 'alpha' },
        ],
    },
    'textbox-variables': {
        fixtureName: 'textboxFixture',
        componentType: 'TEXT_BOX_COMPONENT',
        inputClass: 'text-box-component',
        definition: { CaseSensitive: true, MarkPunctuation: false, IgnoredCharacters: '' },
        items: [
            { id: 'box-v', raw: '{word}', answer: 'armadietto' },
        ],
    },
    'textbox-mixed': {
        fixtureName: 'textboxFixture',
        componentType: 'TEXT_BOX_COMPONENT',
        inputClass: 'text-box-component',
        definition: { CaseSensitive: true, MarkPunctuation: false, IgnoredCharacters: '' },
        items: [
            { id: 'box-a', answer: 'alpha' },
        ],
        extraComponents: [
            { ComponentTypeCode: 'MULTICHOICE_COMPONENT', ComponentID: 'mcq-1' },
        ],
        extraControls: [
            { tag: 'input', type: 'radio', name: 'mcq-1', value: 'invented-zeta', label: 'Invented option label', trackEvents: true, count: 3 },
        ],
    },
    numberbox: {
        fixtureName: 'numberBoxFixture',
        componentType: 'NUMBER_BOX_COMPONENT',
        inputClass: 'number-box-component',
        wrapsInput: true,
        definition: numberBoxDefinition,
        items: [
            { id: 'box-c', answer: '30' },
            { id: 'box-a', answer: '30' },
            { id: 'box-d', answer: '30' },
            { id: 'box-b', answer: '94.2', definition: { RoundingTypeCode: 'DP', RoundingAmount: 2 } },
        ],
    },
    'numberbox-variables': {
        fixtureName: 'numberBoxFixture',
        componentType: 'NUMBER_BOX_COMPONENT',
        inputClass: 'number-box-component',
        wrapsInput: true,
        definition: numberBoxDefinition,
        items: [
            { id: 'box-v', raw: '{[n][0]}', answer: '42' },
        ],
    },
};

module.exports = { installInputBoxFixture, inputBoxFixtures, numberBoxDefinition };
