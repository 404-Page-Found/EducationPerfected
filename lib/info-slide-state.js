// Read-only recognition of EP's Smart Lesson information slide (issue #327):
// a content-only slide with nothing to answer. EP public chunk 171 (the
// pinned research snapshot, retrieved 23 November 2026) defines
// questionType EP_INFORMATION = 7, QuestionAnswerGenerator returns [] for it
// (no answers ship to the client), and the navigation controls mount
// <game-information-controls>: one action button whose label counts down
// ("Ns remaining", disabled) and becomes "Continue" (enabled) after a 3s
// timer (InformationControls.loadDirective / onTimerComplete). onContinue
// dispatches the model's own CONTINUE action - the same action EP's sidebar
// auto-dispatches when the timer completes on an informational section.
// Live shape captured 23 November 2026 from a real lesson's refusal
// diagnostic: gameMode 3, questionType 7, zero question components, zero
// inputs/textareas/selects/contentEditable/canvases/buttons on the rendered
// slide.
//
// This reader whitelists exactly that shape. Any deviation - another
// questionType, any question component, any visible answer control, an
// unreadable model, Assessment or Dash context - is NOT an information
// slide and stays refused. Advancing clicks the lesson's own Continue
// control only; the handler never types, selects or submits.
function readInfoSlideInPage(baseline, action) {
    const shown = el => !!(el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0));
    const refuse = (reason, diagnostic) => ({ descriptor: { kind: 'unsupported', reason: 'Information slide: ' + reason, ...(diagnostic ? { diagnostic: { kind: 'info-slide-refusal', ...diagnostic } } : {}) } });

    // Same slide context the generic fallback uses: a rendered lesson slide.
    const lesson = document.querySelector('#ep-question-container');
    if (!lesson) return null;
    const rendered = lesson.querySelector('#question-container-group');
    if (!rendered || rendered.textContent.trim() === '') return null;

    // EP is an AngularJS app; walk up for the scope carrying the current question.
    let self;
    for (let node = rendered, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
        try {
            const scope = window.angular?.element(node)?.scope?.();
            if (scope?.self?.model?._currentQuestion) { self = scope.self; break; }
        } catch (e) { /* not a scoped node; keep walking */ }
    }
    const model = self?.model, q = model?._currentQuestion;
    if (!q) return null;   // unreadable model: the generic fallback reports it
    if (model.gameMode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } };
    if (model.isDash === true) return { descriptor: { kind: 'unsupported', dash: true, reason: 'Dash timed sprint round detected; only the captured choice and typed Dash layouts are answered. Stop the run, type inspect-dash and send the EP_DASH_INSPECT line (read-only capture).' } };
    // Only the captured information type (chunk171: EP_INFORMATION === 7).
    // Any other question type is not this reader's shape; the generic
    // fallback reports it as unsupported.
    if (q.questionType !== 7) return null;
    if (model.gameMode !== 3) return refuse(`information slides require confirmed Smart Lesson practice mode; unknown modes (gameMode ${Number.isSafeInteger(model.gameMode) ? model.gameMode : 'unreadable'}) are not supported`);
    if (!Number.isSafeInteger(q.contentID) || q.contentID <= 0
        || !Number.isSafeInteger(q.questionIndex) || q.questionIndex < 0) return refuse('information slide without a stable identity (contentID/questionIndex missing from EP\'s question state)');

    // The captured slide ships zero question components. Any component is an
    // answer or companion surface this reader has no contract for; refuse by
    // name (recognized codes) or as unlisted, never silently skipping it.
    // Canonical companion inventory mirrors lib/companion-components.js
    // (issue #231): recognized EP codes are named, anything unlisted is
    // reported as UNLISTED_COMPONENT. Kept local because this reader runs
    // inside page.evaluate and must stay self-contained;
    // scripts/companion-components-test.js asserts Set equality with the
    // canonical module.
    const knownCodes = new Set(('ANNOTATED_QUESTION ANNOTATED_TEXT DEPTH DROPDOWN FILE_UPLOADER FILL_IN_GAPS'
        + ' FORMULA FREEFORM_WORKING HIGHLIGHT LONG_ANSWER MULTICHOICE NUMBER_BOX SCRATCH_PAD SOUND SOUND_RECORDER'
        + ' TEXT_BOX TYPE_ARROW TYPE_EQUALS TYPE_EXPONENT TYPE_GROUP TYPE_MATH_ENTITY TYPE_MATH_FUNCTION'
        + ' TYPE_MULTI_OPERATOR TYPE_NUMBER TYPE_OR TYPE_SUBSCRIPT_SUPERSCRIPT TYPE_TEXT TYPE_UNARY_OPERATOR'
        + ' WORKING_FORMULA').split(' ').map(c => c + '_COMPONENT'));
    const components = q.questionDef?.Components;
    if (!Array.isArray(components)) return refuse('question components unreadable');
    if (components.length) {
        const code = components[0]?.ComponentTypeCode;
        const named = knownCodes.has(code) ? code : 'UNLISTED_COMPONENT';
        return refuse(`an information slide carries no question components (found ${components.length}: ${named}); stopping instead of skipping it`, { guard: 'unexpected-component', componentType: named });
    }

    // The captured slide renders no answer controls. Any visible form
    // control, canvas or button inside the lesson container is something a
    // student could answer with; refuse it rather than advance past an
    // answerable slide. (The lesson's own Previous/Continue controls live in
    // #sa-navigation-controls, outside the lesson container.)
    const controlCount = selector => [...lesson.querySelectorAll(selector)].filter(shown).length;
    const contentEditable = [...lesson.querySelectorAll('[contenteditable]')].filter(el => shown(el) && el.isContentEditable).length;
    const controls = {
        inputs: controlCount('input'),
        textareas: controlCount('textarea'),
        selects: controlCount('select'),
        contentEditable,
        canvases: controlCount('canvas'),
        buttons: controlCount('button'),
    };
    const total = controls.inputs + controls.textareas + controls.selects + controls.contentEditable + controls.canvases + controls.buttons;
    if (total) return refuse('the slide shows answer controls; stopping instead of skipping a possibly answerable question', { guard: 'answer-controls', controls });
    // Answer surfaces claimed by other readers run first; seeing their DOM
    // here means that reader passed on it, so refuse rather than skip.
    if ([...lesson.querySelectorAll('.voice-speaker, div.multi-choice-component, div.highlight-input, input#answer-text')].some(shown)) {
        return refuse('the slide mounts a known answer surface its own reader did not claim; stopping instead of skipping it', { guard: 'unclaimed-surface' });
    }

    const key = `info-slide:${q.contentID}:${q.questionIndex}`;
    const descriptor = { kind: 'info-slide', representation: 'information-slide', key };

    if (baseline) {
        if (baseline.q !== q || baseline.model !== model
            || baseline.descriptor?.key !== key) return refuse('cached question identity changed', { guard: 'identity-changed' });
    }

    const result = { descriptor, q, model };
    if (action === 'advance') {
        // The visible navigation bar whose Angular scope chain resolves to
        // this lesson model is the only bar whose button may be clicked.
        const barModel = bar => {
            for (let node = bar, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
                const a = window.angular?.element(node);
                const scopes = a ? [a.isolateScope?.(), a.scope?.()] : [];
                for (const scope of scopes) {
                    if (scope?.self?.model?._currentQuestion) return scope.self.model;
                }
            }
            return undefined;
        };
        const bars = [...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(bar => barModel(bar) === model);
        if (bars.length !== 1) return refuse('navigation controls are ambiguous or unassociated', { guard: 'navigation-ambiguous' });
        const bar = bars[0];
        // A Submit on this slide would mean there is something to grade;
        // never advance past it (and never click it). A disabled but visible
        // Submit still counts: it is an answer surface.
        const submits = [...bar.querySelectorAll('button')].filter(b => shown(b) && (b.innerText || '').trim() === 'Submit');
        if (submits.length) return refuse('a Submit button is visible on a slide that should have nothing to submit; stopping', { guard: 'submit-present' });
        const continues = [...bar.querySelectorAll('button')].filter(b => shown(b) && !b.disabled && (b.innerText || '').trim() === 'Continue');
        if (continues.length > 1) return refuse('Continue is ambiguous', { guard: 'continue-ambiguous' });
        const button = continues[0] || null;
        if (baseline && baseline.bar !== undefined && (baseline.bar !== bar || baseline.button !== button)) {
            return refuse('Continue control changed', { guard: 'identity-changed' });
        }
        result.bar = bar;
        result.button = button;
        // EP's information controls count down ("Ns remaining", disabled)
        // before enabling Continue; report not-ready so the caller waits.
        if (!button) return { ...result, readiness: 'not-ready' };
        result.target = button;
    }
    return action === 'descriptor' ? { descriptor } : result;
}
module.exports = { readInfoSlideInPage };
