// Slide orchestrator for the general single-pass rule (design:
// research/general-single-pass-rule.md, 17 November 2026). A slide carrying
// two or more recognised input surfaces is answered only when EVERY surface
// verifies under its own established contract; the slide then fills in one
// pass and Submits once. Single-surface slides fall through to the existing
// readers unchanged.
//
// Routing: a slide with exactly one multi-select surface plus box-family
// inputs is composed by readSlideSurfaces (PR B). Every other slide
// delegates to the existing dropdown-numberbox reader unconditionally,
// preserving its probe, mid-swap re-probe and refusal retagging bit-for-bit:
// this probe's snapshot must never gate that call, because it can beat an
// asynchronously rendering second surface. Single-choice, gaps and highlight
// surfaces join the composition in later PRs; slides carrying them fall
// through to today's per-reader refusals unchanged.
const { readDropdownNumberBox } = require('./dropdown-numberbox-state');
const { readDropdownsInPage } = require('./dropdown-state');
const { readMultiChoiceInPage } = require('./multi-choice-state');
const { readChoiceInPage } = require('./choice-state');
const { readGapsInPage } = require('./gaps-state');
const { readHighlightInPage } = require('./highlight-state');
const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');

// Count every recognised input surface in the lesson container. Surface
// selectors mirror the single-surface readers exactly so a surface the
// orchestrator counts is a surface its reader can verify.
function probeAllSurfacesInPage() {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const lesson = document.querySelector('#ep-question-container');
    if (!lesson) return null;
    const choiceGroups = [...lesson.querySelectorAll('div.multi-choice-component')].filter(shown);
    return {
        selects: [...lesson.querySelectorAll('select')].filter(shown).length,
        numberBoxes: [...lesson.querySelectorAll('input.number-box-component')].filter(shown).length,
        textBoxes: [...lesson.querySelectorAll('input.text-box-component')].filter(shown).length,
        gaps: [...lesson.querySelectorAll('.fitg-component.fitg-drag-drop')].filter(shown).length,
        choices: choiceGroups.length,
        multiSelects: choiceGroups.filter(g => g.getAttribute('role') === 'group' || g.classList.contains('multi-select')).length,
        highlights: [...lesson.querySelectorAll('div.highlight-input')].filter(shown).length,
    };
}

// A multi-select surface sharing a slide with box-family inputs is composed
// here: each present surface verifies under its own established reader with
// an explicit allow-mix set naming the other present component types, and
// marking must be uniform across the union of definitions (an authored-
// unmarked component is graded like a marked one, so a mixed-marking slide
// has no single answering contract). Every surface refusal refuses the whole
// slide, retagged so the printed diagnostic names the orchestrator.
async function readSlideSurfaces(page, action) {
    const probe = await page.evaluate(probeAllSurfacesInPage);
    if (!probe) return null;
    if (probe.multiSelects !== 1) {
        // No multi-select surface: delegate every slide to the established
        // mixed reader unconditionally, exactly as before this module
        // existed. Its own probe and mid-swap re-probe decide whether a
        // box-family mix is present; this probe's snapshot must never gate
        // that call, because it can beat an asynchronously rendering second
        // surface.
        return readDropdownNumberBox(page, action);
    }
    // Exactly one multi-select surface. Slides also carrying a single-choice
    // group fall through to today's per-reader refusals until that surface
    // joins; a slide with no companion surface belongs to the multi-select
    // reader alone. A probe snapshot can still
    // beat a late-rendering surface: each reader below then refuses on the
    // foreign definitions, failing closed exactly as the single readers do.
    // Two choice groups compose only as exactly one single-choice plus one
    // multi-select surface, each verified by its own reader; any other
    // choice-group count falls through to today's per-reader refusals.
    if (!(probe.choices === 1 || (probe.choices === 2 && probe.multiSelects === 1))) return null;
    if (!(probe.choices === 2 || probe.selects > 0 || probe.numberBoxes > 0 || probe.textBoxes > 0 || probe.gaps > 0 || probe.highlights > 0)) return null;
    const types = [];
    if (probe.selects > 0) types.push('DROPDOWN_COMPONENT');
    if (probe.numberBoxes > 0) types.push('NUMBER_BOX_COMPONENT');
    if (probe.textBoxes > 0) types.push('TEXT_BOX_COMPONENT');
    if (probe.gaps > 0) types.push('FILL_IN_GAPS_COMPONENT');
    if (probe.highlights > 0) types.push('HIGHLIGHT_COMPONENT');
    types.push('MULTICHOICE_COMPONENT');
    const mixFor = own => types.filter(t => t !== own);
    // A surface refusal passes through retagged so the printed diagnostic
    // names the orchestrator that engaged; counts stay content-free. A null
    // read (a surface disappeared mid-probe) stays null so detection falls
    // through to the single-surface readers instead of returning an
    // undefined descriptor.
    const passThrough = result => {
        if (result == null) return null;
        const descriptor = result.descriptor;
        if (!descriptor || descriptor.kind !== 'unsupported' || descriptor.assessment || !descriptor.diagnostic) return { descriptor };
        return { descriptor: { ...descriptor, diagnostic: { ...descriptor.diagnostic, kind: 'slide-surfaces-refusal', domSelectCount: probe.selects, domBoxCount: probe.numberBoxes, domTextBoxCount: probe.textBoxes, domMultiSelectCount: probe.multiSelects } } };
    };
    let dropdowns = null;
    if (probe.selects > 0) {
        dropdowns = await page.evaluate(readDropdownsInPage, null, action, false, mixFor('DROPDOWN_COMPONENT'));
        if (dropdowns?.descriptor?.kind !== 'dropdown') return passThrough(dropdowns);
    }
    let numberBoxes = null;
    if (probe.numberBoxes > 0) {
        numberBoxes = await page.evaluate(readInputBoxesInPage, null, action, NUMBER_BOX_CONFIG, mixFor('NUMBER_BOX_COMPONENT'));
        if (numberBoxes?.descriptor?.kind !== 'numberbox') return passThrough(numberBoxes);
    }
    let textBoxes = null;
    if (probe.textBoxes > 0) {
        textBoxes = await page.evaluate(readInputBoxesInPage, null, action, TEXTBOX_CONFIG, mixFor('TEXT_BOX_COMPONENT'));
        if (textBoxes?.descriptor?.kind !== 'textbox') return passThrough(textBoxes);
    }
    let gaps = null;
    if (probe.gaps > 0) {
        gaps = await page.evaluate(readGapsInPage, null, action, mixFor('FILL_IN_GAPS_COMPONENT'));
        if (gaps?.descriptor?.kind !== 'gaps') return passThrough(gaps);
    }
    let highlight = null;
    if (probe.highlights > 0) {
        highlight = await page.evaluate(readHighlightInPage, null, action, mixFor('HIGHLIGHT_COMPONENT'));
        if (highlight?.descriptor?.kind !== 'highlight') return passThrough(highlight);
    }
    let choice = null;
    if (probe.choices === 2) {
        // The sibling single-choice surface shares the multi surface's
        // component type code, so both choice readers receive the full type
        // set and each admits exactly one surface of the opposite mode.
        const raw = await page.evaluate(readChoiceInPage, null, null, types);
        if (raw == null) return null;
        if (raw.kind !== 'choice' || raw.multi !== false) return passThrough({ descriptor: raw });
        choice = { descriptor: raw };
    }
    const multi = await page.evaluate(readMultiChoiceInPage, null, action, choice ? types : mixFor('MULTICHOICE_COMPONENT'));
    if (multi?.descriptor?.kind !== 'choice') return passThrough(multi);
    const markings = [...(dropdowns ? dropdowns.descriptor.markings : []), ...(numberBoxes ? numberBoxes.descriptor.markings : []),
        ...(textBoxes ? textBoxes.descriptor.markings : []), ...(gaps ? gaps.descriptor.markings : []),
        ...(highlight ? highlight.descriptor.markings : []), ...(choice ? choice.descriptor.markings : []),
        ...multi.descriptor.markings];
    if (new Set(markings).size !== 1) {
        return { descriptor: { kind: 'unsupported', reason: 'Multi-select with lesson inputs: unsafe, unsupported or changed renderer state', diagnostic: { kind: 'slide-surfaces-refusal', guard: 'mixed-definition-marking', domSelectCount: probe.selects, domBoxCount: probe.numberBoxes, domTextBoxCount: probe.textBoxes, domMultiSelectCount: probe.multiSelects, markedDefCount: markings.filter(m => m === 1).length, unmarkedDefCount: markings.filter(m => m === 0).length, invalidMarkedDefCount: markings.filter(m => m !== 0 && m !== 1).length } } };
    }
    const parts = [dropdowns, numberBoxes, textBoxes, gaps, highlight, choice, multi].filter(Boolean);
    const descriptor = {
        kind: 'slide-surfaces',
        key: parts.map(r => r.descriptor.key).join('+'),
        autoMarked: true,
        marked: markings[0] === 1,
        surfaces: types,
        dropdownCount: dropdowns ? dropdowns.descriptor.dropdowns.length : 0,
        boxCount: numberBoxes ? numberBoxes.descriptor.boxes.length : 0,
        textBoxCount: textBoxes ? textBoxes.descriptor.boxes.length : 0,
        gapCount: gaps ? gaps.descriptor.gaps.length : 0,
        highlightTokenCount: highlight ? highlight.descriptor.tokenCount : 0,
        choiceOptionCount: choice ? choice.descriptor.options.length : 0,
        choiceSibling: choice !== null,
        multiOptionCount: multi.descriptor.options.length,
        dropdown: dropdowns ? dropdowns.descriptor : null,
        numberBox: numberBoxes ? numberBoxes.descriptor : null,
        textBox: textBoxes ? textBoxes.descriptor : null,
        gaps: gaps ? gaps.descriptor : null,
        highlight: highlight ? highlight.descriptor : null,
        choice: choice ? choice.descriptor : null,
        multi: multi.descriptor,
    };
    return { descriptor };
}

module.exports = { readSlideSurfaces, probeAllSurfacesInPage };
