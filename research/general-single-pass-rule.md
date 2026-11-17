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

1. PR A (this branch): orchestrator framework + allow-mix parameters on every
   reader, wired so today's supported mixes (dropdown/NB/TB families) route
   through it unchanged. No newly answered combination yet; refusal output
   shapes preserved. This is the refactor PR.
2. PR B: choice and multi-select surfaces join the orchestrator
   (select-only rounds + cross-surface submit verification).
3. PR C: gaps and highlight surfaces join.

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
