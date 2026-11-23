// Invented sanitized fixture for the information slide (issue #327), derived
// from public chunk171 (EP_INFORMATION = 7; InformationControls: disabled
// "Ns remaining" countdown, then an enabled "Continue" action button in
// #sa-navigation-controls), not captured live account DOM. The captured live
// refusal diagnostic (23 November 2026) showed gameMode 3, questionType 7,
// zero question components and zero answer controls on the rendered slide.
function installInfoSlideFixture(config = {}) {
    const self = window.angular.element(document.querySelector('.multi-choice-component')).scope().self;
    const q = self.model._currentQuestion;
    self.model.gameMode = 3;
    q.questionType = 7;
    q.questionDef.Components = [];
    document.querySelector('.multi-choice-component').remove();
    const group = document.querySelector('#question-container-group');
    group.textContent = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = config.text || 'Synthetic information slide: the imperfect tense describes ongoing past actions.';
    group.append(paragraph);
    const bar = document.querySelector('#sa-navigation-controls');
    bar.innerHTML = '';
    const f = window.infoSlideFixture = { self, q, clicks: [], submits: 0, advances: 0 };
    // A stray enabled Submit beside Continue must stop the handler.
    if (config.submitAlso) {
        const submit = document.createElement('button');
        submit.textContent = 'Submit';
        submit.addEventListener('click', () => f.submits++);
        bar.append(submit);
    }
    const button = document.createElement('button');
    button.textContent = '3s remaining';
    button.disabled = true;
    bar.append(button);
    // EP's timer is 3s; the fixture shortens it. neverReady keeps the
    // countdown state forever so the wait budget is what gives up.
    if (!config.neverReady) {
        setTimeout(() => {
            button.disabled = false;
            button.textContent = 'Continue';
            // A second enabled Continue appearing with the first: ambiguous.
            if (config.secondContinue) {
                const extra = document.createElement('button');
                extra.textContent = 'Continue';
                extra.addEventListener('click', (event) => f.clicks.push({ trusted: event.isTrusted }));
                bar.append(extra);
            }
        }, config.countdownMs === undefined ? 100 : config.countdownMs);
    }
    button.addEventListener('click', (event) => {
        f.clicks.push({ trusted: event.isTrusted });
        if (f.ignoreClicks) return;
        f.advances++;
        if (f.complete) {
            group.remove();
            f.self.model._currentQuestion = null;
            const exit = document.querySelector('button.exit-button');
            exit.hidden = false;
            exit.style.display = '';
            return;
        }
        if (f.keepSame) return;
        // Advance: the next slide mounts with a new question identity.
        q.questionIndex++;
        paragraph.textContent = 'Synthetic information slide: continued.';
    });
}
module.exports = { installInfoSlideFixture };
