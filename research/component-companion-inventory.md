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
| SCRATCH_PAD_COMPONENT | ScratchPadComponent | input | NOT_MARKED 0/0/0 when the definition's is_marked is false; scored when marked | answer-bearing when marked |
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

SOUND_COMPONENT and ANNOTATED_TEXT_COMPONENT are admitted as companions by the gaps, highlight and working-formula readers (dropdown already admitted both with runtime `isInput === false` verification). Proof: neither component accepts a response, and each marking output is a constant payload that does not depend on any student interaction - SoundComponent always reports {score 1, max 1, weight 0} and AnnotatedTextComponent always reports NOT_MARKED {0, 0, 0} - so submitting with the companion untouched reports exactly what interacting with it would. Synthetic coverage: scripts/presentation-companions-test.js.

The choice and multi-choice readers already passed both codes through their answer-bearing deny-list; their behavior is unchanged.

## Not admitted (documented, needs a product decision or live evidence)

- FILE_UPLOADER_COMPONENT and SOUND_RECORDER_COMPONENT: `UploaderComponent.outputForMarking` (which `FileUploaderComponent` and `SoundRecorderComponent` both inherit, chunk606 module 5615) returns a constant full-marks record {score 1, max 1, weight 1} whether or not the student uploads or records anything. Auto-marking would not be harmed by skipping them, but the upload/recording is a real student response (likely teacher-reviewed); whether the program may submit past it is Page's call, not a source-provable safety fact.
- SCRATCH_PAD_COMPONENT: grading-neutral only when the definition's `is_marked` is false; a marked scratch pad is answer-bearing. Conditional admission is possible but unimplemented.

## Live evidence still blocking full partial-answering (issue options 2/3)

- Whether Submit grades per-component or whole-question on a real mixed slide (the issue's blocking question); everything above treats whole-question Submit as the boundary.
- A sanitised capture of real slides that carry each companion code in the wild.
