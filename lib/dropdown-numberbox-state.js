// Read existing objects only. Combines the DropDownComponent and
// NumberBoxComponent contracts (EP public chunk606, checked 6-9 November
// 2026) for one slide that carries both answer surfaces. Do not invoke
// shuffledOptions: its getter can sort options and create state. change maps
// by trimmed description.
// https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
//
// A slide mixing visible dropdown selects with visible number-box inputs is
// refused by each single-surface reader (mixed-editable-inputs / lesson-dom),
// so this reader verifies the pair together. Every check from the individual
// contracts still applies to its own surface; the slide is answered only when
// all dropdowns and all number boxes verify against EP's own accepted answers.
function readDropdownNumberBoxInPage(baseline, action) {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const lesson = document.querySelector('#ep-question-container');
    const selects = lesson ? [...lesson.querySelectorAll('select')].filter(shown) : [];
    const boxes = [...document.querySelectorAll('input.number-box-component')].filter(shown);
    // Only a slide showing both surfaces belongs to this reader; anything
    // else falls through to the single-surface readers unchanged.
    if (!selects.length || !boxes.length) return null;
    const diagnostic = { kind: 'dropdown-numberbox-refusal', guard: 'start', domSelectCount: selects.length, domBoxCount: boxes.length };
    const refuse = (guard, facts = {}) => ({ descriptor: { kind: 'unsupported', reason: 'Lesson dropdowns with number boxes: unsafe, unsupported or changed renderer state', diagnostic: { ...diagnostic, ...facts, guard } } });
    const modelOf = el => {
        for (let n = el, depth = 0; n && depth < 10; n = n.parentElement, depth++) {
            const a = window.angular?.element(n);
            for (const scope of a ? [a.isolateScope?.(), a.scope?.()] : []) if (scope?.self?.model?._currentQuestion) return scope.self;
        }
        return null;
    };
    const self = modelOf(selects[0]), model = self?.model, q = model?._currentQuestion;
    if (!q) return refuse('missing-question-model');
    if (model.gameMode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } };
    if (model.gameMode !== 3) return refuse('not-lesson-mode');
    if (self.sectionData?.activityGroup?.isAutoMarked !== true) return refuse('not-explicit-auto-marked');
    if (!Number.isSafeInteger(q.contentID) || q.contentID <= 0) return refuse('invalid-content-id');
    if (!Number.isSafeInteger(q.questionIndex) || q.questionIndex < 0) return refuse('invalid-question-index');
    const own = (object, key) => {
        const property = object && Object.getOwnPropertyDescriptor(object, key);
        return property && 'value' in property ? property.value : undefined;
    };
    // Any editable control beyond the two known answer surfaces keeps the
    // slide refused, named content-free exactly like the dropdown reader.
    const extraEditables = [...lesson.querySelectorAll('input,textarea,select,[contenteditable]')].filter(el => shown(el) && (el.matches('input,textarea,select') || el.isContentEditable)).filter(el => !selects.includes(el) && !boxes.includes(el));
    if (extraEditables.length) return refuse('mixed-editable-inputs', (() => {
        const extras = extraEditables.slice(0, 8).map(el => {
            const detail = { tag: el.tagName.toLowerCase() };
            if (el.tagName === 'INPUT') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                detail.type = ['button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week'].includes(type) ? type : 'other';
            }
            if (el.matches('input.text-box-component')) detail.answerBox = 'text-box';
            else if (el.matches('input.number-box-component')) detail.answerBox = 'number-box';
            if (el.closest('.fitg-component')) detail.inGapsComponent = true;
            if (el.isContentEditable) detail.contentEditable = true;
            if (el.disabled) detail.disabled = true;
            if (el.readOnly) detail.readOnly = true;
            return detail;
        });
        const definitions = { total: 0, byType: {}, marked: 0, unmarked: 0, invalidMarked: 0 };
        const defs = q.questionDef?.Components;
        if (Array.isArray(defs)) {
            definitions.total = defs.length;
            const typeNames = { DROPDOWN_COMPONENT: 'dropdown', TEXT_BOX_COMPONENT: 'textBox', NUMBER_BOX_COMPONENT: 'numberBox', SOUND_COMPONENT: 'sound', ANNOTATED_TEXT_COMPONENT: 'annotatedText' };
            for (const def of defs) {
                const name = Object.hasOwn(typeNames, own(def, 'ComponentTypeCode')) ? typeNames[own(def, 'ComponentTypeCode')] : 'unlisted';
                definitions.byType[name] = (definitions.byType[name] || 0) + 1;
                const marked = own(def, 'Marked');
                if (marked === 1) definitions.marked++;
                else if (marked === 0) definitions.unmarked++;
                else definitions.invalidMarked++;
            }
        }
        return {
            extraCount: extraEditables.length,
            extras,
            ...(extraEditables.length > 8 ? { extrasTruncated: true } : {}),
            definitions,
        };
    })());
    if (boxes.some(b => !lesson.contains(b))) return refuse('boxes-outside-lesson', { boxesInLesson: boxes.filter(b => lesson.contains(b)).length });
    const allDefs = q.questionDef?.Components, renderer = q.cachedRenderers?.[1];
    const parser = own(renderer, 'parser');
    const identified = own(renderer, 'identifiedComponents') || own(parser, 'identifiedComponents');
    const base = own(identified, 'baseComponents');
    if (!Array.isArray(allDefs)) return refuse('definitions-not-array');
    if (!allDefs.length) return refuse('definitions-empty');
    if (allDefs.length > 20) return refuse('definitions-limit');
    // Definitions include non-answer companions. Compare controls with their
    // own definition type, but retain complete definition/cache coverage,
    // never ignore another input.
    const companionTypes = { SOUND_COMPONENT: 'sound', ANNOTATED_TEXT_COMPONENT: 'annotated-text' };
    const dropdownDefs = allDefs.filter(d => own(d, 'ComponentTypeCode') === 'DROPDOWN_COMPONENT');
    const numberBoxDefs = allDefs.filter(d => own(d, 'ComponentTypeCode') === 'NUMBER_BOX_COMPONENT');
    const companions = allDefs.filter(d => Object.hasOwn(companionTypes, own(d, 'ComponentTypeCode')));
    if (dropdownDefs.length !== selects.length || numberBoxDefs.length !== boxes.length
        || dropdownDefs.length + numberBoxDefs.length + companions.length !== allDefs.length) {
        return refuse('definitions-component-count', {
            definitionCount: allDefs.length,
            dropdownDefinitionCount: dropdownDefs.length,
            numberBoxDefinitionCount: numberBoxDefs.length,
            companionDefinitionCount: companions.length,
            unsupportedDefinitionCount: allDefs.length - dropdownDefs.length - numberBoxDefs.length - companions.length,
        });
    }
    if (!base) return refuse('missing-renderer-map');
    const answerDefs = [...dropdownDefs, ...numberBoxDefs];
    if (answerDefs.some(d => typeof d?.ComponentID !== 'string' || !d.ComponentID || ![0, 1].includes(d.Marked))) return refuse('definition-type-id-or-marking');
    // Marking must be uniform across the whole slide: an authored-unmarked
    // component is graded like a marked one (EP chunk606), so a slide mixing
    // marking flags has no single answering contract.
    if (new Set(answerDefs.map(d => d.Marked)).size !== 1) return refuse('mixed-definition-marking');
    if (allDefs.some(d => typeof own(d, 'ComponentID') !== 'string' || !own(d, 'ComponentID'))) return refuse('definition-id');
    if (new Set(allDefs.map(d => own(d, 'ComponentID'))).size !== allDefs.length) return refuse('definition-duplicate-id');
    if (Object.keys(base).length !== allDefs.length) return refuse('renderer-definition-count');
    const plain = s => typeof s === 'string' && s.length > 0 && s.length <= 1024 && s === s.trim()
        && !/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>`[\]@]/.test(s);
    // Permit boundary ASCII spaces only; EP maps by trim(), so normalized
    // descriptions must also be unique. Raw text and option identities stay exact.
    const optionText = s => {
        if (typeof s !== 'string' || s.length > 1024 || s.includes(' ') || !plain(s.trim())) return false;
        let first = 0, last = s.length;
        while (first < last && s[first] === ' ') first++;
        while (last > first && s[last - 1] === ' ') last--;
        return s.slice(first, last) === s.trim();
    };
    const optionSafe = o => o && typeof o === 'object' && (o.Description === '' || optionText(o.Description))
        && ['true', 'false'].includes(o.Correct) && o.Validity === 'true' && Number.isFinite(o.SortOrder);
    // EP chunk606, checked 9 November 2026: one BasicVariableInjector per raw
    // Description/Correct string keeps the exact template as literal TextPart
    // .text pieces and TempVariablePart .temporaryVariable.expression pieces.
    // applyVariableContext rewrites metadata.Options in place with the resolved
    // values (originalDropDownOptions shares those objects), so raw options
    // legitimately differ whenever a template carries a variable. Reconstruct
    // the template from the injector parts; any other shape is malformed.
    const injectorTemplate = injector => {
        const parts = own(injector, 'parts');
        if (!Array.isArray(parts) || parts.length > 100) return null;
        let template = '';
        for (const part of parts) {
            if (!part || typeof part !== 'object') return null;
            const hasText = Object.prototype.hasOwnProperty.call(part, 'text'), hasVariable = Object.prototype.hasOwnProperty.call(part, 'temporaryVariable');
            if (hasText === hasVariable) return null;
            // A genuine parse turns every {expression} substring into a
            // variable part, so a text part carrying that pattern is forged.
            if (hasText) { const text = own(part, 'text'); if (typeof text !== 'string' || /{[^}]+}/.test(text)) return null; template += text; continue; }
            const expression = own(own(part, 'temporaryVariable'), 'expression');
            if (typeof expression !== 'string' || expression.length > 1024) return null;
            template += '{' + expression + '}';
        }
        return template;
    };
    // Every raw field except the two templated strings must deep-equal the
    // resolved copy (metadata starts as ObjectHelper.cloneObject(def)).
    // Descriptor reads only: no getter, toJSON or proxy code ever executes,
    // and the depth bound turns cycles into a refusal instead of a crash.
    const dataEqual = (a, b, depth) => {
        if (Object.is(a, b)) return true;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || depth > 10) return false;
        const keysA = Reflect.ownKeys(a), keysB = Reflect.ownKeys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every(key => {
            const pa = Object.getOwnPropertyDescriptor(a, key), pb = Object.getOwnPropertyDescriptor(b, key);
            return pb !== undefined && Object.hasOwn(pa, 'value') && Object.hasOwn(pb, 'value') && dataEqual(pa.value, pb.value, depth + 1);
        });
    };
    const nonTemplateFieldsEqual = (raw, resolved) => {
        const skip = key => key !== 'Description' && key !== 'Correct';
        const rawKeys = Reflect.ownKeys(raw).filter(skip), resolvedKeys = Reflect.ownKeys(resolved).filter(skip);
        if (rawKeys.length !== resolvedKeys.length) return false;
        return rawKeys.every(key => {
            const a = Object.getOwnPropertyDescriptor(raw, key), b = Object.getOwnPropertyDescriptor(resolved, key);
            return b !== undefined && Object.hasOwn(a, 'value') && Object.hasOwn(b, 'value') && dataEqual(a.value, b.value, 0);
        });
    };
    // EP's editor default-none sentinel is rendered as a synthetic blank option.
    // It is not an answer description and must never relax ordinary option text.
    const emptyDefault = o => o && typeof o === 'object' && ['', ' < None > '].includes(o.Description)
        && o.Correct === 'false' && o.Validity === 'true' && Number.isFinite(o.SortOrder);
    const companionRows = [];
    for (const def of companions) {
        const id = own(def, 'ComponentID'), code = own(def, 'ComponentTypeCode'), entries = own(base, id);
        if (!Array.isArray(entries) || entries.length !== 1) return refuse('companion-binding');
        const component = entries[0], state = own(component, 'componentState'), metadata = own(state, 'metadataInstance'), element = own(component, 'visualElement');
        if (own(component, 'id') !== id || own(component, 'type') !== companionTypes[code] || own(component, 'isInput') !== false
            || own(component, 'marked') !== (code === 'ANNOTATED_TEXT_COMPONENT' ? 2 : 1)
            || own(own(component, 'renderingParameters'), 'mode') !== 1 || own(state, 'componentID') !== id
            || !dataEqual(def, metadata, 0) || !(element instanceof Element) || !lesson.contains(element) || !shown(element)
            || selects.some(select => element === select || element.contains(select))
            || boxes.some(box => element === box || element.contains(box))
            || element.matches('input,textarea,select,[contenteditable],iframe,object,embed')
            || element.querySelector('input,textarea,select,[contenteditable],iframe,object,embed')) return refuse('companion-contract');
        companionRows.push({ def, component, state, metadata, element });
    }
    const rows = [];
    for (const select of selects) {
        if (modelOf(select)?.model !== model || select.disabled || select.multiple || select.size > 1 || select.closest('.fitg-component')) return refuse('select-control-or-model');
        const matches = dropdownDefs.filter(d => Array.isArray(base[d.ComponentID]) && base[d.ComponentID].length === 1 && base[d.ComponentID][0].dropDownList === select);
        if (matches.length !== 1) return refuse('component-select-binding');
        const def = matches[0], component = base[def.ComponentID][0], state = component.componentState, metadata = state?.metadataInstance;
        const original = state?.originalDropDownOptions, shuffled = state?._shuffledOptions, dom = [...select.options];
        // The real getter sorts metadata.Options in place; rendering can then
        // unshift one blank into that same array after original was copied.
        const injected = Array.isArray(shuffled) && Array.isArray(original) ? shuffled.filter(o => !original.includes(o)) : [];
        const placeholder = injected.length === 1 && shuffled[0] === injected[0] && injected[0].Description === '' && optionSafe(injected[0]) && injected[0].Correct === 'false';
        const metadataOptions = metadata?.Options;
        const sourceOptions = Array.isArray(metadataOptions) && placeholder && metadataOptions === shuffled ? metadataOptions.filter(o => o !== injected[0]) : metadataOptions;
        if (component.id !== def.ComponentID) return refuse('component-id');
        if (select.id !== def.ComponentID) return refuse('select-id');
        if (component.visualElement !== select) return refuse('visual-element');
        if (component.renderingParameters?.mode !== 1) return refuse('render-mode');
        if (component.marked !== 1) return refuse('component-marked');
        if (metadata?.ComponentTypeCode !== 'DROPDOWN_COMPONENT') return refuse('metadata-type');
        if (metadata.ComponentID !== def.ComponentID) return refuse('metadata-id');
        if (metadata.Marked !== def.Marked || ![0, 1].includes(metadata.Marked)) return refuse('metadata-marked');
        if (!Array.isArray(sourceOptions)) return refuse('source-options-array');
        if (!sourceOptions.length) return refuse('source-options-empty');
        if (sourceOptions.length > 50) return refuse('source-options-limit');
        if (!sourceOptions.every(optionSafe)) return refuse('source-option-text-or-flags');
        if (!Array.isArray(def.Options) || !Array.isArray(original) || def.Options.length !== original.length) return refuse('raw-original-options');
        const descInjectors = own(state, 'descInjectors'), correctInjectors = own(state, 'correctInjectors');
        if (!Array.isArray(descInjectors) || !Array.isArray(correctInjectors) || descInjectors.length !== def.Options.length || correctInjectors.length !== def.Options.length) return refuse('option-injector-shape');
        for (let index = 0; index < def.Options.length; index++) {
            const raw = def.Options[index], resolved = original[index];
            if (!raw || typeof raw !== 'object' || !resolved || typeof resolved !== 'object') return refuse('raw-original-options');
            const description = injectorTemplate(descInjectors[index]), correct = injectorTemplate(correctInjectors[index]);
            if (description === null || correct === null) return refuse('option-injector-shape');
            if (description !== raw.Description || correct !== raw.Correct) return refuse('raw-original-options');
            if (!nonTemplateFieldsEqual(raw, resolved)) return refuse('raw-original-options');
        }
        if (JSON.stringify(def.DefaultSelection) !== JSON.stringify(metadata.DefaultSelection)) return refuse('raw-default');
        if (!emptyDefault(metadata.DefaultSelection)) return refuse('default-none-contract');
        if (!Array.isArray(original)) return refuse('original-options-array');
        if (original.length !== sourceOptions.length) return refuse('original-source-count');
        if (new Set(original).size !== original.length) return refuse('original-duplicate');
        if (original.some(o => !sourceOptions.includes(o))) return refuse('original-source-identity');
        if (!Array.isArray(shuffled)) return refuse('shuffled-array');
        if (shuffled.length !== dom.length) return refuse('shuffled-dom-count');
        if (!shuffled.length) return refuse('shuffled-empty');
        if (shuffled.length > 51) return refuse('shuffled-limit');
        if (!shuffled.every(optionSafe)) return refuse('shuffled-option-text-or-flags');
        if (new Set(shuffled).size !== shuffled.length) return refuse('shuffled-duplicate');
        if (new Set(shuffled.map(o => o.Description.trim())).size !== shuffled.length) return refuse('shuffled-description-duplicate');
        if (original.some(o => !shuffled.includes(o))) return refuse('original-shuffled-identity');
        if ((injected.length !== 0 && !placeholder)) return refuse('synthetic-placeholder');
        if (dom.some((o, i) => o.parentElement !== select || o.textContent !== shuffled[i].Description || o.text !== shuffled[i].Description.trim() || o.disabled || o.hidden || o.children.length)) return refuse('dom-option-contract');
        if (dom.filter(o => o.selected).length !== 1) return refuse('dom-selected-count');
        if (select.selectedIndex < 0) return refuse('dom-selected-index');
        const correct = shuffled.filter(o => o.Correct === 'true');
        if (correct.length !== 1 || !optionText(correct[0].Description)) return refuse('correct-option');
        const selected = shuffled[select.selectedIndex], cached = state._selectedOption;
        // A blank placeholder is allowed only when no answer is cached, or when
        // it is the actual cached blank default/option. Never overwrite a prefill.
        if (selected.Description === '') {
            if (selected.Correct !== 'false') return refuse('selected-blank-correct');
            if (cached != null && !(cached === selected || cached === metadata.DefaultSelection && emptyDefault(cached))) return refuse('cached-blank-identity');
        } else if (cached !== selected) return refuse('cached-selection-identity');
        rows.push({ select, def, component, state, metadata, original, shuffled, optionRefs: shuffled.slice(), originalRefs: original.slice(), dom, answer: correct[0], answerIndex: shuffled.indexOf(correct[0]), selectedIndex: select.selectedIndex, filled: selected.Description !== '' });
    }
    // Number-box surface: the numeric branch of the input-box contract,
    // unchanged. Only the accepted numeric string is filled; DP metadata may
    // round a stored option to EP's submitted format, while an SF option must
    // already be in EP's accepted format or the slide refuses.
    const numeric = s => plain(s) && s.length <= 64 && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) && Number.isFinite(Number(s));
    const roundNumber = (value, amount, type) => {
        if (type === 'NONE') return value;
        const sign = value < 0 ? -1 : 1, magnitude = Math.abs(value);
        if (type === 'DP') { const factor = 10 ** amount; return sign * Math.round(magnitude * factor) / factor; }
        if (magnitude === 0) return 0;
        const scale = 10 ** (amount - Math.floor(Math.LOG10E * Math.log(magnitude)) - 1);
        return sign * Math.round(magnitude * scale) / scale;
    };
    const roundingFormatMatches = (answer, amount, type) => {
        if (type === 'NONE') return true;
        const clean = answer.replace(/[-, ]/g, ''), point = clean.indexOf('.');
        if (type === 'DP') return amount === 0 ? point < 0 : point >= 0 && clean.length - (point + 1) === amount;
        if (amount <= 0) return clean.length === 0;
        let count;
        if (point >= 0) {
            const value = Number(clean);
            count = value < 1 ? clean.slice(point + 1).length + Math.floor(Math.LOG10E * Math.log(value)) + 1 : point + clean.length - point - 1;
            return count === amount;
        }
        if (clean.length < amount) return false;
        const reversed = '.' + [...clean].reverse().join('');
        count = reversed.length - 1 + Math.floor(Math.LOG10E * Math.log(parseFloat(reversed))) + 1;
        return count <= amount;
    };
    // EP chunk606, checked 9 November 2026: NumberBoxComponentState and
    // TextBoxComponentState copy answerOptions from metadata.Options and build
    // one BasicVariableInjector per raw option string; applyVariableContext
    // then resolves each {expression} template in place on answerOptions,
    // while metadata.Options keeps the raw templates (cloneObject of the
    // definition). Raw agreement is reconstructed from each injector's parts:
    // literal TextPart .text pieces and TempVariablePart
    // .temporaryVariable.expression pieces. A genuine parse turns every
    // {expression} substring into a variable part, so a text part carrying
    // that pattern is forged, and each part must carry exactly one shape.
    // Descriptor reads only: no getter, toJSON or proxy code ever executes.
    const analyzeOptionInjector = injector => {
        const read = (object, key) => { const property = object && Object.getOwnPropertyDescriptor(object, key); return property && Object.hasOwn(property, 'value') ? property.value : undefined; };
        const parts = read(injector, 'parts');
        if (!Array.isArray(parts) || parts.length > 100) return null;
        let template = '', variable = false;
        for (const part of parts) {
            if (!part || typeof part !== 'object') return null;
            const textHolder = Object.hasOwn(part, 'text'), variableHolder = Object.hasOwn(part, 'temporaryVariable');
            if (textHolder === variableHolder) return null;
            if (textHolder) { const text = read(part, 'text'); if (typeof text !== 'string' || /{[^}]+}/.test(text)) return null; template += text; continue; }
            const expression = read(read(part, 'temporaryVariable'), 'expression');
            // EP's parse requires one or more non-} characters, so an empty
            // expression cannot come from the renderer.
            if (typeof expression !== 'string' || !expression.length || expression.length > 1024) return null;
            variable = true; template += '{' + expression + '}';
        }
        return { template, variable };
    };
    // Raw templates allow any printable expression text (brackets, angle
    // brackets, quotes): only resolved answers need the full markup ban.
    const rawTemplate = s => typeof s === 'string' && s.length > 0 && s.length <= 1024
        && !/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(s);
    // Descriptor-only string-array equality: no element getter, toJSON or
    // extra own key (genuine option arrays carry indices and length only).
    const stringArraysEqual = (a, b) => {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        const isArrayIndex = key => typeof key === 'string' && String(Number(key)) === key && Number.isSafeInteger(Number(key)) && Number(key) >= 0 && Number(key) < 2 ** 32 - 1;
        const indexKeysOnly = array => Reflect.ownKeys(array).every(key => key === 'length' || isArrayIndex(key));
        if (!indexKeysOnly(a) || !indexKeysOnly(b)) return false;
        for (let index = 0; index < a.length; index++) {
            const pa = Object.getOwnPropertyDescriptor(a, String(index)), pb = Object.getOwnPropertyDescriptor(b, String(index));
            if (!pa || !pb || !Object.hasOwn(pa, 'value') || !Object.hasOwn(pb, 'value')) return false;
            if (typeof pa.value !== 'string' || pa.value !== pb.value) return false;
        }
        return true;
    };
    const numberAnswerAccepted = (answer, options, metadata) => {
        const value = Number(answer), amount = metadata.RoundingAmount, rounding = metadata.RoundingTypeCode;
        if (!roundingFormatMatches(answer, amount, rounding)) return false;
        return options.some(option => {
            const optionValue = Number(option), rounded = roundNumber(optionValue, amount, rounding);
            if (metadata.AcceptableErrorValue === 0) return value === rounded;
            const range = metadata.AcceptableErrorTypeCode === 'ABS'
                ? [optionValue - metadata.AcceptableErrorValue, optionValue + metadata.AcceptableErrorValue]
                : [optionValue * (1 - metadata.AcceptableErrorValue / 100), optionValue * (1 + metadata.AcceptableErrorValue / 100)];
            const low = roundNumber(range[0], amount, rounding), high = roundNumber(range[1], amount, rounding);
            const checked = rounding === 'NONE' ? value : roundNumber(value, amount, rounding);
            return low <= checked && checked <= high;
        });
    };
    const selectNumberAnswer = (options, metadata) => {
        const exact = options.find(option => numberAnswerAccepted(option, options, metadata));
        if (exact) return exact;
        if (metadata.RoundingTypeCode !== 'DP') return null;
        const formatted = options.map(option => Number(option).toFixed(metadata.RoundingAmount)).find(answer => numeric(answer) && numberAnswerAccepted(answer, options, metadata));
        return formatted || null;
    };
    const validRoundingType = value => value === 'NONE' || value === 'DP' || value === 'SF';
    const validErrorType = value => value === 'ABS' || value === '%';
    const safeInteger = value => Number.isSafeInteger(value) ? value : null;
    const boxRows = [];
    for (const box of boxes) {
        const boxIndex = boxes.indexOf(box), sameModel = modelOf(box)?.model === model;
        if (!sameModel || box.disabled || box.readOnly || !['text', ''].includes(box.type)
            || box.closest('.fitg-component') || box.getAttribute('maxlength') !== null || box.getAttribute('pattern') !== null) {
            return refuse('box-shape', {
                boxIndex,
                sameModel,
                disabled: box.disabled,
                readOnly: box.readOnly,
                inputType: box.type === 'text' || box.type === '' ? box.type : 'UNLISTED_INPUT_TYPE',
                inGapsComponent: !!box.closest('.fitg-component'),
                hasMaxlength: box.getAttribute('maxlength') !== null,
                hasPattern: box.getAttribute('pattern') !== null,
            });
        }
        const matches = numberBoxDefs.filter(d => Array.isArray(base[d.ComponentID]) && base[d.ComponentID].length === 1 && base[d.ComponentID][0]?.textBox === box);
        if (matches.length !== 1) return refuse('component-association', { boxIndex, matchCount: matches.length });
        const def = matches[0], component = base[def.ComponentID][0], state = component.componentState, metadata = state?.metadataInstance;
        // Reconstructed raw templates must equal metadata.Options exactly.
        // When a template carries no variable its resolution is the identity,
        // so the resolved answerOptions entry must equal the template; a
        // variable-bearing resolution is trusted as the renderer's record.
        // The whole analysis fails closed: a throwing Proxy trap or accessor
        // refuses the slide instead of breaking detection.
        const optionTemplates = Array.isArray(metadata?.Options) ? metadata.Options : [];
        let optionTemplatesMatch = false, literalOptionsMatch = false, optionAnalysisThrew = false;
        try {
            const injectorProperty = state && Object.getOwnPropertyDescriptor(state, 'optionsInjector');
            const optionInjectors = injectorProperty && Object.hasOwn(injectorProperty, 'value') ? injectorProperty.value : undefined;
            const analyzedInjectors = Array.isArray(optionInjectors) ? optionInjectors.map(analyzeOptionInjector) : [];
            optionTemplatesMatch = Array.isArray(optionInjectors) && analyzedInjectors.length === optionTemplates.length
                && optionTemplates.every((template, index) => analyzedInjectors[index] != null && analyzedInjectors[index].template === template);
            literalOptionsMatch = Array.isArray(state?.answerOptions) && state.answerOptions.length === analyzedInjectors.length
                && analyzedInjectors.every((analyzed, index) => analyzed == null || analyzed.variable || state.answerOptions[index] === analyzed.template);
        } catch { optionAnalysisThrew = true; }
        const definitionOptionsMatch = stringArraysEqual(def.Options, metadata?.Options);
        const boxParent = box.parentElement;
        // EP chunk606: NumberBoxComponent.createQuestionVisualElement wraps the
        // input in a script-position span, so visualElement is the input's
        // parent span, never the input itself.
        const visualElementMatches = component.visualElement === boxParent && component.visualElement?.tagName === 'SPAN'
            && boxParent?.childNodes.length === 1 && boxParent?.firstChild === box;
        if (component.id !== def.ComponentID || !visualElementMatches || component.renderingParameters?.mode !== 1 || component.marked !== 1
            || metadata?.ComponentTypeCode !== 'NUMBER_BOX_COMPONENT' || metadata.ComponentID !== def.ComponentID
            || (metadata.Marked !== 0 && metadata.Marked !== 1) || metadata.Marked !== def.Marked
            || typeof state?.userAnswer !== 'string' || typeof state?.isUserAnswerSet !== 'boolean'
            || typeof state?.injectedInitialText !== 'string' || state.injectedInitialText !== '' || metadata?.InitialText !== ''
            || !Array.isArray(state?.answerOptions) || !state.answerOptions.length || state.answerOptions.length > 50 || !state.answerOptions.every(plain)
            || !Array.isArray(metadata?.Options) || !metadata.Options.length || !metadata.Options.every(rawTemplate)
            || !definitionOptionsMatch || def.InitialText !== ''
            || optionAnalysisThrew || !optionTemplatesMatch || !literalOptionsMatch
            || !Array.isArray(state?.variableOptions)) {
            return refuse('state-shape', {
                boxIndex,
                componentIdMatches: component.id === def.ComponentID,
                visualElementMatches,
                visualElementIsBox: component.visualElement === box,
                visualElementIsBoxParent: component.visualElement === boxParent,
                boxParentChildNodeCount: boxParent ? boxParent.childNodes.length : null,
                renderingMode: safeInteger(component.renderingParameters?.mode),
                renderingModeValid: component.renderingParameters?.mode === 1,
                componentMarked: component.marked === 0 || component.marked === 1 ? component.marked : null,
                componentMarkedValid: component.marked === 1,
                metadataTypeMatches: metadata?.ComponentTypeCode === 'NUMBER_BOX_COMPONENT',
                metadataIdMatches: metadata?.ComponentID === def.ComponentID,
                metadataMarked: metadata?.Marked === 0 || metadata?.Marked === 1 ? metadata.Marked : null,
                metadataMarkedValid: metadata?.Marked === 0 || metadata?.Marked === 1,
                definitionMarkedMatches: metadata?.Marked === def.Marked,
                userAnswerIsString: typeof state?.userAnswer === 'string',
                isUserAnswerSetBoolean: typeof state?.isUserAnswerSet === 'boolean',
                injectedInitialTextEmpty: state?.injectedInitialText === '',
                metadataInitialTextEmpty: metadata?.InitialText === '',
                answerOptionCount: Array.isArray(state?.answerOptions) ? state.answerOptions.length : null,
                answerOptionsValid: Array.isArray(state?.answerOptions) && state.answerOptions.every(plain),
                metadataOptionCount: Array.isArray(metadata?.Options) ? metadata.Options.length : null,
                optionInjectorCount: (() => { try { const p = state && Object.getOwnPropertyDescriptor(state, 'optionsInjector'); return p && Object.hasOwn(p, 'value') && Array.isArray(p.value) ? p.value.length : null; } catch { return null; } })(),
                optionTemplatesMatch,
                literalOptionsMatch,
                optionAnalysisThrew,
                definitionOptionsMatch,
                variableOptionsIsArray: Array.isArray(state?.variableOptions),
            });
        }
        // EP chunk606's SF checker counts a leading plus as a digit, and
        // its percent helper reverses negative bounds. Do not normalize
        // those cases into a guessed answer; refuse the slide closed.
        const unsafeSfSign = metadata.RoundingTypeCode === 'SF' && state.answerOptions.some(option => option.startsWith('+'));
        const unsafeNegativePercent = metadata.AcceptableErrorTypeCode === '%' && metadata.AcceptableErrorValue > 0
            && state.answerOptions.some(option => Number(option) < 0);
        if (!state.answerOptions.every(numeric)
            || !validRoundingType(metadata.RoundingTypeCode) || !validErrorType(metadata.AcceptableErrorTypeCode)
            || unsafeSfSign || unsafeNegativePercent
            || !Number.isSafeInteger(metadata.RoundingAmount) || metadata.RoundingAmount < 0 || metadata.RoundingAmount > 15
            || typeof metadata.AcceptableErrorValue !== 'number' || !Number.isFinite(metadata.AcceptableErrorValue) || metadata.AcceptableErrorValue < 0
            || def.RoundingTypeCode !== metadata.RoundingTypeCode || def.RoundingAmount !== metadata.RoundingAmount
            || def.AcceptableErrorTypeCode !== metadata.AcceptableErrorTypeCode || def.AcceptableErrorValue !== metadata.AcceptableErrorValue) {
            return refuse('numeric-metadata', {
                boxIndex,
                answerOptionsNumeric: state.answerOptions.every(numeric),
                roundingType: validRoundingType(metadata.RoundingTypeCode) ? metadata.RoundingTypeCode : null,
                roundingTypeValid: validRoundingType(metadata.RoundingTypeCode),
                roundingAmountValid: Number.isSafeInteger(metadata.RoundingAmount) && metadata.RoundingAmount >= 0 && metadata.RoundingAmount <= 15,
                acceptableErrorType: validErrorType(metadata.AcceptableErrorTypeCode) ? metadata.AcceptableErrorTypeCode : null,
                acceptableErrorTypeValid: validErrorType(metadata.AcceptableErrorTypeCode),
                acceptableErrorValueValid: typeof metadata.AcceptableErrorValue === 'number' && Number.isFinite(metadata.AcceptableErrorValue) && metadata.AcceptableErrorValue >= 0,
                unsafeSfSign,
                unsafeNegativePercent,
                definitionRoundingMatches: def.RoundingTypeCode === metadata.RoundingTypeCode && def.RoundingAmount === metadata.RoundingAmount,
                definitionErrorMatches: def.AcceptableErrorTypeCode === metadata.AcceptableErrorTypeCode && def.AcceptableErrorValue === metadata.AcceptableErrorValue,
            });
        }
        if (box.value !== state.userAnswer || (!state.isUserAnswerSet && state.userAnswer !== '')) {
            return refuse('stored-value', { boxIndex, valueMatchesState: box.value === state.userAnswer, isUserAnswerSet: state.isUserAnswerSet, hasStoredAnswer: state.userAnswer !== '' });
        }
        const answer = selectNumberAnswer(state.answerOptions, metadata);
        if (typeof answer !== 'string') return refuse('answer-acceptance', { boxIndex, roundingType: validRoundingType(metadata.RoundingTypeCode) ? metadata.RoundingTypeCode : null, acceptableErrorType: validErrorType(metadata.AcceptableErrorTypeCode) ? metadata.AcceptableErrorTypeCode : null, optionCount: state.answerOptions.length });
        boxRows.push({ box, def, component, state, metadata, answer, value: box.value });
    }
    if (new Set([...rows.map(r => r.def), ...boxRows.map(r => r.def)]).size !== answerDefs.length) return refuse('component-coverage', { rowCount: rows.length + boxRows.length });
    const key = 'dropdown-numberbox:' + q.contentID + ':' + q.questionIndex;
    const signature = JSON.stringify([q.questionDef, rows.map(r => [r.metadata, r.shuffled, r.original]), boxRows.map(r => [r.metadata, r.state.answerOptions, r.state.variableOptions, r.state.injectedInitialText]), companionRows.map(r => r.metadata)]);
    const descriptor = {
        kind: 'dropdown-numberbox', key, autoMarked: true, signature,
        dropdowns: rows.map(r => ({ id: r.def.ComponentID, answer: r.answer.Description, index: r.answerIndex, selectedIndex: r.selectedIndex, filled: r.filled })),
        boxes: boxRows.map(r => ({ id: r.def.ComponentID, answer: r.answer, value: r.value })),
    };
    if (baseline && (baseline.q !== q || baseline.model !== model || baseline.renderer !== renderer || baseline.base !== base || baseline.parser !== parser || baseline.identified !== identified
        || baseline.companionRows.length !== companionRows.length || companionRows.some((r, i) => ['def', 'component', 'state', 'metadata', 'element'].some(k => r[k] !== baseline.companionRows[i][k]))
        || baseline.descriptor.key !== key || baseline.descriptor.signature !== signature || baseline.rows.length !== rows.length || baseline.boxRows.length !== boxRows.length
        || rows.some((r, i) => { const b = baseline.rows[i]; return ['select', 'def', 'component', 'state', 'metadata', 'original', 'shuffled', 'answer'].some(k => r[k] !== b[k]) || r.dom.some((o, j) => o !== b.dom[j]) || r.optionRefs.some((o, j) => o !== b.optionRefs[j]) || r.originalRefs.some((o, j) => o !== b.originalRefs[j]); })
        || boxRows.some((r, i) => ['box', 'def', 'component', 'state', 'metadata'].some(k => r[k] !== baseline.boxRows[i][k])))) {
        return refuse('baseline-changed', {
            sameQuestion: baseline.q === q,
            sameModel: baseline.model === model,
            sameRenderer: baseline.renderer === renderer,
            sameBase: baseline.base === base,
            sameSignature: baseline.descriptor.signature === signature,
            sameKey: baseline.descriptor.key === key,
            sameRowCount: baseline.rows.length === rows.length && baseline.boxRows.length === boxRows.length,
        });
    }
    const result = { descriptor, q, model, renderer, parser, identified, base, rows, boxRows, companionRows };
    if (action && typeof action === 'object') {
        if (Number.isSafeInteger(action.dropdown)) {
            if (!rows[action.dropdown]) return refuse('target-index');
            result.target = rows[action.dropdown].select;
        } else if (Number.isSafeInteger(action.box)) {
            if (!boxRows[action.box]) return refuse('target-index');
            result.target = boxRows[action.box].box;
        } else return refuse('target-index');
    } else if (action === 'verify' || action === 'submit') {
        if (rows.some(r => !r.filled || r.shuffled[r.selectedIndex] !== r.answer) || boxRows.some(r => r.value !== r.answer)) return refuse('answers-not-verified');
        if (action === 'submit') {
            const bars = [...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(b => modelOf(b)?.model === model);
            if (bars.length !== 1) return refuse('submit-bar');
            const buttons = [...bars[0].querySelectorAll('button')].filter(b => shown(b) && b.textContent.trim() === 'Submit');
            const enabled = buttons.filter(b => !b.disabled);
            const submitState = { visible: buttons.length, enabled: enabled.length };
            if (buttons.length > 1) return { ...refuse('submit-button-ambiguous'), submitState };
            // EP SkillsControls locks Submit for one second after loading a question
            // (chunk171: lockedForNewQuestion). Exact answers may settle first.
            if (!enabled.length) return { ...result, readiness: 'not-ready', submitState };
            result.target = enabled[0];
        }
    }
    return action === 'descriptor' ? { descriptor } : result;
}
module.exports = { readDropdownNumberBoxInPage };
