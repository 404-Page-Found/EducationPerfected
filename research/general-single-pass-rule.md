# General single-pass rule: design (17 November 2026)

Page's directive (17 Nov 2026, after the mixed-slide fixes): stop adding
allowlisted slide combinations. Fill every recognised input from verified
answers in a single pass; refuse only when an input has no verified answer,
definitions disagree with the DOM, or page state is unclear. Keep the
Assessment boundary and the unsupported-type refusals (speaking, matching,
ordering, image answers, maths editor, self-mark). No typed-yes gates.

## Why

Every recognised single-surface reader currently refuses a slide that carries
any other answer-bearing component ("answering one part would submit the rest
blank"). That is the right safety primitive, but it means each new EP slide
composition needs its own handler (the dropdown+number-box, then
+text-box, then zero-dropdown progression of 17 Nov 2026). The primitive
generalizes: verify EVERY surface, fill every surface, Submit once.

## Design

A slide orchestrator (`lib/slide-surfaces-state.js` +
`lib/slide-surfaces-handler.js`) runs ahead of the single-surface readers and
engages only when two or more recognised input surfaces share one slide.
Single-surface slides keep their existing readers, handlers and refusals bit
for bit.

Detection:

1. Probe the lesson container for recognised surfaces: dropdown selects,
   number boxes, text boxes, the drag-and-drop gaps component, choice /
   multi-select components, highlight tokens.
2. For each present surface, run its existing reader under an explicit
   allow-mix set naming the other present component types (the pattern
   textbox-state/dropdown-state already implement: foreignTypes +
   foreignControl). Choice, gaps, multi-select and highlight readers gain the
   same allow-mix parameter; without it their current refusals are unchanged.
3. Every surface must verify under its own established contract (identity
   chains, verified answers from EP's own accepted answers, auto-marked
   activity, per-surface marking rules). Marking must be uniform across the
   union of definitions where the Marked-flag contract applies.
4. Any surface refusal refuses the whole slide: the printed diagnostic stays
   content-free (guard names, counts, allowlisted shapes), retagged to name
   the orchestrator. The refusal cases are exactly Page's three: an input
   with no verified answer, definitions disagreeing with the DOM, unclear
   page state - plus the kept boundaries (Assessment; speaking, matching,
   ordering, image answers, maths editor, self-mark/long-answer, scratch pad
   and any unrecognised component present on the slide).

Fill (one pass, fixed order, existing sub-rounds in fill-only mode):

1. Dropdowns: F4-popup round, verified around every key.
2. Gaps: deterministic tile-assignment clicks, verified after each gap.
3. Choice / multi-select: exact-set selection clicks with re-verification
   (the rounds gain a select-only mode like the boxes' fillOnly).
4. Number boxes and text boxes: per-character trusted typing, re-verified
   around every character.
5. Highlight tokens: one click per correct token, selection re-verified.

Submit: one guarded Submit for the whole question. Target ownership: the
dropdown readiness poll when dropdowns are present, else the first present
surface's submit read. The click-time re-verification re-reads every surface
baseline-bound (the mixed handler's verifyBoxes pattern generalized), then
the shared transition watch proves advance/modal/completion. Never Next for
the same question; a guard failing mid-run stops without retry, and a stop
can follow earlier verified inputs on other surfaces.

## Incremental shipping

1. PR A (this branch): orchestrator framework only - lib/slide-surfaces-state.js
   probes every recognised surface and routes today's supported mixes
   (dropdown/NB/TB families) through the existing reader bit-for-bit. No
   newly answered combination, no reader change, refusal output shapes
   preserved; the full handler battery stays green. This is the refactor PR.
2. PR B: choice and multi-select surfaces join the orchestrator: the inline
   choice reader extracts to lib/choice-state.js, multi-choice-state and the
   extracted choice reader gain their allow-mix parameters, the handlers gain
   select-only modes, and mixed fixtures prove the newly answered
   combinations end to end.
3. PR C: gaps and highlight surfaces join, with their allow-mix parameters
   (the gaps component-registry admission included) and mixed fixtures.

Each surface's allow-mix parameter lands in the PR that first exercises it
end to end: param-only unit tests would need the mixed fixtures twice, and
an uncalled parameter is dead code.

Each PR keeps the whole test battery green, adds fixture coverage for the
new mixes (Page's pasted diagnostics as fixtures), and follows the repo
rules: signed commits as 404-Page-Found, independent reviewer on the exact
head, cubic + SonarCloud (duplication <= 3%) green, signed fast-forward.

## Open questions

- Choice slides with a blank-submit risk: EP may treat unanswered components
  as wrong; filling every surface before Submit already covers this.
- A slide whose surfaces disagree about the Submit target refuses at the
  click-time verification.
- Detection order vs the classic text/audio kinds: unchanged; the
  orchestrator only sees Smart Lesson component slides.

## PR A implementation notes (from code reading, 17 Nov 2026)

Template files: lib/dropdown-numberbox-state.js (probe + compose + retagged
refusals) and lib/dropdown-numberbox-handler.js (fill order, submit target
ownership, verifyBoxes click-time pattern, shared transition watch). The
general orchestrator extracts their structure.

Foreign-component refusal points per reader (PR A adds an allowMix param to
each, default = today's behavior):

- lib/textbox-state.js: readInputBoxesInPage(baseline, action, config,
  allowMix=false) already implements the pattern: foreignTypes +
  foreignControl(el) matcher; emits markings when mixed.
- lib/dropdown-state.js: readDropdownsInPage(baseline, action,
  reportGuard=false, allowMix=false) already mixed-aware.
- lib/gaps-state.js L39-43: refuses defs containing any non-
  FILL_IN_GAPS_COMPONENT outside PRESENTATION_COMPONENTS (ANNOTATED_TEXT).
- lib/multi-choice-state.js L43-44: answerBearingCodes check; L51-53:
  foreign-editable DOM scan outside the group.
- lib/detect-question.js choice branch L489-498: same two checks inline
  (answerBearingCodes list + foreign-editable scan). Choice reading lives
  inside detectQuestionInPage; extracting it to lib/choice-state.js with an
  allowMix param is part of PR A/B.
- lib/highlight-state.js L34: expects exactly one HIGHLIGHT_COMPONENT.

PR A shape:
1. lib/slide-surfaces-state.js: probeAllSurfacesInPage() counts every
   recognised surface; composeSlideSurfaces(page, action) routes box-family
   combos through the moved dropdown-numberbox logic and returns the same
   'dropdown-numberbox' descriptor shape (bit-for-bit); other multi-surface
   combos return null so today's per-reader refusals are unchanged.
2. detectQuestion calls the new module in place of readDropdownNumberBox.
3. allowMix params land per surface in the PR that wires that surface into
   the orchestrator (B: choice + multi-select; C: gaps + highlight), tested
   by that PR's mixed fixtures.
4. Existing suites must pass unchanged in every PR. SonarCloud: move, don't
   copy - shared helpers for the mixed descriptor assembly.
