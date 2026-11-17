// Slide orchestrator for the general single-pass rule (design:
// research/general-single-pass-rule.md, 17 November 2026). A slide carrying
// two or more recognised input surfaces is answered only when EVERY surface
// verifies under its own established contract; the slide then fills in one
// pass and Submits once. Single-surface slides fall through to the existing
// readers unchanged.
//
// PR A scope: the probe recognises every input surface (exercised by
// scripts/slide-surfaces-race-test.js; it becomes load-bearing when choice
// and multi-select join in PR B, gaps and highlight in PR C). The dispatch
// delegates every slide to the existing dropdown-numberbox reader
// unconditionally, preserving its probe, mid-swap re-probe and refusal
// retagging bit-for-bit: the orchestrator's snapshot must never gate that
// call, because it can beat an asynchronously rendering second surface.
// Other multi-surface mixes fall through to today's per-reader refusals
// unchanged.
const { readDropdownNumberBox } = require('./dropdown-numberbox-state');

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

async function readSlideSurfaces(page, action) {
    // PR A delegates every slide to the established mixed reader
    // unconditionally: its own probe and mid-swap re-probe decide whether a
    // box-family mix is present, exactly as before this module existed. The
    // all-surface probe must never gate the delegation - its snapshot can
    // beat an asynchronously rendering second surface, and the delegated
    // reader's retry loop is the established answer to that race.
    // probeAllSurfacesInPage is exercised by its own unit test and becomes
    // load-bearing when choice and multi-select surfaces join in PR B.
    return readDropdownNumberBox(page, action);
}

module.exports = { readSlideSurfaces, probeAllSurfacesInPage };
