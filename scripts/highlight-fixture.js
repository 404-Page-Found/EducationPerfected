// Invented sanitized fixture derived from public chunk606, not live account DOM.
// Mirrors: HighlightComponent/HighlightInput (div.highlight-input#highlight-input-{guid},
// span.highlight-token ids token-{guid}-{index}, click toggles userSelectedOptions
// and the 'highlighted' class, SingleAnswerMode clears the rest), and
// ComponentStateFactory storing the questionDef component as the highlight
// state's metadata unchanged.
function installHighlightFixture(config = {}) {
    document.querySelector('#question-container-group').textContent = 'Synthetic highlight question: select the correct tokens.';
    const old = document.querySelector('.multi-choice-component');
    const self = window.angular.element(old).scope().self, q = self.model._currentQuestion;
    self.model.gameMode = 3;
    const uniqueID = 'synthetic-highlight-guid';
    const element = document.createElement('div');
    element.className = 'highlight-input';
    element.id = 'highlight-input-' + uniqueID;
    // keepExisting: another surface fixture already owns the page - merge this
    // surface into the shared question instead of replacing it, and leave the
    // Submit button to the surface that owns it.
    if (config.keepExisting) { old.after(element); } else { old.replaceWith(element); }
    const prompt = document.createElement('p');
    prompt.style.fontWeight = '700';
    prompt.textContent = 'Highlight the words that are verbs.';
    const container = document.createElement('div');
    container.className = 'template-container';
    const paragraph = document.createElement('p');
    container.append(paragraph);
    element.append(prompt, container);
    const words = config.words || ['The', 'cat', 'sat', 'on', 'mats'];
    const correct = config.correct || [1, 2];
    const comp = { ComponentTypeCode: 'HIGHLIGHT_COMPONENT', ComponentID: 'synthetic-highlight',
        PromptText: 'Highlight the words that are verbs.', Template: '<p>' + words.map(w => '<span class="highlight-token">' + w + '</span>').join(' ') + '</p>',
        CorrectOptions: correct.slice(), SingleAnswerMode: config.single === true, Marked: 1 };
    const state = { metadata: comp, questionElement: null };
    const questionElement = { element, uniqueID, userSelectedOptions: [], componentState: state };
    state.questionElement = questionElement;
    const component = { type: 'highlight', id: comp.ComponentID, visualElement: element,
        componentState: state, marked: 1, renderingParameters: { mode: 1 } };
    const f = window.highlightFixture = { self, q, comp, state, questionElement, component, element,
        tokens: [], clicks: [], submits: 0 };
    if (config.keepExisting) { q.questionDef.Components.push(comp); } else { q.questionDef.Components = [comp]; }
    words.forEach((word, index) => {
        const token = document.createElement('span');
        token.className = 'highlight-token';
        token.id = `token-${uniqueID}-${index}`;
        token.textContent = word;
        token.style.cssText = 'display:inline-block;padding:2px;margin:2px;border:1px solid #ccc';
        token.addEventListener('click', e => {
            f.clicks.push({ index, trusted: e.isTrusted });
            if (f.ignoreClicks) return;
            const selected = questionElement.userSelectedOptions;
            const at = selected.indexOf(index);
            if (at !== -1) { selected.splice(at, 1); token.classList.remove('highlighted'); return; }
            if (comp.SingleAnswerMode === true) {
                for (const other of selected.splice(0)) f.tokens[other].classList.remove('highlighted');
            }
            selected.push(index);
            token.classList.add('highlighted');
            f.afterClick?.(index);
        });
        paragraph.append(token, document.createTextNode(' '));
        f.tokens.push(token);
    });
    if (config.keepExisting) { q.cachedRenderers[1].identifiedComponents.baseComponents[comp.ComponentID] = [component]; }
    else { q.cachedRenderers = { 1: { identifiedComponents: { baseComponents: { [comp.ComponentID]: [component] } } } }; }
    // Angular scope is recovered from an ancestor, as in a lesson slide.
    const angular = window.angular;
    window.angular = { ...angular, element: el => el === element ? { scope: () => ({ self }) } : angular.element(el) };
    if (config.keepExisting) return;
    const oldSubmit = [...document.querySelectorAll('#sa-navigation-controls button')].find(b => b.textContent.trim() === 'Submit');
    const submit = oldSubmit.cloneNode(true);
    oldSubmit.replaceWith(submit);
    submit.addEventListener('click', () => {
        f.submits++;
        if (f.keepSame) { submit.textContent = 'Next Question'; return; }
        q.questionIndex++;
        if (f.unsupportedNext) { f.q.questionDef.Components.push({ ComponentTypeCode: 'TEXT_BOX_COMPONENT', ComponentID: 'z' }); }
        if (f.continueOnly) {
            element.remove();
            document.querySelector('#question-container-group')?.remove();
            f.self.model._currentQuestion = null;
            let next = document.querySelector('button.continue-button');
            if (!next) {
                next = document.createElement('button');
                next.className = 'continue-button';
                next.textContent = 'Continue';
                document.body.append(next);
            }
            next.hidden = false;
            next.style.display = '';
        }
        if (f.complete) {
            element.hidden = true;
            document.querySelector('#question-container-group')?.remove();
            f.self.model._currentQuestion = null;
            const exit = document.querySelector('button.exit-button');
            exit.hidden = false;
            exit.style.display = '';
        }
    });
}
module.exports = { installHighlightFixture };
