# Developer guide

Build prerequisites, development builds, one-question validation helpers, and test notes. For user-facing install and usage, see the [README](../README.md).

## Standalone development builder prerequisite

All three SEA development builders (`build:linux-dev`, `build:windows-dev` and `build:macos-dev`) require **Node 22.23.4 exactly** on the matching native host. This is narrower than the `package.json` engine range (`>=22.12.0`), which describes source-program installation and runtime requirements, not the SEA builder matrix. The builder copies the current Node executable and includes the checked-in Node 22.23.4 runtime LICENSE and bundled-component notices. A different Node version fails with `Node runtime notice version mismatch` before archive, bundle or native executable generation; do not remove that check to build with another version. Supporting another builder version needs matching reviewed runtime notices and native validation first. No other Node builder version is currently supported by these commands.

## Linux x64/ARM64 standalone development build

`npm run build:linux-dev` creates `build/linux-<arch>/educationperfected` (`x64` or `arm64`, matching the native build host) using the current Node executable, pinned JavaScript tooling, native keyring module, and the full Chrome for Testing already installed by Puppeteer. Run `npm run test:packaged` for local fixture checks. No live Education Perfect answers are submitted by these tests.

This is an unsigned native glibc Linux x64/ARM64 development build, not a released artifact or a claim of support on the five target platforms. It extracts the native module and browser into a private temporary directory on each launch and checks the browser payload's build-time SHA256 before extracting it. Normal exit, setup interruption and pre-launch interruption remove that directory; removal briefly retries when a closing browser helper or scanner still holds a file, and any directory still left behind is marked cleanup-ready and swept on the next launch. SIGKILL, power loss or a crashed process can leave temporary files behind. Disk space and OS browser libraries are still required. macOS development builds have ad-hoc signature verification; certificate signing, notarization and Windows signature policy remain unproved.

The build writes available third-party notices and an inventory of every installed production dependency beside the executable. Missing notice files are explicitly listed. Exact-version Puppeteer source licenses omitted from npm tarballs are recovered with checksum/source provenance; copying them is not legal clearance. Distribution remains blocked until notices, rights and native evidence are reviewed. Do not distribute a binary without its notices or before completing the project's rights/licensing review, browser redistribution review, signing and clean-machine/native-platform release checks. Existing contributions have no repository-wide license grant documented here. The local development build does not settle those release gates.
Native-store test prerequisites: `npm run test:store` uses an inert adapter and needs only Node/dependencies. `npm run test:store:pty` uses Python 3's standard-library PTY support on Linux/macOS and preloads an inert store, so it cannot save a real login. `npm run test:store:integration` additionally needs Linux `dbus-run-session`, `gdbus` and `gnome-keyring-daemon`; it creates a fresh temporary HOME and private D-Bus session for synthetic native-store write/read/delete. No real user's keyring is used. These developer-test tools are not runtime prerequisites for the CLI.


OS-delivered child-signal fixtures (`startup-signal-test`, `legacy-drain-signal-test` and `cli-test --signal`) are POSIX-only and explicitly report SKIP on Windows. Node's `child.kill()` force-terminates Windows children rather than delivering the console event these tests need. The platform-neutral run-control and pending-launch handler tests still run, but they do not certify Windows console shutdown. Native Windows console close/Ctrl+C and process cleanup remain required release checks.

A Windows x64 development builder is available via `npm run build:windows-dev`. Its native browser/local CLI and corruption fixtures passed experimentally, and disposable Windows source-worker synthetic save/read/delete and SEA visible-input setup now pass with an independent exact source-store pair, fresh SEA valid-shape health read, unchanged source pair, deletion and cleanup. Empty-email/password cancellation and raw byte3 interruption at both armed setup prompts also pass without mutation or native deletion. The raw-input check is not OS console-event delivery or physical terminal-close proof. Browser-startup reliability, normal saved-login use, locked/unavailable-store behavior, real console events and clean-machine checks remain incomplete. See `release/native-validation.md`; this is not a release or a signed/unsigned distribution-policy decision.

The Linux development package embeds the browser as a SEA asset with a checksum checked before unpacking. Full-size build and packaged CLI/integrity fixtures passed on a standard 16 GB Ubuntu 22.04 runner. Smaller-memory full-size injection was killed, so this is not a promise that every development machine can build it. Ubuntu 24.04 sandbox compatibility remains unresolved; the Ubuntu 22.04 pass does not clear that platform's prerequisites or the native release gates. No browser sandbox bypass is enabled.

The SEA runtime maps the full embedded browser asset, verifies its checksum in a complete pass, and only then extracts it. It uses a read-only raw asset view with bounded stream chunks instead of copying the full archive into a Blob. Short synthetic workflow-command memory observations are recorded in `release/native-validation.md`; total process-tree peak and minimum supported RAM remain unproved.

Native Ubuntu 22.04 x64 and ARM64 runners passed full SEA builds and the packaged mock CLI, checksum-corruption and startup-interruption fixtures. Current-source private Secret Service tests also passed native synthetic save/read/delete and packaged setup/delete verified by independent source reads. These runs do not prove normal answer-path credential use, a separate no-Node machine, platform signatures or distribution rights. Ubuntu 24.04 sandbox compatibility and a longer-term runner baseline remain open.


Native macOS ARM64 and Intel development runs passed source controls, full SEA builds, ad-hoc signature verification, packaged local-mock browser controls and owned extraction cleanup. An isolated disposable runner keychain also passed source exact synthetic save/read/delete and packaged setup, fresh-process `--check-credentials`, deletion and independent source absence. This uses inherited runner HOME with verified owned User keychain selection and restoration, not a clean profile. Packaged health checks prove a valid parsed record, not its exact synthetic value or normal sign-in use. A source Node read of a packaged-created record timed out; its cause remains unproved and cross-executable read is not cleared. Historical Intel startup timing also remains unexplained despite later passes. See `release/native-validation.md` for exact evidence and remaining gates.

### One-question fill-only validation

`node bin/validate-gaps-fill.js` opens a separate stopped validation session. Use it only after approving a specific practice question for alteration. Filling may save a draft in EP even though this session never clicks Submit or Next.

Open that approved question, then enter `fill once` in this validation terminal. It calls only the guarded gaps handler, with submission disabled, and stops after the exact filled set is verified or on the first mismatch. It does not enter the ordinary answering loop. The attempt is consumed before inspection; a failed, cancelled or successful attempt cannot be retried in the same process, even on a new question. Do not open another validation process as a retry without checking what changed and getting any needed approval.

Only `fill once`, `stop`, `status` and `quit` are supported. Browser answering hotkeys are disabled in this session. `stop` drains an in-flight action; it cannot undo a key already delivered. `quit` closes the owned browser. `EP_FILL_ONCE` reports a fixed, content-free result: `filled-only` confirms filling was verified, not marking, submission or advance.

Use a fresh source ZIP containing this entrypoint and its matching handler files. The earlier Console diagnostics contain their own reader and do not prove an old installed CLI has been updated. This is a developer validation path, not full lesson completion or packaged-release proof.

### One-question automated Submit validation

`node bin/validate-gaps-submit.js` is a separate, stopped validation session. It requires approval for one fresh, initially empty supported practice gaps question, including filling, one automated Submit and any result or points EP records. Do not use the previously filled or submitted question. No live run of this command has been verified.

After opening only the approved question, enter `submit once` exactly once. The session consumes the attempt before inspection, uses the guarded fill-only operation, then rechecks the same question, exact filled set and associated Submit control before one trusted click. It returns immediately after that click. It never clicks Next, retries, answers another question or enters the ordinary answer loop. EP may automatically display the next question, an explanation or a completion screen after Submit.

Only `submit once`, `stop`, `status` and `quit` are supported; browser answering hotkeys are disabled. A refusal, cancellation, uncertain input or completed attempt cannot be retried in the same process, even on a fresh question. Do not start a new process as a retry without checking what changed and getting any needed approval. `EP_SUBMIT_ONCE` reports a fixed, content-free result: `submitted-once` means the one click returned, not that EP accepted or graded the answer. An uncertain click reports `stopped` and may still have taken effect. Stop cannot undo an already dispatched key or click; shutdown may wait for an in-flight browser call.

Use a fresh matching source ZIP, not the ordinary launcher or the fill-only command. Synthetic browser and real-program fixtures cover at-most-one Submit, no Next, no further answering after automatic advancement, permanent attempt consumption, cancellation and stale-state refusals. These are not live automated-submission or full-lesson proof.


### One-question textbox fill-only validation

`node bin/validate-textbox-fill.js` opens its own stopped browser. Open the specifically approved, initially empty ordinary auto-marked lesson textbox question there. `fill once` calls only the existing guarded textbox handler with submission disabled, then stops after exact filling is verified or at the first refusal, cancellation or uncertainty. It never intentionally clicks Submit or Next or enters the answering loop. Filling may still save or grade in EP; there is no promise that input has no effect beyond a visible draft.

Only `fill once`, `stop`, `status` and `quit` are supported; answering hotkeys are disabled. One attempt is consumed before inspection, including refusal or cancellation, and cannot be retried even on a different question. A new process is not permission to retry. `EP_TEXTBOX_FILL_ONCE` `filled-only` confirms the handler's exact fill checkpoint, not saving, marking, grading, points or advancement. An interrupted or uncertain fill may leave partial input. `stop` cannot undo a delivered key, and shutdown may wait for in-flight browser work. Final read/input checks are not atomic against concurrent page or user changes.

The ordinary textbox contract and exclusions above remain unchanged. Synthetic Linux browser and real-program fixtures cover this validation path, not live textbox or Windows compatibility. Use a fresh matching source ZIP. Each live question needs separate approval before typing `fill once`.

### Read-only Reflection inspection (#114)

The narrow user-authored Reflection fill-only path is described above. To inspect its component
and control shapes without starting answering:

1. Run `node bin/cli.js`, finish sign-in, and open the approved Reflection page.
2. Leave the CLI inactive (stopped, completed or error state). Do not type `start` or press the answering hotkey.
3. Type `inspect-self-mark` once. Paste the line beginning `EP_SELF_MARK_INSPECT`.
4. Type `quit` when finished. Do not reveal answers or select a self-grade for this capture.

The command reads structural metadata, control shapes and counts only. It does not type,
click, focus, Submit, reveal answers, select a self-grade or advance the question.
It reports recognized component codes and fixed metadata field shapes, not answer
values, question text, arbitrary keys, classes, labels or IDs. Cached metadata
accessors are skipped. Assessment mode and unconfirmed lesson modes stop before
question-state reads. While inspection is pending, answering, mode changes and
refresh are locked out. Waiting is bounded to two seconds; a remote read already
in flight may finish later, but it has no write path. Existing answering guards
are unchanged. A capture is not permission for live answering.

### Read-only slide component inspection (#231)

When a Smart Lesson slide stops on an accompanying component the answerer does not
recognize, the slide's full component structure can be captured without starting
answering:

1. Run `node bin/cli.js`, finish sign-in, and open the approved lesson slide.
2. Leave the CLI inactive (stopped, completed or error state). Do not type `start` or press the answering hotkey.
3. Type `inspect-components` once. Paste the line beginning `EP_COMPONENTS_INSPECT`.
4. Type `quit` when finished.

The command reads structural metadata and fixed-selector control counts only. It does
not type, click, focus, Submit, reveal answers or advance the question. It reports
recognized component codes by name (unlisted codes as `UNLISTED_COMPONENT`), marking
flags, option counts and Correct-flag tallies, not answer values, question text,
arbitrary keys, classes, labels or IDs. Cached metadata accessors are skipped.
Assessment mode stops before question-state reads. While inspection is pending,
answering, mode changes and refresh are locked out. A capture is not permission for
live answering.


### Dropdown Submit readiness

Auto mode verifies the full exact dropdown answer set while waiting up to three
seconds (or a shorter configured round timeout) for the associated Submit button
to become available. EP's SkillsControls has a one-second new-question lock; a
fast fill can finish before it unlocks. These probes never replay input, click,
enable a button or bypass the terminal Submit approval. Each probe rechecks the
original model, question key, renderer identities and exact selected answers.
Multiple visible Submit buttons, any identity/answer drift, assessment mode and
cancellation stop without Submit. A timeout reports `submit-readiness-timeout`
with content-free visible/enabled Submit counts. The final button-identity and
coverage checks and the no-retry rule after an uncertain click are unchanged.
The one-shot validation helper still uses its existing single-read Submit gate.
This is synthetic-test proof of the readiness path, not proof of the cause of
every live `submit-button` refusal.

### Selection dialogs at section boundaries

Normal selection rounds (choice, gaps, dropdown, textbox and number-box) preserve dialogs after Submit. Content-free `Selection modal diagnostic` guards distinguish template family, baseline/model/current-section association, next-section fields and button readiness failures. For exactly bound source-shaped section completion only, automation clicks that dialog's Next Section button once. It never directly invokes controller methods, uses Enter, clicks a generic modal control, retries an uncertain click or navigates peer review. The dialog template scope may inherit its `self` as UI Bootstrap transclusion does; only bounded own data-property reads are used, not getters. Before input, the model, original section/question, next displayed section identity/ID/type/activityGroup, exact button binding, visibility, hit target and run cancellation are rechecked. After the click, read-only polling must prove the same model, the exact promised next section, a different valid question and no visible modal/backdrop. Fresh supported-question detection then permits normal per-round checks to resume. A stalled, dismissed, uncertain or wrong-section transition stops without another click. Unknown dialogs and final activity completion stay open and stop; no lesson-completion or grading claim is inferred from the dialog. This is source-derived synthetic coverage, not live EP proof.

Unrecognized, ambiguous, hidden or unverified dialogs still stop. Diagnostics contain fixed family/guard names, counts and identity-match booleans only, never dialog/answer/question text, section names or raw IDs. Selection runs do not erase dialogs in normal loop cleanup, including when Stop lands after Submit but before the next modal poll. An explicit restart stays inert while a visible dialog or backdrop remains; once the user handles it, a new start uses normal fresh detection, not an inferred section-transition result. One-shot validation commands are unchanged. This is source-derived synthetic proof, not confirmation of which dialog appeared in a live run and not proof of the exact association failure in the reported stop.

### Gaps with exact alternative labels

A displayed gaps tile is usable only when its raw label is an exact member of that gap's resolved CorrectOptions. When multiple exact correct labels are displayed, deterministic distinct-tile matching assigns a complete set across all DOM-ordered gaps instead of refusing every alternative or choosing greedily. No spelling/case/punctuation normalization, generated answers or internal marking calls. Existing exact renderer, gap, tile and filled-prefix checks still apply. Missing exact candidates and insufficient distinct tiles stop with content-free gap-index/count diagnostics. Source-derived synthetic proof only; the live report did not distinguish these cases.

### Plain-block paragraph choices

EP's source renders separate template lines as adjacent paragraph nodes, without separator text nodes. Plain-block association accepts that exact paragraph shape (optionally inside the source's div wrappers), binding every template line in order to one paragraph (including an exact empty paragraph for a blank line) and retaining the existing cached option/template/marking/radio association. It does not join arbitrary layout, reorder paragraphs, strip markup or infer an answer. Unknown paragraph shapes and changed line text stop. Content-free render failures now distinguish unsupported descendants from text mismatch; text mismatches include template-line/paragraph counts. Source-derived fixtures only; the live report's exact shape remains unconfirmed.

### Plain-block inline style tokens

EP InlineTextElement consumes the style toggles `**`, `__`, `//` and `~~` rather than displaying them. Plain-block choices accept balanced occurrences of those exact tokens (including mixed styles and existing color spans) only with an exact source-shaped paragraph/span text association. Unknown descendants, missing/extra paragraphs, changed text, unbalanced toggles and style-token escapes stop. Highlight, sub/sup and heading syntax remain unsupported here. Render-text diagnostics add fixed token-family booleans, never option text or answer values, so a further mismatch can identify the still-unsupported family. The one-line/one-paragraph live failure did not include its template, so this fixes a source-proven formatting gap, not a confirmed cause of that exact report. No live EP validation.


## Dependencies
The program has four runtime dependencies, pinned in [package.json](../package.json) and locked (with their own dependencies) in [package-lock.json](../package-lock.json): [Puppeteer](https://github.com/puppeteer/puppeteer) **25.16.0** with `@puppeteer/browsers` **3.2.6** drives and downloads the browser (each Puppeteer version pairs with a Chrome build - Chrome 156 for this one), `@napi-rs/keyring` **2.1.2** handles the optional saved login in the OS credential store, and `modern-tar` **0.8.6** unpacks the downloaded browser archives. Install with `npm ci`, or just use one of the starter scripts, which run it for you when needed. To bump Puppeteer, change the version in `package.json`, run `npm install`, and commit the updated lockfile.

That version was exercised by a local smoke test ([scripts/smoke-test.js](../scripts/smoke-test.js)) against a mock EP site ([scripts/mock-ep.js](../scripts/mock-ep.js)) covering the Puppeteer calls this program makes: login form fill and submit, reading the word lists, typing and submitting answers, reading and dismissing the wrong-answer modal, and the completion screen, plus the Dash sprint fixture (/dash-task, /dash-task/play: shared word lists, shared question/answer pair, timer/score/results, refresh/answer/advance/completion-exit). Run it yourself with `npm run smoke` (use `SMOKE_HEADFUL=1` to watch a visible window, or `SMOKE_EXECUTABLE_PATH`/`SMOKE_BROWSER_URL` to target a browser you already have).  
The Smart Lesson and audio handlers have their own end-to-end test ([scripts/handler-test.js](../scripts/handler-test.js), run it with `npm run test:handlers`). It drives the program's real answer loop against local fixtures ([scripts/mock-ep.js](../scripts/mock-ep.js)) that were built from notes taken while inspecting the live site (a multiple-choice lesson slide and an audio task, sanitised of account data) - they are reconstructions, not recorded sessions.  
The interactive CLI groundwork has a separate local regression command: `npm run test:phase3`. It runs shared-control unit tests, startup-failure tests for all three entrypoints with both invalid-URL and connection-refused scenarios, startup and legacy-entrypoint SIGINT/SIGTERM cleanup, pending-launch cancellation feedback, the CLI browser fixture, and stop-during-completion-proof coverage. Run `node scripts/cli-test.js --signal` and `node scripts/cli-test.js --external-close` for signal and external-browser-close cases. These are local fixtures, not live-service or cross-platform release certification. Only the Windows taskkill path resolver has unit coverage; the cleanup itself has not been executed on Windows.
*This smoke test proves the dependency setup works, including a synthetic Dash fixture. An end-to-end run against EP's live service (not just the mock) has since confirmed the word-to-word task flow works as expected (Dash multi-choice rounds are answered from a live structural capture, fixture-tested only; see the Dash section in docs/question-types.md) - though the live site can still change, so re-verify if you suspect breakage.*


## CLI credential setup (source build)

Run `educationperfected setup` for first-time installation (or `node bin/cli.js setup` from source). It asks before downloading pinned Chrome from Google, verifies the archive checksum, reuses an existing verified cache, then offers credential setup. Email and password stay visible while you type. Leave the email empty to skip saving. It never opens EP or answers a question. `check-credentials` checks the native saved login without printing it; `forget-credentials` removes the app's login. `help`/`-h`/`--help` shows commands; `version`/`-v`/`--version` prints 2026.11.16. Legacy credential/update/uninstall flags are refused with a subcommand hint, before any runtime/store/download action.

The native store uses Windows Credential Manager, macOS Keychain, or Linux Secret Service. On Linux, an unlocked Secret Service session (for example GNOME Keyring or KWallet) is required; there is no plaintext or nonpersistent kernel-keyring fallback. If the store is unavailable, ordinary browser/manual login still works. Never put a password in a command argument.

A saved login is read as one versioned record. Existing environment-variable and optional legacy keytar inputs are retained for source-build compatibility. Setup does not delete older legacy-keytar entries. `forget-credentials` removes only the new record, so older inputs may still supply a login.

This is source-build work, not a packaged release. Native disposable tests now cover Linux x64/ARM64 private-store CRUD, Windows x64 source-worker CRUD and SEA visible-input setup, cancellation, raw byte3 interruption, health-read and deletion, plus Mac ARM64/Intel source CRUD and packaged setup/health-read/delete. Mac exact packaged values and normal saved-login use remain unproved; see `release/native-validation.md`. Browser bundling, native module extraction, signing/distribution and five-target release checks must pass before claiming standalone support. Run `npm run test:store` for isolated adapter/setup contract tests; those tests never access a real credential store.


## Desktop app (stage 2, in progress)

`npm run app` starts the Electron window from source (devDependency `electron`; needs a display). The app shares the CLI's engine (`index.js`), run controls, app config, OS credential store and pinned-browser download path; `app/session.js` is the electron-free, fully injected orchestrator and `app/main.js` only wires the window and the allowlisted IPC. `npm run test:app` covers the session contract, the shell wiring and the installer payload layout without the Electron binary, and runs inside `test:phase3`.

The OS installers ship the app: `packaging/build-app.js` lays out the host runner's pinned Electron distribution with the bundled app over it (esbuild main bundle, preload and renderer as files, the native `@napi-rs/keyring` packages, per-OS executable renames, icon and Info.plist substitutions, and Electron's own notices in THIRD-PARTY-NOTICES). No cross-building: each candidate lane builds its own platform's payload before the candidate inventory. The Windows setup exe installs the app tree and a Start-menu shortcut, then offers the browser download on its finish page; the .pkg/.deb/.rpm packages embed the app (/Applications bundle, or /usr/lib app dir plus .desktop entry and icon) and run the same step from their post-install scripts as the installing user. That step is `educationperfected setup --browser-only`: the non-interactive install-time variant of `setup` that only downloads the pinned browser (consent is the installer's to present), leaving the login to the app's first-run wizard. The curl/PowerShell installers and the npm package stay CLI-only; the desktop app comes from the OS installers.
