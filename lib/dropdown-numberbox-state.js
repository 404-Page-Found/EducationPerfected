// Orchestrator for one slide carrying dropdown selects with number-box
// inputs, or number-box inputs with lesson text boxes (dropdowns optional),
// (EP public chunk606, checked 6-17 November 2026). Each single-surface
// reader refuses such a slide (mixed-editable-inputs / lesson-dom), so this
// module detects the mix, then has each established reader verify its own
// surface under its explicit allow-mix flag - every per-component check from
// the individual contracts still applies, never re-implemented here. The
// slide is answered only when every surface verifies against EP's own
// accepted answers AND marking is uniform across the union of definitions:
// an authored-unmarked component is graded like a marked one, so a slide
// mixing marking flags has no single answering contract and stays refused.
const { readDropdownsInPage } = require('./dropdown-state');
const { NUMBER_BOX_CONFIG, TEXTBOX_CONFIG, readInputBoxesInPage } = require('./textbox-state');

// Only a slide showing dropdowns and number boxes, or number boxes and
// text boxes, belongs to this reader (text boxes may join a dropdown mix as
// a third surface); anything else falls through to the single-surface
// readers unchanged.
function probeMixedSurfacesInPage() {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const lesson = document.querySelector('#ep-question-container');
    if (!lesson) return null;
    const selects = [...lesson.querySelectorAll('select')].filter(shown).length;
    const boxes = [...lesson.querySelectorAll('input.number-box-component')].filter(shown).length;
    const textBoxes = [...lesson.querySelectorAll('input.text-box-component')].filter(shown).length;
    return (selects > 0 && boxes > 0) || (boxes > 0 && textBoxes > 0) ? { selects, boxes, textBoxes } : null;
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
        const mix = diagnostic?.guard === 'mixed-editable-inputs' ? diagnostic.extras?.some(e => e.answerBox === 'number-box' || e.answerBox === 'text-box')
            : diagnostic?.guard === 'definitions-select-count';
        if (!mix) return null;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!probe) return null;
    // A text-box third surface admits itself into every companion reader's
    // allow-mix set; a two-surface slide keeps the original `true` contract.
    // Without selects the slide is number boxes + text boxes: the readers'
    // mix sets admit exactly the other box surface, so a stray select still
    // refuses. (A mid-render box slide whose definitions outnumber its DOM
    // boxes is refused by every single-surface reader's lesson-dom count
    // check, so falling through here never answers a half-rendered slide.)
    const withDropdowns = probe.selects > 0;
    const withTextBoxes = probe.textBoxes > 0;
    const dropdownMix = withTextBoxes ? ['NUMBER_BOX_COMPONENT', 'TEXT_BOX_COMPONENT'] : true;
    const numberBoxMix = withDropdowns ? (withTextBoxes ? ['DROPDOWN_COMPONENT', 'TEXT_BOX_COMPONENT'] : true) : ['TEXT_BOX_COMPONENT'];
    const textBoxMix = withDropdowns ? ['DROPDOWN_COMPONENT', 'NUMBER_BOX_COMPONENT'] : ['NUMBER_BOX_COMPONENT'];
    if (withDropdowns && (!dropdowns || withTextBoxes)) dropdowns = await page.evaluate(readDropdownsInPage, null, action, false, dropdownMix);
    // A surface refusal passes through retagged so the printed diagnostic
    // names the mixed reader that engaged; counts stay content-free. A null
    // read (a surface disappeared mid-probe) stays null so detection falls
    // through to the other readers instead of returning an undefined
    // descriptor.
    const passThrough = result => {
        if (result == null) return null;
        const descriptor = result.descriptor;
        if (descriptor?.kind !== 'unsupported' || descriptor.assessment || !descriptor.diagnostic) return { descriptor };
        return { descriptor: { ...descriptor, diagnostic: { ...descriptor.diagnostic, kind: 'dropdown-numberbox-refusal', domSelectCount: probe.selects, domBoxCount: probe.boxes, ...(withTextBoxes ? { domTextBoxCount: probe.textBoxes } : {}) } } };
    };
    if (withDropdowns && dropdowns?.descriptor?.kind !== 'dropdown') return passThrough(dropdowns);
    const numberBoxes = await page.evaluate(readInputBoxesInPage, null, action, NUMBER_BOX_CONFIG, numberBoxMix);
    if (numberBoxes?.descriptor?.kind !== 'numberbox') return passThrough(numberBoxes);
    const textBoxes = withTextBoxes ? await page.evaluate(readInputBoxesInPage, null, action, TEXTBOX_CONFIG, textBoxMix) : null;
    if (withTextBoxes && textBoxes?.descriptor?.kind !== 'textbox') return passThrough(textBoxes);
    const markings = [...(withDropdowns ? dropdowns.descriptor.markings : []), ...numberBoxes.descriptor.markings, ...(textBoxes ? textBoxes.descriptor.markings : [])];
    if (new Set(markings).size !== 1) {
        return { descriptor: { kind: 'unsupported', reason: 'Lesson dropdowns with number boxes: unsafe, unsupported or changed renderer state', diagnostic: { kind: 'dropdown-numberbox-refusal', guard: 'mixed-definition-marking', domSelectCount: probe.selects, domBoxCount: probe.boxes, ...(withTextBoxes ? { domTextBoxCount: probe.textBoxes } : {}), markedDefCount: markings.filter(m => m === 1).length, unmarkedDefCount: markings.filter(m => m === 0).length, invalidMarkedDefCount: markings.filter(m => m !== 0 && m !== 1).length } } };
    }
    const descriptor = {
        kind: 'dropdown-numberbox',
        key: (withDropdowns ? dropdowns.descriptor.key + '+' : '') + numberBoxes.descriptor.key + (textBoxes ? '+' + textBoxes.descriptor.key : ''),
        autoMarked: true,
        marked: markings[0] === 1,
        inputMode: 'f4-popup',
        dropdownCount: withDropdowns ? dropdowns.descriptor.dropdowns.length : 0,
        boxCount: numberBoxes.descriptor.boxes.length,
        dropdowns: withDropdowns ? dropdowns.descriptor.dropdowns : [],
        boxes: numberBoxes.descriptor.boxes,
        dropdown: withDropdowns ? dropdowns.descriptor : null,
        numberBox: numberBoxes.descriptor,
        ...(textBoxes ? {
            textBoxCount: textBoxes.descriptor.boxes.length,
            textBoxes: textBoxes.descriptor.boxes,
            textBox: textBoxes.descriptor,
        } : {}),
    };
    return { descriptor };
}

module.exports = { readDropdownNumberBox };
