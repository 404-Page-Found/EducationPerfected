// Read-only contract derived from EP public chunk606 (checked 17 Nov 2026):
// LongAnswerComponent -> componentState.questionElement (LongAnswerInput) ->
// editor.editor.view.dom. No getQuestionElement/dataSerialised/answer getter:
// those can construct controls or update saved state. ModelAnswerHTML is
// feedback, never an accepted student answer. The user writes the response.
// https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
function readReflectionInPage(baseline, action) {
    try {
    const own = (o, k) => o && typeof o === 'object' ? Object.getOwnPropertyDescriptor(o, k)?.value : undefined;
    const shown = el => !!el && !el.hidden && el.getClientRects().length > 0
        && !['hidden', 'collapse'].includes(getComputedStyle(el).visibility);
    const roots = [...document.querySelectorAll('#ep-question-container')].filter(shown);
    const lesson = roots.length === 1 ? roots[0] : null;
    if (!lesson) return null;
    const editors = [...lesson.querySelectorAll('[contenteditable]')].filter(el => shown(el) && el.isContentEditable);
    if (!editors.length) return null;
    const refuse = guard => ({ descriptor: { kind: 'unsupported', reason: 'Reflection: unsupported or changed state; no input.', diagnostic: { kind: 'reflection-refusal', guard } } });
    const modelOf = el => {
        for (let n = el, depth = 0; n && depth < 15; n = n.parentElement, depth++) {
            const a = window.angular?.element(n);
            for (const scope of a ? [a.isolateScope?.(), a.scope?.()] : []) {
                const self = own(scope, 'self');
                if (own(self, 'model')) return self;
            }
        }
        return null;
    };
    const self = modelOf(editors[0]), model = own(self, 'model');
    const mode = own(model, 'gameMode');
    if (mode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment answering is disabled.' } };
    const candidate = own(own(own(model, '_currentQuestion'), 'questionDef'), 'Components');
    if (!Array.isArray(candidate) || !candidate.some(d => own(d, 'ComponentTypeCode') === 'LONG_ANSWER_COMPONENT')) return null;
    if (mode !== 3) return refuse('model-or-mode');
    const q = own(model, '_currentQuestion'), activity = own(own(self, 'sectionData'), 'activityGroup');
    if (!q || !Number.isSafeInteger(own(q, 'contentID')) || own(q, 'contentID') <= 0
        || !Number.isSafeInteger(own(q, 'questionIndex')) || own(q, 'questionIndex') < 0) return refuse('identity');
    if (own(activity, 'isAutoMarked') !== false || own(activity, 'isSelfMarked') !== true) return refuse('marking');
    const defs = own(own(q, 'questionDef'), 'Components');
    if (!Array.isArray(defs) || defs.length !== 1) return refuse('component-count');
    const def = own(defs, '0'), id = own(def, 'ComponentID');
    if (own(def, 'ComponentTypeCode') !== 'LONG_ANSWER_COMPONENT' || typeof id !== 'string' || !id) return refuse('component-type');
    if (![0, 1].includes(own(def, 'Marked'))) return refuse('component-marked');
    const renderer = own(own(q, 'cachedRenderers'), '1'), base = own(own(renderer, 'identifiedComponents'), 'baseComponents');
    const entries = own(base, id);
    if (!base || Object.keys(base).length !== 1 || !Array.isArray(entries) || entries.length !== 1) return refuse('renderer');
    const component = own(entries, '0'), state = own(component, 'componentState'), metadata = own(state, 'metadata');
    const input = own(state, 'questionElement'), rich = own(input, 'editor'), tiptap = own(rich, 'editor');
    // Tiptap's view can be a getter, but its stored view is editor.view in the
    // current public implementation. Reading it never calls a marking method.
    const view = tiptap?.view, editor = view?.dom, visual = own(component, 'visualElement');
    if (own(component, 'id') !== id || own(own(component, 'renderingParameters'), 'mode') !== 1
        || own(component, 'marked') !== 1 || !metadata || own(metadata, 'ComponentID') !== id
        || own(metadata, 'ComponentTypeCode') !== 'LONG_ANSWER_COMPONENT' || own(metadata, 'Marked') !== own(def, 'Marked')
        || visual !== own(input, 'element') || !lesson.contains(visual) || !visual?.contains(editor)
        || editors.length !== 1 || editors[0] !== editor || !shown(editor)) return refuse('editor-association');
    const editables = [...lesson.querySelectorAll('input,textarea,select,[contenteditable]')]
        .filter(el => shown(el) && (el.matches('input,textarea,select') || el.isContentEditable));
    if (editables.length !== 1 || editables[0] !== editor) return refuse('mixed-controls');
    if ([...document.querySelectorAll('div[uib-modal-window],div[uib-modal-backdrop]')].some(shown)) return refuse('modal');
    // Narrow initial-content boundary: never overwrite initial or saved work.
    if (![undefined, ''].includes(own(state, 'answerHTML')) || ![undefined, ''].includes(own(metadata, 'InitialHTML'))
        || ![undefined, ''].includes(own(def, 'InitialHTML'))) return refuse('stored-answer');
    const value = editor.textContent?.replace(/\u00a0/g, ' ');
    if (typeof value !== 'string' || editor.querySelector('img,canvas,iframe,math,formula')) return refuse('editor-content');
    const key = 'reflection:' + own(q, 'contentID') + ':' + own(q, 'questionIndex');
    const fields = ['ComponentID', 'ComponentTypeCode', 'Marked', 'InitialHTML', 'Format', 'MinAnswerTime', 'ApplyGibberishFilter'];
    const signature = JSON.stringify([def, metadata].map(o => fields.map(k => {
        const v = own(o, k);
        return ['string', 'boolean', 'number', 'undefined'].includes(typeof v) ? [k, v] : [k, 'unsupported'];
    })));
    const descriptor = { kind: 'reflection', key, empty: value === '' };
    const refs = { q, model, activity, def, renderer, base, component, state, metadata, input, rich, tiptap, view, editor, visual };
    if (baseline && (baseline.descriptor.key !== key || baseline.signature !== signature
        || Object.keys(refs).some(k => baseline[k] !== refs[k]))) return refuse('baseline-changed');
    if (action?.verify === true) {
        if (value !== action.expected || !editor.isContentEditable) return false;
        if (!action.focus) return true;
        const selection = window.getSelection();
        if (document.activeElement !== editor || !selection?.isCollapsed || selection.rangeCount !== 1) return false;
        if (!editor.contains(selection.anchorNode) && selection.anchorNode !== editor) return false;
        const tail = document.createRange();
        tail.selectNodeContents(editor);
        tail.setStart(selection.anchorNode, selection.anchorOffset);
        return tail.toString().length === 0;
    }
    const result = { descriptor, ...refs, signature, value };
    return action === 'descriptor' ? { descriptor } : result;
    } catch { return { descriptor: { kind: 'unsupported', reason: 'Reflection: unreadable state; no input.' } }; }
}
module.exports = { readReflectionInPage };
