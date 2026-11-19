---
id: component-companion-inventory
type: research
---
# Question-component companion inventory (issue #231)

Source: [EP public chunk 606](https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js), checked 19 November 2026 (14,736,150 bytes). `ComponentStateFactory.createComponentState` builds one state per definition in `questionDef.Components`; `BaseComponent` defaults `marked = MARKED`; `ComponentIndex.getOutputForMarking` calls each registered component's `outputForMarking()` and Submit grades the whole question (see [[assessment-component-output]]).

## The factory's 14 question-component codes

| Code | Component class | isInput | Marking output | Companion verdict |
|---|---|---|---|---|
| MULTICHOICE_COMPONENT | MultiChoiceComponent | input | computed from selections | answer-bearing |
| DROPDOWN_COMPONENT | DropDownComponent | input | computed from selection | answer-bearing |
| LONG_ANSWER_COMPONENT | LongAnswerComponent | input | componentState.marking | answer-bearing |
| FREEFORM_WORKING_COMPONENT | (working state) | input | checkAnswer + steps | answer-bearing |
| FILL_IN_GAPS_COMPONENT | FillInTheGapsComponent | input | per-gap marking | answer-bearing |
| SCRATCH_PAD_COMPONENT | ScratchPadComponent | input | NOT_MARKED 0/0/0 when the definition's is_marked is false; scored when marked | answer-bearing when marked |
| FILE_UPLOADER_COMPONENT | UploaderComponent | input | constant {score 1, max 1, weight 1} regardless of input | unresolved, see below |
| SOUND_RECORDER_COMPONENT | (no outputForMarking override) | input | inherits BaseComponent's null output | unresolved, see below |
| SOUND_COMPONENT | SoundComponent | false | constant {score 1, max 1, weight 0} | presentation-only, proven |
| HIGHLIGHT_COMPONENT | HighlightComponent | input | componentState.marking | answer-bearing |
| TEXT_BOX_COMPONENT | NewTextBoxComponent | input | mark(getAnswer()) | answer-bearing |
| NUMBER_BOX_COMPONENT | NumberBoxComponent | input | mark() | answer-bearing |
| ANNOTATED_QUESTION_COMPONENT | AnnotatedQuestionComponent | input | componentState.marking | answer-bearing |
| ANNOTATED_TEXT_COMPONENT | AnnotatedTextComponent | false | {marked NOT_MARKED, score 0, max 0, weight 0} | presentation-only, proven |

WORKING_FORMULA_COMPONENT and FORMULA_COMPONENT exist as `*_TYPECODE` statics on the factory and build the same working-formula editor components (see [[working-formula]] handling in lib/working-formula-state.js).

## Admitted companions (implemented)

SOUND_COMPONENT and ANNOTATED_TEXT_COMPONENT are admitted as companions by the gaps, highlight and working-formula readers (dropdown already admitted both with runtime `isInput === false` verification). Proof: neither class accepts input and neither output can change the weighted mark (weight 0 / NOT_MARKED 0/0/0), so answering the supported component cannot submit a companion blank. Synthetic coverage: scripts/presentation-companions-test.js.

The choice and multi-choice readers already passed both codes through their answer-bearing deny-list; their behavior is unchanged.

## Not admitted (documented, needs a product decision or live evidence)

- FILE_UPLOADER_COMPONENT: `UploaderComponent.outputForMarking` returns a constant full-marks record {score 1, max 1, weight 1} whether or not the student uploads anything. Auto-marking would not be harmed by skipping it, but the upload is a real student response (likely teacher-reviewed); whether the program may submit past it is Page's call, not a source-provable safety fact.
- SOUND_RECORDER_COMPONENT: no `outputForMarking` override (BaseComponent returns null); how ComponentIndex treats a null output on a multi-component slide is not established from source alone. Likely teacher-marked. Not admitted.
- SCRATCH_PAD_COMPONENT: grading-neutral only when the definition's `is_marked` is false; a marked scratch pad is answer-bearing. Conditional admission is possible but unimplemented.

## Live evidence still blocking full partial-answering (issue options 2/3)

- Whether Submit grades per-component or whole-question on a real mixed slide (the issue's blocking question); everything above treats whole-question Submit as the boundary.
- A sanitised capture of real slides that carry each companion code in the wild.
