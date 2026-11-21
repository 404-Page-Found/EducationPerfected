// Shared in-page program segments for the read-only structural captures
// (lib/dash-diagnostics.js, lib/components-diagnostics.js). Each capture's
// program runs INSIDE the page via page.evaluate and is composed from
// INSPECTION_HELPERS (lib/inspection.js) plus these segments, so each concern
// (known codes, visibility counts, assessment boundary, model walk, component
// summary) has one source instead of a copy per capture.
//
// Composition contract: the program defines `result` ({ build, readOnly })
// before ASSESSMENT_SHELL_GUARD and `routing` before MODEL_WALK; segments read
// the INSPECTION_HELPERS utilities `data`, `integer`, `bool` and `shape`.
// Every segment records fixed field names and recognized codes only - never
// question/answer text, option text, arbitrary metadata keys, class strings,
// ids or attribute values.

// Fixed allowlist of EP question-component type codes (chunk606
// createComponentState, research/component-companion-inventory.md): a listed
// code reports its own fixed name, anything else the literal
// 'UNLISTED_COMPONENT'. Derived from the canonical inventory so diagnostics
// stay in sync without copying the list.
const { KNOWN_COMPONENT_CODES: CANONICAL_KNOWN_CODES } = require('./companion-components');
const KNOWN_COMPONENT_CODES = `
    const known = new Set(${JSON.stringify(CANONICAL_KNOWN_CODES)});
`;

// Fixed candidate selectors only; a match reports a count, never the matched
// element's own markup.
const VISIBILITY_COUNTERS = `
    const shown = el => !!el && !el.hidden
        && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0));
    const count = selector => {
        try { return [...document.querySelectorAll(selector)].filter(shown).length; } catch (e) { return null; }
    };
`;

// Same refusal boundary as detection: an assessment shell is never read for
// question state, even by a read-only capture.
const ASSESSMENT_SHELL_GUARD = `
    const assessmentControls = [...document.querySelectorAll('game-assessment-action-bar, game-assessment-side-bar, game-assessment-navigation-controls')];
    if (assessmentControls.some(el => shown(el)
        || [...el.querySelectorAll('button,a,input,select,textarea,[role="button"]')].some(shown))) {
        return { ...result, guard: 'assessment-mode' };
    }
`;

// The URL stays private; only the two routing facts a session needs.
const ROUTING = `
    const path = String(location && location.pathname || '');
    const routing = { pathIncludesDash: /dash/i.test(path), pathIncludesQuiz: /quiz/i.test(path) };
`;

// The game model hangs off the AngularJS scope's self, found by walking up
// from a rendered anchor (the same approach as the question readers).
const MODEL_WALK = `
    const anchors = [
        ...document.querySelectorAll('div.multi-choice-component[role=radiogroup]'),
        document.querySelector('#question-text'),
        document.querySelector('#ep-question-container'),
        document.querySelector('.voice-speaker'),
        document.body,
    ].filter(Boolean);
    let self = null, model = null;
    for (const anchor of anchors) {
        for (let el = anchor, depth = 0; el && depth < 20; el = el.parentElement, depth++) {
            try {
                const scope = window.angular?.element?.(el)?.scope?.();
                const candidate = data(scope, 'self'), candidateModel = data(candidate, 'model');
                if (candidateModel) { self = candidate; model = candidateModel; break; }
            } catch { break; } // Do not fall through an unreadable scope to an ancestor.
        }
        if (model) break;
    }
    if (!model) return { ...result, guard: 'model-unreadable', routing };
`;

const GAME_MODE_FLAGS = `
    const gameMode = integer(data(model, 'gameMode'));
    const isDash = bool(data(model, 'isDash'));
`;

// Model-level assessment boundary: the DOM shell check above only covers
// mounted controls, so gameMode is checked before any question state is read.
const GAME_MODE_ASSESSMENT_GUARD = `
    if (gameMode === 2) return { ...result, guard: 'assessment-mode', routing, gameMode, isDash };
`;

const QUESTION_DEFS = `
    const q = data(model, '_currentQuestion');
    const def = data(q, 'questionDef');
    const defs = data(def, 'Components');
`;

// Structural counts only: which fixed Correct representations the options
// carry, never the option text or the answer itself. Indexed reads go through
// property descriptors too: a getter on an array index must not run (same
// accessor-free contract as the rest of the capture).
const COMPONENT_SUMMARY = `
    const components = Array.isArray(defs) ? Array.from({ length: Math.min(defs.length, 20) }, (_, i) => {
        const c = data(defs, String(i)), code = data(c, 'ComponentTypeCode');
        const options = data(c, 'Options');
        const optionCount = Array.isArray(options) ? options.length : null;
        let correctStringTrue = null, correctBooleanTrue = null, correctFieldShapes = null, accessorOptionSlots = null, optionsTruncated = null;
        if (Array.isArray(options)) {
            correctStringTrue = 0;
            correctBooleanTrue = 0;
            accessorOptionSlots = 0;
            // Bounded scan: a huge or malformed Options array must not block
            // the page past the command timeout; the flag labels partial
            // aggregates instead of silently truncating.
            optionsTruncated = options.length > 40;
            const shapes = new Set();
            for (let i = 0; i < Math.min(options.length, 40); i++) {
                const d = Object.getOwnPropertyDescriptor(options, String(i));
                // An accessor slot is reported, never run: the Correct counts
                // then cover only the readable slots, and this count says so.
                if (d && !Object.hasOwn(d, 'value')) { accessorOptionSlots++; continue; }
                const option = d ? d.value : undefined;
                const correct = data(option, 'Correct');
                if (correct === 'true') correctStringTrue++;
                if (correct === true) correctBooleanTrue++;
                if (i < 10) shapes.add(shape(option, 'Correct'));
            }
            correctFieldShapes = [...shapes];
        }
        return {
            type: known.has(code) ? code : 'UNLISTED_COMPONENT',
            allowMultiSelect: bool(data(c, 'AllowMultiSelect')),
            marked: integer(data(c, 'Marked')),
            optionsShape: shape(c, 'Options'),
            optionCount,
            correctStringTrue,
            correctBooleanTrue,
            correctFieldShapes,
            accessorOptionSlots,
            optionsTruncated,
        };
    }) : [];
`;

module.exports = {
    KNOWN_COMPONENT_CODES,
    VISIBILITY_COUNTERS,
    ASSESSMENT_SHELL_GUARD,
    ROUTING,
    MODEL_WALK,
    GAME_MODE_FLAGS,
    GAME_MODE_ASSESSMENT_GUARD,
    QUESTION_DEFS,
    COMPONENT_SUMMARY,
};
