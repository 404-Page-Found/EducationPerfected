// Invented fixture, not captured student DOM. Structure follows public
// chunk606 LongAnswerComponent/LongAnswerInput: cached renderer, state metadata,
// visual root, Vue editor wrapper, Tiptap editor view.dom. Activity flags and
// one LONG_ANSWER_COMPONENT follow Page's read-only 11 Nov capture. No claim
// about EP acceptance or grading: the handler never submits this fixture.
function installReflectionFixture(variant) {
    const old = document.querySelector('.multi-choice-component');
    const self = window.angular.element(old).scope().self, q = self.model._currentQuestion;
    self.model.gameMode = 3;
    self.sectionData = { activityGroup: { isAutoMarked: false, isSelfMarked: true } };
    const def = { ComponentTypeCode: 'LONG_ANSWER_COMPONENT', ComponentID: 'reflection-0', Marked: variant === 'unmarked' ? 0 : 1 };
    q.questionDef.Components = [def];
    const group = document.createElement('div');
    group.className = 'long-answer-input';
    old.replaceWith(group);
    document.querySelector('#question-container-group').querySelectorAll('h3,p').forEach(el => el.remove());
    const f = window.reflectionFixture = { self, q, group, keys: [], inputs: [], submits: 0, nexts: 0 };
    group.append(document.createTextNode('Synthetic reflection slide.'));
    for (let i = 0; i < 3; i++) {
        const tool = document.createElement('button'); tool.type = 'button'; tool.textContent = 'T' + i; group.append(tool);
    }
    const wrapper = document.createElement('div');
    wrapper.id = 'rich-text-editor-synthetic'; group.append(wrapper);
    const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.style.minHeight = '20px'; wrapper.append(editor);
    f.editor = editor;
    const input = { element: group, editor: { editor: { view: { dom: editor } } } };
    const state = { metadata: { ...def }, questionElement: input };
    const component = { id: def.ComponentID, marked: 1, renderingParameters: { mode: 1 }, componentState: state, visualElement: group };
    q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: { [def.ComponentID]: [component] } } } };
    f.component = component; f.state = state;
    editor.addEventListener('keydown', e => { f.keys.push({ key: e.key, trusted: e.isTrusted }); });
    editor.addEventListener('input', e => { f.inputs.push({ trusted: e.isTrusted }); f.afterInput?.(); });
    document.addEventListener('click', e => {
        const button = e.target.closest('#sa-navigation-controls button');
        if (button?.textContent.trim() === 'Submit') f.submits++;
        else if (button) f.nexts++;
    }, true);
}
module.exports = { installReflectionFixture };
