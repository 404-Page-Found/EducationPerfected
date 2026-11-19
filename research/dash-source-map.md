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

## What is still unknown (needs the live capture)

- The round's question state shape: whether `model._currentQuestion.questionDef` exists on the quiz page, whether options carry `Correct` flags, and the option DOM association.
- The real timer markup and expiry behavior, scoring element, and the completion/results screen.
- Whether any Dash round is typed-input rather than multi-choice.

Until those are captured (read-only `inspect-dash` command, `lib/dash-diagnostics.js`), a Dash round that reaches the choice, classic-text, audio or typed reader refuses by name (`dash: true`); a Dash layout those readers do not recognize still stops unanswered on the generic refusal and transition paths.

## Synthetic evidence and its limits

`scripts/mock-ep.js` `/dash-task/quiz` models the shape above (multi-choice component, `gameMode: 1`, `isDash: true`, quiz Submit button, fixture-invented timer). `scripts/dash-cli-test.js` proves the real CLI refuses that round by name and that `inspect-dash` captures its structure sanitised; `scripts/dash-diagnostics-test.js` proves the capture is side-effect free, runs no accessors, and honors the assessment shell boundary. These fixtures are reconstructions from public source plus one refusal log line, not live captures; they do not establish Dash support.
