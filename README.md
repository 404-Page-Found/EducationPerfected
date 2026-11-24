# EducationPerfected

A continuation of [akioweh's archived project](https://github.com/akioweh/EducationPerfected), using Node.js and Puppeteer to automate supported Education Perfect language tasks. It is independent of Education Perfect and is not endorsed or supported by it.

Automating schoolwork can breach school or service rules. Read the [disclaimer](docs/disclaimer.md) before using it. Compatibility and results are not guaranteed.

## Start here

- [Install, update and uninstall](docs/install-and-update.md): Windows, macOS, Linux, source ZIPs and terminal-only installs.
- [Run and controls](docs/usage.md): desktop app, CLI commands, browser menu, hotkeys and saved settings.
- [Documentation index](docs/README.md): user, developer and release references.
- [Downloads and platform summaries](https://404-page-found.github.io/EducationPerfected/).

### Run a source ZIP

Install Node.js 22.12 or newer. Download the full source ZIP, extract it into a new folder and open a terminal there:

```sh
npm ci
npm run app
```

The same commands apply on Windows, macOS and Linux. For the terminal CLI instead, use `npm run cli`. The desktop app embeds its browser and uses native controls. The CLI opens a separate browser with a draggable panel, top-right by default. The desktop app has no browser-page panel.

## Status

The current development line is V2026. `main` may include changes not yet present in the published download. Check [release notes](https://github.com/404-Page-Found/EducationPerfected/releases) for the version you install; release and native-validation limits are in the [release guide](release/README.md).

Word-to-word tasks have been run end-to-end against the live service. Other question types have bounded live checks or synthetic coverage, and Dash has not been answered live. See the dated [verification log](CHANGELOG.md#live-verification-log) and the support table below. Synthetic tests do not prove live or cross-platform compatibility.

## Installation

Use the [installation guide](docs/install-and-update.md) for all supported routes, including fresh source ZIPs. OS installers include the desktop app and CLI; install scripts, npm and raw binaries are CLI-only.

## Quick start

Open the desktop app, sign in, open a supported task and use its controls. For terminal commands, the CLI-only browser menu and hotkeys, see [Run and controls](docs/usage.md).

## Uninstall

Use your OS or package manager for installed apps. For CLI installs and optional data cleanup, see [uninstall instructions](docs/install-and-update.md#uninstall). Saved data is kept unless you explicitly choose to remove it.

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
| Information slides (content-only, nothing to answer) | Advanced via the lesson's own Continue; never submitted; synthetic coverage only | [contract](docs/question-types.md#information-slides-327) |
| Short-answer lesson questions | Answered the same way; not live-verified yet | [known limitations](docs/question-types.md#known-limitations-full-text) |
| Dash (timed sprint) choice and typed rounds | Answered from the live-captured round shapes; fixture-tested only, not yet live-verified end to end | [Dash](docs/question-types.md#dash-timed-word-to-word-sprint) |
| Matching, ordering, image-based and other manual or assessment questions | Detected and reported, not answered | [assessment boundary](docs/question-types.md#assessment-source-boundary) |
| Smart Lesson mixed slides (supported question + unrecognized companion) | Stopped in full with a named, content-free diagnostic; no partial answer or partial Submit | [accompanying components](docs/question-types.md#accompanying-components-and-inspect-components-231) |

Unsupported Smart Lesson question types are detected and reported, not guessed at. Policy (issue #231, fail-closed-with-report): a slide that pairs a supported question with an unrecognized accompanying component stops instead of answering the supported part, because chunk606 Submit grades the whole question and the companion would be submitted blank. The refusal names the recognized EP type code (or `redacted type`/`UNLISTED_COMPONENT` for unlisted codes) without question or answer text. Proven presentation-only companions (`SOUND_COMPONENT`, `ANNOTATED_TEXT_COMPONENT`, runtime-proven unmarked `SCRATCH_PAD_COMPONENT`) are admitted; uploader/sound-recorder companions stay refused by product decision.

## Known limitations

- **Dash support is fixture-tested only (#230).** Choice rounds (19 November 2026) and typed rounds (20 November 2026, #272) are answered from live structural captures on a dash route only (see [CHANGELOG](CHANGELOG.md#live-verification-log)); no end-to-end live Dash sprint has been run through the program yet. The number-box capture (20 November 2026, #282) ships no answer and other Dash layouts are refused by name; perfect is the provisional accuracy recommendation since each Dash mistake is expected (unproved live) to burn clock. Run `inspect-dash` at a refused round and send the `EP_DASH_INSPECT` line to help extend support.
- **Audio answers depend on EP's data.** Audio is answered from the data EP ships to the browser before submission. If that state goes missing, those tasks fail loudly rather than fall back to guessing. Self-test work still earns points and stays visible to teachers.
- **Smart Lesson support is limited.** Only explicitly auto-marked activities are answered. Full-lesson completion and automated rejection handling are not proved live. A slide that pairs a supported question with an unrecognized accompanying component stops in full instead of answering the supported part (fail-closed-with-report, issue #231): the refusal names the recognized code or `redacted type` with no content leak and never partially fills or submits; run `inspect-components` with the CLI stopped at that slide and send the `EP_COMPONENTS_INSPECT` line to help map the companion. The canonical inventory is `lib/companion-components.js` with sources in `research/component-companion-inventory.md`.
- **Word-list parsing is best-effort.** Extreme formatting cases can still produce incorrect answers.
- **The anti-cheat bypass may stop working** when the service changes.

The full text, with dates and citations, is in [docs/question-types.md](docs/question-types.md#known-limitations-full-text).

## Contributing

Contributions are welcome: new features, bug fixes, anti-cheat bypass, or documentation. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Developer, build, and validation notes are in the [developer guide](docs/developer-guide.md).

## Release, licensing, and disclaimer

- **Licensing and rights:** the code is under the [MIT license](LICENSE). The scope note and rights status are in [release/license-and-rights.md](release/license-and-rights.md).
- **Release status:** [release/README.md](release/README.md) indexes the release gates and native validation.
- **Downloadable stable-release preparation:** see [release/README.md](release/README.md#downloadable-stable-release-preparation-moved-from-readme). The policy is in [release/downloadable-beta-policy.md](release/downloadable-beta-policy.md).
- **Packaged maintenance:** see [runtime storage and uninstall](release/runtime-storage.md). `uninstall` requires typed confirmation and keeps each item unless you choose otherwise. `update` uses published stable GitHub Releases with verified checksums. The desktop app keeps update reachable in App settings before startup and after a startup failure (disabled in a source or development copy, which keeps the terminal commands); uninstall the app from your OS or package manager (see [Uninstall](#uninstall)).
- **Disclaimer:** read the [detailed disclaimer](docs/disclaimer.md) before use: automating schoolwork can breach school or service rules, and may be detected, marked wrong, or acted on. The software is provided as-is, at your own risk.


## Project history

The original console userscript is preserved in [V1_Archive](V1_Archive); version v2.2.0 is frozen in [V2_Archive](V2_Archive). The live root continues as V2026.
