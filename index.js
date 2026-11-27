// V2026 (package version 2026.11.22)

const puppeteer = require('puppeteer');
const { detectQuestion } = require('./lib/detect-question');
const { audioAllowed, audioPolicyUnchanged } = require('./lib/audio-policy');
const { playChoiceRound } = require('./lib/choice-handler');
const { playGapsRound } = require('./lib/gaps-handler');
const { playDropdownRound } = require('./lib/dropdown-handler');
const { playDropdownNumberBoxRound } = require('./lib/dropdown-numberbox-handler');
const { playSlideSurfacesRound } = require('./lib/slide-surfaces-handler');
const { playReflectionRound } = require('./lib/reflection-handler');
const { playTextboxRound, playNumberBoxRound } = require('./lib/textbox-handler');
const { createRunControls } = require('./lib/run-controls');
const { createFillGapsOnce } = require('./lib/gaps-fill-once');
const { createFillTextboxesOnce } = require('./lib/textbox-fill-once');
const { createSubmitGapsOnce } = require('./lib/gaps-submit-once');
const { createSubmitDropdownOnce } = require('./lib/dropdown-once');
const { createSelectMultiOnce } = require('./lib/multi-select-once');
const { playMultiChoiceSelection } = require('./lib/multi-choice-handler');
const { playHighlightRound } = require('./lib/highlight-handler');
const { playInfoSlideRound } = require('./lib/info-slide-handler');
const { playWorkingFormulaRound } = require('./lib/working-formula-handler');
const { createHumanDelay, summarizeRanges } = require('./lib/human-delay');
const { createSelectChoiceOnce } = require('./lib/choice-select-once');
const { readChoiceInPage } = require('./lib/choice-state');
const { diagnostic } = require('./lib/diagnostics');
const { createSupportReport, describeUnsupported, describeHandlerStop, needsShapeProbe } = require('./lib/support-report');
const { readUnsupportedShape } = require('./lib/unsupported-shape');
const { createSupportSender } = require('./lib/support-sender');
const { collectSelfMarkDiagnostics } = require('./lib/self-mark-diagnostics');
const { captureAssessment } = require('./lib/assessment-diagnostics');
const { guardClassicEnter } = require('./lib/classic-enter');
const { boxMatchesAnswer } = require('./lib/answer-normalize');
const { cleanString: cleanQuestionString, questionKeyVariants } = require('./lib/question-keys');
const {
    answerCandidates: buildAnswerCandidates,
    mergeCandidates: mergeCandidateLists,
    hasCandidates: dictHasCandidates,
    findCandidate: findDictCandidate,
    learnEntryIn: learnDictEntry,
    recordRejectionIn: recordDictRejection,
} = require('./lib/classic-dict');
const {captureSelectionBaseline,inspectSelectionModal,advanceSelectionSection}=require('./lib/selection-modal');
const { DASH_TIMER_CSS, DASH_SCORE_CSS, DASH_RESULTS_CSS, DASH_PACING_NOTE, DASH_ACCURACY_NOTE, DASH_EMPTY_WORDLIST_NOTE, detectDashInPage } = require('./lib/dash');

// ===== Credentials ===== //
// Credentials are never stored in this (or any other tracked) file. They are read at
// runtime, the first source that yields a value for BOTH fields wins:
//   1. the EP_EMAIL / EP_PASSWORD environment variables
//   2. the native OS credential store, then optional legacy `keytar` entries
//   3. an interactive prompt on the terminal, when run attached to a TTY. The browser
//      window is already sitting on EP's login page then, so the prompt is raced
//      against the logged-in signal on the page: a manual login that completes first
//      (the password form, or an SSO/social flow this script can never touch)
//      cancels the prompt instead of outliving it.
// Nothing is ever written to disk. Leave the sources unset to skip auto-login and
// sign in manually in the browser window.
const CREDENTIAL_SERVICE = 'EducationPerfected';

/**
 * Strips surrounding quotes and normalizes whitespace for credential-like values.
 * Returns null for empty/placeholder values.
 * @param {string} value
 * @returns {string|null}
 */
function cleanCredential(value) {
    if (typeof value !== 'string') return null;
    // Remove surrounding single/double quotes, then trim whitespace.
    const cleaned = value.trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
    return cleaned === '' ? null : cleaned;
}

/**
 * Normalizes an email address: trims whitespace and strips surrounding quotes.
 * Unlike passwords, emails never have meaningful leading/trailing spaces.
 * @param {string} value
 * @returns {string|null}
 */
function cleanEmail(value) {
    return cleanCredential(value);
}

/**
 * Normalizes a password: strips surrounding quotes only, preserving all
 * leading/trailing/internal whitespace which can be significant.
 * @param {string} value
 * @returns {string|null}
 */
function cleanPassword(value) {
    if (typeof value !== 'string') return null;
    const unquoted = value.replace(/^(['"])(.*)\1$/s, '$2');
    return unquoted === '' ? null : unquoted;
}

/**
 * Attempts to load the optional `keytar` module for OS keychain access.
 * Returns null if the module is not installed or fails to load, allowing
 * the program to fall back to environment variables or TTY prompt.
 * @returns {Object|null} The keytar module or null if unavailable
 */
function loadKeytar() {
    // The SEA supplies @napi-rs/keyring through native-binding. Legacy keytar
    // migration is source-only; SEA require cannot load optional npm modules.
    if (require('node:sea').isSea()) return null;
    try {
        return require('keytar');
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.warn(`Credential store unavailable (${e.message}); skipping the OS keychain.`);
        }
        return null;
    }
}

/**
 * Reads a credential field from the OS keychain using keytar.
 * @param {string} field - The field name ('EP_EMAIL' or 'EP_PASSWORD')
 * @returns {Promise<string|null>} The credential value or null if unavailable
 */
async function readKeychainCredential(field) {
    const keytar = loadKeytar();
    if (!keytar) return null;
    try {
        const raw = await keytar.getPassword(CREDENTIAL_SERVICE, field);
        return field === 'EP_EMAIL' ? cleanEmail(raw) : cleanPassword(raw);
    } catch (e) {
        console.warn(`Could not read the ${field} from the OS keychain (${e.message}); skipping it.`);
        return null;
    }
}

// Terminal prompt: input echoes as it is typed, so both fields can be reviewed and
// edited before submitting. Resolves null when stdin
// is not a terminal (piped input is not trusted with a password) or the user submits
// nothing, so the manual-login path still works everywhere.
//
// An open prompt can also be closed from OUTSIDE (see racePromptAgainstLogin): when a
// manual login completes in the browser while the prompt is waiting on the terminal,
// it is closed the way a real keystroke would close it - finish(): restore raw mode,
// drop the data listener, write the terminating newline - but WITHOUT process.exit,
// so the program keeps running after the cancelled prompt. finish() is guarded to run
// exactly once, which also covers a cancel landing in the same tick as a submit: no
// second newline, no double restore. The early exits (no TTY, no raw mode) resolve
// before anything was armed and mark themselves finished, so a later cancel() on them
// is a no-op rather than an extra newline.
/**
 * Prompts for a value with visible, editable input.
 * @param {string} label
 * @param {(value: string) => string|null} cleaner - Function to clean the submitted value
 * @returns {{promise: Promise<string|null>, cancel: () => void}} promise resolves to the
 *   cleaned answer, or null when nothing valid was submitted, stdin is not a terminal,
 *   or the prompt was cancelled; cancel() closes an open prompt through the same
 *   finish() path Ctrl+C takes, minus process.exit
 */
function promptSecret(label, cleaner) {
    let finish = null;
    const promise = new Promise(resolve => {
        const stdin = process.stdin;
        let finished = false;   // finish() has run: no more cleanup or newline is due
        let armed = false;      // stdin was switched to raw with onData attached
        let wasRaw = false;
        finish = result => {
            if (finished) return;
            finished = true;
            if (armed) {
                stdin.removeListener('data', onData);
                stdin.setRawMode(wasRaw || false);
                stdin.pause();
                process.stderr.write('\n');
            }
            resolve(result);
        };
        if (!stdin.isTTY) return finish(null);
        // Raw mode gives keystroke-at-a-time control (manual echo, backspace editing,
        // escape-sequence filtering); a terminal that cannot do it gets no prompt.
        if (typeof stdin.setRawMode !== 'function') {
            process.stderr.write('\n(this terminal cannot take interactive input; log in manually)\n');
            return finish(null);
        }
        // Chunk is a Buffer; for...of yields numeric byte values. Collect bytes
        // and decode as UTF-8 on submit so non-ASCII characters are preserved.
        // On backspace/delete, remove the complete final UTF-8 character.
        // Ignore escape sequences (starting with 0x1B) so arrow keys, bracketed paste,
        // and other control sequences are not added to the secret.
        // Echo only to a live terminal: redirected stderr (setup 2>setup.log) must
        // never receive the typed login.
        const echo = process.stderr.isTTY ? chunk => process.stderr.write(chunk) : () => {};
        const bytes = [];
        // Escape-sequence state machine. ESC starts a sequence, then:
        //   'kind' none   -> the next byte is the introducer ('[' CSI, ']' OSC,
        //                    anything else for a two-byte sequence such as Alt+key)
        //   'kind' csi    -> body until a final byte 0x40-0x7E. Covers arrow/function
        //                    keys and bracketed paste (ESC [200~ ... ESC [201~).
        //   'kind' osc    -> body until BEL or ST (ESC \). Covers colour/title replies.
        // None of these bytes may reach the secret: `[` is itself in the final-byte
        // range, so without the explicit introducer step the parser would end on it and
        // feed the rest back as input ("A" from an arrow key, "200~" from a paste).
        let escapeKind = null;  // null | 'introducer' | 'csi' | 'osc' | 'oscEsc'
        const onData = chunk => {
            for (const byte of chunk) {
                if (escapeKind !== null) {
                    if (escapeKind === 'introducer') {
                        if (byte === 0x5B /* [ */) escapeKind = 'csi';
                        else if (byte === 0x5D /* ] */) escapeKind = 'osc';
                        else escapeKind = null;  // two-byte sequence (Alt+key) is complete
                        continue;
                    }
                    if (escapeKind === 'osc') {
                        if (byte === 0x07) escapeKind = null;          // BEL terminates OSC
                        else if (byte === 0x1B) escapeKind = 'oscEsc';  // maybe ST (ESC \)
                        continue;
                    }
                    if (escapeKind === 'oscEsc') {
                        escapeKind = null;  // ST if '\', otherwise the sequence just ended
                        continue;
                    }
                    // csi: ends on a final byte; parameters are 0x30-0x3F, intermediates 0x20-0x2F
                    if (byte >= 0x40 && byte <= 0x7E) escapeKind = null;
                    continue;
                }
                if (byte === 0x1B) {  // ESC: start of escape sequence
                    escapeKind = 'introducer';
                    continue;
                }
                if (byte === 13 || byte === 10) return finish(cleaner(Buffer.from(bytes).toString('utf8')));
                if (byte === 3) {  // Ctrl+C: leave cleanly, no stack trace
                    finish(null);
                    if (process.listenerCount('SIGINT')) process.emit('SIGINT');
                    else process.exit(130);
                }
                if (byte === 8 || byte === 127) {
                    // drop one whole UTF-8 character (continuation bytes, then the lead byte)
                    while (bytes.length && (bytes.at(-1) & 0xC0) === 0x80) bytes.pop();
                    bytes.pop();
                    echo('\b \b');   // erase the echoed character
                } else if (byte >= 32) {
                    bytes.push(byte);
                    echo(Buffer.from([byte]));   // visible while typing
                }
            }
        };
        wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
        armed = true;   // listener attached: finish() now owns the full undo
        process.stderr.write(label);
    });
    // Cancelling from outside takes finish()'s cleanup path but never process.exit:
    // the run continues on the normal post-login wait (see racePromptAgainstLogin).
    return { promise, cancel: () => finish(null) };
}

// The marker racePromptAgainstLogin returns when the run's login watcher saw a
// completed session before the prompt was answered - the exact moment the user
// finished signing in by hand. It is threaded through promptCredentials and
// resolveCredentials so the program block can skip auto-login and the "no
// credentials" message for it. A Symbol, so it can never collide with a value the
// user actually submitted at the prompt.
const PROMPT_CANCELLED_BY_LOGIN = Symbol('a completed browser login cancelled the terminal prompt');

/**
 * Races an open prompt against the run's login watcher (see watchForSession in the
 * program block). The browser window is already sitting on EP's login page while the
 * prompt waits on the terminal, and a manual sign-in that completes first - the
 * password form, or an SSO/Google/Microsoft/Clever flow the auto-login can never
 * touch - cancels the prompt instead of outliving it: the prompt is closed through
 * promptSecret's cancel() (finish()'s cleanup, minus process.exit) and
 * PROMPT_CANCELLED_BY_LOGIN is returned. When the prompt is answered first, the
 * cleaned answer is returned untouched.
 * The watcher is started BEFORE the prompt, by promptCredentials, and the
 * already-running promise is what gets raced: starting it inside the race would leave
 * the race observing a wait that re-arms after every navigation for as long as the
 * run goes on, so the event loop would tick with closed stdin on the very page the
 * login belongs to until the prompt was answered. Awaiting it first instead would
 * hold the prompt back until a login that might never come: the prompt must be on
 * screen from the moment it is created.
 * @param {{promise: Promise<string|null>, cancel: () => void}} prompt - An open promptSecret
 * @param {Promise<boolean>} sessionWatch - The run's login watcher, already running
 * @returns {Promise<string|null|symbol>} The submitted answer, or
 *   PROMPT_CANCELLED_BY_LOGIN when the watcher saw the session first.
 */
async function racePromptAgainstLogin(prompt, sessionWatch) {
    const winner = await Promise.race([
        // A submitted answer settles the race with its value. A prompt promise that
        // rejects is not expected (every finish path resolves), so it degrades to an
        // empty answer rather than rejecting the run's credential resolution.
        prompt.promise.then(
            answer => ({ answer: answer }),
            () => ({ answer: null }),
        ),
        // Only a logged-in session wins the race. A dead one - the wait killed by a
        // navigation (EP's login bounces hosts before the session arrives) or left
        // false with the page gone - must neither win nor reject the race: it maps
        // to a never-settling promise, which is the equivalent of no watcher, and
        // the prompt stays open as before.
        sessionWatch.then(
            seen => (seen ? { login: true } : new Promise(() => { })),
            () => new Promise(() => { }),
        ),
    ]);
    if (!winner.login) return winner.answer;
    prompt.cancel();
    return PROMPT_CANCELLED_BY_LOGIN;
}

// Asks only when a terminal is attached AND the run would otherwise skip auto-login;
// an empty answer at either prompt means "log in manually". The browser window is
// already sitting on EP's login page while the prompts wait on the terminal, so each
// prompt is raced against the login watcher (watchForSession): a manual sign-in that
// completes first cancels the prompt invisibly.
/**
 * Prompts for email and password credentials interactively.
 * @param {() => Promise<boolean>} [watchForSession] - Starts the run's login-success
 *   watcher; absent (or not a function) when no race is wanted. Created once, before
 *   the first prompt, and raced against both.
 * @returns {Promise<{email: string, password: string}|PROMPT_CANCELLED_BY_LOGIN|null>}
 */
async function promptCredentials(watchForSession, { setup = false } = {}) {
    if (!process.stdin.isTTY) {
        console.log(setup ? 'Setup requires an interactive terminal; no login saved.' : 'Not running in a terminal, so no credential prompt; log in manually in the opened browser window.');
        return null;
    }
    // The watcher is started, not tested: watchForSession() hands back a Promise, which
    // is always truthy, so a `watcher ? race : plain` split would never take the plain
    // branch anyway. Null (no watcher was given) means no race. One is started just
    // before each prompt - so the prompt opens at once, without waiting on a login that
    // might never come - and the running promise is handed to the race.
    const startWatch = () => typeof watchForSession === 'function' ? watchForSession() : null;
    const race = (prompt) => {
        const sessionWatch = startWatch();
        return sessionWatch === null
            ? prompt.promise
            : racePromptAgainstLogin(prompt, sessionWatch);
    };

    const emailPrompt = promptSecret(setup ? 'EP email (leave empty to cancel setup): ' : 'EP email (leave empty to log in manually): ', cleanEmail);
    const email = await race(emailPrompt);
    if (email === PROMPT_CANCELLED_BY_LOGIN) return PROMPT_CANCELLED_BY_LOGIN;
    if (email === null) return null;
    const passwordPrompt = promptSecret('EP password (visible): ', cleanPassword);
    const password = await race(passwordPrompt);
    if (password === PROMPT_CANCELLED_BY_LOGIN) return PROMPT_CANCELLED_BY_LOGIN;
    if (password === null) {
        console.log(setup ? 'No password entered; setup cancelled.' : 'No password entered; log in manually in the opened browser window.');
        return null;
    }
    return { email, password };
}

/**
 * Resolves credentials at runtime from the first available source:
 * 1. EP_EMAIL / EP_PASSWORD environment variables (both must be set)
 * 2. Versioned native OS credential record, then optional legacy keytar fields
 * 3. Interactive TTY prompt (visible, editable input), raced against watchForSession so a manual
 *    browser login that completes while it is open cancels it
 * Returns null if no credentials are available, allowing manual login, or an object
 * with sessionDetected true when the login watcher saw a completed login first.
 * @param {() => Promise<boolean>} [watchForSession]
 * @returns {Promise<{email: string, password: string, source: string}|{sessionDetected: true}|null>}
 */
async function resolveCredentials(watchForSession) {
    // Test boot must never consult env credentials, the OS keychain, or a
    // terminal prompt. The local harness performs its own inert mock login.
    if (process.env.EP_TEST_BOOT === '1') return null;
    const email = cleanEmail(process.env.EP_EMAIL);
    const password = cleanPassword(process.env.EP_PASSWORD);
    if (email && password) return { email, password, source: 'EP_EMAIL/EP_PASSWORD' };
    if (process.env.EP_EMAIL || process.env.EP_PASSWORD) {
        // Half a configuration is almost always a typo; say so instead of guessing
        // which half the user meant and prompting for the other.
        console.warn('Only one of EP_EMAIL / EP_PASSWORD is set (or one of them is empty); not enough for auto-login.');
    }

    // Read the versioned pair once, never a mixed email/password snapshot.
    try {
        const saved = await require('./lib/credential-store').createCredentialStore().read();
        if (saved) return { ...saved, source: 'the OS credential store' };
    } catch (error) {
        console.warn('Saved login unavailable (' + (error.code || 'store failure') + '). Unlock the OS credential store or run CLI setup; manual login is still available.');
    }

    const keychainEmail = await readKeychainCredential('EP_EMAIL');
    const keychainPassword = await readKeychainCredential('EP_PASSWORD');
    if (keychainEmail && keychainPassword) {
        return { email: keychainEmail, password: keychainPassword, source: 'the OS keychain' };
    }

    const prompted = await promptCredentials(watchForSession);
    if (prompted === PROMPT_CANCELLED_BY_LOGIN) {
        // The session is already running; the program block reports it as such and
        // falls straight through to the normal post-login wait.
        return { sessionDetected: true };
    }
    if (prompted) return { ...prompted, source: 'the terminal prompt' };
    return null;
}

// ===== Program ===== //

async function launchProgram({ onBrowserClosed = () => {}, onBrowserDisconnected = () => {}, onStartupPhase = () => {}, legacySignals = false, gapsFillOnly = false, choiceSelectOnly = false, gapsSubmitOnce = false, textboxFillOnly = false, dropdownSubmitOnce = false, multiSelectOnly = false, reflectionTextProvider, accuracy = {}, connectBrowser = null, selectPage = null, browserControls = true } = {}) {
    // F4 popup is the only normal-run dropdown input path. The older
    // Home/ArrowDown mechanism remains only in explicit synthetic regression
    // fixtures and the local EP-free diagnostic; there is no env rollback.
    const dropdownInputMode = 'f4-popup';
    if ([gapsFillOnly, choiceSelectOnly, gapsSubmitOnce, textboxFillOnly, dropdownSubmitOnce, multiSelectOnly].filter(Boolean).length > 1 || ((gapsFillOnly || choiceSelectOnly || gapsSubmitOnce || textboxFillOnly || dropdownSubmitOnce || multiSelectOnly) && legacySignals)) throw new Error('Validation requires an exclusive nonlegacy session.');
    // EP_TEST_BOOT=1 is the test harness boot (scripts/handler-test.js). The
    // EP_LOGIN_URL / EP_LOGIN_HOST overrides are honored ONLY under it: on a
    // real run they are ignored, so a stray environment can never point the
    // program at a lookalike host or disable the host protection below.
    const TEST_BOOT = process.env.EP_TEST_BOOT === '1';
    // Issue #222 random accuracy: OFF by default (perfect answers); enable it
    // with `accuracy on`, CLI flags or env. Also perfect under
    // TEST_BOOT unless explicitly enabled.
    // Validation one-shot sessions stay perfect: precise fill-only proofs
    // must never inject mistakes.
    const validationFlags = Boolean(gapsFillOnly || choiceSelectOnly || gapsSubmitOnce || textboxFillOnly || dropdownSubmitOnce || multiSelectOnly);
    const { readConfig, writeConfig } = require('./lib/app-config');
    // Fixtures and one-shot validators never read or change personal settings.
    const savedConfig = TEST_BOOT || validationFlags ? { version: 1 } : readConfig();
    let accuracyConfig;
    try {
        accuracyConfig = require('./lib/accuracy').resolveAccuracyConfig({ cli: accuracy || {}, env: process.env, config: savedConfig.accuracy });
    } catch (e) {
        console.error(String(e.message || e));
        throw e;
    }
    if (validationFlags && accuracyConfig.enabled) {
        accuracyConfig = { ...accuracyConfig, enabled: false, fixedTarget: 100, target: 100, source: 'validation-perfect' };
    }
    const DIR = {
        // Credentials are resolved at runtime (see resolveCredentials) and never kept
        // anywhere a commit could pick them up. Email/password are added below.

        login_url: (TEST_BOOT && process.env.EP_LOGIN_URL) || 'https://app.educationperfect.com/app/login',

        // The login form is no longer served from app.educationperfect.com: that URL
        // boots the SPA, which bounces /app/login -> / -> authentication.educationperfect.com
        // -> iam.educationperfect.com (FusionAuth OAuth2). The form there keeps the same
        // #loginId/#password ids, so the selectors below only need the matching origin -
        // a same-document selector wait would never match while the page is still on the
        // first host.
        login_host: (TEST_BOOT && process.env.EP_LOGIN_HOST) || 'iam.educationperfect.com',

        // log-in page elements
        username_css: '#loginId',
        password_css: '#password',

        // The submit control, matched by its text rather than by position: the iam page
        // can carry SSO/Google/Microsoft/Clever buttons around the main form, and a
        // positional selector would risk clicking one of those. Resolved once per page
        // load and reused, so the button that is readiness-checked is the button clicked.
        login_button_css: 'button',

        // the login button's label (exact, case-insensitive)
        login_button_text: 'Log in',

        // A logged-in signal, not a page-specific element: the old
        // 'div.view-segment-dashboard' belonged to the pre-single-spa app and no longer
        // exists anywhere on the current dashboard (verified: /learning/dashboard renders
        // an mfeAppShell-Scaffold with none of that class). The MFE mount points under
        // <main> only appear once the app shell is actually running for a session, and
        // the login page has neither, so its appearance means login succeeded.
        home_css: 'main #single-spa-application\\:mfeGlobalNavigation\\:Tertiary',

        // task-starter page elements
        baseList_css: 'div.baseLanguage',
        targetList_css: 'div.targetLanguage',
        start_button_css: 'button#start-button-main',

        // task page elements
        // Audited against the live app's current bundles (mfe-student-app, 2026-10-27):
        // every selector here still matches the markup and the app's own code. The <td>
        // names on the modal fields are load-bearing: the wrong-answer table is the only
        // markup that puts these ids on a <td> (other dialogs reuse them on divs/spans).
        // The modal's fields start as "&nbsp;" placeholders and are filled by the
        // answer-feedback formatter, which is what the readiness check below waits for.
        // Dash (issue #230, closed 2026-11-21): three live EP_DASH_INSPECT captures
        // exist (choice 2026-11-19, typed 2026-11-20 filed as #272, number-box
        // 2026-11-20 filed as #282). The typed capture reuses the classic
        // #question-text / input#answer-text pair plus the shared wrong-answer
        // modal above; the choice/number-box captures use no classic markup.
        // The timer/score/results selectors below stay fixture-invented (no live
        // capture found timer candidates) and never drive answering.
        modal_question_css: 'td#question-field',
        modal_correct_answer_css: 'td#correct-answer-field',
        modal_user_answered_css: 'td#users-answer-field',
        modal_css: 'div[uib-modal-window=modal-window]',
        modal_backdrop_css: 'div[uib-modal-backdrop=modal-backdrop]',

        // task page: <span id="question-text"> inside #question-block (audio tasks use a
        // span with the same id under .voice-speaker; they are unsupported anyway)
        // Dash typed rounds share this pair (captured 2026-11-20, #272); Dash
        // choice/number-box rounds use no classic markup. The Dash timer/scores
        // below are the only Dash-specific selectors. See lib/dash.js for the
        // pacing/accuracy decision.
        question_css: '#question-text',
        answer_box_css: 'input#answer-text',
        // Dash (timed sprint, issue #230 closed 2026-11-21): the classic task
        // selectors above are shared ONLY by the captured Dash typed shape
        // (audited 2026-11-20 against the #272 live capture; fixture at
        // /dash-task/typed in scripts/mock-ep.js). The earlier /dash-task
        // classic reconstruction is synthetic and retained only to exercise the
        // timed-run empty-word-list warning. The timer/score/results selectors
        // below are fixture-invented (lib/dash.js, no live timer candidates):
        // the timer warns on the first classic question the word list cannot answer and
        // notes the sprint; it never drives answering. The fixture exposes both
        // .dash-timer and #dash-timer (likewise score/results) so either selector
        // resolves.
        dash_timer_css: DASH_TIMER_CSS,
        dash_score_css: DASH_SCORE_CSS,
        dash_results_css: DASH_RESULTS_CSS,

        // task page: Smart Lesson/Assessment and audio-task shapes. Audited against
        // the live app (Italian Smart Lesson + Listening/Dictation, 2026-10-30);
        // lib/detect-question.js carries the full markup notes, including why the
        // per-option ids are unusable and where EP ships the answers client-side.

        exit_button_css: 'button.exit-button',
        exit_continue_button_css: 'button.continue-button',

        // Dash (timed sprint, issue #230 closed 2026-11-21): live Dash runs showed
        // the real rounds are NOT the classic shape - choice rounds render a
        // multi-choice component on EP's QuizModel (gameMode null, isDash true,
        // 2026-11-19) and typed rounds reuse the classic pair on the same model
        // (2026-11-20, #272). The choice/typed readers answer exactly those
        // confirmed shapes (see lib/choice-state.js, lib/dash-typed-state.js);
        // the number-box capture (2026-11-20, #282) ships no answer and every
        // other Dash layout still refuses by name. The timer selector below
        // remains fixture-invented and is used only for the classic-path timed
        // warning/note; it never drives answering.
        continue_button_css: 'button#continue-button',

        // non-blocking feedback toast (injected by this script, not part of EP)
        toast_id: '__ep_toast',
    }

    // Startup owns signal cleanup until controls are ready. Keep stdin exclusive
    // to credential prompts; do not create the CLI reader during sign-in.
    let startupBrowser;
    let startupSignal = null;
    const exitCodeFor = signal => signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143;
    let startupShutdown = null;
    let legacyReady = false;
    const closeSignalBrowser = async () => {
        let timer;
        try {
            await Promise.race([
                closeLaunchedBrowser(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser shutdown timed out')), 3000); }),
            ]);
        } finally { clearTimeout(timer); }
    };
    let signalClose = closeSignalBrowser;
    // An attached (embedded) browser outlives the session: closing disconnects
    // from it rather than shutting the app's own browser shell down.
    const closeLaunchedBrowser = () => ownsBrowser ? startupBrowser.close() : Promise.resolve().then(() => startupBrowser.disconnect());
    const removeStartupSignals = () => {
        process.removeListener('SIGINT', onStartupInt);
        process.removeListener('SIGTERM', onStartupTerm);
        process.removeListener('SIGHUP', onStartupHup);
    };
    const shutdownStartup = () => {
        if (!startupBrowser || startupShutdown) return startupShutdown;
        startupShutdown = (async () => {
            try {
                // Ready legacy controls must drain before the browser-close timeout
                // starts. Startup still has only a browser to close.
                await require('./lib/browser-close-confirmation').closeAndConfirm(signalClose, onBrowserClosed);
            } catch {
                startupBrowser.process()?.kill();
                startupBrowser.disconnect();
            } finally {
                removeStartupSignals();
                process.exit(exitCodeFor(startupSignal));
            }
        })();
        return startupShutdown;
    };
    const onStartupSignal = signal => {
        if (startupSignal && legacyReady) {
            console.error('Second interrupt received; forcing browser shutdown. Pending work may not finish cleanup.');
            startupBrowser.process()?.kill();
            startupBrowser.disconnect();
            removeStartupSignals();
            process.exit(exitCodeFor(startupSignal));
        }
        if (legacyReady) console.log('Stopping and waiting for active work to finish. Interrupt again to force shutdown.');
        if (!startupSignal && !startupBrowser) console.log('Cancellation requested; waiting for browser launch before cleanup.');
        startupSignal ||= signal;
        // A raw credential prompt has no echo and must relinquish the terminal.
        if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
        shutdownStartup();
    };
    const onStartupInt = () => onStartupSignal('SIGINT');
    const onStartupTerm = () => onStartupSignal('SIGTERM');
    const onStartupHup = () => onStartupSignal('SIGHUP');
    process.on('SIGINT', onStartupInt);
    process.on('SIGTERM', onStartupTerm);
    process.on('SIGHUP', onStartupHup);
    // The desktop app attaches to its own embedded browser view instead of
    // launching a browser: connectBrowser hands over a Puppeteer connection
    // and selectPage picks the guest page out of it. An attached browser is
    // never this process's to kill, so closing disconnects instead.
    const ownsBrowser = !connectBrowser;
    return (ownsBrowser
        ? puppeteer.launch({
            // test boot: no visible window, and the endpoint is printed so the
            // test can attach
            headless: TEST_BOOT ? 'shell' : false,
            defaultViewport: null,
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        })
        : connectBrowser())
        .then(async browser => {
            startupBrowser = browser;
            if (startupSignal) return shutdownStartup();
            if (TEST_BOOT) console.log(`EP_WS_ENDPOINT=${browser.wsEndpoint()}`);
            const allPages = await browser.pages();
            const page = selectPage ? await selectPage(allPages, browser) : allPages[0];
            if (startupSignal) return shutdownStartup();
            if (!page) throw new Error('The browser opened no page to control.');

            /**
 * Finds the login button by its label text within the login form.
 * Avoids SSO/social buttons by requiring the button to be inside a <form>.
 * @returns {Promise<ElementHandle|null>} The login button handle or null if not found
 */
            const findLoginButton = async () => {
                const handles = await page.$$(DIR.login_button_css);
                for (const handle of handles) {
                    const label = await handle.evaluate((el, want) => {
                        if (!el.closest('form')) return null;
                        const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
                        return text.toLowerCase() === want.toLowerCase() ? text : null;
                    }, DIR.login_button_text).catch(() => null);
                    if (label !== null) {
                        for (const other of handles) if (other !== handle) await other.dispose().catch(() => { });
                        return handle;
                    }
                }
                for (const handle of handles) await handle.dispose().catch(() => { });
                return null;
            };

            /**
 * Navigates to the login page and waits for the login form to appear.
 * Verifies the form is on the expected host (iam.educationperfect.com) to prevent
 * credential submission on lookalike pages. Returns the resolved login button.
 * @returns {Promise<{loginButton: ElementHandle|null}|null>} Login form info or null if form not found/wrong host
 */
            let alreadyLoggedIn = false;
            const reachLoginForm = async () => {
                console.log('Opening EP page...');
                const navigationStartedAt = TEST_BOOT ? Date.now() : null;
                try {
                    await require('./lib/initial-login-navigation').navigateInitialLogin(page, DIR.login_url);
                } catch (error) {
                    // Report only after the bounded initial-login policy fails.
                    if (TEST_BOOT) require('./lib/test-navigation-cause').recordNavigationFailure(error, true, navigationStartedAt);
                    throw error; // Preserve the owner's original failure before cleanup.
                }
                console.log('Waiting for login page to load...');
                try {
                    // No retry loop on purpose: waitForFunction already keeps polling and
                    // follows the SPA's client-side redirects, so it covers the form appearing
                    // on a later host. A retry loop here would reload the page each time EP
                    // is merely slow, which is worse than one honest 60s wait.
                    // A profile that is already signed in (the desktop app keeps its
                    // session) never shows the form: the app shell is the other outcome,
                    // so either one ends the wait instead of idling for the full 60s.
                    const ready = await page.waitForFunction((username, home) => {
                        if (document.querySelector(username)) return 'form';
                        if (document.querySelector(home)) return 'session';
                        return false;
                    }, { timeout: 60000 }, DIR.username_css, DIR.home_css);
                    let outcome;
                    try { outcome = await ready.jsonValue(); }
                    finally { await ready.dispose(); }
                    if (outcome === 'session') {
                        alreadyLoggedIn = true;
                        console.log('Already logged in; skipping the login page.');
                        return null;
                    }
                } catch (e) {
                    console.error(`Login form (${DIR.username_css}) did not appear within 60s on ${new URL(page.url()).hostname || page.url()}: ${e.errors?.[0]?.message ?? e.message}`);
                    console.error('EP may have changed its login flow. The browser window stays open: log in manually there.');
                    return null;
                }

                const loginHost = new URL(page.url()).hostname;
                console.log(`Login form ready on ${loginHost}.`);
                if (loginHost !== DIR.login_host) {
                    // Never type credentials into an origin we did not expect, even if it
                    // serves elements that look like the login form: a lookalike on another
                    // host would receive the password. Manual login stays available.
                    console.warn(`Expected the login form on ${DIR.login_host}, but EP served it from ${loginHost}. ` +
                        'Not auto-filling credentials; log in manually in the browser window.');
                    return null;
                }

                const loginButton = await findLoginButton();
                if (loginButton === null) {
                    console.warn(`No "${DIR.login_button_text}" button found inside the login form; auto-login will submit with Enter instead.`);
                }
                return { loginButton };
            };

            /**
 * Fills in the loaded credentials and submits the login form currently on screen.
 * Whether the form is still there is confirmed just before typing: a manual sign-in
 * can complete while the credentials were being resolved (env vars and the keychain
 * involve no prompt; a terminal prompt is cancelled by a completed login), or in the
 * beat before the first keystroke lands, and page.type into the page a completed
 * login leaves behind has no login form to match - the throw that used to kill the
 * whole run (issue #27). One DOM read confirms form present, no session signal
 * (DIR.home_css) and the expected login host, right before the typing begins.
 *
 * The read and the typing are separate round trips to the browser, so a manual login
 * is still free to navigate between them: the typing is wrapped as a unit and a
 * navigation/detached-frame failure inside it abandons auto-login for the manual-login
 * path instead of rejecting the startup chain. A keystroke that did get through into a
 * page that then navigated is harmless - the document it landed in is gone.
 * @param {{loginButton: ElementHandle|null}} loginForm - From reachLoginForm
 * @returns {Promise<void>}
 */
            const attemptAutoLogin = async (loginForm) => {
                const fillGuard = await page.evaluate((userCss, homeCss) => ({
                    form: document.querySelector(userCss) !== null,
                    session: document.querySelector(homeCss) !== null,
                    host: location.hostname,
                }), DIR.username_css, DIR.home_css).catch(() => null);

                if (fillGuard === null) {
                    // The page state could not even be read: a navigation (e.g. a manual
                    // login just landing) is mid-flight. Nothing may be typed until it
                    // settles, and the user's login is already taking care of itself.
                    console.log('The login page state could not be verified before auto-login; skipping it. Log in manually in the browser window.');
                } else if (fillGuard.session) {
                    // A manual login got in first and the logged-in signal is already on
                    // screen: nothing to fill, the post-login wait below resolves at once.
                    console.log('The browser is already logged in; skipping auto-login.');
                } else if (!fillGuard.form) {
                    console.log('The login form is gone; skipping auto-login. If the session is not open yet, log in manually in the browser window.');
                } else if (fillGuard.host !== DIR.login_host) {
                    // The same oath reachLoginForm took: never type credentials into an
                    // origin EP did not serve this login form from - a lookalike there
                    // would receive the password.
                    console.log(`Expected the login form on ${DIR.login_host}, but EP served it from ${fillGuard.host}. Not auto-filling credentials there; log in manually in the browser window.`);
                } else {
                    const { loginButton } = loginForm;
                    // THIS FILLS IN YOUR DETAILS TO LOG IN AUTOMATICALLY
                    // (username/password only: SSO, Google, Microsoft, Clever and the reCAPTCHA
                    // on this page are left alone - users on those sign-in methods must log in
                    // manually, and no challenge is ever solved or bypassed here.)
                    console.log('Filling in login details...');
                    try {
                        // Verified typing: the desktop app's embedded webview
                        // guest silently drops synthetic keystrokes, so each
                        // field is read back and refilled through the DOM when
                        // the value did not land (lib/verified-typing.js).
                        await require('./lib/verified-typing').typeVerified(page, DIR.username_css, DIR.email);
                        await require('./lib/verified-typing').typeVerified(page, DIR.password_css, DIR.password);
                    } catch (e) {
                        // The form went away between the guard read above and the typing:
                        // a manual login navigated the page (Puppeteer reports this as a
                        // detached frame / destroyed execution context). That is the
                        // manual-login path, not a failure - report it and let the
                        // post-login wait below settle on whichever page is left.
                        console.log(`The login page changed while auto-login was filling it (${e.message}); leaving it to the manual login.`);
                        return;
                    }
                    // Submit through the form's own Log in button: the iam page POSTs to
                    // /oauth2/authorize, and a synthetic Enter only submits when focus lands in a
                    // field. The resolved handle is clicked, so an SSO/social button can never be
                    // hit by accident; Enter is the fallback when no such button exists.
                    console.log('Submitting login form...');
                    // The navigation waiter must exist BEFORE the click is dispatched: a fast
                    // successful redirect would otherwise happen before waitForNavigation
                    // starts observing, and the login would sit out the full 30s timeout.
                    // The catch is attached now rather than at the await so that a rejection
                    // during the password-field clear below is already handled and cannot
                    // surface as an unhandled rejection.
                    const navigation = page.waitForNavigation({ timeout: 30000 }).catch(() => {
                        // a failed login stays on the form (or shows an error/challenge there),
                        // so the timeout is not fatal: report it and let the user finish by hand.
                        console.warn('No navigation after submitting the login form; check the open browser window for an error or challenge.');
                    });
                    // Dispatch the click/Enter, then immediately clear the password field so the
                    // secret doesn't linger in the DOM during the navigation wait.
                    await (loginButton ? loginButton.click() : page.keyboard.press('Enter'));
                    await page.$eval(DIR.password_css, el => { el.value = ''; }).catch(() => { });
                    await navigation;

                    console.log('Waiting for home page to load...');
                    // wait for the app shell, so a slow dashboard is reported honestly instead
                    // of being called loaded the moment the login form disappears. Other routes
                    // (a task opened straight from an assignment link) also carry the shell.
                    const homeSeen = await page.waitForSelector(DIR.home_css, { timeout: 30000 }).then(() => true).catch(() => false);
                    console.log(homeSeen
                        ? `EP Home page loaded (${new URL(page.url()).pathname}); Logged in.`
                        : `Login did not reach the app shell (${DIR.home_css}) within 30s (now on ${new URL(page.url()).pathname}); finish signing in manually in the browser window.`);
                }
            };

            const loginForm = await reachLoginForm();
            // Owner readiness, not launch availability. No observer may attach before it.
            if (TEST_BOOT && loginForm !== null) console.log('EP_TEST_LOGIN_READY');

            // Whether the logged-in signal was already seen on the page before auto-login
            // could fill anything: a manual login raced the credential prompt (the prompt
            // is cancelled for exactly that) or arrived while the loaded credentials were
            // being put to use (the pre-type guard covers that). It steers the messages
            // below - an already-open session is reported ready, not as "no credentials" -
            // and joins the auto-login guard.
            let sessionDetected = alreadyLoggedIn;

            // The login watcher the credential prompt is raced against: resolves true the
            // moment the app shell mounts - DIR.home_css, the same signal the
            // end-of-startup wait below uses, and the one every manual login path (the
            // password form as well as school SSO, Google, Microsoft, Clever) produces.
            // EP's login bounces through several hosts before the session arrives, so a
            // wait killed by one of those navigations is re-armed rather than ending the
            // watch; the watch only stops for good when the page itself is gone.
            // @returns {Promise<boolean>}
            function watchForSession() {
                // Always a promise of a boolean: it is raced (racePromptAgainstLogin) or
                // awaited, never tested for truthiness.
                return sessionAppeared(page).then(seen => seen === true);
            }

            // The form script leaves a loading state behind when it fails (e.g. scripts
            // blocked): the fields render but the button can stay disabled. Report it so a
            // failed auto-login is explained, and leave the window for manual login.
            if (loginForm !== null) {
                const fieldsEnabled = await page.evaluate((userCss, passCss) => {
                    const field = (css) => {
                        const el = document.querySelector(css);
                        return el ? !el.disabled && !el.readOnly : false;
                    };
                    return field(userCss) && field(passCss);
                }, DIR.username_css, DIR.password_css).catch(() => false);
                // checked on the same handle that will be clicked
                const submitEnabled = loginForm.loginButton
                    ? await loginForm.loginButton.evaluate(el => !el.disabled).catch(() => false)
                    : false;
                if (!fieldsEnabled || !submitEnabled) {
                    console.warn(`Login form looks unusable (fields enabled: ${fieldsEnabled}, submit enabled: ${submitEnabled}); the login page's scripts may not have finished or are blocked.`);
                }
            }

            if (loginForm !== null) {
                // Resolved only once the expected login form is actually in front of us,
                // so a keychain read or a password prompt never happens for a run that
                // was going to stop at a lookalike host anyway. Called even when the env
                // vars are already set: that is where a half-set pair is reported. The
                // login watcher is passed along so the prompt is raced against a manual
                // login (see racePromptAgainstLogin).
                const credentials = await resolveCredentials(watchForSession);
                if (credentials !== null && !credentials.sessionDetected) {
                    console.log(`Auto-login credentials loaded from ${credentials.source}.`);
                    DIR.email = credentials.email;
                    DIR.password = credentials.password;
                } else if (credentials !== null) {
                    // The manual login won the race while the prompt was open: the prompt
                    // was cancelled invisibly (finish()'s cleanup, minus process.exit) and
                    // the run falls through to the normal post-login wait below.
                    sessionDetected = true;
                    console.log('Logged in manually in the browser; skipping the terminal prompt and auto-login.');
                }
            }

            if (DIR.email && DIR.password && loginForm !== null) {
                await attemptAutoLogin(loginForm);
            } else if (DIR.email && DIR.password && !sessionDetected) {
                // a lookalike host (see reachLoginForm): never auto-filled, and no keychain
                // read or prompt was ever done for it
                console.log('Auto-login skipped; finish signing in manually in the browser window.');
            } else if (sessionDetected) {
                // The login completed in the browser while the credential prompt was open
                // (or by the time resolved credentials were being put to use): report the
                // session as ready instead of claiming no credentials were given.
                console.log('Session ready: a login has already completed in the browser; continuing.');
            } else {
                console.log('No credentials provided; skipping auto-login. Log in manually in the opened browser window.');
            }
            // Either way, continue once a session is actually running: the manual branch waits
            // without a timeout here, exactly as before, and the auto branch has already been
            // given its 30s check above. When the session was detected already (the manual
            // login won its race), the element is on screen: this resolves at once and the
            // run proceeds.
            // The desktop app surfaces this phase in its window: the page is open and the
            // program is now waiting for a manual sign-in, which a bare "opening" spinner
            // misreports as the browser still starting.
            onStartupPhase('waiting-for-sign-in');
            await page.waitForSelector(DIR.home_css, { timeout: 0 });


            // ===== Auto-answer code starts here ===== //
            let TOGGLE = false;  // user intent: the loop should be answering right now
            let capturingAssessment = false;  // an Alt+I capture is in flight
            let RUNNING = null;  // promise handle of the run currently executing, or null
            let preserveSelectionModal = false; // do not erase an unclassified selection dialog
            let CLEANUP = null;  // promise of the most recent run's post-run modal cleanup
            let ENTER = true;
            let runReason = 'stopped';
            // Local-only task support report (tally of task types and outcomes, reason categories only).
            let supportReport = createSupportReport();
            let lastStop = null; // content-free stop info from the latest stopped round handler
            const supportSender = createSupportSender({ config: savedConfig, appVersion: require('./package.json').version });
            // Issue #222: per-run accuracy controller (target randomized per run).
            // Null when disabled (perfect). Created fresh in answerLoop so every
            // start() picks a new target in the band.
            let accuracyRun = null;
            // Classic first-try tracking: suppresses mistake injection on modal-driven
            // retries for the same question text (P1: --accuracy 0 must not typo forever).
            let accuracyClassicSeen = new Set();
            const accuracyStatus = () => {
                if (!accuracyConfig.enabled) return { enabled: false, target: 100 };
                if (!accuracyRun) return { enabled: true, min: accuracyConfig.min, max: accuracyConfig.max, fixedTarget: accuracyConfig.fixedTarget ?? null, target: null, attempts: 0, mistakes: 0, accuracy: null, source: accuracyConfig.source };
                return { enabled: true, min: accuracyConfig.min, max: accuracyConfig.max, fixedTarget: accuracyConfig.fixedTarget ?? null, target: accuracyRun.target, attempts: accuracyRun.stats.attempts, mistakes: accuracyRun.stats.mistakes, accuracy: accuracyRun.accuracy(), source: accuracyConfig.source };
            };
            const startAccuracyRun = () => {
                accuracyClassicSeen = new Set();
                if (!accuracyConfig.enabled) { accuracyRun = null; return null; }
                try {
                    accuracyRun = require('./lib/accuracy').createAccuracyRun(accuracyConfig);
                } catch { accuracyRun = null; return null; }
                console.log(`Accuracy target ${accuracyRun.target}% for this run (band ${accuracyConfig.min}-${accuracyConfig.max}%, ${accuracyConfig.source}).`);
                return accuracyRun;
            };
            // Human pacing (issue #221): one randomized wait per answered
            // question before its guarded submission, off by default; `delay on`
            // or EP_HUMAN_DELAY=on enables it.
            const humanDelay = createHumanDelay({ config: savedConfig.delay });
            const persistSetting = (name, value) => {
                if (TEST_BOOT || validationFlags) return;
                savedConfig[name] = value;
                try { writeConfig(savedConfig); }
                catch { console.warn('Settings changed for this session, but could not be saved. Check app storage permissions.'); }
            };
            const pendingReflectionCancellers = new Set();
            const onReflectionRequestCancel = cancel => {
                pendingReflectionCancellers.add(cancel);
                return () => pendingReflectionCancellers.delete(cancel);
            };
            const cancelReflectionRequests = () => {
                for (const cancel of [...pendingReflectionCancellers]) cancel();
            };

            // How long to wait for EP to move on to the next question after a submission.
            // EP round-trips (large class, slow backend, transient lag) can legitimately
            // exceed 5s, so a fixed 5s timeout used to abort the whole task on one slow
            // round. Keep generous, and retry the round once before giving up.
            const ADVANCE_TIMEOUT = TEST_BOOT && Number(process.env.EP_TEST_ADVANCE_TIMEOUT) > 0
                ? Number(process.env.EP_TEST_ADVANCE_TIMEOUT) : 15000;

            // question -> ordered candidate answers (most-preferred first), seeded from
            // the word lists and enriched by what wrong-answer modals prove.
            // Null prototypes: question text is external page content, and inherited
            // keys ("constructor" is a real Spanish vocab item) must never resolve to
            // Object.prototype members and masquerade as arrays or Sets.
            let candidatesDict = Object.create(null);
            let dashTimedThisRun = false;   // issue #230: classic-path run shows a dash timer
            let dashUnknownWarned = false;  // one-shot timed-guess warning per run
            // Issue #230 (classic-path only): on a timed classic round every guessed
            // answer costs clock a sprint cannot recover. Say so once, clearly,
            // instead of silently guessing through the sprint - whether the question
            // was never listed or every listed answer was already rejected.
            // Captured Dash choice/typed rounds never reach this warning: they read
            // the shipped answer and refuse by name when none exists.
            function warnDashGuess() {
                if (!dashTimedThisRun || dashUnknownWarned) return;
                dashUnknownWarned = true;
                console.warn('Timed task detected (dash timer) and the word list cannot answer this question: answers are learned from the wrong-answer modal and every guess burns the clock. Refresh Words on the task-starter page before starting a timed run.');
            }
            // question -> Set of answers EP has graded wrong this session. Without this,
            // a rejected answer was "learned" from its own wrong-answer modal and then
            // resubmitted forever: "io prendo" / "I take" looped incorrect indefinitely
            // because EP's grading wants the whole "I take, I get", not a comma-cut of it.
            let rejectedDict = Object.create(null);
            // question -> how many rounds in a row the loop has had nothing usable left
            // for it (all candidates rejected, or the correction modal unreadable).
            // Feeds the give-up guards in answerQuestions/correctAnswer.
            let futileDict = Object.create(null);
            // set when the futility guards trip; answerQuestions breaks on it at the top
            // of its next pass (correctAnswer cannot break the caller's loop itself)
            let futileStop = false;
            // the previous successful refresh's list content, so a refresh of a NEW
            // task's lists can reset session knowledge instead of carrying stale
            // rejections/futility across tasks
            let lastRefreshSignature = null;
            // The latest word-list refresh outcome, surfaced in status() so the
            // desktop window (and any other control surface) can show which list
            // is loaded without scraping the page again. Null until the first
            // refresh attempt in this session.
            let lastWordListRefresh = null;

            /**
 * Normalizes a string by removing parenthetical content and taking the first
 * segment separated by ; , or |. Used for question dictionary keys.
 * Single source lives in lib/question-keys (issue #234 punctuation skew).
 * @param {string} string
 * @returns {string}
 */
            function cleanString(string) {
                return cleanQuestionString(string);
            }

            // Symmetric key variants for "," vs ";" renderings ("eight, 8" vs
            // "eight; 8"). All dict reads/writes use this so a correction
            // learned under one rendering is found from the other (issue #234).
            // Local alias keeps the loop code short; logic lives in lib.
            const questionVariants = questionKeyVariants;

            /**
 * Generates the canonical key for a question's futility counter.
 * Uses the cleaned question text so all rendering variants share one counter.
 * @param {string} question
 * @returns {string}
 */
            function futileKey(question) {
                return cleanString(question);
            }

            /**
 * Registers candidate answers for a question under all key variants.
 * Returns true if new candidates were added (indicating fresh knowledge from a modal).
 * @param {string} question
 * @param {string} rawAnswer
 * @param {boolean} incomingFirst
 * @returns {boolean}
 */
            function learnEntry(question, rawAnswer, incomingFirst = true) {
                return learnDictEntry(candidatesDict, question, rawAnswer, incomingFirst);
            }

            /**
 * Records a bidirectional word-list pair (both directions answer each other).
 * Uses existing-first merge so refreshes don't demote modal-proven candidates.
 * @param {string} first
 * @param {string} second
 */
            function learnPair(first, second) {
                learnEntry(first, second, false);
                learnEntry(second, first, false);
            }

            /**
 * Records that an answer was graded wrong for a question, under all key variants.
 * Prevents the same wrong answer from being resubmitted.
 * @param {string} question
 * @param {string} answer
 */
            function recordRejection(question, answer) {
                recordDictRejection(rejectedDict, question, answer);
            }

            /**
 * Checks if an error indicates the page/frame has been destroyed or navigated away.
 * These errors are expected during normal operation (task completion, browser close)
 * and should be handled quietly rather than as crashes.
 * @param {Error|any} e
 * @returns {boolean}
 */
            function isPageGoneError(e) {
                const message = String((e && e.message) || e);
                return /detached Frame|Execution context was destroyed|Cannot find context|Target closed|Session closed|Browser has been closed|Navigating was not successful/i.test(message);
            }

            // The login watcher's body (see watchForSession in the startup flow, which
            // passes `page`): waits for the shell on `page`, re-arming after navigations.
            // It takes its signals as arguments so it can be tested without a browser.
            /**
     * Resolves true once the logged-in app shell is on the page, false once the page is gone.
     * @param {Page} page - The browser page to watch
     * @param {string} homeCss - The logged-in app-shell selector
     * @param {(e: any) => boolean} isGone - Page-closed test (isPageGoneError)
     * @param {number} retryDelayMs - Delay before re-arming after a navigation
     * @returns {Promise<boolean>}
     */
            async function sessionAppeared(page, homeCss = DIR.home_css, isGone = isPageGoneError, retryDelayMs = 100) {
                while (true) {
                    const seen = await page.waitForSelector(homeCss, { timeout: 0 }).then(() => true, e => e);
                    if (seen === true) return true;   // the app shell mounted: logged in
                    if (isGone(seen)) return false;   // no page left to watch
                    await new Promise(r => setTimeout(r, retryDelayMs));   // a navigation: re-arm
                }
            }

            /**
 * Scrapes word list entries from the task-starter page.
 * Uses innerText to respect visual rendering (one entry per line).
 * @param {string} selector
 * @returns {Promise<string[]>}
 */
            async function wordList(selector) {
                return await page.$$eval(selector, els => {
                    let words = [];
                    els.forEach(i => words.push(i.innerText));
                    return words;
                });
            }

            /**
 * Reads the current question text from the task page.
 * Returns null if the element is missing (round transition, navigation, task end).
 * Does not throw on missing elements.
 * @returns {Promise<string|null>}
 */
            async function readQuestionText() {
                try {
                    return await page.$eval(DIR.question_css, el => el.textContent);
                } catch (e) {
                    return null;
                }
            }

            // Dash-only guidance must not leak into classic tasks: the empty
            // and mismatch alerts are shared by both starters, so detect a
            // Dash starter (URL plus provisional markers) before appending
            // timed-sprint wording. Every probe failure keeps the generic wording.
            async function detectDashStarter() {
                try {
                    const url = page.url();
                    if (typeof url === 'string' && url.toLowerCase().includes('dash')) return true;
                } catch { /* keep generic on URL failure */ }
                try {
                    const found = await page.evaluate(detectDashInPage, DIR.dash_timer_css, DIR.dash_results_css);
                    if (found && found.isDash) return true;
                } catch { /* keep generic on evaluate failure */ }
                try {
                    return !!(await page.evaluate(() => !!document.querySelector('.dash-info')));
                } catch { /* keep generic on evaluate failure */ }
                return false;
            }

            /**
 * Scrapes and learns word pairs from the task-starter page.
 * Resets dictionaries if the lists have changed (new task), otherwise merges.
 * Reports the entry count via console and toast.
 * @returns {Promise<void>}
 */
            async function refreshWords() {
                const base = await wordList(DIR.baseList_css);
                const target = await wordList(DIR.targetList_css);
                const isDashStarter = await detectDashStarter();

                if (base.length !== target.length) {
                    lastWordListRefresh = { outcome: 'mismatch', entries: 0, base: base.length, target: target.length, at: new Date().toISOString() };
                    const baseMsg = `Word Lists Not Refreshed: ${base.length} base vs ${target.length} target entries; lists do not line up, so pairing them would teach wrong answers.`;
                    const mismatch = isDashStarter
                        ? `${baseMsg} On a timed Dash sprint a mismatched pairing also burns clock; fix the lists before starting the sprint.`
                        : `${baseMsg} Fix the lists before starting the task.`;
                    console.warn(mismatch);
                    await alert(mismatch);
                    return;
                }
                if (base.length === 0) {
                    lastWordListRefresh = { outcome: 'empty', entries: 0, base: 0, target: target.length, at: new Date().toISOString() };
                    const baseMsg = 'Word Lists Refreshed. 0 entries: no word lists found. Press Refresh Words on the task-starter page with the word lists visible.';
                    const empty = isDashStarter ? `${baseMsg} ${DASH_EMPTY_WORDLIST_NOTE}` : baseMsg;
                    console.warn(empty);
                    await alert(empty);
                    return;
                }

                // A refresh that brings DIFFERENT lists means a new task: the previous
                // task's rejections and futility counts would otherwise bleed into it and
                // exhaust reused questions without ever trying their new answers. Same
                // content (a re-scrape of the same task) keeps everything learned so far.
                const signature = JSON.stringify([base, target]);
                lastWordListRefresh = { outcome: 'refreshed', entries: base.length, base: base.length, target: target.length, changed: signature !== lastRefreshSignature, at: new Date().toISOString() };
                if (signature !== lastRefreshSignature) {
                    candidatesDict = Object.create(null);
                    rejectedDict = Object.create(null);
                    futileDict = Object.create(null);
                    futileStop = false;
                    lastRefreshSignature = signature;
                }

                const count = base.length;
                for (let i = 0; i < count; i++) {
                    learnPair(base[i], target[i]);
                }

                // report how many entries were scraped so a partial/empty scrape is diagnosable
                const msg = `Word Lists Refreshed. ${count} entries (${base.length} base, ${target.length} target).`;
                console.log(msg);
                await alert(msg);
            }


            /**
 * Extracts the user's submitted answer from the wrong-answer modal.
 * Reads per-word segments, skipping greyed-out (unanswered) portions.
 * @returns {Promise<string>}
 */
            async function getModalAnswered() {
                return await page.evaluate(() => {
                    const field = document.querySelector('td#users-answer-field');
                    if (!field) return '';
                    let answered = '';
                    field.querySelectorAll('*').forEach(i => {
                        if (i.textContent !== null && i.style.color !== 'rgba(0, 0, 0, 0.25)') answered = answered + i.textContent;
                    })
                    return answered;
                });
            }

            /**
 * Handles a wrong-answer modal: waits for it to load, learns the correct answer,
 * records the rejection, dismisses the modal, and updates futility counters.
 * @param {string} question - The question text as detected before submission
 * @param {string} answer - The answer that was submitted and graded wrong
 * @param {boolean} randomRound - Whether this round used a random string (affects futility counting)
 * @returns {Promise<boolean>} True if a correction was learned, false otherwise
 */
            async function correctAnswer(question, answer, randomRound = false) {
                // wait until the modal's question and correct answer have actually been
                // filled in. Both start as "&nbsp;" placeholders, which trim() to '', so
                // requiring non-empty text on both is the real readiness condition; the
                // old guard accepted anything that was merely "not blau" (one sample word)
                // and read empty placeholders into the dictionary permanently.
                let loaded = true;
                try {
                    await page.waitForFunction((qCss, aCss) => {
                        const q = document.querySelector(qCss);
                        const a = document.querySelector(aCss);
                        if (!q || !a) return false;
                        // an empty question is transitional too; accepting it would store the
                        // correction under "" and pollute every lookups that touch empty keys
                        return q.textContent.trim() !== '' && a.textContent.trim() !== '';
                    }, { timeout: 5000 }, DIR.modal_question_css, DIR.modal_correct_answer_css);
                } catch (e) {
                    loaded = false;
                }

                // extract modal contents (for debugging and correcting answers)
                const modal = await page.evaluate((qCss, aCss) => {
                    const q = document.querySelector(qCss);
                    const a = document.querySelector(aCss);
                    return {
                        question: q ? q.textContent : '',
                        answer: a ? a.textContent : '',
                    };
                }, DIR.modal_question_css, DIR.modal_correct_answer_css);
                const modalQuestion = modal.question;
                const modalAnswer = modal.answer;
                const modalCutAnswer = cleanString(modalAnswer);
                const modalAnswered = await getModalAnswered();

                // a missing/empty modal is not a correction; bail out and leave the dictionaries alone
                const modalsGone = await page.evaluate((css) => document.querySelectorAll(css).length === 0, DIR.modal_css);
                const modalCutQuestion = cleanString(modalQuestion);
                if (!loaded || modalsGone || modalCutAnswer === '' || modalCutQuestion === '') {
                    console.log(`Skipping answer correction for "${question}": ${modalsGone ? 'modal disappeared' : 'no usable question/answer'} (raw modal answer: "${modalAnswer}").`);
                    // The wrong-answer modal on screen DID prove the submission was rejected,
                    // but it yielded no readable correction — and without one, findAnswer
                    // would return the same candidate again and again (an unknown question
                    // would get a fresh random string each time). Count these toward the
                    // same futility bound so an unreadable modal cannot spin the loop
                    // forever. No rejection is recorded: keying it to `question` is
                    // unproven (round skew), and the count alone bounds the spin. A random
                    // submission round was already counted above, so this only counts
                    // rounds whose submission came from a real candidate.
                    if (!randomRound) {
                        const key = futileKey(question);
                        futileDict[key] = (futileDict[key] || 0) + 1;
                        if (futileDict[key] >= 4) {
                            futileStop = true;
                            const message = `EP's correction modal could not be read for "${question}" ${futileDict[key]} rounds in a row; stopping the loop.`;
                            console.error(message);
                            await alert(message);
                        }
                    }
                    return false;
                }

                // dismisses the modal (bypasses the required cooldown)
                const continueClicked = await page.evaluate((css) => {
                    const button = document.querySelector(css);
                    if (!button) return false;
                    button.disabled = false;
                    button.click();
                    return true;
                }, DIR.continue_button_css);
                if (!continueClicked) {
                    console.log('Continue button missing; deleting modal directly.');
                    await deleteModals();
                }

                // Learn ONLY the pairing the modal proves: EP grades the submission against
                // ITS question (modalQuestion), so modalQuestion -> modalAnswer is the one
                // verifiably true mapping. Writing the script-detected `question` here used
                // to poison the dictionary whenever the round advanced while the answer was
                // being typed: the detected question then belonged to an item different from
                // the one graded, and every later occurrence of those words was mis-answered
                // while "learning" wrote the wrong pairing back again.
                if (!/^(audio|typed|dash-typed):/.test(question) && modalQuestion !== question) {
                    console.warn(`Round skew: read question "${question}" but EP graded "${modalQuestion}". Learning only the graded pairing.`);
                }
                // EP just graded `answer` wrong for modalQuestion: that exact pairing must
                // never be resubmitted for this item. Recording it is what breaks the
                // infinite loop — the old code instead stored the comma-CUT answer (which
                // is the very string EP rejected) and resubmitted it forever.
                recordRejection(modalQuestion, answer);
                // The full answer EP displayed is canonical: learn it (and its built-in
                // alternatives) instead of only the cut, so the next pass escalates to the
                // form EP's grader actually wants.
                const learned = learnEntry(modalQuestion, modalAnswer);
                // Only a learn that added NEW candidates restarts this item's futility
                // meter: fresh escalation material is real progress. A readable modal
                // that repeats what is already stored (and already rejected) must leave
                // the count alone, or the all-rejected bound below could never be reached.
                if (learned) {
                    delete futileDict[futileKey(modalQuestion)];
                }

                // logging for debugging if needed
                let log = "===== Details after Incorrect Answer: =====\n"
                log = log + `Detected Question: \n => ${question}\n`;
                log = log + `Inputted Answer: \n => ${answer}\n\n`;
                log = log + `Modal Question: \n => ${modalQuestion}\n`;
                log = log + `Modal Full Answer: \n => ${modalAnswer}\n`;
                log = log + `Modal Cut Answer: \n => ${modalCutAnswer}\n`;
                log = log + `Modal Detected Answered: \n => ${modalAnswered}\n\n\n`;

                console.log(log);
                return true;
            }

            /**
 * Removes all modal windows and backdrops from the page.
 * Used to dismiss modals without waiting for EP's cooldown animations.
 * @returns {Promise<void>}
 */
            async function deleteModals() {
                await page.$$eval(DIR.modal_css, el => {
                    el.forEach(i => i.remove())
                });
                await page.$$eval(DIR.modal_backdrop_css, el => {
                    el.forEach(i => i.remove())
                });
            }

            /**
 * Finds the best candidate answer for a question.
 * Shared lookup lives in lib/classic-dict (issue #234 review); this wrapper
 * adds the unknown-probe logging/side effects.
 * Returns null if candidates exist but all were rejected (caller escalates).
 * Returns a random string if the question is completely unknown.
 * @param {string} question
 * @returns {string|null}
 */
            function findAnswer(question) {
                const { candidate, hadCandidates } = findDictCandidate(candidatesDict, rejectedDict, question);
                if (candidate !== null) return candidate;
                if (hadCandidates) return null;
                console.log(`No answer found for ${question}`);
                // Dictionary size alone is not the signal: entries may belong to a
                // different task, so the warning lives at the guess itself.
                warnDashGuess();
                return generateRandomString(8, 10);
            }

            /**
 * True when the dictionary holds any candidate for the question's variants.
 * Single source lives in lib/classic-dict; used to tag unknown probes
 * (findAnswer random strings) separately from all-rejected escalations.
 * @param {string} question
 * @returns {boolean}
 */
            function hasKnownCandidates(question) {
                return dictHasCandidates(candidatesDict, question);
            }

            /**
 * Generates a random alphanumeric string for probing unknown questions.
 * @param {number} minLength
 * @param {number} maxLength
 * @returns {string}
 */
            function generateRandomString(minLength, maxLength) {
                const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
                const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                let result = '';
                for (let i = 0; i < length; i++) {
                    result += characters.charAt(Math.floor(Math.random() * characters.length));
                }
                return result;
            }

            /**
 * Handles whatever modal is on screen after an answer submission.
 * Routes to correctAnswer for wrong-answer modals, clicks exit/continue for completion,
 * or deletes unknown modals.
 * @param {string} question
 * @param {string} answer
 * @param {boolean} randomRound
 * @returns {Promise<boolean>} False if task is complete, true to continue answering
 */
            async function handleModal(question, answer, randomRound = false) {
                // allow the modal a moment to render before deciding what it is
                await page.waitForSelector(DIR.modal_css, { timeout: 2000 }).catch(() => { });

                // incorrect answer and modal pops up; initiate answer-correction procedure
                if (await page.$(DIR.modal_question_css) !== null) {
                    await correctAnswer(question, answer, randomRound);
                    await deleteModals();
                } else if (await page.$(DIR.exit_button_css)) {
                    // list complete; clicks button to exit
                    await page.click(DIR.exit_button_css);
                    return false;
                } else if (await page.$(DIR.exit_continue_button_css)) {
                    await page.click(DIR.exit_continue_button_css);
                    return false;
                } else {
                    // no idea what the modal is for so let's just pretend it doesn't exist
                    await deleteModals();
                }
                return true;
            }

            /**
 * Waits for the round to advance past the previous question, or for a modal to appear.
 * Polls the question text and answer box value; a cleared box counts as advancement
 * only after a grace period (and never for random probes, issue #234).
 * Aborts cleanly if TOGGLE becomes false. Returns a status string.
 * @param {string} previous - The previous question text
 * @param {number} timeout - Timeout in ms (0 = no timeout)
 * @param {string} submitted - The answer that was submitted
 * @param {boolean} isRandomProbe - True when the submission was an unknown-probe random string
 * @returns {Promise<'advanced'|'modal'|'timeout'|'aborted'>}
 */
            const CLEAR_GRACE_MS = 2000;
            // A cleared box counts as advancement only after the grace period (and
            // never for random probes, issue #234). Tracks clearedSince on `tracker`.
            function clearedBoxAdvanced(tracker, submitted, box, isRandomProbe) {
                if (typeof submitted !== 'string' || box !== '' || isRandomProbe) {
                    tracker.clearedSince = null;
                    return false;
                }
                if (tracker.clearedSince === null) {
                    tracker.clearedSince = Date.now();
                    return false;
                }
                return Date.now() - tracker.clearedSince >= CLEAR_GRACE_MS;
            }

            async function waitForAdvance(previous, timeout, submitted, isRandomProbe = false) {
                const deadline = timeout > 0 ? Date.now() + timeout : Infinity;
                const tracker = { clearedSince: null };
                while (TOGGLE && Date.now() < deadline) {
                    if ((await detectQuestion(page))?.kind === 'unsupported') {
                        TOGGLE = false;
                        console.error('Classic practice context changed while waiting; stopping without further input.');
                        return 'aborted';
                    }
                    const state = await page.evaluate((qCss, mCss, aCss) => {
                        const q = document.querySelector(qCss);
                        const box = document.querySelector(aCss);
                        return {
                            question: q ? q.textContent : null,
                            modal: document.querySelector(mCss) !== null,
                            box: box ? box.value : null,
                        };
                    }, DIR.question_css, DIR.modal_css, DIR.answer_box_css);

                    if (state.modal) return 'modal';
                    if (state.question === null || state.question !== previous) return 'advanced';
                    if (clearedBoxAdvanced(tracker, submitted, state.box, isRandomProbe)) return 'advanced';
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                return TOGGLE ? 'timeout' : 'aborted';
            }

            /**
 * Reads the answer box's current value.
 * Returns null if the box is not rendered (transitional state between rounds).
 * Does not throw on missing elements.
 * @returns {Promise<string|null>}
 */
            async function answerBoxValue() {
                try {
                    return await page.$eval(DIR.answer_box_css, el => el.value);
                } catch (e) {
                    return null;
                }
            }

            /**
 * Focuses and clears the answer box, verifying it's empty before returning.
 * Retries up to 5 times with alternating triple-click and Ctrl+A to handle
 * EP's asynchronous content restoration.
 * @returns {Promise<boolean>} True if box is empty, false if box missing or content persisted
 */
            // A revoked stop permission flips TOGGLE off and fails the clear.
            async function stillAllowed(allowed) {
                if (!allowed || await allowed()) return true;
                TOGGLE = false;
                return false;
            }

            // The mouse triple-click selection can be swallowed by the page;
            // select-all via the keyboard is a different code path. The chord
            // is sent as explicit modifier/key presses, not a "Control+a"
            // combo string whose parsing varies between Puppeteer versions,
            // and a failure to send it must not kill the run: the
            // triple-click + Backspace still applies.
            async function selectAllChord() {
                await page.keyboard.down('Control').catch(() => { });
                await page.keyboard.press('a').catch(() => { });
                await page.keyboard.up('Control').catch(() => { });
            }

            // Empty after clearing: no content means no restore can surface, so
            // skip the settle beat when the box started empty (the common case);
            // otherwise wait a beat so an EP restore lands before typing starts.
            async function boxStayedEmpty(before) {
                if (before === '') return true;
                await new Promise(resolve => setTimeout(resolve, 20));
                return (await answerBoxValue()) === '';
            }

            async function clearAnswerBox(allowed) {
                for (let attempt = 0; attempt < 5; attempt++) {
                    const before = await answerBoxValue();
                    if (before === null) return false;
                    if (!await stillAllowed(allowed)) return false;
                    await page.click(DIR.answer_box_css, { clickCount: 3 }).catch(() => { });
                    if (!await stillAllowed(allowed)) return false;
                    if (attempt % 2 === 1) await selectAllChord();
                    if (!await stillAllowed(allowed)) return false;
                    await page.keyboard.press('Backspace');
                    const value = await answerBoxValue();
                    if (value === null) return false;
                    if (value === '') return boxStayedEmpty(before);
                    // content survived/reappeared (restored asynchronously); pause so this
                    // round's restore lands, then check and clear again
                    await new Promise(resolve => setTimeout(resolve, 40));
                }
                return false;
            }

            /**
 * Reads the answer box until its value stabilizes (two consecutive reads match).
 * Handles EP's late keystroke processing by confirming the value holds.
 * @param {string} answer - The expected answer
 * @returns {Promise<string|null>} The settled value, or null if box vanished
 */
            async function readSettledBox(answer) {
                let previous = null;
                for (let i = 0; i < 8; i++) {
                    const value = await answerBoxValue();
                    if (value === null) return value;
                    if (value === previous) return value; // stabilized without matching
                    if (boxMatchesAnswer(answer, value)) {
                        await new Promise(resolve => setTimeout(resolve, 25));
                        const confirm = await answerBoxValue();
                        if (boxMatchesAnswer(answer, confirm)) return value; // matched and held (EP may IME-normalize punctuation)
                        previous = confirm; // changed after the match: keep settling
                        continue;
                    }
                    previous = value;
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return previous;
            }

            /**
 * Per-keystroke pause when typing an answer. Zero-gap keystrokes race EP's own
 * input handling, which re-applies the value it last committed to the box at
 * unpredictable moments — grafting snapshots of old text into the middle of the
 * fresh one, so "I speak" arrived as "I I sI speakeakat". Spacing the keystrokes
 * gives EP's handling time to keep up, the way it does for human typing. 20ms
 * keeps a 7-character word under 0.2s, and any attempt that still garbles is
 * caught by enterAnswer's verification and retried with an escalated delay.
 */
            const TYPE_DELAY_MS = 20;

            /**
 * Types an answer into the answer box and verifies it was entered correctly.
 * Uses real keyboard events with spaced keystrokes. Escalates delay on retries.
 * @param {string} answer
 * @returns {Promise<boolean>} True if answer was entered and verified, false if box vanished
 * @throws {Error} If answer could not be entered after all retries
 */
            async function enterAnswer(answer, allowed = async () => (await detectQuestion(page))?.kind === 'text') {
                const delays = [TYPE_DELAY_MS, TYPE_DELAY_MS * 3, TYPE_DELAY_MS * 8];
                for (const delay of delays) {
                    if (!await allowed()) { TOGGLE = false; console.error('Answer context changed; stopping before further input.'); return false; }
                    if (!await clearAnswerBox(allowed)) {
                        // Never type into an uncleared box: EP-restored text would combine
                        // with the fresh keystrokes. A vanished box is a round transition
                        // (the caller re-reads it); otherwise clear again on the next attempt.
                        if (await answerBoxValue() === null) return false;
                        continue;
                    }
                    if (!TOGGLE) return false;

                    for (const character of answer) {
                        if (!TOGGLE) return false;
                        if (!await allowed()) { TOGGLE = false; console.error('Answer context changed; stopping before further input.'); return false; }
                        await page.keyboard.type(character, { delay });
                    }
                    if (!TOGGLE) return false;
                    const typed = await readSettledBox(answer);
                    if (boxMatchesAnswer(answer, typed)) {
                        if (typed !== answer) console.log(`Answer box holds EP-normalized punctuation; expected "${answer}", got "${typed}". Submitting as-is.`);
                        return true;
                    }
                    if (typed === null) return false; // box vanished mid-attempt (round transition)
                    console.log(`Answer box mismatch; expected "${answer}", got "${typed}". Retrying.`);
                }
                throw new Error(`Could not enter answer "${answer}" (box contains "${await answerBoxValue()}").`);
            }

            // non-text item key -> submissions attempted this run (the per-item bound
            // in handleTypedRound; keys are contentID+questionIndex+mode, so entries
            // never bleed across items or runs)
            const typedSubmissionsByKey = new Map();

            // the last (question, answer) submitted in the current run. A round whose
            // submission is still on screen must not be resubmitted blindly — the stall
            // guard below checks for exactly that. Cleared whenever a modal is handled,
            // since that means the round resolved.
            let lastSubmitted = null;

            /**
 * Resolves the current modal and prepares for the next round.
 * Clears the lastSubmitted tracker on modal resolution so a repeated question
 * isn't treated as a resubmission stall.
 * @param {string} question
 * @param {string} answer
 * @param {boolean} randomRound
 * @returns {Promise<boolean>} False if task completed, true to continue
 */
            async function handleModalAndContinue(question, answer, randomRound = false) {
                const keepGoing = await handleModal(question, answer, randomRound);
                if (!keepGoing) return false;
                if (TOGGLE) {
                    // a modal means the round resolved, so the next pass is a fresh round and the
                    // stall guard must not treat a recurring question as a resubmission
                    lastSubmitted = null;
                }
                return TOGGLE;
            }

            /**
 * Waits for a non-text round to advance past the current item, or for a modal.
 * Mirrors waitForAdvance, but the round's identity is the detected question key:
 * audio and lesson items have no #question-text to compare.
 * @param {string} key - descriptor.key of the submitted item
 * @param {number} timeout - Timeout in ms (0 = no timeout)
 * @param {string} submitted - The answer that was submitted
 * @returns {Promise<'advanced'|'modal'|'timeout'|'aborted'>}
 */
            const enterClassic = async (question, answer, enter) => {
                // The paced wait (issue #221) lands before guardClassicEnter's
                // own question/value re-reads, and ENTER is re-read after the
                // wait so a switch to semi mid-wait cancels the press.
                if (enter) await humanDelay.beforeSubmit('text');
                return guardClassicEnter({
                    readQuestion: () => detectQuestion(page), readValue: answerBoxValue,
                    pressEnter: () => page.keyboard.press('Enter'), shouldStop: () => !TOGGLE,
                    question, answer, enter: enter && ENTER,
                });
            };

            async function waitContextLost(current, key, allowed) {
                if (current?.kind === 'unsupported') return true;
                if (current?.key !== key || !allowed) return false;
                return !await allowed(current);
            }

            async function waitForAdvanceKey(key, timeout, submitted, allowed) {
                const deadline = timeout > 0 ? Date.now() + timeout : Infinity;
                while (TOGGLE && Date.now() < deadline) {
                    if (await page.$(DIR.modal_css) !== null) return 'modal';
                    const current = await detectQuestion(page);
                    if (await waitContextLost(current, key, allowed)) {
                        TOGGLE = false;
                        console.error('Answer context changed while waiting; stopping without further input.');
                        return 'aborted';
                    }
                    if (current === null) {
                        // a transition, or the task ended: only the VISIBLE completion
                        // controls prove completion (they exist hidden on every round)
                        const complete = await page.evaluate((exitCss, contCss) => {
                            const shown = (css) => {
                                const el = document.querySelector(css);
                                return !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
                            };
                            return shown(exitCss) || shown(contCss);
                        }, DIR.exit_button_css, DIR.exit_continue_button_css).catch(() => false);
                        if (complete) return 'advanced';
                    } else if (typeof current.key === 'string' && current.key !== key) {
                        return 'advanced';
                    }
                    // A cleared answer box is deliberately NOT an advance signal here
                    // (unlike the classic path): if EP rejects a typed audio/lesson
                    // answer by clearing the box while keeping the same item on screen,
                    // treating the clear as advancement would resubmit the same answer
                    // forever. Advancement is a changed question key, a modal, or
                    // completion - nothing else.
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                return TOGGLE ? 'timeout' : 'aborted';
            }

            /**
 * Plays one round of an audio (Listening/Dictation), lesson short-answer, or
 * Dash timed-sprint typed question (issue #273).
 * The accepted answers ship in EP's client-side question state (verified live
 * 2026-10-30 for Listening/Dictation; the lesson short-answer shape is
 * extrapolated, not live-verified; the #272-captured Dash validAnswers shape
 * was verified live 2026-11-20), so the round is: type the first shipped
 * answer EP hasn't rejected,
 * submit, wait for the item to change. No random probing - the answers come from
 * EP itself, so if every one is rejected the item is broken, not unknown, and the
 * run stops and reports instead of guessing (issue #32's fail-loudly rule).
 * Dash shares this path (no word-list lookup, no random probe: every blind
 * guess burns sprint score, so a round with no usable shipped answer stops
 * instead of mistyping) with the typed 4-10s human-paced range.
 * @param {object} descriptor - audio/typed/dash-typed descriptor from detectQuestion
 * @returns {Promise<boolean>} False to stop the run, true to keep looping
 */
            async function handleTypedRound(descriptor) {
                const key = descriptor.key;
                const isDashTyped = descriptor.kind === 'dash-typed';
                // Marking gate. Lesson short-answer is strict: the flag (captured
                // as a real boolean on a Smart Lesson, 2026-10-30) must be
                // explicitly true. List audio tasks ship no sectionData at all
                // (captured on Listening), so audio is allowed either by an
                // explicit true flag, a source-grounded assigned classic translation
                // context, OR by positive identification of the
                // captured self-test list context (contentSource.selectedActivity
                // with _taskID null, _activityType 1, _contentType 1 - see
                // detect-question.js; the no-teacher-marking-surface reading of
                // that shape is a documented inference, not a proof). An explicit
                // false, an assigned task, or any unknown context stops the run.
                // Dash has no sectionData/activityGroup, so the Smart Lesson
                // flag proof does not apply there; the proof is client-side
                // instead (EP's quiz page marks through its own marking manager,
                // public chunk 171, and the reader only accepts the captured
                // isDash QuizModel shape).
                if (descriptor.kind === 'audio') {
                    // the list allowance substitutes ONLY for the captured live
                    // shape: sectionData genuinely ABSENT. A present but
                    // unreadable/malformed sectionData never borrows it.
                    const allowed = audioAllowed(descriptor);
                    if (!allowed) {
                        const message = descriptor.autoMarked === false
                            ? 'This audio task is marked manually (self/peer/teacher), not auto-marked by EP; stopping instead of answering.'
                            : 'EP did not confirm this audio task is auto-marked or a self-test list (the marking fields were missing or unreadable); stopping instead of answering.';
                        console.error(message);
                        await alert(message);
                        return false;
                    }
                } else if (descriptor.autoMarked !== true) {
                    const message = descriptor.autoMarked === false
                        ? isDashTyped
                            ? 'This Dash sprint round is marked manually (self/peer/teacher), not auto-marked by EP; stopping instead of answering.'
                            : 'This lesson question is marked manually (self/peer/teacher), not auto-marked by EP; stopping instead of answering.'
                        : isDashTyped
                            ? 'EP did not confirm this Dash sprint round is auto-marked (the marking field was missing or unreadable); stopping instead of answering.'
                            : 'EP did not confirm this lesson question is auto-marked (the marking field was missing or unreadable); stopping instead of answering.';
                    console.error(message);
                    await alert(message);
                    return false;
                }
                // Bound the submissions any single item can get in one run. The
                // advance wait below treats only a changed question key, a modal, or
                // completion as progress, so an item that quietly rejects (cleared
                // box, same question) would otherwise be resubmitted without limit.
                // Two attempts mirror the classic path's submit-once-plus-one-retry.
                const submissions = typedSubmissionsByKey.get(key) || 0;
                if (submissions >= 2) {
                    const message = `EP has not accepted ${submissions} submissions for ${key}; stopping instead of resubmitting.`;
                    console.error(message);
                    await alert(message);
                    return false;
                }
                const answers = (descriptor.answers || []).filter(a => typeof a === 'string' && a.trim() !== '');
                const rejected = rejectedDict[key] || new Set();
                const correct = answers.find(a => !rejected.has(a));
                if (correct === undefined) {
                    const message = answers.length === 0
                        ? isDashTyped
                            ? `This Dash sprint round ships no accepted answers to answer with; stopping instead of guessing.`
                            : `This ${descriptor.kind === 'audio' ? 'audio' : 'lesson'} question ships no accepted answers to answer with (it may be manually marked); stopping instead of guessing.`
                        : `EP rejected every shipped answer for ${key}; stopping instead of guessing.`;
                    console.error(message);
                    await alert(message);
                    return false;
                }
                // Issue #222: occasional human-like typo on the FIRST submission only
                // (auto mode). The retry for the same key always uses the correct
                // answer, so an intentional mistake costs one modal then completes.
                // On Dash a mistake is expected (unproved live) to burn sprint
                // time/points; perfect stays the provisional recommendation.
                // Policy/context checks below keep using `correct`; only the typed
                // and submitted value may be the typo. The first-try stat is recorded
                // only after a confirmed submission so vanished boxes or changed
                // questions never inflate the displayed rate.
                let submitAnswer = correct;
                let intentionalMistake = false;
                let accuracyPending = null;
                if (accuracyRun && ENTER && submissions === 0) {
                    try {
                        if (accuracyRun.shouldMistake()) {
                            const { makeTypoFor } = require('./lib/accuracy');
                            const typo = makeTypoFor(correct, answers);
                            if (typo && typo !== correct) {
                                console.log(`Accuracy mistake for ${key}: submitting "${typo}" instead of "${correct}" (target ${accuracyRun.target}%).`);
                                submitAnswer = typo;
                                intentionalMistake = true;
                            }
                            accuracyPending = intentionalMistake;
                        } else {
                            accuracyPending = false;
                        }
                    } catch {
                        submitAnswer = correct;
                        accuracyPending = null;
                    }
                }

                const contextUnchanged = async (current = undefined) => {
                    if (current === undefined) current = await detectQuestion(page);
                    return descriptor.kind === 'audio' ? audioPolicyUnchanged(descriptor, current, correct)
                        : current?.kind === descriptor.kind && current.key === key && current.autoMarked === true && current.answers?.includes(correct);
                };
                if (!await contextUnchanged()) return false;
                if (isDashTyped) console.log(`Answering Dash typed round ${key} from EP's shipped answers.`);
                else console.log(`Answering ${descriptor.kind === 'audio' ? 'audio' : 'lesson'} question ${key} from EP's shipped answers.`);
                if (!await enterAnswer(submitAnswer, contextUnchanged)) {
                    // the box vanished mid-entry: a round transition; the next pass re-detects
                    console.log('Answer box vanished while answering; re-detecting the question.');
                    return true;
                }
                if (!TOGGLE) return false;

                // the item can swap while the answer is being typed (the same round
                // skew the classic path guards against): re-detect before submitting
                const fresh = await detectQuestion(page);
                if (fresh === null || fresh.kind === 'text' || fresh.key !== key) {
                    console.log(`Question changed while typing (${key}); looking the answer up again on the next pass.`);
                    return true;
                }

                if (descriptor.kind === 'audio' && !audioPolicyUnchanged(descriptor, fresh, correct)) {
                    console.error('Audio marking or task context changed while typing; stopping without submission.');
                    return false;
                }

                // The paced wait (issue #221) runs BEFORE the final rechecks so
                // the context and box-value guards still hold at Enter time.
                // Dash typed shares the typed 4-10s range; delay off stays the
                // provisional max-score recommendation on a timed clock.
                if (ENTER) await humanDelay.beforeSubmit(isDashTyped ? 'typed' : descriptor.kind);
                // Recheck the actual value after scope detection, immediately
                // before Enter. No submission slot is consumed by a lost box.
                if (!await contextUnchanged()) return false;
                if (!boxMatchesAnswer(submitAnswer, await answerBoxValue()) || !TOGGLE) return true;
                // Re-reading ENTER after the wait cancels the press when the
                // user switched to semi mid-wait.
                if (ENTER) {
                    typedSubmissionsByKey.set(key, submissions + 1);
                    await page.keyboard.press('Enter');
                    if (accuracyPending !== null && accuracyRun) {
                        try { accuracyRun.recordFirstTry(accuracyPending); } catch { /* never break answering on stats */ }
                    }
                    accuracyPending = null;
                }
                lastSubmitted = { question: key, answer: submitAnswer };

                let outcome = await waitForAdvanceKey(key, ENTER ? ADVANCE_TIMEOUT : 0, submitAnswer, contextUnchanged);
                if (outcome === 'timeout' && ENTER) {
                    const beforeRetry = await detectQuestion(page);
                    if (descriptor.kind === 'audio' && !audioPolicyUnchanged(descriptor, beforeRetry, correct)) {
                        console.error('Audio marking or task context changed before retry; stopping.');
                        return false;
                    }
                    if (!await contextUnchanged()) return false;
                    // same single-retry policy as the classic path: EP can swallow
                    // an Enter. But a quiet rejection CLEARS the box, so never
                    // retry blind: re-read it and retype the exact answer first,
                    // otherwise the retry submits an empty box.
                    console.log(`Question ${key} did not advance within ${ADVANCE_TIMEOUT}ms; retrying the submission once.`);
                    await page.click(DIR.answer_box_css).catch(() => { });
                    if (!TOGGLE) return false;
                    const inBox = await page.$eval(DIR.answer_box_css, el => el.value).catch(() => null);
                    if (inBox === null) {
                        console.log('Answer box vanished before the retry; re-detecting the question.');
                        return true;
                    }
                    // Retry always uses the correct answer: a first-try typo must not be
                    // resubmitted, otherwise --accuracy 0 would loop typos on timeouts.
                    // A box holding EP's IME-normalized punctuation still verifies.
                    if (!boxMatchesAnswer(correct, inBox)) {
                        console.log(inBox === ''
                            ? 'The answer box was cleared after the submission (quiet rejection); retyping the answer for the retry.'
                            : 'The answer box content changed after the submission; retyping the answer for the retry.');
                        if (!await enterAnswer(correct, contextUnchanged)) {
                            console.log('Answer box vanished while retyping; re-detecting the question.');
                            return true;
                        }
                        if (!TOGGLE) return false;
                    }
                    const retryQuestion = await detectQuestion(page);
                    if (!retryQuestion || retryQuestion.key !== key) return true;
                    if (descriptor.kind === 'audio' && !audioPolicyUnchanged(descriptor, retryQuestion, correct)) {
                        console.error('Audio marking or task context changed while retyping; stopping without submission.');
                        return false;
                    }
                    if (!await contextUnchanged()) return false;
                    if (!boxMatchesAnswer(correct, await answerBoxValue()) || !TOGGLE) return true;
                    const retryCount = typedSubmissionsByKey.get(key) || 0;
                    if (retryCount >= 2) {
                        const message = `EP has not accepted ${retryCount} submissions for ${key}; stopping instead of resubmitting.`;
                        console.error(message);
                        await alert(message);
                        return false;
                    }
                    typedSubmissionsByKey.set(key, retryCount + 1);
                    await page.keyboard.press('Enter');
                    // The retry dispatched the correct answer: a modal from here on
                    // rejects THAT value, so the rejection bookkeeping below must
                    // blame it rather than the first-try typo.
                    submitAnswer = correct;
                    outcome = await waitForAdvanceKey(key, ADVANCE_TIMEOUT, correct, contextUnchanged);
                    if (outcome === 'timeout') {
                        console.error(`Question ${key} did not advance after submitting its answer. Stopping.`);
                        await alert(`Answer loop stopped: ${key} did not advance.`);
                        return false;
                    }
                }
                if (outcome === 'timeout' && !ENTER) {
                    // semi-auto: the answer is typed and awaiting the user's Enter
                    console.log(`Waiting for the answer to ${key} to be submitted.`);
                    outcome = await waitForAdvanceKey(key, 0, submitAnswer, contextUnchanged);
                }
                if (outcome === 'aborted') return false;
                if (outcome === 'modal') {
                    // the modal proves this shipped answer was rejected: record that and
                    // learn whatever correction it shows, then try the remaining answers
                    recordRejection(key, submitAnswer);
                    return await handleModalAndContinue(key, submitAnswer, false);
                }
                return TOGGLE;
            }

            /**
             * Plays one round of a Dash timed-sprint typed question (issue #273).
             * Thin wrapper over the shared shipped-answer path: the #272-captured
             * validAnswers shape reuses the classic typing/verify/submit mechanics
             * bound to the Dash round key (fail-closed, no word-list lookup, no
             * random probe). The marking gate, answer selection and pacing live
             * in handleTypedRound's dash-typed branch; this wrapper only emits
             * the once-per-run sprint notice.
             * @param {object} descriptor - dash-typed descriptor from detectQuestion
             * @returns {Promise<boolean>} False to stop the run, true to keep looping
             */
            async function handleDashTypedRound(descriptor) {
                await noteDashOnce();
                return handleTypedRound(descriptor);
            }

            // The non-text question handlers, dispatched from answerQuestions by the
            // detected descriptor's kind (issue #33's QUESTION_HANDLERS). Detection is
            // deliberately shared per-round in detectQuestion: a round must be
            // classified atomically (and re-detected for stabilization), not probed by
            // each handler in turn. Each handler plays one round from the descriptor
            // and returns false to stop the run, true to keep looping.
            const QUESTION_HANDLERS = [
                { type: 'choice', play: playSelectionDescriptorRound },
                { type: 'gaps', play: playSelectionDescriptorRound },
                { type: 'textbox', play: playSelectionDescriptorRound },
                { type: 'numberbox', play: playSelectionDescriptorRound },
                { type: 'dropdown', play: playSelectionDescriptorRound },
                { type: 'dropdown-numberbox', play: playSelectionDescriptorRound },
                { type: 'slide-surfaces', play: playSelectionDescriptorRound },
                { type: 'reflection', play: playSelectionDescriptorRound },
                { type: 'highlight', play: playSelectionDescriptorRound },
                { type: 'workingformula', play: playSelectionDescriptorRound },
                { type: 'info-slide', play: playInfoSlideDescriptorRound },
                { type: 'audio', play: handleTypedRound },
                { type: 'typed', play: handleTypedRound },
                { type: 'dash-typed', play: handleDashTypedRound },
            ];

            /**
 * Plays one round of a non-text question (Smart Lesson slide, audio task
 * or Dash typed round).
 * Every refusal path stops and reports rather than guessing (issue #33).
 * @param {object} descriptor - non-text descriptor from detectQuestion
 * @returns {Promise<boolean>} False to stop the run, true to keep looping
 */
            async function handleNonTextRound(descriptor) {
                if (!TOGGLE) return false;
                if (descriptor.kind === 'unsupported') {
                    // Refusal sites that carry no shape of their own get a read-only probe of the page, so the report still says what the slide was.
                    const shapeProbe = needsShapeProbe(descriptor) ? await readUnsupportedShape(page) : null;
                    supportReport.record('unsupported', 'refused', 'unsupported-question', describeUnsupported(descriptor, shapeProbe));
                    if (descriptor.diagnostic) console.error('Unsupported question diagnostic ' + JSON.stringify(descriptor.diagnostic));
                    console.error(descriptor.reason);
                    await alert(descriptor.reason);
                    return false;
                }
                const handler = QUESTION_HANDLERS.find(h => h.type === descriptor.kind);
                if (!handler) {
                    supportReport.record(descriptor.kind, 'refused', 'no-handler');
                    const message = `No question handler is registered for "${descriptor.kind}"; stopping instead of guessing.`;
                    console.error(message);
                    await alert(message);
                    return false;
                }
                lastStop = null;
                const played = await handler.play(descriptor);
                if (played) supportReport.record(descriptor.kind, 'answered');
                else if (!TOGGLE) supportReport.record(descriptor.kind, 'skipped', 'stopped-by-user');
                else {
                    // A stopped round handler leaves its content-free reason, phase and guard; probe the page's shape too.
                    // Handlers that leave no stop info (info slides, typed rounds) still report the page's shape with guard unknown.
                    let stopDetail;
                    try { stopDetail = describeHandlerStop(lastStop, await readUnsupportedShape(page)); } catch { stopDetail = describeHandlerStop(lastStop, null); }
                    supportReport.record(descriptor.kind, 'refused', 'handler-stopped', stopDetail);
                }
                return played;
            }

            /**
 * Shared outcome mapping for the selection and information-slide round
 * handlers: advanced/aborted pass through, completion requires task proof,
 * a modal goes through the verified section-transition machinery, and any
 * other status stops the run with its message. Extracted so both handlers
 * run the identical mapping (issue #327).
 * @param {object} result - the round handler's outcome
 * @param {object} again - the re-detected descriptor for this round
 * @param {object} modalBaseline - captureSelectionBaseline handle for this round
 * @param {string} modalLabel - word naming the round in the modal diagnostic line
 * @param {string} roundLabel - label used in the modal stop messages
 * @param {string} modalNote - extra sentence in the modal stop message ('' when none)
 * @returns {Promise<boolean>} False to stop the run, true to keep looping
 */
            async function mapCompleteOutcome() {
                if (await taskCompletionProven()) {
                    runReason = 'completed';
                    console.log('Lesson completed.');
                } else if (TOGGLE) {
                    const message = 'A Continue screen appeared without proof of task completion; stopping the run.';
                    console.error(message);
                    await alert(message);
                }
                return false;
            }

            async function mapModalOutcome(again, modalBaseline, modalLabel, roundLabel, modalNote) {
                preserveSelectionModal=true;
                const modalDiagnostic=await inspectSelectionModal(page,again,modalBaseline);
                if(!TOGGLE)return false;
                console.error(modalLabel+' modal diagnostic '+JSON.stringify(modalDiagnostic));
                if(modalDiagnostic.guard==='section-next-action-required'){
                    const sectionResult=await advanceSelectionSection(page,again,modalBaseline,{shouldStop:()=>!TOGGLE,timeout:ADVANCE_TIMEOUT});
                    console.log('Section transition diagnostic '+JSON.stringify(sectionResult));
                    if(!TOGGLE)return false;
                    if(sectionResult.guard==='next-section-verified'){
                        // Detect the new question read-only before allowing the next
                        // normal round to run its own complete fresh safety checks.
                        const nextQuestion=await detectQuestion(page);
                        if(nextQuestion&&nextQuestion.kind!=='unsupported'&&nextQuestion.key!==again.key){
                            console.log('Verified the next section and a new question.');
                            return TOGGLE;
                        }
                        console.error('The next section opened without a supported new question; stopping.');
                        return false;
                    }
                }
                console.error(`A modal appeared during the ${roundLabel} round; stopping so it can be checked.${modalNote} The dialog is left open.`);
                await alert(`A modal interrupted the ${roundLabel} round; stopping the run.`);
                return false;
            }

            async function mapRoundOutcome(result, again, modalBaseline, modalLabel, roundLabel, modalNote) {
                if (result.status === 'advanced') return TOGGLE;
                if (result.status === 'aborted') return false;
                if (result.status === 'complete') return mapCompleteOutcome();
                if (result.status === 'modal') return mapModalOutcome(again, modalBaseline, modalLabel, roundLabel, modalNote);
                // 'stopped'
                console.error(result.message);
                await alert(result.message);
                return false;
            }

            /**
 * Information-slide round handler (issue #327): the slide has nothing to
 * answer, so the round is one Continue click via playInfoSlideRound - never
 * Submit, never typed input. Detection mirrors the selection rounds; the
 * modal/completion/stopped mapping is shared with them via mapRoundOutcome.
 * @param {object} descriptor - info-slide descriptor from detectQuestion
 * @returns {Promise<boolean>} False to stop the run, true to keep looping
 */
            async function playInfoSlideDescriptorRound(descriptor) {
                // EP swaps slides asynchronously: require the detected slide to
                // hold still across two reads before clicking anything.
                const again = await detectQuestion(page);
                if (again === null || again.kind !== 'info-slide' || again.key !== descriptor.key) {
                    console.log('Information slide changed during detection; re-reading it in a fresh pass.');
                    return true;
                }
                // Preserve even if Stop/errors arrive before the modal poll:
                // no information-slide cleanup deletes dialogs.
                preserveSelectionModal=true;
                const modalBaseline=await captureSelectionBaseline(page,again);
                try{
                    const result = await playInfoSlideRound(page, again, {
                        enter: ENTER,
                        timeout: ADVANCE_TIMEOUT,
                        shouldStop: () => !TOGGLE,
                        log: msg => console.log(msg),
                    });
                    if (result.status === 'info-shown') {
                        console.log('Information slide: nothing to answer. Run stopped. Click Continue in the browser to advance.');
                        return false;
                    }
                    return await mapRoundOutcome(result, again, modalBaseline, 'Information slide', 'information slide', '');
                }finally{if(modalBaseline)await modalBaseline.dispose().catch(()=>{});}
            }

            /**
 * Selection-round handler: re-detects the slide to confirm it held still, then
 * plays it through the matching selection handler and maps the outcome onto the run.
 * @param {object} descriptor - choice descriptor from detectQuestion
 * @returns {Promise<boolean>} False to stop the run, true to keep looping
 */
            async function playSelectionDescriptorRound(descriptor) {
                    // EP swaps slides asynchronously, like it swaps question text: require
                    // the detected slide to hold still across two reads before clicking.
                    const again = await detectQuestion(page);
                    if (again === null || again.kind !== descriptor.kind || again.key !== descriptor.key) {
                        console.log('Selection slide changed during detection; re-reading it in a fresh pass.');
                        return true;
                    }
                    const play = descriptor.kind === 'dropdown' ? playDropdownRound : descriptor.kind === 'dropdown-numberbox' ? playDropdownNumberBoxRound : descriptor.kind === 'slide-surfaces' ? playSlideSurfacesRound : descriptor.kind === 'workingformula' ? playWorkingFormulaRound : descriptor.kind === 'reflection' ? playReflectionRound : descriptor.kind === 'numberbox' ? playNumberBoxRound : descriptor.kind === 'textbox' ? playTextboxRound : descriptor.kind === 'gaps' ? playGapsRound : descriptor.kind === 'highlight' ? playHighlightRound : playChoiceRound;
                    // Issue #222: single-choice mistakes only (neighboring distractor).
                    // Other surfaces stay perfect to preserve their fail-closed proofs;
                    // a wrong single-choice still advances via the normal Next flow.
                    // The stat is recorded only after a confirmed submission, using the
                    // handler's actual distractor outcome (a lone option falls back to
                    // the correct answer and must not count as wrong).
                    let choiceMistakeIntent = false;
                    let choiceMistakeResult = null;
                    let choiceAccuracyPending = null;
                    if (again.kind === 'choice' && again.multi !== true && ENTER && accuracyRun && TOGGLE) {
                        try {
                            if (accuracyRun.shouldMistake()) {
                                choiceMistakeIntent = true;
                                choiceMistakeResult = { mistake: false };
                                choiceAccuracyPending = true;
                            } else {
                                choiceAccuracyPending = false;
                            }
                        } catch { choiceMistakeIntent = false; choiceAccuracyPending = null; }
                    }
                    // Preserve even if Stop/errors arrive after Submit but before
                    // the handler's next modal poll. No selection cleanup deletes dialogs.
                    preserveSelectionModal=true;
                    const modalBaseline=await captureSelectionBaseline(page,again);
                    try{
                    const result = await play(page, again, {
                        enter: ENTER,
                        timeout: ADVANCE_TIMEOUT,
                        shouldStop: () => !TOGGLE,
                        log: msg => console.log(msg),
                        beforeSubmit: () => humanDelay.beforeSubmit(again.kind),
                        ...((again.kind === 'choice' && again.multi !== true && choiceMistakeIntent && choiceMistakeResult) ? { intentionalMistake: true, mistakeResult: choiceMistakeResult } : {}),
                        ...((again.kind === 'dropdown' || again.kind === 'dropdown-numberbox') ? {
                            inputMode: dropdownInputMode,
                        } : again.kind === 'reflection' ? {
                            requestText: async request => typeof reflectionTextProvider === 'function' ? await reflectionTextProvider(request, onReflectionRequestCancel) : false,
                        } : {}),
                    });
                    if (choiceAccuracyPending !== null && accuracyRun && (result.status === 'advanced' || result.status === 'complete' || result.status === 'modal')) {
                        try {
                            const mistook = choiceMistakeIntent ? Boolean(choiceMistakeResult && choiceMistakeResult.mistake) : false;
                            if (mistook) console.log(`Accuracy mistake for ${again.key}: selected a neighboring distractor (target ${accuracyRun.target}%).`);
                            accuracyRun.recordFirstTry(mistook);
                        } catch { /* never break answering on stats */ }
                    }
                    if (result.status === 'self-marked-filled') {
                        console.log('Self-marked dropdowns filled. Run stopped. Review, submit and self-mark in the browser.');
                        return false;
                    }
                    if (result.status === 'reflection-filled') {
                        console.log('Reflection filled with your approved text. Run stopped. Review, submit and self-mark in the browser.');
                        return false;
                    }
                    if (result.status === 'stopped') {
                        lastStop = { reason: result.reason, selectionDiagnostic: result.selectionDiagnostic, diagnostic: result.diagnostic };
                        if (again.kind === 'slide-surfaces' && result.selectionDiagnostic) {
                            const { phase, dropdownIndex, boxIndex, keyDispatchesReturned, guard, submitState } = result.selectionDiagnostic;
                            console.error('Slide-surfaces refusal diagnostic ' + JSON.stringify({ phase, dropdownIndex, ...(boxIndex !== undefined && boxIndex !== null ? { boxIndex } : {}), keyDispatchesReturned, guard, dropdownCount: again.dropdownCount, boxCount: again.boxCount, textBoxCount: again.textBoxCount, multiOptionCount: again.multiOptionCount, ...(submitState ? {submitState} : {}) }));
                        }
                        if ((again.kind === 'dropdown' || again.kind === 'dropdown-numberbox') && result.selectionDiagnostic) {
                            const { phase, dropdownIndex, boxIndex, keyDispatchesReturned, guard, submitState } = result.selectionDiagnostic;
                            console.error('Dropdown refusal diagnostic ' + JSON.stringify({ phase, dropdownIndex, ...(boxIndex !== undefined && boxIndex !== null ? { boxIndex } : {}), keyDispatchesReturned, guard, dropdownCount: again.dropdowns.length, ...(again.kind === 'dropdown-numberbox' ? { boxCount: again.boxes.length } : {}), ...(submitState ? {submitState} : {}) }));
                        }
                        if ((again.kind === 'textbox' || again.kind === 'numberbox' || again.kind === 'dropdown-numberbox' || again.kind === 'slide-surfaces' || again.kind === 'reflection' || again.kind === 'workingformula') && result.diagnostic) console.error('Unsupported question diagnostic ' + JSON.stringify(result.diagnostic));
                    }
                    const roundLabel = descriptor.kind === 'textbox' ? 'textbox' : descriptor.kind === 'numberbox' ? 'number-box' : descriptor.kind === 'dropdown-numberbox' ? 'dropdown+number-box' : descriptor.kind === 'reflection' ? 'reflection' : 'selection';
                    return await mapRoundOutcome(result, again, modalBaseline, 'Selection', roundLabel, ' The submission may or may not have been accepted.');
                    }finally{if(modalBaseline)await modalBaseline.dispose().catch(()=>{});}
                }

            // A generic Continue/modal is not proof that the task ended. Status
            // uses a narrower signal than legacy navigation: no question plus
            // a visible exit control, while this run still intends to answer.
            // Dash (issue #230): the timed sprint ends the same way (exit/continue),
            // with a provisional results interstitial (.dash-results) that keeps the
            // same exit control. Either visible control proves completion; the
            // results screen alone is also accepted so a leaderboard interstitial
            // without a separate exit button still ends the run. The real
            // results/leaderboard markup stays uncaptured (all live captures
            // found no timer candidates).
            async function taskCompletionProven() {
                if (!TOGGLE || await detectQuestion(page) !== null) return false;
                const proven = await page.evaluate((exitCss, resultsCss) => {
                    const shown = (css) => {
                        const button = document.querySelector(css);
                        return !!button && !button.hidden && (button.offsetParent !== null || button.getClientRects().length > 0);
                    };
                    return shown(exitCss) || shown(resultsCss);
                }, DIR.exit_button_css, DIR.dash_results_css).catch(() => false);
                return TOGGLE && proven;
            }

            // Dash sprint notice (issue #230): captured Dash rounds (choice 2026-11-19,
            // typed 2026-11-20) call it out once per run. Reports the timer
            // presence, the shared per-type pacing decision (provisional delay
            // off recommendation, live scoring unproved) and the expected
            // accuracy cost (a Dash mistake is expected to burn sprint
            // time/points).
            // Runs inside the answer loop; never throws and never stops the run.
            let dashNoted = false;
            async function noteDashOnce() {
                if (dashNoted) return;
                // Timer-first, model-fallback: all three live captures found no
                // timer candidates, so the `.dash-timer`/`.dash-results`
                // selectors are fixture-invented. The captured Dash model (isDash
                // on a dash route, via detectQuestion's `dash: true`) is the live
                // signal; the timer flag only reports whether the fixture chrome
                // shows.
                let timerVisible = false;
                let isDash = false;
                try {
                    const dash = await page.evaluate(detectDashInPage, DIR.dash_timer_css, DIR.dash_results_css);
                    if (dash && dash.isDash) {
                        isDash = true;
                        timerVisible = !!dash.timerVisible;
                    }
                } catch { /* fall through to the model check */ }
                if (!isDash) {
                    try {
                        const descriptor = await detectQuestion(page);
                        if (descriptor && descriptor.dash === true) isDash = true;
                    } catch { return; }
                }
                if (!isDash) return;
                dashNoted = true;
                console.log(`Dash sprint detected (timer visible: ${timerVisible ? 'yes' : 'no'}). ${DASH_PACING_NOTE}`);
                if (accuracyRun && accuracyRun.enabled !== false && accuracyConfig && accuracyConfig.enabled) {
                    console.log(`Accuracy ${accuracyRun.target}% is on for this Dash sprint. ${DASH_ACCURACY_NOTE}`);
                } else {
                    console.log(`Accuracy is perfect for this Dash sprint (recommended). ${DASH_ACCURACY_NOTE}`);
                }
            }

            /**
 * Main answer loop: runs until TOGGLE is false, task completes, or an error occurs.
 * Handles cleanup, modal resolution, and page-gone errors. Restart-safe.
 * @returns {Promise<void>}
 */
            async function answerLoop() {
                if (RUNNING !== null) throw new Error("Tried to initiate answerLoop while it is already running");

                TOGGLE = true;
                runReason = 'stopped';
                lastSubmitted = null;
                typedSubmissionsByKey.clear();
                supportReport = createSupportReport();
                futileStop = false;  // a manual restart after a futility stop gets a fresh bounded run
                dashNoted = false;  // per-run Dash guidance: a second start must log the sprint notice again
                startAccuracyRun();
                console.log("answerLoop entered.");

                // Issue #230 (classic-path only): note whether this run shows a dash
                // timer so the first unknown classic question can trigger the
                // timed-guess warning. Captured Dash choice/typed rounds use the
                // shipped answer and refuse instead of guessing, so they ignore it.
                dashUnknownWarned = false;
                const dashTimer = await page.$(DIR.dash_timer_css).catch(() => null);
                dashTimedThisRun = Boolean(dashTimer);
                if (dashTimer) await dashTimer.dispose().catch(() => {});

                try {
                    // If the previous run's modal cleanup is still in flight, wait for it
                    // before answering: the old deleteModals() must never remove a modal
                    // that belongs to this fresh run (e.g. its first wrong-answer modal).
                    // A stop pressed during this hand-over simply leaves TOGGLE false, and
                    // the loop below exits without touching the page.
                    if (CLEANUP !== null) await CLEANUP;
                    if(preserveSelectionModal){
                        const dialogOpen=await page.evaluate(()=>{
                            const shown=el=>!el.hidden&&el.getClientRects().length>0&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
                            return [...document.querySelectorAll('div[uib-modal-window=modal-window],div[uib-modal-backdrop=modal-backdrop]')].some(shown);
                        }).catch(()=>true);
                        if(dialogOpen){
                            console.error('The interrupted selection dialog is still open; close or check it before restarting.');
                            return {reason:runReason};
                        }
                        // This is an explicit new user start after the obstruction
                        // has gone, not automatic continuation or proof of acceptance.
                        preserveSelectionModal=false;
                    }
                    await answerQuestions();
                } catch (e) {
                    // Navigation mid-run (task completed and EP left the task screen, or
                    // the user closed the task) detaches the frame; every page call then
                    // throws "Attempted to use detached Frame". That is the task ending,
                    // not a bug: end the run quietly. Anything else stays loud.
                    if (isPageGoneError(e)) {
                        console.log('The task page navigated away; ending the run.');
                    } else {
                        throw e;
                    }
                } finally {
                    // Go inert BEFORE the async cleanup runs. deleteModals() costs two
                    // browser round-trips, so clearing the flags first makes the stop
                    // observable immediately: an Alt+S landing during cleanup starts a
                    // fresh run instead of being consumed as a phantom second stop, and
                    // no stale flag write can kill that new run.
                    TOGGLE = false;
                    RUNNING = null;

                    // Preserve selection interruptions for checking. Other legacy paths
                    // retain their cleanup. CLEANUP is recorded so a run spawned
                    // during this cleanup chains after it instead of overlapping it.
                    // A navigation during cleanup makes deleteModals' $$evals hit a detached
                    // frame; that used to print a scary stack trace for a harmless skip.
                    CLEANUP = (preserveSelectionModal ? Promise.resolve() : deleteModals()).catch(e => {
                        if (isPageGoneError(e)) console.log('answerLoop cleanup skipped: the page navigated away.');
                        else console.error('answerLoop cleanup failed:', e);
                    });
                    await CLEANUP;
                    if (accuracyRun) {
                        const acc = accuracyRun.accuracy();
                        console.log(`Accuracy this run: target ${accuracyRun.target}%, first-try ${accuracyRun.stats.attempts - accuracyRun.stats.mistakes}/${accuracyRun.stats.attempts}${acc === null ? '' : ` (${acc.toFixed(1)}%)`}.`);
                    }
                    if (futileStop) supportReport.record('text', 'refused', 'futility-guard');
                    console.log(`answerLoop Exited. (reason=${runReason}, futileStop=${futileStop})`);
                    console.log(supportReport.render(runReason));
                    await supportSender.sendRun(supportReport);
                }
                return { reason: runReason };
            }

            /**
 * Core answering logic: reads questions, finds/enters answers, handles submissions.
 * Bounded respawn counters prevent infinite loops on dead/stale pages.
 * @returns {Promise<void>}
 */
            async function answerQuestions() {
                // bounded respawn counters: a page in a dead state must not restart
                // answer entry forever
                let boxVanishedRounds = 0;  // answer box missing at answer-entry time
                let unstableRounds = 0;     // question text never held still in a pass
                let boxTamperedRounds = 0;  // answer box rewritten between entry and submission

                while (TOGGLE) {
                    if (futileStop) {
                        // correctAnswer tripped a futility guard mid-pass; it cannot break
                        // this loop itself, so honor it here. The guard already logged
                        // the specific bound; this line makes the exit itself visible
                        // so a tail ending after a Details block is still answerable.
                        console.log('Answer loop stopping: futility guard tripped (see prior futility message).');
                        break;
                    }
                    // Per-round question-type detection (issues #33/#32): the loop asks
                    // the page what it is showing instead of assuming #question-text.
                    // Classic text questions keep the inline path below; Smart Lesson
                    // slides and audio tasks are played by their handlers, and the next
                    // pass detects fresh. This is also what lets a run start on a lesson
                    // page, where #question-text never exists.
                    let descriptor = await detectQuestion(page);
                    if (descriptor === null) {
                        // The question element disappears on round transitions and on the
                        // task's end screens, but an unconfirmed disappearance must not
                        // kill a live run or click the wrong control: wait (up to ~20s)
                        // for a question to return, or for an explicit completion state —
                        // a modal, or exit/continue controls on the completion screen.
                        // The old code crashed here with a bare $eval; then it broke out
                        // of the run on any unconfirmed null question.
                        let complete = false;   // completion controls were seen on screen
                        let modalSeen = false;  // a modal is up; route it to its handler
                        let completePolls = 0;  // consecutive polls with completion controls visible
                        for (let i = 0; i < 80 && TOGGLE; i++) {
                            await new Promise(resolve => setTimeout(resolve, 250));
                            descriptor = await detectQuestion(page);
                            if (descriptor !== null) break;
                            if (await page.$(DIR.modal_css) !== null) { modalSeen = true; break; }
                            // The completion controls exist in the DOM (hidden) on every
                            // round of a lesson/task, and slides unmount for a beat
                            // before the next one mounts: only controls that are VISIBLE
                            // on two consecutive polls (the question stayed gone, so this
                            // is not a slide gap) prove completion. An existence check
                            // here used to "complete" the task mid-lesson and click a
                            // hidden exit button.
                            const controlsVisible = await page.evaluate((exitCss, contCss, resultsCss) => {
                                const shown = (css) => {
                                    const el = document.querySelector(css);
                                    return !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
                                };
                                return shown(exitCss) || shown(contCss) || shown(resultsCss);
                            }, DIR.exit_button_css, DIR.exit_continue_button_css, DIR.dash_results_css).catch(() => false);
                            completePolls = controlsVisible ? completePolls + 1 : 0;
                            complete = completePolls >= 2;
                            if (complete) break;
                        }
                        if (descriptor === null) {
                            if (modalSeen) {
                                // the completion flow is a modal window: let the modal path
                                // resolve it (it clicks exit/continue and reports completion).
                                // Futility counting uses randomRound alone: unknown probes
                                // were not pre-counted at submission, so they must still
                                // count in correctAnswer when unreadable (isRandomProbe
                                // would skip the increment and spin forever).
                                if (!await handleModalAndContinue(lastSubmitted?.question ?? '', lastSubmitted?.answer ?? '', lastSubmitted?.randomRound ?? false)) {
                                    console.log('Answer loop stopping: completion modal resolved the task.');
                                    break;
                                }
                                continue;
                            }
                            console.log(complete
                                ? 'Question element gone; task completion confirmed. Ending the run.'
                                : 'Question element never returned within 20s; stopping the run.');
                            if (complete && TOGGLE) {
                                const proven = await taskCompletionProven();
                                if (!TOGGLE) {
                                    console.log('Answer loop stopping: stopped while proving task completion.');
                                    break;
                                }
                                const completion = await page.evaluate((exitCss, contCss, resultsCss) => {
                                    const shown = (css) => {
                                        const el = document.querySelector(css);
                                        return !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
                                    };
                                    const exitEl = document.querySelector(exitCss);
                                    const contEl = document.querySelector(contCss);
                                    const resultsEl = document.querySelector(resultsCss);
                                    const button = exitEl || contEl || resultsEl;
                                    if (!button) return { clicked: false, resultsVisible: shown(resultsCss) };
                                    // The Dash results interstitial is a div, not a button: a
                                    // results-only finish has no control to click, but the
                                    // visible results proof alone still completes the sprint.
                                    if (button.tagName !== 'BUTTON') {
                                        const fallback = exitEl || contEl;
                                        if (fallback && fallback.tagName === 'BUTTON') {
                                            fallback.click();
                                            return { clicked: true, resultsVisible: shown(resultsCss) };
                                        }
                                        return { clicked: false, resultsVisible: shown(resultsCss) };
                                    }
                                    button.click();
                                    return { clicked: true, resultsVisible: shown(resultsCss) };
                                }, DIR.exit_button_css, DIR.exit_continue_button_css, DIR.dash_results_css).catch(() => ({ clicked: false, resultsVisible: false }));
                                if (proven && TOGGLE && (completion.clicked || completion.resultsVisible)) runReason = 'completed';
                                console.log(completion.clicked ? 'Clicked the task exit/continue button.' : (completion.resultsVisible ? 'Dash results interstitial confirms sprint completion; no exit control to click.' : 'The completion controls vanished; stopping the run.'));
                            }
                            console.log(`Answer loop stopping: question element gone (complete=${complete}, reason=${runReason}).`);
                            break;
                        }
                        // a question came back: fall through to its pass
                    }
                    if (descriptor.kind !== 'text') {
                        if (!await handleNonTextRound(descriptor)) {
                            console.log('Answer loop stopping: non-text round requested a stop (see prior refusal message).');
                            break;
                        }
                        continue;
                    }
                    await noteDashOnce();
                    let question = descriptor.text;
                    // EP swaps the question element's text asynchronously after starting a
                    // round; reads taken mid-swap pick up the word EP WAS asking, not the
                    // one it is asking now (the runs watched the text flip between deck
                    // words before any submission). Start every pass from a text that
                    // holds still: require two reads 120ms apart to agree. If the text
                    // still churned after the window, do NOT type against an unverified
                    // word — restart the pass, at most three times before giving up.
                    let unstable = true;
                    for (let i = 0; i < 15 && TOGGLE; i++) {
                        await new Promise(resolve => setTimeout(resolve, 120));
                        const again = await readQuestionText();
                        if (again === null) { question = null; break; }
                        if (again !== question) { question = again; continue; }
                        unstable = false;
                        break;
                    }
                    if (!TOGGLE) {
                        console.log('Answer loop stopping: stopped during question stabilization.');
                        break;
                    }
                    if (question === null) {
                        console.log('Question vanished during stabilization; re-reading it in a fresh pass.');
                        continue;
                    }
                    if (unstable) {
                        unstableRounds += 1;
                        console.log(`Question text churned within a pass; restart ${unstableRounds}/3.`);
                        if (unstableRounds >= 3) {
                            console.log('Answer loop stopping: question text never held still (unstable x3).');
                            break;
                        }
                        continue;
                    }
                    unstableRounds = 0;

                    // Accepted answers shipped on the classic round's own
                    // model state (captured shape only - see the text branch
                    // of detect-question.js): learn them under this
                    // question's key variants before the dictionary lookup,
                    // so a word EP already answers never costs a random
                    // probe or a wrong-answer modal. The answers were read in
                    // the same page snapshot as descriptor.text; when the
                    // stabilization pass settled on different text the
                    // pairing is unproven (round skew) and must not be
                    // learned - the next pass re-detects fresh. Anything
                    // unreadable leaves descriptor.answers absent and the
                    // dictionary/modal learning below runs unchanged.
                    if (Array.isArray(descriptor.answers) && descriptor.text === question) {
                        for (const modelAnswer of descriptor.answers) learnEntry(question, modelAnswer);
                    }

                    let answer = findAnswer(question);
                    // true when this pass had no usable candidate and only a random string
                    // is being submitted. correctAnswer must not count that round again if
                    // the correction modal is also unreadable: the meter counts submission
                    // ROUNDS, and counting both stages would trip the bound at half of it.
                    let randomRound = false;
                    // Unknown probe: findAnswer returns a random string when no
                    // candidates exist for any variant (answer !== null). It must
                    // be tracked separately from the all-rejected escalation
                    // (answer === null): both are random submissions for the
                    // advance-wait heuristic, but only the all-rejected one was
                    // already counted toward futility at submission time.
                    // (issue #258 review: randomRound alone left unknown probes
                    // passing false to waitForAdvance.)
                    let unknownProbe = false;
                    if (answer !== null && !hasKnownCandidates(question)) {
                        unknownProbe = true;
                    }
                    if (answer === null) {
                        warnDashGuess();
                        // Every candidate this session knows for the question was already
                        // graded wrong. Feed EP a random string so its wrong-answer modal
                        // reveals the canonical answer (which then joins the candidates),
                        // but bound the cycle: an item that stays unanswerable must not
                        // loop incorrect answers forever.
                        const futile = futileKey(question);
                        futileDict[futile] = (futileDict[futile] || 0) + 1;
                        const attempt = futileDict[futile];
                        if (attempt >= 4) {
                            const message = `EP rejected every known answer for "${question}" ${attempt} rounds in a row; stopping the loop. Check that item's entry in the word list.`;
                            console.error(message);
                            await alert(message);
                            console.log(`Answer loop stopping: all-rejected bound for "${question}" (attempt ${attempt}/4).`);
                            break;
                        }
                        randomRound = true;
                        console.log(`Every known answer for "${question}" was rejected; submitting a random string to make EP reveal its answer (round ${attempt}/4).`);
                        answer = generateRandomString(8, 10);
                    }
                    // Both random kinds never advance via a cleared box: an
                    // unknown probe's submit-clear precedes its correction modal
                    // (issue #234), and an all-rejected retry behaves the same.
                    // Futility counting keeps using randomRound alone (unknown
                    // probes are counted in correctAnswer when unreadable).
                    const isRandomProbe = randomRound || unknownProbe;
                    // No reset in the non-null branch: an unknown question falls through
                    // it with a fresh random string every pass, and resetting there would
                    // wipe the unreadable-modal count before it could ever reach the
                    // bound. The meter only restarts on real progress — acceptance, a
                    // learn that adds new candidates, a changed-list refresh, or a run
                    // restart.
                    if (typeof answer !== 'string' || answer === '') {
                        supportReport.record('text', 'refused', 'empty-answer');
                        console.log(`Answer loop stopping: refusing to type an empty answer for "${question}".`);
                        break;
                    }
                    // Issue #222: occasional human-like first-try mistake (small typo).
                    // Only when the correct answer is known, in auto mode, and this run
                    // has accuracy enabled. Unknown questions already submit a random
                    // probe (findAnswer returns a random string when no candidates exist)
                    // and are excluded from accuracy stats; semi-auto fills the correct
                    // answer and leaves submission to the user. The typo flows through
                    // the normal wrong-answer-modal -> Continue path, so the run still
                    // completes with lower accuracy. Only the first submission per question
                    // may mistake; modal-driven retries always use the correct answer and
                    // the stat is recorded only after a confirmed submission.
                    let accuracyClassicPending = null;
                    let accuracyClassicCorrect = answer;
                    if (accuracyRun && ENTER && !isRandomProbe && !accuracyClassicSeen.has(question)) {
                        try {
                            // Unknown probe: no candidates for any key variant, so
                            // findAnswer returned a random string. Never mistake those
                            // and never count them toward first-try accuracy.
                            // unknownProbe is computed from the shared dict helper
                            // above (single source with findAnswer).
                            if (unknownProbe) {
                                // Unknown question: random probe, not an accuracy decision.
                            } else if (accuracyRun.shouldMistake()) {
                                const { makeTypoFor } = require('./lib/accuracy');
                                const avoid = [];
                                for (const probe of questionVariants(question)) {
                                    const key = String(probe).trim();
                                    const list = candidatesDict[key];
                                    if (Array.isArray(list)) avoid.push(...list);
                                }
                                const typo = makeTypoFor(answer, avoid);
                                if (typo && typo !== answer) {
                                    console.log(`Accuracy mistake for "${question}": submitting "${typo}" instead of "${answer}" (target ${accuracyRun.target}%).`);
                                    answer = typo;
                                    accuracyClassicPending = true;
                                } else {
                                    accuracyClassicPending = false;
                                }
                            } else {
                                accuracyClassicPending = false;
                            }
                        } catch {
                            // Never break answering on an accuracy helper failure.
                            accuracyClassicPending = null;
                        }
                    }

                    // The screen can look identical after a round: dictionary tasks draw
                    // words at random, so the next question can repeat the same text. The
                    // previous submission is still pending only while the box still holds
                    // exactly what was typed for it; a cleared box means EP moved on and
                    // expects a fresh round, so identical question+answer is then legitimate.
                    const boxValue = await answerBoxValue();
                    const stillPending = lastSubmitted !== null
                        && lastSubmitted.question === question
                        && lastSubmitted.answer === answer
                        && boxMatchesAnswer(lastSubmitted.answer, boxValue);
                    if (stillPending) {
                        // the previous round for this question produced no visible progress. Rather
                        // than resubmitting it, wait for the page to catch up (or stop).
                        console.log(`Question "${question}" has not advanced since the last submission; waiting before retrying.`);
                        const stalledProbe = lastSubmitted.isRandomProbe ?? isRandomProbe;
                        const stalled = await waitForAdvance(question, 0, lastSubmitted.answer, stalledProbe);
                        if (stalled === 'aborted') {
                            console.log('Answer loop stopping: stalled-question wait aborted (stopped or context changed).');
                            break;
                        }
                        if (stalled === 'modal') {
                            // Futility uses the submission's pre-counted state (as in
                            // the main modal path), not the advance-wait probe flag.
                            if (!await handleModalAndContinue(question, answer, lastSubmitted?.randomRound ?? randomRound)) {
                                console.log('Answer loop stopping: completion modal resolved the task (stalled wait).');
                                break;
                            }
                        }
                        continue;
                    }

                    // enterAnswer clears the box, types it as real keystrokes
                    // (spaced out so EP's own input handling can keep up), and verifies
                    // the box before returning. A false return means the box vanished
                    // during a round transition: re-read on the next pass, but only a
                    // bounded number of times — a box that stays missing while the
                    // question element remains must not restart forever.
                    if (!await enterAnswer(answer)) {
                        boxVanishedRounds += 1;
                        console.log(`Answer box missing at entry; restart ${boxVanishedRounds}/5.`);
                        if (boxVanishedRounds >= 5) {
                            console.log('Answer loop stopping: answer box never reappeared (missing x5).');
                            break;
                        }
                        continue;
                    }
                    boxVanishedRounds = 0;
                    if (!TOGGLE) {
                        console.log('Answer loop stopping: stopped after answer entry.');
                        break;
                    }

                    // The round can advance while the answer is being typed; EP then grades
                    // the submission against a different item than `question` was looked up
                    // from (see round-skew warnings in the log). Re-read the question and
                    // abandon the pass if it changed: the box content is wrong for the new
                    // item, and the next pass must look the answer up again — the stale text
                    // is cleared on the way. The second read just beneath catches questions
                    // whose element updates a beat after the box resets.
                    const freshQuestion = await readQuestionText();
                    if (freshQuestion === null) {
                        console.log('Question vanished after typing; re-reading it on the next pass.');
                        continue;
                    }
                    if (freshQuestion !== question) {
                        // EP can consume a matching answer without waiting for Enter, clearing
                        // the box as the round advances: an empty box here means the text just
                        // typed was already graded, so this is progress, not a discard.
                        const boxAfter = await answerBoxValue();
                        console.log(boxAfter === ''
                            ? `Round auto-graded during "question changed" check (${question} → ${freshQuestion}); moving on.`
                            : `Question changed while typing ("${question}" → "${freshQuestion}"); looking the answer up again.`);
                        // EP grading the just-typed text is real progress: the box was not
                        // fighting us, so the interference streak ends here.
                        if (boxAfter === '') boxTamperedRounds = 0;
                        continue;
                    }
                    await new Promise(resolve => setTimeout(resolve, 50));
                    const latestQuestion = await readQuestionText();
                    if (latestQuestion === null) {
                        console.log('Question vanished after typing; re-reading it on the next pass.');
                        continue;
                    }
                    if (latestQuestion !== question) {
                        const boxAfter = await answerBoxValue();
                        console.log(boxAfter === ''
                            ? `Round auto-graded during late check (${question} → ${latestQuestion}); moving on.`
                            : `Question changed while typing ("${question}" → "${latestQuestion}"); looking the answer up again.`);
                        if (boxAfter === '') boxTamperedRounds = 0;
                        continue;
                    }
                    // even with the question text intact, the box content can still change
                    // during the wait above: submit only what was verified, or not at all.
                    // EP may IME-normalize punctuation after typing (issue #232), so a
                    // normalized-equal box still verifies and submits as-is.
                    const boxBeforeEnter = await answerBoxValue();
                    if (!boxMatchesAnswer(answer, boxBeforeEnter)) {
                        if (boxBeforeEnter === null) {
                            boxVanishedRounds += 1;
                            console.log(`Answer box missing before submission (${boxVanishedRounds}/5); re-reading on a fresh pass.`);
                            if (boxVanishedRounds >= 5) {
                                console.log('Answer loop stopping: answer box never returned (missing x5).');
                                break;
                            }
                        } else {
                            boxTamperedRounds += 1;
                            console.log(`Answer box changed before submission for "${question}" (now "${boxBeforeEnter}"); restart ${boxTamperedRounds}/5.`);
                            if (boxTamperedRounds >= 5) {
                                console.log('Answer loop stopping: answer box keeps changing between entry and submission (tampered x5).');
                                break;
                            }
                        }
                        continue;
                    }
                    if (!TOGGLE) {
                        console.log('Answer loop stopping: stopped before submission.');
                        break;
                    }

                    if (!await enterClassic(question, answer, ENTER)) {
                        supportReport.record('text', 'refused', 'pre-submit-guard');
                        console.log(`Answer loop stopping: pre-submit guard refused submission for "${question}" (question changed, box mismatch, or stopped).`);
                        break;
                    }
                    lastSubmitted = { question, answer, isRandomProbe, randomRound };
                    supportReport.record('text', 'answered');
                    // Record the first-try result only after a confirmed submission so
                    // changed questions, vanished boxes, or refused selections never
                    // inflate the displayed stats. Mark the question seen so a modal-driven
                    // retry submits the correct answer without a second mistake.
                    if (accuracyClassicPending !== null && accuracyRun && ENTER) {
                        try { accuracyRun.recordFirstTry(accuracyClassicPending); } catch { /* never break answering on stats */ }
                        accuracyClassicSeen.add(question);
                    }
                    accuracyClassicPending = null;
                    // a real submission happened: any box-interference streak is over
                    boxTamperedRounds = 0;

                    // wait for the round to move on before the next lookup, so the next answer is
                    // not typed against the question that was just submitted. A modal (wrong
                    // answer, or task complete) ends the wait immediately; a cleared box
                    // counts only after it persists (issue #234 grace) so a random probe's
                    // submit-clear cannot false-accept before its correction modal renders.
                    // Random probes (unknown or all-rejected) never advance via a
                    // cleared box at all.
                    const outcome = await waitForAdvance(question, ENTER ? ADVANCE_TIMEOUT : 0, answer, isRandomProbe);

                    if (outcome === 'aborted') {
                        console.log('Answer loop stopping: advance wait aborted (stopped or context changed).');
                        break;
                    }

                    if (outcome === 'advanced') {
                        // the round was graded and moved on: acceptance. Whatever futility
                        // streak this question had is over. The question leaves the
                        // first-try set so a later new round with the same text is again
                        // eligible; modal retries stay suppressed until then.
                        futileDict[futileKey(question)] = 0;
                        futileStop = false;
                        accuracyClassicSeen.delete(question);
                    }

                    if (outcome === 'modal') {
                        if (!await handleModalAndContinue(question, answer, randomRound)) {
                            console.log('Answer loop stopping: completion modal resolved the task.');
                            break;
                        }
                        continue;
                    }

                    if (outcome === 'timeout') {
                        if (!ENTER) {
                            // semi-auto: the answer is typed and awaiting the user's Enter. Wait for the
                            // round to resolve before touching the next question, so stopping and
                            // restarting the loop never double-submits. (This wait is unbounded, so it
                            // cannot actually time out; the branch is kept for safety.)
                            console.log(`Waiting for the answer to "${question}" to be submitted.`);
                            const resolved = await waitForAdvance(question, 0, answer, isRandomProbe);
                            if (resolved === 'aborted') {
                                console.log('Answer loop stopping: semi-auto resolve wait aborted.');
                                break;
                            }
                            if (resolved === 'modal') {
                                if (!await handleModalAndContinue(question, answer, randomRound)) {
                                    console.log('Answer loop stopping: completion modal resolved the task (semi-auto).');
                                    break;
                                }
                            }
                            continue;
                        }

                        // the round has not moved on yet. One retry: EP can swallow the
                        // first Enter (it checks for real key events now, but focus or
                        // round-trip timing can still lose it). The timeout branch is only
                        // reached with the round genuinely unresolved (no modal, question
                        // unchanged, no persistent cleared box for a new round), so
                        // re-submitting the same content is safe. Only a second timeout
                        // stops the run; break rather than throw so the loop falls through
                        // to its modal cleanup.
                        console.log(`Question "${question}" did not advance within ${ADVANCE_TIMEOUT}ms; pressing Enter again.`);
                        if (!TOGGLE) {
                            console.log('Answer loop stopping: stopped before Enter retry.');
                            break;
                        }
                        await page.click(DIR.answer_box_css).catch(() => { });
                        if (!TOGGLE) {
                            console.log('Answer loop stopping: stopped after focus click before retry.');
                            break;
                        }
                        // Retry always uses the correct answer so a first-try typo is not resubmitted.
                        // A swallowed first Enter leaves the typo in the box, and enterClassic's
                        // guard refuses to press Enter over a mismatched box, so restore the
                        // correct answer first (enterAnswer clears, retypes and verifies).
                        // A normalized-punctuation box (issue #232) still verifies.
                        if (!boxMatchesAnswer(accuracyClassicCorrect, await answerBoxValue())) {
                            console.log('Restoring the answer in the box before the retry.');
                            if (!await enterAnswer(accuracyClassicCorrect)) {
                                console.log('Answer loop stopping: answer box vanished while restoring for retry.');
                                break;
                            }
                        }
                        if (!await enterClassic(question, accuracyClassicCorrect, true)) {
                            supportReport.record('text', 'refused', 'pre-submit-guard');
                            console.log(`Answer loop stopping: pre-submit guard refused retry for "${question}".`);
                            break;
                        }
                        const retry = await waitForAdvance(question, ADVANCE_TIMEOUT, accuracyClassicCorrect, isRandomProbe);
                        if (retry === 'timeout') {
                            console.error(`Question "${question}" did not advance after submitting "${accuracyClassicCorrect}". Stopping.`);
                            await alert(`Answer loop stopped: "${question}" did not advance.`);
                            console.log(`Answer loop stopping: Enter-retry timeout for "${question}".`);
                            break;
                        }
                        if (retry === 'aborted') {
                            console.log('Answer loop stopping: retry wait aborted.');
                            break;
                        }
                        if (retry === 'advanced') {
                            futileDict[futileKey(question)] = 0;
                            futileStop = false;
                            accuracyClassicSeen.delete(question);
                        }
                        if (retry === 'modal') {
                            if (!await handleModalAndContinue(question, accuracyClassicCorrect, randomRound)) {
                                console.log('Answer loop stopping: completion modal resolved the task (retry).');
                                break;
                            }
                        }
                    }
                }
            }

            /**
 * Starts a new answerLoop run, managing the RUNNING handle for restart safety.
 * The RUNNING promise identity ensures a cleanup from an old run doesn't
 * cancel a newer run that started during cleanup.
 * @returns {void}
 */
            function startLoop() {
                TOGGLE = true;
                const myRun = answerLoop()
                    .catch(e => {
                        // answerLoop's own finally already cleared TOGGLE on every
                        // path that can reach this handler, and a stale TOGGLE = false here
                        // would cancel a newer run spawned while the old cleanup was pending
                        console.error(diagnostic(e, 'Answer loop'));
                        throw e;
                    })
                    .finally(() => {
                        // backstop: a run that crashed outside answerLoop's finally must
                        // not leave a stale handle behind, or every later press would be
                        // misread as "stop while running". The identity check is needed
                        // because a newer run can already be executing by the time an
                        // older run's cleanup settles (an Alt+S during cleanup spawns a
                        // fresh run while the old cleanup is still pending).
                        if (RUNNING === myRun) RUNNING = null;
                    });
                RUNNING = myRun;
                return myRun;
            }

            /**
 * Toggles the answer loop on/off (Alt+S hotkey).
 * If running, signals stop by setting TOGGLE=false. If stopped, starts a new run.
 * @returns {Promise<void>}
 */
            async function toggleLoop() {
                if (controls.status().state === 'running' && !TOGGLE) {
                    console.log('Restart requested; waiting for cleanup.');
                    await controls.restartAfterDrain();
                } else if (controls.status().state === 'running') {
                    console.log('Stopping answerLoop.');
                    await controls.stop();
                } else if (['stopped', 'error', 'completed'].includes(controls.status().state)) {
                    console.log('Starting answerLoop.');
                    controls.start();
                } else if (controls.status().state === 'closed') {
                    await notifyControl('The browser is closed; open a new session before starting again.');
                } else {
                    await notifyControl(`Answer control is ${controls.status().state}; wait until stopped before starting again.`);
                }
            }

            // Temporary Alt+I hotkey: one read-only Assessment capture while no
            // run is active. Never starts, answers or clicks anything. Remove
            // together with its docs once the Assessment inspection is done.
            async function inspectAssessmentHotkey() {
                // Held under the shared control lock so no run can start while
                // the capture is pending. Written under the app data root.
                const dir = require('node:path').join(require('node:os').homedir(), '.educationperfected', 'assessment-captures');
                if (capturingAssessment) return;
                let captured = null;
                try { captured = await controls.exclusive(async () => { capturingAssessment = true; try { return await captureAssessment(page, { dir }); } finally { capturingAssessment = false; } }); }
                catch { await notifyControl('Stop the run before an Assessment capture.'); return; }
                if (captured?.guard === 'captured') {
                    const where = captured.file ? ' Saved to ' + captured.file + '.' : captured.fileError ? ' The capture file could not be written (' + captured.fileError + ').' : '';
                    console.log('EP_ASSESSMENT_INSPECT ' + JSON.stringify(captured));
                    await notifyControl('Assessment captured (read-only); nothing was answered.' + where);
                } else await notifyControl('Not an Assessment page (or unreadable); nothing captured.');
            }

            /**
 * Toggles between auto mode (auto-submit Enter) and semi-auto mode (user presses Enter).
 * @returns {Promise<void>}
 */
            async function notifyControl(message) {
                console.log(message);
                try { await alert(message); } catch { console.warn('Browser notification could not be shown.'); }
            }

            async function toggleAuto() {
                try { await controls.mode(ENTER ? 'semi' : 'auto'); }
                catch { await notifyControl('Stop the run before changing mode.'); return; }
                await notifyControl(ENTER ? 'Switched to auto mode.' : 'Switched to semi-auto mode.');
            }

            async function refreshControl() {
                try { await controls.refresh(); }
                catch { await notifyControl('Word refresh failed or a run is still active; stop the run and check the task-starter word lists.'); }
            }

            /**
 * Shows a non-blocking toast message in the page (replaces native alert).
 * Persists across navigation via evaluateOnNewDocument.
 * @param {string} msg
 * @returns {Promise<void>}
 */
            async function alert(msg) {
                await page.evaluate((m, id) => {
                    let toast = document.getElementById(id);
                    if (!toast) {
                        // recreated after navigation, or on first use
                        toast = document.createElement('div');
                        toast.id = id;
                        toast.setAttribute('role', 'status');
                        toast.setAttribute('aria-live', 'polite');
                        Object.assign(toast.style, {
                            position: 'fixed',
                            top: '16px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: '2147483647',
                            padding: '10px 18px',
                            borderRadius: '6px',
                            background: 'rgba(20, 20, 20, 0.9)',
                            color: '#fff',
                            font: '14px/1.4 sans-serif',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                            pointerEvents: 'none',
                            opacity: '0',
                            transition: 'opacity 400ms ease',
                        });
                        document.body.appendChild(toast);
                    }

                    // reuse the same element so the live region stays registered with AT
                    toast.textContent = m;
                    toast.style.opacity = '1';

                    clearTimeout(toast.__epHide);
                    clearTimeout(toast.__epClear);
                    toast.__epHide = setTimeout(() => { toast.style.opacity = '0'; }, 1600);
                    toast.__epClear = setTimeout(() => { toast.textContent = ''; }, 2100);
                }, msg, DIR.toast_id);
            }

            const fillOnce = createFillGapsOnce({ detectQuestion, playGapsRound });
            const submitOnce = createSubmitGapsOnce({ fillGapsOnce: fillOnce });
            const runFillOnly = async () => {
                TOGGLE = true;
                try {
                    const result = await (gapsSubmitOnce ? submitOnce : fillOnce)(page, { shouldStop: () => !TOGGLE });
                    console.log((gapsSubmitOnce ? 'EP_SUBMIT_ONCE ' : 'EP_FILL_ONCE ') + JSON.stringify(result));
                    return result;
                } finally { TOGGLE = false; }
            };
            const selectOnce = createSelectChoiceOnce({ detectQuestion, detectQuestionInPage: readChoiceInPage });
            const runSelectOnly = async () => {
                TOGGLE = true;
                try {
                    const result = await selectOnce(page, { shouldStop: () => !TOGGLE });
                    console.log('EP_SELECT_ONCE ' + JSON.stringify(result));
                    return result;
                } finally { TOGGLE = false; }
            };
            const fillTextboxesOnce = createFillTextboxesOnce({ detectQuestion, playTextboxRound });
            const runTextboxFillOnly = async () => {
                TOGGLE = true;
                try {
                    const result = await fillTextboxesOnce(page, { shouldStop: () => !TOGGLE });
                    console.log('EP_TEXTBOX_FILL_ONCE ' + JSON.stringify(result));
                    return result;
                } finally { TOGGLE = false; }
            };
            const selectMultiOnce = createSelectMultiOnce({ detectQuestion, playMultiChoiceSelection });
            const runMultiSelectOnly = async () => {
                TOGGLE = true;
                try {
                    const result = await selectMultiOnce(page, { shouldStop: () => !TOGGLE });
                    console.log('EP_MULTI_SELECT_ONCE ' + JSON.stringify(result));
                    return result;
                } finally { TOGGLE = false; }
            };
            const submitDropdownOnce = createSubmitDropdownOnce({ detectQuestion, playDropdownRound, inputMode: dropdownInputMode });
            const runDropdownSubmitOnce = async () => {
                TOGGLE = true;
                try {
                    const result = await submitDropdownOnce(page, { shouldStop: () => !TOGGLE });
                    console.log('EP_DROPDOWN_ONCE ' + JSON.stringify(result));
                    return result;
                } finally { TOGGLE = false; }
            };
            const validationOnly = gapsFillOnly || choiceSelectOnly || gapsSubmitOnce || textboxFillOnly || dropdownSubmitOnce || multiSelectOnly;
            const controls = createRunControls({
                run: multiSelectOnly ? runMultiSelectOnly : dropdownSubmitOnce ? runDropdownSubmitOnce : textboxFillOnly ? runTextboxFillOnly : choiceSelectOnly ? runSelectOnly : (gapsFillOnly || gapsSubmitOnce) ? runFillOnly : startLoop,
                requestStop: () => { TOGGLE = false; cancelReflectionRequests(); },
                setMode: value => { ENTER = value === 'auto'; },
                refresh: refreshWords,
                inspect: () => collectSelfMarkDiagnostics(page),
                inspectDash: () => require('./lib/dash-diagnostics').collectDashDiagnostics(page),
                inspectComponents: () => require('./lib/components-diagnostics').collectComponentsDiagnostics(page),
                close: () => legacySignals && startupSignal ? closeSignalBrowser() : (ownsBrowser ? browser.close() : Promise.resolve().then(() => browser.disconnect())),
            });
            // Issue #222: expose accuracy in status and allow tuning when stopped.
            // Validation sessions stay perfect and reject accuracy changes.
            const baseStatus = controls.status.bind(controls);
            controls.status = () => ({ ...baseStatus(), accuracy: accuracyStatus(), pacing: humanDelay.describe(), supportReports: { enabled: savedConfig.supportReports !== false && String(process.env.EP_SUPPORT_REPORTS || '').toLowerCase() !== 'off' }, wordList: lastWordListRefresh });
            controls.setAccuracy = async raw => {
                if (validationOnly) throw new Error('Validation session is fixed to one-shot only.');
                const text = String(raw ?? '').trim().toLowerCase();
                // A bare `accuracy` is a read-only query and stays allowed during a run;
                // only changes require the stopped state (checked below).
                if (text === '' || text === 'show' || text === 'status') return controls.status();
                const state = baseStatus().state;
                if (!['stopped', 'completed', 'error'].includes(state)) throw new Error('Stop the run before changing accuracy.');
                if (['off', 'perfect', 'no-mistakes', 'no-mistake'].includes(text)) {
                    accuracyConfig = { ...accuracyConfig, enabled: false, fixedTarget: 100, source: 'interactive:off' };
                    accuracyRun = null;
                    console.log('Accuracy disabled (100% - perfect).');
                    return controls.status();
                }
                if (['on', 'default', 'auto'].includes(text)) {
                    const { DEFAULT_MIN, DEFAULT_MAX } = require('./lib/accuracy');
                    accuracyConfig = { enabled: true, min: DEFAULT_MIN, max: DEFAULT_MAX, fixedTarget: null, source: 'interactive:on' };
                    accuracyRun = null;
                    console.log(`Accuracy enabled with default band ${DEFAULT_MIN}-${DEFAULT_MAX}%.`);
                    return controls.status();
                }
                throw new Error('Usage: accuracy [on|off] (on = 70-90% band).');
            };
            const updateAccuracy = controls.setAccuracy;
            controls.setAccuracy = async raw => {
                const result = await updateAccuracy(raw);
                const text = String(raw ?? '').trim().toLowerCase();
                if (text && !['show', 'status'].includes(text)) persistSetting('accuracy', accuracyConfig);
                return result;
            };
            if (dropdownSubmitOnce) controls.inspectDropdowns = () => require('./lib/dropdown-diagnostics').collectDropdownDiagnostics(page,{definitionsOnly:true});
            // Human pacing control (issue #221): no action reports state, on/off
            // toggle the wait. The per-question-type ranges are the one tuned
            // behavior; there is no custom range. Dash (issue #230) shares the
            // per-type ranges in the reconstructions; delay off is the provisional
            // Dash recommendation (live scoring unproved).
            controls.delay = action => {
                if (action && !['stopped', 'completed', 'error'].includes(controls.status().state)) return { error: 'Stop the run before changing pacing.' };
                if (action === 'on') humanDelay.setEnabled(true);
                else if (action === 'off') humanDelay.setEnabled(false);
                else if (action) return { error: 'Use delay, delay on or delay off.' };
                const state = humanDelay.describe();
                if (action) persistSetting('delay', state);
                const base = state.enabled ? 'per-question-type ranges: ' + summarizeRanges() : 'off (super speed)';
                return { delay: `${base}. ${DASH_PACING_NOTE}` };
            };
            // Anonymous support reports (on by default once a relay is set): no action
            // reports state, on/off save the choice. EP_SUPPORT_REPORTS=off always wins.
            controls.reports = action => {
                if (action && !['stopped', 'completed', 'error'].includes(controls.status().state)) return { error: 'Stop the run before changing support reports.' };
                if (action === 'on' || action === 'off') {
                    savedConfig.supportReports = action === 'on';
                    persistSetting('supportReports', savedConfig.supportReports);
                } else if (action) return { error: 'Use reports, reports on or reports off.' };
                const enabled = savedConfig.supportReports !== false;
                const forcedOff = String(process.env.EP_SUPPORT_REPORTS || '').toLowerCase() === 'off';
                const sending = supportSender.isEnabled();
                return { reports: `${enabled && !forcedOff ? 'on' : 'off'}${forcedOff ? ' (EP_SUPPORT_REPORTS=off)' : ''}; ${sending ? 'a relay is configured' : 'no relay is configured, so nothing is sent'}. The local report block always prints.` };
            };
            browser.on('disconnected', () => { controls.browserClosed(); onBrowserDisconnected(); });

            // The desktop has its own controls. Only the CLI installs a panel in the task page.
            if (browserControls) {
                const { createBrowserControl, installControlMenu } = require('./lib/browser-controls');
                const browserControl = createBrowserControl({
                    controls,
                    validationOnly,
                    restartNeeded: () => controls.status().state === 'running' && !TOGGLE,
                    notify: notifyControl,
                });
                await page.exposeFunction('epControl', browserControl);
                await page.evaluateOnNewDocument(installControlMenu);
                await page.evaluate(installControlMenu);
            }

            // Expose API functions to the page (for hotkey event listeners to call).
            // These bindings live on the browser context, not on the document, so they
            // survive navigation - but the keyup listener does not, and must be re-added.
            await page.exposeFunction('refresh', validationOnly ? () => 'Validation session: refresh is disabled.' : refreshControl);
            await page.exposeFunction('startAnswer', validationOnly ? () => 'Validation session: use the approved terminal one-shot command.' : toggleLoop);
            await page.exposeFunction('inspectAssessmentKey', validationOnly ? () => 'Validation session: capture is disabled.' : inspectAssessmentHotkey);
            await page.exposeFunction('toggleMode', validationOnly ? () => 'Validation mode is fixed to one-shot only.' : toggleAuto);
            // Harness-only observability and idempotent stop, never inferred
            // from log text or exposed during normal runs.
            if (TEST_BOOT) {
                await page.exposeFunction('epTestState', () => ({ running: ['running', 'stopping'].includes(controls.status().state) }));
                await page.exposeFunction('epTestStop', () => controls.stop());
            }

            /**
             * Installs the hotkey keyup listener on the page document.
             * Registered via evaluateOnNewDocument to survive navigations.
             * Idempotent: guarded by window.__epHotkeysInstalled.
             * @returns {void}
             */
            const installHotkeysInPage = () => {
                if (window.top !== window || window.__epHotkeysInstalled) return;
                window.__epHotkeysInstalled = true;

                document.addEventListener("keyup", async (event) => {
                    let key = event.key.toLowerCase();
                    if (key !== 'alt') {
                        if ((event.altKey && key === "r") || (key === "®")) {
                            await window.refresh();
                        } else if ((event.altKey && key === "s") || (key === "ß")) {
                            await window.startAnswer();
                        } else if ((event.altKey && key === "a") || (key === "å")) {
                            await window.toggleMode();
                        } else if (event.altKey && event.code === "KeyI") {
                            await window.inspectAssessmentKey();
                        }
                    }
                });
            };

            if (!validationOnly) {
                await page.evaluateOnNewDocument(installHotkeysInPage);
                await page.evaluate(installHotkeysInPage);
            }

            console.log('Education Perfected V2026 fully Loaded.');
            if (legacySignals) {
                // Legacy entrypoints have no CLI signal owner. Keep this owner
                // and drain shared controls before closing the owned browser.
                signalClose = () => controls.close();
                legacyReady = true;
                browser.once('disconnected', () => { if (!startupSignal) removeStartupSignals(); });
            } else removeStartupSignals();
            return controls;
        })
        .catch(async error => {
            if (TEST_BOOT) require('./lib/test-startup-failure').recordStartupFailure(error, startupBrowser, true);
            if (startupSignal) {
                if (startupBrowser) await shutdownStartup();
                else { removeStartupSignals(); process.exit(exitCodeFor(startupSignal)); }
                return;
            }
            removeStartupSignals();
            if (startupBrowser) {
                let timer;
                try {
                    await Promise.race([
                        closeLaunchedBrowser(),
                        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser close timed out')), 3000); }),
                    ]);
                }
                catch {
                    // close() can fail on a broken control connection. An owned
                    // browser child is still ours to terminate; an attached one
                    // belongs to the app's window, so only disconnect it.
                    if (ownsBrowser) startupBrowser.process()?.kill();
                    startupBrowser.disconnect();
                } finally { clearTimeout(timer); }
            }
            throw error;
        });
}

module.exports = { launchProgram, promptCredentials, promptSecret };
if (require.main === module) {
    launchProgram({ legacySignals: true }).catch(error => {
        console.error(diagnostic(error, 'EducationPerfected startup'));
        process.exitCode = 1;
    });
}
