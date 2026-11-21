---
id: component-companion-inventory
type: research
---
# Question-component companion inventory (issue #231)

Source: [EP public chunk 606](https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js), checked 19 November 2026 (14,736,150 bytes). `ComponentStateFactory.createComponentState` builds one state per definition in `questionDef.Components`; `BaseComponent` defaults `marked = MARKED`; `ComponentIndex.getOutputForMarking` calls each registered component's `outputForMarking()` and Submit grades the whole question (see [[assessment-component-output]]).

## The question-component codes

`createComponentState` has cases for 14 codes; WORKING_FORMULA_COMPONENT and FORMULA_COMPONENT are built outside the switch and listed last.

| Code | Component class | isInput | Marking output | Companion verdict |
|---|---|---|---|---|
| MULTICHOICE_COMPONENT | MultiChoiceComponent | input | computed from selections | answer-bearing |
| DROPDOWN_COMPONENT | DropDownComponent | input | computed from selection | answer-bearing |
| LONG_ANSWER_COMPONENT | LongAnswerComponent | input | componentState.marking | answer-bearing |
| FREEFORM_WORKING_COMPONENT | (working state) | input | checkAnswer + steps | answer-bearing |
| FILL_IN_GAPS_COMPONENT | FillInTheGapsComponent | input | per-gap marking | answer-bearing |
| SCRATCH_PAD_COMPONENT | ScratchPadComponent | input (interactive canvas) | constant {marked NOT_MARKED, 0/0/0} unless `marked == MARKED` (loose, enum 1); scored when marked | admitted only on runtime proof of unmarked, see below |
| FILE_UPLOADER_COMPONENT | UploaderComponent | input | constant {score 1, max 1, weight 1} regardless of input | unresolved, see below |
| SOUND_RECORDER_COMPONENT | SoundRecorderComponent (extends UploaderComponent) | input | inherits UploaderComponent's constant {score 1, max 1, weight 1} regardless of any recording | unresolved, see below |
| SOUND_COMPONENT | SoundComponentState (factory state) / SoundComponent (component) | false | constant {score 1, max 1, weight 0} | presentation-only, proven |
| HIGHLIGHT_COMPONENT | HighlightComponent | input | componentState.marking | answer-bearing |
| TEXT_BOX_COMPONENT | NewTextBoxComponent | input | mark(getAnswer()) | answer-bearing |
| NUMBER_BOX_COMPONENT | NumberBoxComponent | input | mark() | answer-bearing |
| ANNOTATED_QUESTION_COMPONENT | AnnotatedQuestionComponent | input | componentState.marking | answer-bearing |
| ANNOTATED_TEXT_COMPONENT | AnnotatedTextComponent | false | {marked NOT_MARKED, score 0, max 0, weight 0} | presentation-only, proven |
| WORKING_FORMULA_COMPONENT | WorkingFormulaComponent (built outside the switch) | input | checkAnswer + working-step comparison | answer-bearing |
| FORMULA_COMPONENT | FormulaComponent (built outside the switch) | input | checkAnswer + working-step comparison | answer-bearing |

WORKING_FORMULA_COMPONENT and FORMULA_COMPONENT are question-component codes (factory `*_TYPECODE` statics) with no case in `createComponentState`. The working-formula reader admits WORKING_FORMULA_COMPONENT and FREEFORM_WORKING_COMPONENT (the switch builds the same editor state for both); FORMULA_COMPONENT has its own FormulaComponent class (input, `checkAnswer` + working-step comparison) and no reader path, so a slide carrying it still refuses.

## Admitted companions (implemented)

SOUND_COMPONENT and ANNOTATED_TEXT_COMPONENT are admitted as companions by the gaps, highlight, working-formula and textbox/number-box readers (dropdown already admitted both with runtime `isInput === false` verification; the textbox reader accounts for companions in its count contracts the same way dropdown does). Proof: neither component accepts a response, and each marking output is a constant payload that does not depend on any student interaction - SoundComponent always reports {score 1, max 1, weight 0} and AnnotatedTextComponent always reports NOT_MARKED {0, 0, 0} - so submitting with the companion untouched reports exactly what interacting with it would. Synthetic coverage: scripts/presentation-companions-test.js.

The choice and multi-choice readers already passed both codes through their answer-bearing deny-list; their behavior is unchanged.

Every single-surface reader (gaps, highlight, working-formula, textbox/number-box, choice, multi-select) also admits a SCRATCH_PAD_COMPONENT companion when its cached runtime component proves the pad unmarked: exactly one baseComponents entry, the `scratch-pad` builder type, a matching component id, and `marked` failing EP's own loose `marked == MARKED` check. ScratchPadComponent sets `marked` from the definition's raw is_marked and returns a constant {marked NOT_MARKED, 0/0/0} payload unless `marked == MARKED` (loose equality in EP's code), so the admission mirrors EP's own scoring exactly: a string '1' counts as marked and refuses, while a missing `marked` admits the way EP itself would score it. A marked, wrong-type, ambiguous or otherwise unverifiable pad stays answer-bearing and refuses the slide. The pad's canvas is interactive but not an editable control, and anything drawn on it is unmarked by definition. The gaps reader's registry guard exempts the verified pad's entry (its isInput is not false); the choice reader reads the registry through its own own-data accessors, never the lazy getters.

## Not admitted (documented, needs a product decision or live evidence)

- FILE_UPLOADER_COMPONENT and SOUND_RECORDER_COMPONENT: `UploaderComponent.outputForMarking` (which `FileUploaderComponent` and `SoundRecorderComponent` both inherit, chunk606 module 5615) returns a constant full-marks record {score 1, max 1, weight 1} whether or not the student uploads or records anything. Auto-marking would not be harmed by skipping them, but the upload/recording is a real student response (likely teacher-reviewed); whether the program may submit past it is a product decision, not a source-provable safety fact. Decision (19 November 2026, re-affirmed for #231 close): keep refusing both.
- SCRATCH_PAD_COMPONENT: admitted only when the cached runtime component proves it unmarked (above); a marked pad is answer-bearing and refuses.
- FORMULA_COMPONENT: own FormulaComponent class (input, `checkAnswer` + working-step comparison) with no reader path; a slide carrying it refuses. Not in scope for #231 close.

## Resolution (fail-closed-with-report)

- Chosen policy: keep fail-closed. Proven-safe partial answering and opt-in partial submit stay rejected until per-component Submit grading is proven on a real mixed slide.
- Canonical runtime lists: `lib/companion-components.js` (presentation pair, known codes, answer-bearing codes, `formatAccompanyingCode` / `diagnosticComponentType`). The six full-mirror readers (choice, multi-select, highlight, working-formula, textbox/number-box, gaps) keep self-contained mirrors of those sets; `scripts/companion-components-test.js` extracts each mirror and asserts Set equality with the canonical lists (answer-bearing checked as canonical minus the readers' own `MULTICHOICE_COMPONENT`). Node-side captures stay wired without copying: `lib/question-inspection.js` builds its in-page `known` set from the canonical module. Dropdown uses a subset allowlist (admitted dropdown/sound/annotated-text excluded; TYPE_* display codes recognized) for its `unsupportedTypes` tally, so it is not a full mirror.
- Every companion refusal names the recognized code (or `redacted type` / `UNLISTED_COMPONENT` / `unlisted`) with a content-free diagnostic; the orchestrator retags to `slide-surfaces-refusal`. Choice, multi-select, highlight, working-formula and gaps emit `accompanying-component` (`UNLISTED_COMPONENT` for unlisted codes); textbox reports through its `componentTypes` tally (`UNLISTED_COMPONENT` for unlisted) and dropdown through `unsupportedTypes` (`unlisted`, lowercase) on the `definitions-select-count` guard and `extras` / `definitions.byType` on the `mixed-editable-inputs` guard; Dash choice uses `companion-components` with renderer `dash-choice`. No path fills or submits part of a mixed slide.

## Live evidence still blocking full partial-answering (issue options 2/3)

- Whether Submit grades per-component or whole-question on a real mixed slide (the issue's blocking question); everything above treats whole-question Submit as the boundary.
- A sanitised capture of real slides that carry each companion code in the wild.
