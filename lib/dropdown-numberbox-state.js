// Orchestrator for one slide carrying both dropdown selects and number-box
// inputs (EP public chunk606, checked 6-9 November 2026). Each single-surface
// reader refuses such a slide (mixed-editable-inputs / lesson-dom), so this
// module detects the pair, then has each established reader verify its own
// surface under its explicit allow-mix flag - every per-component check from
// the individual contracts still applies, never re-implemented here. The
// slide is answered only when both surfaces verify against EP's own accepted
// answers AND marking is uniform across the union of definitions: an
// authored-unmarked component is graded like a marked one, so a slide mixing
// marking flags has no single answering contract and stays refused.
const { readDropdownsInPage } = require('./dropdown-state');
const { NUMBER_BOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');

// Only a slide showing both surfaces belongs to this reader; anything else
// falls through to the single-surface readers unchanged.
function probeMixedSurfacesInPage() {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const lesson = document.querySelector('#ep-question-container');
    if (!lesson) return null;
    const selects = [...lesson.querySelectorAll('select')].filter(shown).length;
    const boxes = [...lesson.querySelectorAll('input.number-box-component')].filter(shown).length;
    return selects > 0 && boxes > 0 ? { selects, boxes } : null;
}

async function readDropdownNumberBox(page, action) {
    // EP swaps slides asynchronously: the probe can beat the second surface's
    // render. A dropdown read that meets number-box facts proves the mix, so
    // re-probe after a beat instead of falling through mid-swap.
    let probe = null, dropdowns = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        probe = await page.evaluate(probeMixedSurfacesInPage);
        if (probe) break;
        dropdowns = await page.evaluate(readDropdownsInPage, null, action, false, true);
        const diagnostic = dropdowns?.descriptor?.diagnostic;
        const mix = diagnostic?.guard === 'mixed-editable-inputs' ? diagnostic.extras?.some(e => e.answerBox === 'number-box')
            : diagnostic?.guard === 'definitions-select-count';
        if (!mix) return null;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!probe) return null;
    if (!dropdowns) dropdowns = await page.evaluate(readDropdownsInPage, null, action, false, true);
    // A surface refusal passes through retagged so the printed diagnostic
    // names the mixed reader that engaged; counts stay content-free.
    const passThrough = result => {
        const descriptor = result?.descriptor;
        if (!descriptor || descriptor.kind !== 'unsupported' || descriptor.assessment || !descriptor.diagnostic) return { descriptor };
        return { descriptor: { ...descriptor, diagnostic: { ...descriptor.diagnostic, kind: 'dropdown-numberbox-refusal', domSelectCount: probe.selects, domBoxCount: probe.boxes } } };
    };
    if (dropdowns?.descriptor?.kind !== 'dropdown') return passThrough(dropdowns);
    const numberBoxes = await page.evaluate(readInputBoxesInPage, null, action, NUMBER_BOX_CONFIG, true);
    if (numberBoxes?.descriptor?.kind !== 'numberbox') return passThrough(numberBoxes);
    const markings = [...dropdowns.descriptor.markings, ...numberBoxes.descriptor.markings];
    if (new Set(markings).size !== 1) {
        return { descriptor: { kind: 'unsupported', reason: 'Lesson dropdowns with number boxes: unsafe, unsupported or changed renderer state', diagnostic: { kind: 'dropdown-numberbox-refusal', guard: 'mixed-definition-marking', domSelectCount: probe.selects, domBoxCount: probe.boxes, markedDefCount: markings.filter(m => m === 1).length, unmarkedDefCount: markings.filter(m => m === 0).length, invalidMarkedDefCount: markings.filter(m => m !== 0 && m !== 1).length } } };
    }
    const descriptor = {
        kind: 'dropdown-numberbox',
        key: dropdowns.descriptor.key + '+' + numberBoxes.descriptor.key,
        autoMarked: true,
        marked: markings[0] === 1,
        inputMode: 'f4-popup',
        dropdownCount: dropdowns.descriptor.dropdowns.length,
        boxCount: numberBoxes.descriptor.boxes.length,
        dropdowns: dropdowns.descriptor.dropdowns,
        boxes: numberBoxes.descriptor.boxes,
        dropdown: dropdowns.descriptor,
        numberBox: numberBoxes.descriptor,
    };
    return { descriptor };
}

module.exports = { readDropdownNumberBox };
