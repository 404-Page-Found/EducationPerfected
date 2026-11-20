# EducationPerfected

#### A JavaScript program that automatically answers Education Perfect language questions at **super** speeds.

It automates word-to-word (translation) tasks, audio tasks (Listening and Dictation) and multiple-choice questions in auto-marked Smart Lessons, plus choice and typed rounds in Dash (timed sprint) on [Education Perfect](https://www.educationperfect.com/). The question types and their limits are listed in [Supported question types](#supported-question-types).

**Live verification:** the word-to-word task flow has been run end-to-end against the live Education Perfect service. Other question types have only bounded live checks or synthetic coverage, and Dash has not been answered live. The dated evidence is in the [changelog](CHANGELOG.md#live-verification-log).

![example image](result.png)

## Status

> [!WARNING]
> **Heads up:** this repository continues the original EducationPerfected project. It is *not* the original, actively maintained project.

The original was started by [akioweh](https://github.com/akioweh) and is now **[archived](https://github.com/akioweh/EducationPerfected)**. This repo is a loving continuation of that work.

The original's README used to claim its status was: **_CORRECT STATUS: ALL intended features functional._**  
_*Last time they checked... which was... two years ago???*_

- This repo's development program is **V2026** (package version `2026.11.16`, published as release [v2026.11.16](https://github.com/404-Page-Found/EducationPerfected/releases/tag/v2026.11.16)). It is an independent JavaScript ([node.js](https://nodejs.org/)) program that uses the [Puppeteer](https://github.com/puppeteer/puppeteer) library to drive a web browser.
- The anti-cheat workaround no longer trips anti-cheat detection, as of the latest updates. EP can still change, so don't assume it stays working.
- The task-page and wrong-answer-modal selectors were checked against what EP's live bundles currently ship, and an end-to-end run through a real task on the live service confirmed the markup reading was correct.
- Release, signing and rights status: see [release/README.md](release/README.md) and [release/license-and-rights.md](release/license-and-rights.md).

## Introduction

This project started as a way to automate tasks on [Education Perfect](https://www.educationperfect.com/), which teachers use to set students homework. One of those students was me. The main target was language tasks that ask you to translate words or phrases.

The first approach was a simple userscript pasted into the browser debugger console ([V1](V1_Archive)). It ran at **super** speeds until Education Perfect added anti-cheat features that partly disabled it. To get around that, the script needed more control over the page and could no longer run from the console. The program started as V2 and continues as V2026. Its installation is more involved, but it is currently the only way to get the full anti-cheat bypass.

A snapshot of V2 at version **v2.2.0** is frozen in [V2_Archive/](V2_Archive), alongside the [V1](V1_Archive) snapshot (see [V2_Archive/README.md](V2_Archive/README.md) for what was frozen). The live root codebase continues as **V2026**, skipping V3 as a release name. The version name does not mean the packaged CLI has shipped; its release gates still apply.

## Installation

### Installer (recommended)

Installers are published with **[v2026.11.16](https://github.com/404-Page-Found/EducationPerfected/releases/tag/v2026.11.16)** (15 November 2026); the [Publish workflow](.github/workflows/publish.yml) attaches them to the release. The gates in [release/README.md](release/README.md) still apply.

The installer is the same on every platform; pick yours:

**Windows:**
1. Download `educationperfected-windows-x64-setup.exe` and `SHA256SUMS` from the release. Check the download against `SHA256SUMS` before running it.
2. Run the installer (per-user, no admin). Select **Add EducationPerfected to your PATH**. Builds are unsigned; if SmartScreen shows "Windows protected your PC", choose **More info -> Run anyway**.
3. Open a new terminal and run `educationperfected setup`. It asks consent for a one-time Chrome download from Google, then offers an optional saved login.
4. Start the app. **Recommended:** open **EducationPerfected** from the Start menu (the installer adds it there). You can also run `educationperfected` in a terminal.

**macOS:**
1. Download `educationperfected-macos-arm64.pkg` (Apple Silicon) or `educationperfected-macos-x64.pkg` (Intel) and `SHA256SUMS` from the release. Check the download against `SHA256SUMS` before running it.
2. Run the installer; it puts `educationperfected` in `/usr/local/bin`, which is already on your PATH. Builds are unsigned; right-click the `.pkg` and choose **Open**.
3. Open a new terminal and run `educationperfected setup`. It asks consent for a one-time Chrome download from Google, then offers an optional saved login.
4. Run `educationperfected`.

**Linux:**
1. Download the `.deb` or `.rpm` for your architecture and `SHA256SUMS` from the release. Check the download against `SHA256SUMS` before installing it.
2. Install the package with your package manager (for example `sudo apt install ./educationperfected_2026.11.16_amd64.deb` or `sudo dnf install ./educationperfected-2026.11.16-1.x86_64.rpm`). It puts `educationperfected` in `/usr/bin`, which is already on your PATH.
3. Run `educationperfected setup`. It asks consent for a one-time Chrome download from Google, then offers an optional saved login.
4. Run `educationperfected`.

**Other ways to install:**
- **Install scripts:** download `install.ps1` (Windows) or `install.sh` (macOS/Linux) from the release. After checking the script, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` in PowerShell (bypass applies only to that process) or `sh install.sh` in a terminal. Follow the script's PATH instructions.
- **npm:** run `npm install -g --allow-scripts=educationperfected educationperfected` (requires Node.js). The `--allow-scripts` opt-in is needed on npm 12+; the postinstall downloads the platform binary and verifies it against the release's `SHA256SUMS`. See [npm/educationperfected/README.md](npm/educationperfected/README.md) for the npm package.

After any of these, run `educationperfected setup`, then `educationperfected`. The install scripts and npm package verify the binary download against the release's `SHA256SUMS`; check manual downloads against it yourself. Raw platform binaries are also included for advanced use. On macOS/Linux, run `chmod +x <filename>` first; on macOS, remove quarantine with `xattr -d com.apple.quarantine <filename>` if blocked. Run the raw file by its path instead of `educationperfected` (for example, `.\educationperfected-windows-x64.exe setup` or `./educationperfected-macos-arm64 setup`).

### From source (advanced)

Use this route to run the source directly; it needs Node.js and the full repository.

1. Download the full source ZIP of the `main` branch (**Code -> Download ZIP** on [the repo page](https://github.com/404-Page-Found/EducationPerfected)) and extract it into a new folder. The program needs the whole tree: [index.js](index.js) loads the [lib/](lib/) folder and the CLI loads [packaging/](packaging/), so copying only some files fails with `Cannot find module './lib/...'`.
2. Install [node.js](https://nodejs.org/), version **22.12 or newer** for running the source (the pinned Puppeteer requires it). Building a standalone development executable requires **Node 22.23.4 exactly**; see the [developer guide](docs/developer-guide.md).
3. Open Command Prompt/Terminal **in the folder where `index.js` is located**.
4. Install the dependencies with `npm ci`.
5. Optionally set your **Education Perfect credentials** as environment variables for auto-login:
   - **Windows (Command Prompt):** `set EP_EMAIL=you@example.com` then `set EP_PASSWORD=your-password`
   - **Windows (PowerShell):** `$env:EP_EMAIL='you@example.com'; $env:EP_PASSWORD='your-password'`
   - **Linux/macOS (Terminal):** `export EP_EMAIL='you@example.com' EP_PASSWORD='your-password'`

   Set **both** variables, and keep credential values out of source files. Saved-login storage for the source build is in [CLI credential setup](docs/developer-guide.md#cli-credential-setup-source-build).
6. Dropdowns in the normal run always use the guarded F4 native-popup path; no environment variable is needed. This path handles one or more dropdowns in order and submits each fully verified question automatically in auto mode. There is no Home/ArrowDown fallback.

_The starter scripts run `npm ci` for you the first time if `node_modules` is missing, so double-clicking is enough. `npm ci` installs exactly what [package-lock.json](package-lock.json) records._

_Forgot to set the credentials? The browser still opens and you can log in manually. If the terminal asks for your credentials, you can ignore it and sign in in the browser: a login that completes there cancels the prompt by itself._

_Auto-login only fills in EP's own username/password form. If you sign in through school SSO, Google, Microsoft or Clever, log in manually in the browser window. The script never touches those flows or the reCAPTCHA on EP's login page._

_NOTE: `npm ci` normally downloads a compatible Chrome browser automatically (via Puppeteer's install script). If the first run can't find a browser, run `npx puppeteer browsers install chrome` in the same folder. If your npm does not run install scripts (for example npm 12's `allowScripts` gate), that download is skipped and this step is required._

## Quick start

For a Windows installer-based installation, start **EducationPerfected** from the Start menu. On any installer-based installation you can run `educationperfected` in a terminal. For a source installation, open a terminal in the folder where `index.js` is located, run `npm ci` once, then:

    npm run cli

The CLI opens a browser window, loads EP's login page and waits. Sign in in the browser (school SSO, Google, Microsoft or Clever work too), open a task, then type commands in the terminal:

- `start` - start auto-answering; `stop` - stop it
- `mode auto` - answer and submit automatically (default); `mode semi` - fill answers but leave submitting to you
- `accuracy` - show accuracy config, per-run target and first-try stats; `accuracy <n|min-max|off|on>` - set accuracy when stopped (e.g. `accuracy 82`, `accuracy 70-90`, `accuracy off`)
- `delay` - show the human-paced wait before each submission; `delay off` - restore super speed; `delay on` - re-enable; `delay MIN-MAX` - set the wait range in seconds (e.g. `delay 2-6`); `delay reset` - restore the per-question-type ranges
- `refresh` - learn the answers from a task starter page's word lists (once per new task)
- `status` - show current status (including accuracy target)
- `inspect-self-mark` - read-only capture of a self-mark (Reflection) page
- `inspect-dash` - read-only capture of a Dash round's structure (used for shapes the Dash answerer refuses)
- `quit` - close the CLI

The browser also has a collapsible **EducationPerfected** menu in the bottom-right
corner. A one-line status bar at the top keeps state, mode, accuracy and pacing in
sync with the terminal and hotkeys; action results appear directly below it as
plain sentences ("Running.", "Pacing: waiting 2-6s before each answer."), with the
raw JSON under **Technical details** (inspection captures stay raw for copying).
Below that are the controls: start/stop, change mode, refresh words, set/read
accuracy and pacing, and read-only self-mark/Dash inspections. Drag it by its
header to move it anywhere on screen; the position is remembered across pages and
it cannot be lost off-screen. Collapse it when it covers task content; its inputs
are isolated from EP's page controls. It is reinstalled once after each navigation.
The terminal still owns quit and any one-shot validation approvals.

The legacy entrypoint (hotkeys and browser menu, without terminal commands) is still there: run `node index.js`, or double-click [start.cmd](start.cmd) (Windows) or [start.sh](start.sh) (Linux/Mac).

You can close the browser window or the popped-up terminal window whenever you are done. If you run into weird behavior, try restarting the program.

### Saved settings

Interactive `accuracy` and `delay` changes are saved to
`~/.educationperfected/config.json` (Windows: `%USERPROFILE%\.educationperfected\config.json`).
The next launch reuses them. CLI accuracy options override environment variables,
which override saved settings, which override built-in defaults. Flags and env
changes are not saved. `accuracy off` restores perfect answers; `delay on` re-enables pacing while keeping any custom range; `delay reset` restores
the per-type ranges. Invalid config files fall back to defaults.
Credentials stay in the OS keyring, never in this file.

### Random accuracy (off by default)

Runs answer perfectly unless you opt in. When enabled, each `start` picks a first-try target in the configured band (70-90% via `accuracy on`) and, with probability `1 - target`, submits a plausible-but-wrong answer first: a small typo for text/audio, or a neighboring distractor for single-choice. The mistake flows through the normal wrong-answer-modal / retry / Next path, so the run still completes with lower first-try accuracy. Other lesson surfaces stay perfect to preserve their fail-closed completion proofs. The provisional Dash recommendation is perfect answers, because each Dash mistake is expected, unproved live, to burn sprint time and points.

Startup flags and env enable and tune the simulation (installer command shown; for a source checkout pass the same option to `npm run cli`, e.g. `npm run cli -- --accuracy 82`):

    educationperfected --accuracy 82      # or -a 82
    educationperfected --accuracy-range 70-90   # or -r 70-90
    educationperfected --perfect          # or -p

The same settings exist as a top-level subcommand (applies to this invocation only;
interactive commands inside the running app are saved):

    educationperfected accuracy 82        # fixed target for this run
    educationperfected accuracy 70-90     # band, randomized per run
    educationperfected accuracy off       # perfect (100%) - the default
    educationperfected accuracy on        # 70-90 band
    educationperfected accuracy status    # show the resolved config without launching

`--no-mistakes` is an alias for `--perfect` (100%). Env: `EP_ACCURACY=82`, `EP_ACCURACY_RANGE=70-90`, `EP_PERFECT=0` (enable the default band), `EP_PERFECT=1` (force perfect). `status` shows the active target and first-try stats; the run log reports `Accuracy target X%` at start and a summary at exit.

## How it behaves

When you run the script, it should:
- Open a new browser window with no user data, so you log in to EP manually, or set both `EP_EMAIL` and `EP_PASSWORD` for auto-login.
- Load EP's login page. It is no longer served from `app.educationperfect.com`: that address redirects to EP's identity provider (`iam.educationperfect.com`), where the same username/password fields live.
- Load EP's home page, with all auto-answer functionality loaded in the background.
- Log in for you if you provided credentials (username/password only; SSO, Google, Microsoft, Clever and any CAPTCHA must be completed by hand).
- Cancel the terminal credential prompt by itself when the login completes in the browser first, so signing in by hand needs no terminal interaction, and answering the prompt after a completed login can no longer crash the run.

The hotkeys keep working across page loads (they are re-installed on every new page). At the task starter or task page, use the hotkeys to answer questions.

When auto-answering is triggered, it should:
- Grind through the task at several questions per second. Each answer is typed out as real keystrokes and only submitted once the answer box is verified to contain it.
- Stop when it finishes the task, or when you press the same hotkey again.
- Delete the popup modals should it get any questions wrong.
- Retry the occasional slow round instead of aborting the whole task.

The program also watches itself. If the page gets stuck in a state it can't progress from (question text that never settles, an answer box that keeps vanishing, rounds that never advance), it stops the run and logs the reason in the terminal, instead of hanging or submitting garbage. Press Start Answering again to start a fresh run.

_NOTE: If you close the terminal window that pops up when you run the script, the browser window closes too._

The full expected-behaviour text and feature notes (speed trade-off, self-learning, word parsing) are in [docs/question-types.md](docs/question-types.md#runtime-behaviour-full-text).

## Features

- **Start Answering:** automatically answers the question on the page from the pre-learned dictionary and submits it. To read as a student working rather than a bot, each answer lands after a short randomized wait from a per-question-type range (2-6s for word rounds, 3-8s for choice/dropdown/highlight, 4-10s for typed answers, gaps and input boxes, 5-12s for mixed slides, 6-15s for working formula, 8-15s for audio). `delay off` (or `EP_HUMAN_DELAY=off`) restores super speed. The waits are tuned for untimed tasks; see [Dash](docs/question-types.md#dash-timed-word-to-word-sprint).
- **Full speed trade-off:** answers are typed as real keystrokes, spaced out and verified against the answer box before submission, because EP's own input handling garbles faster-but-fragile approaches ("I speak" used to land as "I I sI speakeakat").
- **Toggle Mode:** fully-auto blasts through the task once started; semi-auto types the answer but leaves pressing enter/submit to you. Semi-auto is useful if your teacher checks how long you spend on tasks.
- **Refresh Words:** learns the answers from the word lists on the task starter page (where the words and translations are laid out). Trigger it for each new task; otherwise questions with unknown answers are wrong until error-correction learns them. The learned dictionary lives only in the running program's memory, so after a restart press Refresh Words again.
- **Self-learning / error correction:** when an error is made, the script handles the popup, extracts the correct answer, and avoids repeating the mistake. The wrong-answer popup has a normal 3-second delay before it can be closed, so it is deleted instead.
- **Smart-ish word parsing:** questions are matched to answers despite EP's inconsistent formatting. Most edge cases are handled, and self-learning covers many of the rest. Extreme cases (such as commas with repeated words, or displayed and expected answers that disagree) can still be answered incorrectly.

## Hotkeys

Upon starting, the program opens the browser and gets EP ready (including logging in if credentials are set), but it does not begin auto-answering until you tell it to. The same functions are triggered by hotkeys in the CLI and the legacy program:

- **Refresh Words -> <kbd>Opt/Alt</kbd> + <kbd>R</kbd>:** on a task-starter page with the word list. Confirms with a toast, including how many entries were scraped (and a warning if the two word lists didn't line up).
- **Mode Toggle -> <kbd>Opt/Alt</kbd> + <kbd>A</kbd>:** works at any time, even while auto-answering. Confirms which mode is now active.
- **Start Answering -> <kbd>Opt/Alt</kbd> + <kbd>S</kbd>:** on a running task's page. Press it again to stop.

*NOTE: key combinations must be pressed in sequence: PRESS Alt, PRESS & RELEASE the letter key, RELEASE Alt. If you release Alt before the letter key, the combination isn't detected. (On macOS, Option + R/A/S types `®`, `å` or `ß`; those combinations are accepted too.)*

## Supported question types

| Question type | Status | Details |
| --- | --- | --- |
| Word-to-word translation tasks | Run end-to-end against the live service | [question types](docs/question-types.md) |
| Listening and Dictation (audio) | Bounded live checks; answered from data EP ships to the browser | [audio contract](docs/question-types.md#assigned-vocabulary-audio-contract) |
| Smart Lesson multiple-choice (single-choice) | Bounded live check in auto-marked activities | [single-choice contract](docs/question-types.md#plain-block-single-choice-source-contract) |
| Multi-select | Synthetic coverage only | [contract](docs/question-types.md#multi-select-source-contract) |
| Drag-and-drop fill-in-the-gaps | Narrow source contract; synthetic coverage plus the 5/6 November one-question live validations | [contract](docs/question-types.md#drag-and-drop-fill-in-the-gaps-contract) |
| Ordinary lesson dropdowns | Guarded; synthetic coverage plus one bounded live submission | [contract](docs/question-types.md#ordinary-lesson-dropdown-source-contract) |
| Text and number boxes | Narrow source contract; synthetic coverage | [contract](docs/question-types.md#ordinary-lesson-text-and-number-box-source-contract) |
| Highlight (click the correct tokens) | Narrow source contract; synthetic coverage | [contract](docs/question-types.md#highlight-source-contract) |
| Reflection / self-mark pages | Fills the user's own text only; submission and self-marking stay with the user | [contract](docs/question-types.md#reflection-and-self-mark-pages-114) |
| Short-answer lesson questions | Answered the same way; not live-verified yet | [known limitations](docs/question-types.md#known-limitations-full-text) |
| Dash (timed sprint) choice and typed rounds | Answered from the live-captured round shapes; fixture-tested only, not yet live-verified end to end | [Dash](docs/question-types.md#dash-timed-word-to-word-sprint) |
| Matching, ordering, image-based and other manual or assessment questions | Detected and reported, not answered | [assessment boundary](docs/question-types.md#assessment-source-boundary) |

Unsupported Smart Lesson question types are detected and reported, not guessed at.

## Known limitations

- **Dash support is fixture-tested only.** Choice rounds (19 November 2026) and typed rounds (20 November 2026) are answered from live structural captures (see [CHANGELOG](CHANGELOG.md#live-verification-log)); no end-to-end live Dash sprint has been run through the program yet, and other Dash layouts are refused by name. Run `inspect-dash` at a refused round and send the `EP_DASH_INSPECT` line to help extend support.
- **Audio answers depend on EP's data.** Audio is answered from the data EP ships to the browser before submission. If that state goes missing, those tasks fail loudly rather than fall back to guessing. Self-test work still earns points and stays visible to teachers.
- **Smart Lesson support is limited.** Only explicitly auto-marked activities are answered. Full-lesson completion and automated rejection handling are not proved live.
- **Word-list parsing is best-effort.** Extreme formatting cases can still produce incorrect answers.
- **The anti-cheat bypass may stop working** when the service changes.

The full text, with dates and citations, is in [docs/question-types.md](docs/question-types.md#known-limitations-full-text).

## Contributing

Contributions are welcome: new features, bug fixes, anti-cheat bypass, or documentation. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Developer, build, and validation notes are in the [developer guide](docs/developer-guide.md).

## Future plans

This is a purely hobby-driven project, so consistent development and maintenance are not guaranteed. Existing resources here remain public and accessible.

- Auto navigation between tasks (temporarily achieved with script+.js during V1)
- Dedicated anti-cheat bypass features
- Even better answer parsing

A dedicated desktop app is a planned phase of this repository, tracked in [issue #8](https://github.com/404-Page-Found/EducationPerfected/issues/8), after the packaged CLI. Thanks to [Garv](https://github.com/garv-shah) for discovering the exploit that made V1 fully-auto answer possible.

## Release, licensing, and disclaimer

- **Licensing and rights:** the code is under the [MIT license](LICENSE). The scope note and rights status are in [release/license-and-rights.md](release/license-and-rights.md).
- **Release status:** [release/README.md](release/README.md) indexes the release gates and native validation.
- **Downloadable stable-release preparation:** see [release/README.md](release/README.md#downloadable-stable-release-preparation-moved-from-readme). The policy is in [release/downloadable-beta-policy.md](release/downloadable-beta-policy.md).
- **Packaged maintenance:** see [runtime storage and uninstall](release/runtime-storage.md). `uninstall` requires typed confirmation and keeps each item unless you choose otherwise. `update` uses published stable GitHub Releases with verified checksums.
- **Disclaimer:** read the [detailed disclaimer](docs/disclaimer.md) before use: automating schoolwork can breach school or service rules, and may be detected, marked wrong, or acted on. The software is provided as-is, at your own risk.
