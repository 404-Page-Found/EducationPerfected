# Dash (timed sprint): source-only map

Checked 19 November 2026. Scope: Education Perfect's public student client source and local synthetic fixtures only. No live Dash run was started by the program; the only live observation is Page's own run on 19 November 2026, which the program refused at the Smart Lesson mode guard (`Choice answering requires confirmed Smart Lesson practice mode; unknown modes are not supported`). That refusal is what this map explains.

Primary source: [public student chunk 171](https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-171-69df426caed962f89980.js), SHA-256 `d6cd2c7eb1d99610fd5369acf793b75a00762646f6a8e20cb6cea396f4f47722` (12,955,262 bytes) - the same snapshot the Assessment research pins. Named symbols below refer to that snapshot, not necessarily the bundle today's live app loads. Client code shows what the client calls, not what a server accepts.

## What Dash is in the client

- Dash is the classic list game's quiz test mode, not a separate game mode. The `gameMode` enum has only `CLASSIC = 1`, `ASSESSMENT = 2`, `SMART_LESSON = 3`; there is no DASH entry. The quiz model (`QuizModel`, `DashVersion = 1.06`) extends the classic game model, whose constructor sets `gameMode = CLASSIC`; `QuizModel` itself sets `isDash = true` (the base model default is `isDash = false`). So a live Dash round reports `model.gameMode === 1` and `model.isDash === true`.
- Starting Dash: `ListStarterController.beginDash` (when `selectedTestMode` is `DASH`) navigates to the activity quiz page; `ClassicGameController.beginDash` does the same from the classic game. The in-round controller is `QuizGameController`.
- Why the 2026-11-19 live run refused: the round renders a `div.multi-choice-component[role=radiogroup]`, so question detection routed to the single-choice reader, which only accepts Smart Lesson mode (`gameMode === 3`) and stopped. The classic text path never ran because the quiz round does not show classic `#question-text` markup on that round.

## How a Dash answer flows (client-side)

- `QuizGameController.loadQuestionDefinitions` preloads question definitions for the activity's valid content IDs. Whether each definition carries the correct option flags (the way Smart Lesson `MULTICHOICE_COMPONENT` options carry `Correct`) is NOT established by this map - that is exactly what the read-only `inspect-dash` capture records.
- `QuizInGamePage.submitAnswer` marks client-side through `markingManager.markAnswerWithSecondChance(question, answerForMarking, CommonMistakeFlags.NONE, translationDirection, false, false)`. A missing answer converts to a quiz-specific typo/second-chance prompt instead of a mark. A wrong answer decrements `model.livesLeft`; `QuizGameController.endQuestion` records timing and routes mistakes into the model's mistake list.
- The quiz page template renders a real Submit button (`button.submit-button.nice-button.positive-green`, disabled until `canSubmit`) wired to `onSubmitClicked` -> `answerInputManager.submitUserAnswer()`.
- Stats: `saveQuestionAnswerLocally` per question (skipped for assigned tasks), `finaliseDashStats` at game end. `livesLeft` bounds the sprint (`NUMBER_OF_LIVES`, fewer for short quizzes); wrong answers can add penalty questions.

## What the 2026-11-19 live capture answered

Page's same-day sanitised `EP_DASH_INSPECT` capture (read-only
`inspect-dash` command, `lib/dash-diagnostics.js`) recorded the real round:

- `model._currentQuestion.questionDef` EXISTS on the quiz page: exactly one
  `MULTICHOICE_COMPONENT`, `AllowMultiSelect` false, `Marked` 1, four
  options, exactly one `Correct` string `"true"` (no boolean-true),
  `validAnswers` empty; valid `contentID`/`questionIndex`, `questionType` 6,
  `translationMode` 4.
- `gameMode` read as `null` live (not the CLASSIC value the constructor
  sets; the reader accepts both), `isDash` true, `sectionData` undefined,
  `selectedActivity` `_activityType` 6 / `_contentType` 0 / `_taskID` set,
  and the route path includes `dash`.
- DOM: no `#question-text`, `input#answer-text` or `.voice-speaker`; one
  visible `div.multi-choice-component[role=radiogroup]` with four
  `.mcq-preview-option`; one `button.submit-button`; one `.exit-button`;
  NO timer element candidate matched (the real timer markup is still
  uncaptured).

Still unknown: the real timer markup and expiry behavior, scoring, the
completion/results screen, wrong-answer behavior, and whether any Dash round
is typed-input rather than multi-choice (such rounds still refuse by name:
`dash: true`).

## What the 2026-11-20 typed capture added (#272, issue #273)

Page's second sanitised `EP_DASH_INSPECT` capture (20 November 2026, filed as
#272) recorded a typed Dash sprint round refused at the classic-text Dash
guard:

- Routing: path includes `dash`, not `quiz`; `gameMode` null, `isDash` true,
  `sectionData` absent.
- Question: valid `contentID`/`questionIndex`, `questionType` 0,
  `translationMode` 0, `validAnswersCount` 1, `componentCount` null (no
  question components).
- DOM: one visible `#question-text`, one visible `input#answer-text`, zero
  `.voice-speaker`, zero choice groups, one `button.submit-button`, one
  `.exit-button`, and no timer element candidates (the real timer markup is
  still uncaptured on both Dash layouts).

This is the grounding capture for the narrow `dash-typed` reader
(`lib/dash-typed-state.js`): the reader answers exactly this shape on a dash
route from the shipped `validAnswers` entry and refuses every deviation by
name (`renderer: dash-typed`). The classic-text, audio and lesson-typed
fallbacks still refuse other Dash shapes by name.

Still unknown after both captures: the real timer markup and expiry behavior,
scoring, the completion/results screen, typed wrong-answer behavior
(modal-with-answer vs instant advance), and any audio, multi-select,
mixed-surface or formula/block Dash variants (each still refuses by name
pending its own capture).

## Synthetic evidence and its limits

`scripts/mock-ep.js` `/dash-task/quiz` models the captured shape above
(multi-choice component, `gameMode: null`, `isDash: true`, one
string-"true" correct option, quiz Submit button, fixture-invented timer).
`scripts/dash-cli-test.js` drives the real CLI through that fixture to
completion and proves the same page off the dash route refuses by name;
`scripts/dash-choice-test.js` covers the reader's accepted shape and named
refusals; `scripts/dash-diagnostics-test.js` proves the capture is
side-effect free, runs no accessors, and honors the assessment shell
boundary. The fixtures reproduce the captured structure; select, submit,
advance and completion behavior in them is fixture behavior, not
live-verified EP behavior.

`/dash-task/typed` (added for #273, modelled from the 20 November capture)
reproduces the typed shape the same way: `gameMode: null`, `isDash: true`,
`questionType` 0, `translationMode` 0, one `validAnswers` entry, no
components, `#question-text` + `input#answer-text` with one Submit button and
a fixture-invented timer. `scripts/dash-cli-test.js` drives the real CLI
through it to completion (typing each round's shipped answer, no word-list
lookup, no random probe) and proves `/typed-round` off the dash route refuses
by name; `scripts/dash-typed-test.js` covers the reader's accepted shape and
named refusals. Typing, grading, advance and completion in the fixture remain
fixture behavior, not live-verified EP behavior.
