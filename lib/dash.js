// Dash support (issue #230 closed 2026-11-21; #237/#273): timed sprint on EP's
// quiz model (isDash flag, gameMode null in the captured choice and typed rounds).
//
// Three live Dash round shapes have been captured by read-only EP_DASH_INSPECT
// lines (never question/answer text): the 19 November 2026 multi-choice round
// (one single-select MULTICHOICE_COMPONENT, answered from the shipped Correct
// flag), the 20 November 2026 typed round (filed as #272: #question-text,
// input#answer-text, questionType 0, translationMode 0, one validAnswers
// entry, no components) and the second 20 November 2026 number-box round
// (filed as #282: one NUMBER_BOX_COMPONENT with validAnswers empty and no
// correct flags - no shipped answer, so that shape refuses by name). The fixtures in scripts/mock-ep.js (`/dash-task`
// classic-shaped starter/play, `/dash-task/quiz` choice shape,
// `/dash-task/typed` typed shape, `/dash-task/number-box` refusal shape) are
// provisional reconstructions, not captured markup: the typed fixture reuses
// the audited classic selectors (`#question-text`, `input#answer-text`, the
// wrong-answer modal and the exit/continue controls); the classic
// `/dash-task` starter/play is synthetic and retained only to exercise the
// classic-path timed-run guess warning. Every timer (`.dash-timer`),
// score (`.dash-score`) and results interstitial (`.dash-results`) is
// fixture-invented - all three live captures found no timer candidates. The run's one-line Dash notice
// (`noteDashOnce` in index.js) is timer-first but falls back to the captured
// Dash model/route (`detectQuestion` returning `dash: true`), so the pacing
// and mistake-cost warnings still appear on a live round with no timer
// markup. If a live capture disagrees, the
// selectors and the reconstruction must be updated and re-audited.
//
// Pacing decision (issue #230; blocking question 7 in #237, extended to typed Dash in
// #273): Dash shares the classic per-question-type human-paced ranges in the
// reconstructions (choice 3-8s, typed 4-10s; the classic synthetic keeps text
// 2-6s). On a timed sprint that wait is expected to trade score for
// human-likeness, so `delay off` (super speed) is the provisional
// recommendation when the goal is maximum points — live scoring/expiry is
// unproved and the fixtures never auto-end on time. No Dash-specific range is
// introduced: one fewer range to mis-tune. There is no custom pacing range;
// on and off are the only pacing settings.
//
// Accuracy decision (joint with #222/#229): an intentional mistake on Dash is
// expected to cost sprint time and points (plus possible leaderboard impact,
// unproved live), unlike an untimed task where it only costs a retry. The
// default (perfect) is the provisional Dash recommendation; when accuracy is
// enabled the mistake still flows through the normal wrong-answer-modal retry
// path so the run completes, but the log calls out the expected Dash cost
// explicitly.
//
// Empty word-list rule (issue #230, classic-path only): a classic Dash entry
// with no `div.baseLanguage` / `div.targetLanguage` lists has no answer source
// and each blind guess burns clock. The run already reports the empty refresh
// loudly; the Dash wording below makes the timed cost explicit so a sprint is
// never silently mistyped. Captured Dash choice/typed rounds do not use word
// lists at all (shipped answer or named refusal), so this warning is a
// classic-path warning gated on the Dash starter page (index.js
// isDashStarter), not on the round shape.

const DASH_TIMER_CSS = '.dash-timer';
const DASH_SCORE_CSS = '.dash-score';
const DASH_RESULTS_CSS = '.dash-results';

// One-line guidance surfaced in the run log and in `delay`/`accuracy` help.
const DASH_PACING_NOTE = 'Dash shares the classic per-question-type pacing in the reconstruction (text 2-6s, choice 3-8s, typed 4-10s); delay off is expected (unproved live) to maximise score on a timed clock — re-verify against a live capture.';
const DASH_ACCURACY_NOTE = 'On Dash each intentional mistake is expected (unproved live) to burn sprint time/points; perfect (the default) is the provisional Dash recommendation.';
const DASH_EMPTY_WORDLIST_NOTE = 'On a timed Dash sprint an empty list leaves only modal self-learning, where each wrong guess burns clock; open the Dash entry with its word lists visible before refreshing.';

// In-page predicate. Runs inside page.evaluate, so it must stay
// self-contained: no references to anything outside its own body.
function detectDashInPage(timerCss, resultsCss) {
    const timer = timerCss ? document.querySelector(timerCss) : null;
    const results = resultsCss ? document.querySelector(resultsCss) : null;
    const timerVisible = !!(timer && !timer.hidden && (timer.offsetParent !== null || (timer.getClientRects && timer.getClientRects().length > 0)));
    const resultsVisible = !!(results && !results.hidden && (results.offsetParent !== null || (results.getClientRects && results.getClientRects().length > 0)));
    if (!timer && !results) return null;
    return { isDash: true, timerVisible, resultsVisible };
}

async function isDashPage(page, timerCss = DASH_TIMER_CSS, resultsCss = DASH_RESULTS_CSS) {
    try {
        const found = await page.evaluate(detectDashInPage, timerCss, resultsCss);
        return !!(found && found.isDash);
    } catch {
        return false;
    }
}

async function isDashCompletion(page, resultsCss = DASH_RESULTS_CSS) {
    try {
        return await page.evaluate(css => {
            const el = document.querySelector(css);
            return !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
        }, resultsCss);
    } catch {
        return false;
    }
}

module.exports = {
    DASH_TIMER_CSS,
    DASH_SCORE_CSS,
    DASH_RESULTS_CSS,
    DASH_PACING_NOTE,
    DASH_ACCURACY_NOTE,
    DASH_EMPTY_WORDLIST_NOTE,
    detectDashInPage,
    isDashPage,
    isDashCompletion,
};
