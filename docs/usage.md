# Run and control EducationPerfected

[Documentation](README.md) / [Install and update](install-and-update.md)

## Desktop app

Open EducationPerfected from the Start menu on Windows, Applications on macOS, or the application menu on Linux. For a source ZIP or checkout, run `npm run app` after `npm ci`.

Complete the first-run wizard, optionally save a login, then sign in in the embedded browser. Open a task, refresh its words when available, and use the app's Start/Stop, mode, accuracy and pacing controls. Accuracy and pacing are on/off toggles; their confirmed state is shown in the app. Stop the run before changing them.

The desktop app has no browser-page control panel, even when its sidebar is collapsed. Collapsing the sidebar only changes the desktop layout. Closing the app ends its session.

## Terminal CLI

For an installed CLI, run `educationperfected`. For a source checkout, open a terminal in the repository folder, run `npm ci` once, then:

    npm run cli

The CLI opens a browser window, loads EP's login page and waits. Sign in in the browser (school SSO, Google, Microsoft or Clever work too), open a task, then type commands in the terminal:

- `start` - start auto-answering; `stop` - stop it
- `mode auto` - answer and submit automatically (default); `mode semi` - fill answers but leave submitting to you
- `accuracy` - show accuracy config, per-run target and first-try stats; `accuracy on|off` - set accuracy when stopped (on = 70-90% band, off = no intentional mistakes)
- `delay` - show the human-paced wait before each submission (off by default); `delay on` - enable the per-question-type wait; `delay off` - restore super speed
- `refresh` - learn the answers from a task starter page's word lists (once per new task)
- `status` - show current status (including accuracy target)
- `inspect-self-mark` - read-only capture of a self-mark (Reflection) page
- `inspect-dash` - read-only capture of a Dash round's structure (used for shapes the Dash answerer refuses)
- `inspect-components` - read-only capture of a slide's question components (used for slides the answerer refuses on an accompanying component)
- `inspect-assessment` - read-only capture of an Assessment page: short summary line plus a full JSON file in `assessment-captures/` (Assessment answering stays disabled)
- `watch-assessment [on|off|status]` - passive read-only watch that writes a new capture file whenever the Assessment page changes
- `quit` - close the CLI

CLI and legacy terminal sessions have a collapsible **EducationPerfected** menu in the top-right
corner by default. The desktop app does not install this menu in its embedded page. A one-line status bar at the top keeps state, mode, accuracy and pacing in
sync with the terminal and hotkeys; action results appear directly below it as
plain sentences ("Running.", "Pacing: a short human-like pause before each answer (varies by question type)."), with the
raw JSON under **Technical details**.
Below that are the controls: start/stop, change mode, refresh words, and set/read
accuracy and pacing with on/off toggles and separate Read buttons. Changes are disabled while a run or setting change is active. Read-only inspections (`inspect-self-mark`, `inspect-dash`,
`inspect-components`, `inspect-assessment`, `watch-assessment`) stay terminal-only developer commands and are not in the
menu. Drag it by its
header to move it anywhere on screen; the position is remembered across pages and
it cannot be lost off-screen. Collapse it when it covers task content; its inputs
are isolated from EP's page controls. It is reinstalled once after each navigation.
The terminal still owns quit and any one-shot validation approvals.

The legacy entrypoint (hotkeys and browser menu, without terminal commands) is still there: run `node index.js`, or double-click [start.cmd](../start.cmd) (Windows) or [start.sh](../start.sh) (Linux/Mac).

You can close the browser window or the popped-up terminal window whenever you are done. If you run into weird behavior, try restarting the program.

### Saved settings

Interactive `accuracy` and `delay` changes are saved to
`~/.educationperfected/config.json` (Windows: `%USERPROFILE%\.educationperfected\config.json`).
The next launch reuses them. CLI accuracy options override environment variables,
which override saved settings, which override built-in defaults. Flags and env
changes are not saved. `accuracy off` restores perfect answers; `delay on` enables the per-type wait and `delay off` restores super speed. Invalid config files fall back to defaults.
Version 2 resets old saved accuracy and pacing settings to off on upgrade. Later on/off choices persist; old numeric accuracy targets and custom pacing ranges are not restored. Credentials stay in the OS keyring, never in this file.

### Random accuracy (off by default)

No intentional mistakes are added unless you opt in. `accuracy on` picks a first-try target between 70% and 90% at each `start`. It occasionally submits a small typo for text/audio or a neighboring distractor for single-choice, then follows the normal retry/advance path. Other lesson surfaces retain their fail-closed completion checks. This is a target, not a guaranteed final score; unsupported rounds are still refused. Accuracy off is the provisional Dash recommendation because mistakes can burn sprint time and points (unproved live).

Accuracy has only on/off settings, with no custom targets or ranges:

    educationperfected --accuracy on      # or -a on
    educationperfected --accuracy off
    educationperfected --perfect          # or -p, same as off
    educationperfected accuracy on        # 70-90% band for this invocation
    educationperfected accuracy off       # no intentional mistakes (default)
    educationperfected accuracy status    # report without launching

Interactive changes inside the running app are saved. Startup flags and environment changes are not saved. Env: `EP_ACCURACY=on|off`, `EP_PERFECT=0` (on) or `EP_PERFECT=1` (off). Numeric values for `EP_ACCURACY` and `EP_ACCURACY_RANGE` are rejected; `EP_PERFECT` accepts only `0` or `1`. `status` shows the target and first-try stats; the log reports a target at start and a summary at exit.

## Runtime behavior (CLI and legacy)

When you run the script, it should:
- Open a new browser window with no user data, so you log in to EP manually, or set both `EP_EMAIL` and `EP_PASSWORD` for auto-login.
- Load EP's login page. It is no longer served from `app.educationperfect.com`: that address redirects to EP's identity provider (`iam.educationperfect.com`), where the same username/password fields live.
- Load EP's home page, with all auto-answer functionality loaded in the background.
- Log in for you if you provided credentials (username/password only; SSO, Google, Microsoft, Clever and any CAPTCHA must be completed by hand).
- Cancel the terminal credential prompt by itself when the login completes in the browser first, so signing in by hand needs no terminal interaction, and answering the prompt after a completed login can no longer crash the run.

The hotkeys keep working across page loads (they are re-installed on every new page). At the task starter or task page, use the hotkeys to answer questions.

When auto-answering is triggered, it should:
- Use the guarded input path for each supported question type. Text and audio answer fields use real keystrokes and verify the field before submission. Choices, dropdowns, gaps and other supported surfaces use their own checks; see [question contracts](question-types.md). Speed depends on the surface, pacing and page readiness.
- Stop when it finishes the task, or when you press the same hotkey again.
- Delete the popup modals should it get any questions wrong.
- Retry the occasional slow round instead of aborting the whole task.

The program also watches itself. If the page gets stuck in a state it can't progress from (question text that never settles, an answer box that keeps vanishing, rounds that never advance), it stops the run and logs the reason in the terminal, instead of hanging or submitting garbage. Press Start Answering again to start a fresh run.

_NOTE: If you close the terminal window that pops up when you run the script, the browser window closes too._

The full expected-behaviour text and feature notes (speed trade-off, self-learning, word parsing) are in [docs/question-types.md](question-types.md#runtime-behaviour-full-text).

## Features

- **Start Answering:** automatically answers the question on the page from the pre-learned dictionary and submits it. With pacing on (`delay on`), each answer lands after a short randomized wait from a per-question-type range (2-6s for word rounds, 3-8s for choice/dropdown/highlight, 4-10s for typed answers, gaps and input boxes, 5-12s for mixed slides, 6-15s for working formula, 8-15s for audio) so the run reads as a student working rather than a bot; pacing is off by default (super speed), and `EP_HUMAN_DELAY=on` enables it for one launch. The waits are tuned for untimed tasks; when pacing is on, Dash rounds use these per-type ranges too — see [Dash](question-types.md#dash-timed-word-to-word-sprint).
- **Full speed trade-off:** answers are typed as real keystrokes, spaced out and verified against the answer box before submission, because EP's own input handling garbles faster-but-fragile approaches ("I speak" used to land as "I I sI speakeakat").
- **Task support report:** at the end of every run (a refusal always ends the run) the app prints a copyable text block listing the task types it met and how many it answered, refused or skipped, with a reason category for each refusal or skip. It holds task type names and fixed reason categories only: no question text, answers, page content or credentials.
- **Anonymous support reports:** a refusal or skip is also sent as one tiny report per distinct task type and reason per session (for an unsupported question, per refusal branch), so a public GitHub issue can track unsupported tasks. The payload is four fields: `task_type`, `reason` (both from fixed lists), `app_version` and `schema`. Example: `{"task_type":"audio","reason":"no-handler","app_version":"2026.11.26","schema":1}`. A refused unsupported question (`reason` `unsupported-question`) also sends six more fields (still `schema` 1) from fixed lists or small integers: `branch` (why it was refused), `game_mode` (`classic`, `assessment`, `lesson`, `unknown`), `question_type` (EP's number, or `-1` when unknown), `component_count` (a number, `-1` when unknown), `components` (EP component codes, unlisted ones as `UNLISTED_COMPONENT`, at most 8) and `controls` (counts of inputs, text areas, selects, editable areas, canvases and buttons). No timestamp, ID, address, question or answer is included, failures are ignored, and it never changes a run. Turn it on or off with the `reports on|off` command (when stopped) or the Support reports switch in the desktop app. You can also use `EP_SUPPORT_REPORTS=off` or set `"supportReports": false` in `config.json`. The local report block is always printed; it lists task types and reason categories, plus the branch, game mode, question type and component codes of an unsupported question. Reports are on by default.
- **Toggle Mode:** fully-auto blasts through the task once started; semi-auto types the answer but leaves pressing enter/submit to you. Semi-auto is useful if your teacher checks how long you spend on tasks.
- **Refresh Words:** learns the answers from the word lists on the task starter page (where the words and translations are laid out). On word-to-word rounds the run also reads the accepted answers EP ships to the browser with the question, so listed words are answered first-try even without a refresh; trigger it for each new task anyway, since anything the round state does not ship is wrong until error-correction learns it. The learned dictionary lives only in the running program's memory, so after a restart press Refresh Words again.
- **Self-learning / error correction:** when an error is made, the script handles the popup, extracts the correct answer, and avoids repeating the mistake. The wrong-answer popup has a normal 3-second delay before it can be closed, so it is deleted instead.
- **Smart-ish word parsing:** questions are matched to answers despite EP's inconsistent formatting. Most edge cases are handled, and self-learning covers many of the rest. Extreme cases (such as commas with repeated words, or displayed and expected answers that disagree) can still be answered incorrectly.

## Hotkeys

Upon starting, the program opens the browser and gets EP ready (including logging in if credentials are set), but it does not begin auto-answering until you tell it to. The same functions are triggered by hotkeys in the CLI and the legacy program:

- **Refresh Words -> <kbd>Opt/Alt</kbd> + <kbd>R</kbd>:** on a task-starter page with the word list. Confirms with a toast, including how many entries were scraped (and a warning if the two word lists didn't line up).
- **Mode Toggle -> <kbd>Opt/Alt</kbd> + <kbd>A</kbd>:** works at any time, even while auto-answering. Confirms which mode is now active.
- **Start Answering -> <kbd>Opt/Alt</kbd> + <kbd>S</kbd>:** on a running task's page. Press it again to stop.
- **Assessment capture -> <kbd>Opt/Alt</kbd> + <kbd>I</kbd> (temporary):** one read-only capture of an Assessment page (same file format and `EP_ASSESSMENT_INSPECT` line as `inspect-assessment`, saved in `assessment-captures/` under `~/.educationperfected`). Needs the run stopped; never answers anything. Will be removed after the Assessment inspection.

*NOTE: key combinations must be pressed in sequence: PRESS Alt, PRESS & RELEASE the letter key, RELEASE Alt. If you release Alt before the letter key, the combination isn't detected. (On macOS, Option + R/A/S types `®`, `å` or `ß`; those combinations are accepted too.)*

