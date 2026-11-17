# Dropdown mixed-editable-inputs diagnostics

Page's live output reported `mixed-editable-inputs` with `domSelectCount: 4`
("Lesson dropdowns: unsafe, unsupported or changed renderer state"). The guard
fires when the slide shows any editable control (`input`, `textarea`, `select`
or content-editable element) beyond the visible dropdown selects, but the
printed diagnostic named nothing about the extra control, so the refusal could
not be acted on without a second live capture.

The extra control cannot be identified from the refusal alone: it could be a
benign non-answer control (for example a media-player slider), a second answer
surface (a textbox or editor alongside the dropdowns, a genuinely mixed slide)
or a changed EP renderer. Relaxing the guard blind could submit an incomplete
answer on a mixed slide, so the slide stays refused.

The refusal diagnostic now describes each extra editable control in a fixed,
content-free shape: tag name, an allowlisted HTML `input` type (anything else
reports `other`), and the content-editable, disabled and read-only flags, plus
the total count. The list is capped at 8 entries with an `extrasTruncated`
flag. It never carries values, labels, ids, classes, option text or answers,
keeping the existing content-free refusal boundary. The same fields flow to
the read-only `inspect` diagnostic read.

The named control decides the follow-up: a media-player `range` input would
become a verified non-answer companion like the sound and annotated-text
components (#129); a textbox or content-editable editor alongside dropdowns is
a genuinely mixed slide that stays refused until mixed answering is designed
(#108/#109 refuse mixed answer boxes by contract).

Offline evidence only: synthetic fixtures reproduce the guard with a bare
input, a content-editable element and a 9-input overflow (cap check), and the
CLI integration prints the exact sanitized diagnostic line for a slide with a
`range` input and a read-only textarea. This is not proof of the makeup of
Page's actual slide; the next live paste of the diagnostic is what identifies
the control. The slide continues to refuse with zero key input and zero
Submits.

## Follow-up: Page's slide identified as dropdowns plus six plain text inputs

Page's next live paste (12:19, same lesson run shape) carried the new fields:
`domSelectCount: 4, extraCount: 6`, every extra `{"tag":"input","type":"text"}`
with no content-editable, disabled or read-only flag. The slide is therefore
four dropdowns plus six plain text inputs, not a media-player slider or a
read-only working area.

That is still not enough to answer safely. Six `type=text` inputs could be
TEXT_BOX_COMPONENT free-text blanks, NUMBER_BOX_COMPONENT numeric entries
(whose answers need rounding/error-margin verification), a fill-in-the-gaps
wrapper with mixed gap controls, or an unsupported editor rendered as plain
inputs; the contracts and the answer source differ for each, and guessing
would submit a wrong or partial answer on a graded lesson. Mixed answering is
also not a relaxation of this guard alone: the definition-coverage contract
(`definitions-select-count`) refuses any non-dropdown definition, and the
text/number-box contract refuses any slide with an editable control beyond its
own boxes, so supporting the mix means composing two exclusive contracts with
an all-or-nothing submit, sized well beyond a safe blind change.

The refusal diagnostic now pins the layout in one more paste, still
content-free. Each extra control also reports fixed-shape membership:
`answerBox` (`text-box`/`number-box`) when it carries EP's known answer-box
class and `inGapsComponent` when it sits inside `.fitg-component`. The refusal
adds `selectsInGaps` (`all`/`mixed`, omitted when no dropdown is gap-wrapped)
and a `definitions` summary: total definitions, a per-type count under fixed
component-type names (`dropdown`, `textBox`, `numberBox`, `sound`,
`annotatedText`, anything else bucketed as `unlisted`), and marking tallies
(`marked`/`unmarked`/`invalidMarked`). No values, labels, ids, raw class
strings, option text or answers are read. The summary tells the next step
apart: six `textBox` or `numberBox` definitions matching six answer-box
inputs makes a composed mixed handler designable; an `unlisted` bucket or a
gaps wrapper means a different shape that stays refused.

Offline evidence only: synthetic fixtures reproduce a bare input, a
content-editable element, the 9-input cap overflow, six text-box-classed
inputs with matching TEXT_BOX_COMPONENT definitions, two number-box-classed
inputs with NUMBER_BOX_COMPONENT definitions, a gap-wrapped input and
gap-wrapped selects; the CLI integration prints the exact sanitized line for
a slide with a `range` input, a read-only textarea and a text-box-classed
input. This is not proof of the makeup of Page's actual slide; the next live
paste of the diagnostic is what identifies it. The slide continues to refuse
with zero key input and zero Submits.

## Identified: four dropdowns plus six number boxes (17 November 2026)

Page's next live paste of the pinned diagnostic answered the open question.
The slide carries four `select` controls and six text inputs, every input
bearing EP's `number-box` answer-box class, and the definition summary
reports exactly four dropdown definitions and six number-box definitions -
ten answer components, no companion or unlisted definitions, and every one
authored-unmarked (`Marked 0` uniformly).

That makes the slide answerable without guessing, and the handler now
answers it. A dropdown+number-box reader engages only when both surfaces are
present together and each meets its established contract in full (the
dropdown source/DOM checks and the number-box rounding/error-margin
verification, composed all-or-nothing), and when marking is uniform across
all ten definitions - an authored-unmarked component is graded like a marked
one (EP chunk606), so a slide mixing marking flags has no single answering
contract and stays refused. Answers still come only from EP's own accepted
answers: the dropdown `Correct` flags and the number-box `answerOptions`.
Input runs the F4-popup dropdown flow, then per-character typing of the
number boxes (and text boxes when present) with a full re-verification
around every input, then the submit-readiness wait and one Submit. (The
typed terminal approval that once sat between readiness and Submit was
removed on 17 November 2026: the user defines every typed-yes-before-Submit
step as live-proven. Refusals and guards are unchanged.)
Any refusal stays content-free and stops with zero key input and zero
Submits; the single-surface slides keep their own handlers and refusals
unchanged.

Live-unverified as ever: coverage is synthetic fixtures reproducing the
pasted layout (marked and authored-unmarked variants), not a run against
Page's actual slide. The first live mixed slide is the real proof.
