// Read-only probe for the content-free shape of a refused slide, used by the
// support report when a refusal site carries no shape of its own. It reads
// only integers and fixed component codes (game mode, question type,
// component codes) and visible control counts. It never clicks, types or
// reads question text, answers, option text or identifiers, and it never throws.
const { collectInspection } = require('./inspection');

function readUnsupportedShapeInPage() {
    const known = new Set([
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
    const visible = el => !!(el && !el.hidden && !['hidden', 'collapse'].includes(getComputedStyle(el).visibility)
        && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0)));
    const root = document.querySelector('#ep-question-container') || document.querySelector('#question-container-group') || document.body;
    const currentQuestionFrom = start => {
        if (!start || !window.angular || typeof angular.element !== 'function') return null;
        for (let node = start, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
            try {
                const scope = angular.element(node).scope?.();
                const self = scope?.self;
                if (self?.model?._currentQuestion) return { self, question: self.model._currentQuestion };
            } catch (e) { /* not a scoped node; keep walking */ }
        }
        return null;
    };
    // Own data properties only, so a page getter can never run during this read-only probe.
    const own = (obj, key) => {
        if (!obj || typeof obj !== 'object') return undefined;
        const d = Object.getOwnPropertyDescriptor(obj, key);
        return d && Object.hasOwn(d, 'value') ? d.value : undefined;
    };
    const found = currentQuestionFrom(document.querySelector('div.multi-choice-component, #question-text, .voice-speaker')) || currentQuestionFrom(root) || currentQuestionFrom(document.querySelector('#question-container-group'))
        || currentQuestionFrom(document.querySelector('#slide-host'));
    const model = own(found?.self, 'model');
    const q = found?.question;
    const components = own(own(q, 'questionDef'), 'Components');
    const count = selector => [...root.querySelectorAll(selector)].filter(visible).length;
    return {
        gameMode: Number.isSafeInteger(own(model, 'gameMode')) ? own(model, 'gameMode') : null,
        questionType: Number.isSafeInteger(own(q, 'questionType')) ? own(q, 'questionType') : null,
        componentCount: Array.isArray(components) ? components.length : null,
        componentTypes: Array.isArray(components) ? components.slice(0, 20).map(c => {
            const type = own(c, 'ComponentTypeCode');
            return typeof type === 'string' && known.has(type) ? type : 'UNLISTED_COMPONENT';
        }) : [],
        controls: {
            inputs: count('input'),
            textareas: count('textarea'),
            selects: count('select'),
            contentEditable: [...root.querySelectorAll('[contenteditable]')].filter(el => visible(el) && el.isContentEditable).length,
            canvases: count('canvas'),
            buttons: count('button'),
        },
    };
}

async function readUnsupportedShape(page, { timeoutMs = 1500 } = {}) {
    try {
        const result = await collectInspection(page, { build: 'unsupported-shape-v1', program: `(${readUnsupportedShapeInPage.toString()})()`, timeoutMs });
        return result && typeof result === 'object' && !result.guard ? result : null;
    } catch { return null; }
}

module.exports = { readUnsupportedShapeInPage, readUnsupportedShape };
