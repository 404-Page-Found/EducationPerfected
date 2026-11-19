// Dash support (issue #237): timed word-to-word sprint sharing the classic
// word-to-word selectors.
//
// There is no live Dash DOM capture: no entry URL, timer, scoring or
// completion markup has been recorded from an account. The fixture in
// scripts/mock-ep.js (`/dash-task`, `/dash-task/play`) is therefore a
// provisional reconstruction, not captured markup: it reuses the audited
// classic selectors (`#question-text`, `input#answer-text`,
// `div.baseLanguage`/`div.targetLanguage`, the wrong-answer modal and the
// exit/continue controls) and adds the smallest plausible timed-sprint
// chrome — a visible countdown (`.dash-timer`), a score readout
// (`.dash-score`) and a results interstitial (`.dash-results`) that keeps the
// same exit control. If a live capture disagrees, the selectors and the
// reconstruction must be updated and re-audited.
//
// Pacing decision (blocking question 7 in #237): Dash shares the classic
// `text` 2-6s human-paced range by default. On a timed sprint that wait
// trades score for human-likeness, so `delay off` (super speed) is the
// documented recommendation when the goal is maximum points. No
// Dash-specific range is introduced: one fewer range to mis-tune, and the
// existing `delay MIN-MAX` override already covers a faster-but-paced
// sprint (e.g. `delay 0.5-1`).
//
// Accuracy decision (joint with #222/#229): an intentional mistake on Dash
// costs sprint time and points (plus possible leaderboard impact), unlike an
// untimed task where it only costs a retry. The default (perfect) is the
// Dash recommendation; when accuracy is enabled the mistake still flows
// through the normal wrong-answer-modal retry path so the run completes,
// but the log calls out the Dash cost explicitly.
//
// Empty word-list rule: a Dash entry with no `div.baseLanguage` /
// `div.targetLanguage` lists has no answer source and each blind guess
// burns clock. The run already reports the empty refresh loudly; the Dash
// wording below makes the timed cost explicit so a sprint is never
// silently mistyped.

const DASH_TIMER_CSS = '.dash-timer';
const DASH_SCORE_CSS = '.dash-score';
const DASH_RESULTS_CSS = '.dash-results';

// One-line guidance surfaced in the run log and in `delay`/`accuracy` help.
const DASH_PACING_NOTE = 'Dash shares the text 2-6s pacing; delay off is recommended for max score on the timed clock.';
const DASH_ACCURACY_NOTE = 'On Dash each intentional mistake burns sprint time/points; perfect (the default) is recommended for Dash.';
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
