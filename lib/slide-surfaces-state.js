// Slide orchestrator for the general single-pass rule (design:
// research/general-single-pass-rule.md, 17 November 2026). A slide carrying
// two or more recognised input surfaces is answered only when EVERY surface
// verifies under its own established contract; the slide then fills in one
// pass and Submits once. Single-surface slides fall through to the existing
// readers unchanged.
//
// PR A scope: the probe recognises every input surface, and the dispatch
// routes any slide showing box-family surfaces through the existing
// dropdown-numberbox reader bit-for-bit (its own probe, mid-swap re-probe
// and refusal retagging are preserved by delegating). Other multi-surface
// mixes fall through to today's per-reader refusals until their surfaces
// join the orchestrator (choice and multi-select in PR B, gaps and
// highlight in PR C).
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
    const probe = await page.evaluate(probeAllSurfacesInPage);
    if (!probe) return null;
    // Any visible box-family surface may belong to an established mix; the
    // delegated reader proves or disproves the mix (including mid-swap
    // re-probes) and a genuinely single-surface slide reads null here and
    // falls through to its own reader, exactly as before.
    if (probe.selects > 0 || probe.numberBoxes > 0 || probe.textBoxes > 0) {
        return readDropdownNumberBox(page, action);
    }
    // Slides without box-family surfaces (including choice, multi-select,
    // gaps or highlight mixes) fall through: the single-surface readers'
    // established refusals apply unchanged until that surface joins the
    // orchestrator.
    return null;
}

module.exports = { readSlideSurfaces };
