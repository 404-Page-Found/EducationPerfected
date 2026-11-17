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
