// Automatic client-end task support report. Local only: the run keeps a tally
// of the question types it met and what happened to each (answered, refused,
// skipped) with a reason CATEGORY. It never stores question text, answers,
// page content or credentials. The report is a plain text block printed to the
// console so the user can copy it by hand. The same enums can also go to the
// anonymous relay (lib/support-sender.js) unless sending is turned off.
// An unsupported round also keeps a content-free shape (branch, game mode,
// question type, component codes, control counts) so the issue can say what
// to build.

const OUTCOMES = new Set(['answered', 'refused', 'skipped']);

// Fixed vocabularies. Anything outside them is reported as 'other' (reason) or
// 'unknown' (task type), so free text, which could carry question or answer
// content, can never reach the report or the payload.
const REASONS = new Set([
    'completed',
    'unsupported-question',
    'no-handler',
    'handler-stopped',
    'empty-answer',
    'pre-submit-guard',
    'unreadable-question',
    'futility-guard',
    'stopped-by-user',
    'other',
]);
// Task types the answer loop can meet (descriptor kinds plus the classic text round).
const TASK_TYPES = new Set([
    'text', 'choice', 'gaps', 'textbox', 'numberbox', 'dropdown', 'dropdown-numberbox',
    'slide-surfaces', 'reflection', 'highlight', 'workingformula', 'info-slide',
    'audio', 'typed', 'dash-typed', 'unsupported',
]);

// Refusal branches for 'unsupported' rounds. The refusal reason text is only
// ever matched against fixed patterns here; the text itself is never kept.
const BRANCHES = new Set([
    'assessment', 'dash', 'unknown-game-mode', 'scope-unreadable', 'no-identity', 'translation-mode',
    'accompanying-component', 'foreign-controls', 'foreign-choice', 'foreign-multiselect', 'foreign-dropdown',
    'foreign-textbox', 'foreign-formula', 'foreign-slide-surfaces', 'multiple-components', 'renderer-association',
    'missing-metadata', 'generic-slide', 'detection-error', 'guard-refusal', 'handler-stop', 'other',
]);
const GAME_MODES = new Set(['classic', 'assessment', 'lesson', 'unknown']);
// Mirrors knownComponentTypes in lib/detect-question.js. Anything else is 'UNLISTED_COMPONENT'.
const COMPONENT_CODES = new Set([
    'ANNOTATED_QUESTION_COMPONENT', 'ANNOTATED_TEXT_COMPONENT', 'DEPTH_COMPONENT',
    'DROPDOWN_COMPONENT', 'FILE_UPLOADER_COMPONENT', 'FILL_IN_GAPS_COMPONENT',
    'FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT', 'HIGHLIGHT_COMPONENT',
    'LONG_ANSWER_COMPONENT', 'MULTICHOICE_COMPONENT', 'NUMBER_BOX_COMPONENT',
    'SCRATCH_PAD_COMPONENT', 'SOUND_COMPONENT', 'SOUND_RECORDER_COMPONENT',
    'TEXT_BOX_COMPONENT', 'TYPE_ARROW_COMPONENT', 'TYPE_EQUALS_COMPONENT',
    'TYPE_EXPONENT_COMPONENT', 'TYPE_GROUP_COMPONENT', 'TYPE_MATH_ENTITY_COMPONENT',
    'TYPE_MATH_FUNCTION_COMPONENT', 'TYPE_MULTI_OPERATOR_COMPONENT', 'TYPE_NUMBER_COMPONENT',
    'TYPE_OR_COMPONENT', 'TYPE_SUBSCRIPT_SUPERSCRIPT_COMPONENT', 'TYPE_TEXT_COMPONENT',
    'TYPE_UNARY_OPERATOR_COMPONENT', 'WORKING_FORMULA_COMPONENT',
    'UNLISTED_COMPONENT',
]);
const CONTROL_KEYS = ['inputs', 'textareas', 'selects', 'editable', 'canvases', 'buttons'];
// Guard identifiers are fixed code constants (kebab-case), never page text.
const GUARD_RE = /^[a-z][a-z0-9-]{0,39}$/;
// Counts the refusing guard already computed (fixed code-constant key names, small integers).
const COUNT_KEY_RE = /^[A-Za-z][A-Za-z0-9.]{0,39}$/;
const MAX_GUARD_COUNTS = 12;
const SHAPE_KEYS = new Set(['gameMode', 'questionType', 'componentCount', 'controls']);
const MAX_COMPONENTS = 8;
const MAX_COUNT = 99;

// -1 means unknown or unreadable.
const UNKNOWN = -1;
const boundedInt = n => (Number.isSafeInteger(n) && n >= 0 ? Math.min(n, MAX_COUNT) : UNKNOWN);
const GAME_MODE_NAMES = { 1: 'classic', 2: 'assessment', 3: 'lesson' };
const byName = (a, b) => a.localeCompare(b);

function classifyBranch(descriptor) {
    if (descriptor?.assessment) return 'assessment';
    if (descriptor?.dash) return 'dash';
    const reason = typeof descriptor?.reason === 'string' ? descriptor.reason : '';
    const rules = [
        ['detection-error', /^Question detection failed/],
        ['unknown-game-mode', /unknown modes \(gameMode/],
        ['scope-unreadable', /AngularJS scope unavailable|answer state could not be read/],
        ['no-identity', /stable identity|contentID/],
        ['translation-mode', /translationMode/],
        ['accompanying-component', /accompanying component|other answer-bearing/],
        ['multiple-components', /multiple visible choice|exactly one identifiable/],
        // Each refusal site gets its own branch, so a report says which guard fired.
        ['foreign-choice', /editable controls outside the choice component/],
        ['foreign-multiselect', /editable controls outside the multi-select component/],
        ['foreign-formula', /editable controls outside the editor/],
        ['foreign-slide-surfaces', /^Multi-select with lesson inputs/],
        ['foreign-dropdown', /^Lesson dropdowns/],
        ['foreign-textbox', /^Lesson (textboxes|number boxes)/],
        ['foreign-controls', /editable controls|lesson inputs|unsafe, unsupported or changed/],
        ['renderer-association', /renderer|plain block|formula choices/],
        ['missing-metadata', /metadata|no usable text|marking flag/],
        ['generic-slide', /unsupported question type \(not text/],
    ];
    for (const [branch, pattern] of rules) if (pattern.test(reason)) return branch;
    return typeof descriptor?.diagnostic?.guard === 'string' ? 'guard-refusal' : 'other';
}

// Content-free shape of an unsupported round: a branch from a fixed list, small
// integers, known component codes and control counts. Built from the descriptor
// and its diagnostic, never from the reason text, and never from page content.
function componentCodes(diag) {
    let codes = [];
    if (Array.isArray(diag.componentTypes)) codes = diag.componentTypes;
    else if (typeof diag.componentType === 'string') codes = [diag.componentType];
    return codes.slice(0, MAX_COMPONENTS).map(c => (typeof c === 'string' && COMPONENT_CODES.has(c) ? c : 'UNLISTED_COMPONENT'));
}

function controlCounts(diag) {
    const raw = diag.controls && typeof diag.controls === 'object' ? diag.controls : {};
    const counts = {};
    for (const key of CONTROL_KEYS) counts[key] = boundedInt(key === 'editable' ? (raw.contentEditable ?? raw.editable) : raw[key]);
    return counts;
}

// A refusal site's own diagnostic wins. Many sites carry none of the shape
// fields, so a second, read-only probe of the page (lib/unsupported-shape.js)
// may be passed in as `fallback` to fill whatever the site left out.
// Flattens a guard diagnostic's numeric fields (one nested level, dotted keys)
// into a bounded map. Strings, arrays and other values are never read.
function guardCounts(diag) {
    const out = {};
    const add = (key, value) => {
        if (Object.keys(out).length >= MAX_GUARD_COUNTS || !COUNT_KEY_RE.test(key)) return;
        if (Number.isSafeInteger(value) && value >= 0) out[key] = Math.min(value, MAX_COUNT);
    };
    for (const key of Object.keys(diag).sort(byName)) {
        if (SHAPE_KEYS.has(key)) continue;
        const value = Object.getOwnPropertyDescriptor(diag, key)?.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const inner of Object.keys(value).sort(byName)) {
                const v = Object.getOwnPropertyDescriptor(value, inner)?.value;
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    for (const deep of Object.keys(v).sort(byName)) add(`${key}.${inner}.${deep}`, Object.getOwnPropertyDescriptor(v, deep)?.value);
                } else add(`${key}.${inner}`, v);
            }
        } else add(key, value);
    }
    return out;
}

function describeUnsupported(descriptor, fallback) {
    const own = descriptor?.diagnostic && typeof descriptor.diagnostic === 'object' ? descriptor.diagnostic : {};
    const fb = fallback && typeof fallback === 'object' ? fallback : {};
    const hasCodes = Array.isArray(own.componentTypes) || typeof own.componentType === 'string';
    const hasControls = own.controls && typeof own.controls === 'object';
    const diag = {
        gameMode: own.gameMode ?? fb.gameMode,
        questionType: own.questionType ?? fb.questionType,
        componentCount: own.componentCount ?? fb.componentCount,
        componentTypes: hasCodes ? own.componentTypes : fb.componentTypes,
        componentType: hasCodes ? own.componentType : undefined,
        controls: hasControls ? own.controls : fb.controls,
    };
    return {
        branch: classifyBranch(descriptor),
        game_mode: GAME_MODE_NAMES[diag.gameMode] ?? 'unknown',
        question_type: boundedInt(diag.questionType),
        component_count: boundedInt(diag.componentCount),
        components: componentCodes(diag),
        controls: controlCounts(diag),
        guard: typeof own.guard === 'string' && GUARD_RE.test(own.guard) ? own.guard : 'unknown',
        guard_counts: guardCounts(own),
    };
}

// Content-free detail for a handler that stopped mid-round. The stop's reason,
// phase, guard and submit state are fixed code constants (kebab-case, checked
// against GUARD_RE here), never page text; they become the guard name plus
// camelCase flag keys. Indexes and counts are small integers.
const camelCode = s => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
function describeHandlerStop(stop, fallback) {
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const sd = obj(stop?.selectionDiagnostic);
    const d = obj(stop?.diagnostic);
    const code = v => (typeof v === 'string' && GUARD_RE.test(v) ? v : null);
    const counts = {};
    const put = (key, value) => {
        if (Object.keys(counts).length >= MAX_GUARD_COUNTS || !COUNT_KEY_RE.test(key)) return;
        if (Number.isSafeInteger(value) && value >= 0) counts[key] = Math.min(value, MAX_COUNT);
    };
    for (const [name, value] of [['phase', sd.phase ?? d.phase], ['submitState', sd.submitState ?? d.submitState], ['reason', stop?.reason]]) {
        if (code(value)) put(`${name}.${camelCode(value)}`, 1);
    }
    for (const key of ['dropdownIndex', 'boxIndex', 'keyDispatchesReturned']) put(key, sd[key]);
    for (const [key, value] of Object.entries(guardCounts(d))) put(key, value);
    const base = describeUnsupported({ diagnostic: {} }, fallback);
    return { ...base, branch: 'handler-stop', guard: code(sd.guard) || code(d.guard) || code(stop?.reason) || 'unknown', guard_counts: counts };
}

// Shape fields a refusal site's diagnostic lacks, so the page probe is worth running.
function needsShapeProbe(descriptor) {
    const own = descriptor?.diagnostic && typeof descriptor.diagnostic === 'object' ? descriptor.diagnostic : {};
    return !(Number.isSafeInteger(own.gameMode) && Number.isSafeInteger(own.questionType)
        && Number.isSafeInteger(own.componentCount) && own.controls && typeof own.controls === 'object'
        && (Array.isArray(own.componentTypes) || typeof own.componentType === 'string'));
}

function validCounts(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    const keys = Object.keys(c);
    return keys.length <= MAX_GUARD_COUNTS && keys.every(k => COUNT_KEY_RE.test(k) && Number.isSafeInteger(c[k]) && c[k] >= 0 && c[k] <= MAX_COUNT);
}

// True only for a shape that is entirely inside the fixed vocabularies.
function isValidDetail(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (Object.keys(d).sort(byName).join(',') !== 'branch,component_count,components,controls,game_mode,guard,guard_counts,question_type') return false;
    if (!validCounts(d.guard_counts)) return false;
    if (typeof d.guard !== 'string' || (d.guard !== 'unknown' && !GUARD_RE.test(d.guard))) return false;
    if (!BRANCHES.has(d.branch) || !GAME_MODES.has(d.game_mode)) return false;
    const okInt = n => Number.isSafeInteger(n) && n >= UNKNOWN && n <= MAX_COUNT;
    if (!okInt(d.question_type) || !okInt(d.component_count)) return false;
    if (!Array.isArray(d.components) || d.components.length > MAX_COMPONENTS || !d.components.every(c => COMPONENT_CODES.has(c))) return false;
    if (!d.controls || typeof d.controls !== 'object' || Object.keys(d.controls).sort(byName).join(',') !== [...CONTROL_KEYS].sort(byName).join(',')) return false;
    return CONTROL_KEYS.every(k => okInt(d.controls[k]));
}

const countsText = c => { const e = Object.entries(c || {}).sort(([a], [b]) => a.localeCompare(b)); return e.length ? ` (${e.map(([k, v]) => `${k} ${v}`).join(', ')})` : ''; };

function safeKind(kind) {
    return typeof kind === 'string' && TASK_TYPES.has(kind) ? kind : 'unknown';
}

function createSupportReport() {
    const kinds = new Map();
    const entryFor = kind => {
        const key = safeKind(kind);
        if (!kinds.has(key)) kinds.set(key, { answered: 0, refused: 0, skipped: 0, reasons: new Map() });
        return kinds.get(key);
    };
    const details = [];
    function record(kind, outcome, reason, detail) {
        if (!OUTCOMES.has(outcome)) throw new Error('Unknown support report outcome');
        const entry = entryFor(kind);
        entry[outcome]++;
        if (outcome !== 'answered') {
            const category = REASONS.has(reason) ? reason : 'other';
            entry.reasons.set(category, (entry.reasons.get(category) || 0) + 1);
            if (isValidDetail(detail) && details.length < 20) details.push({ kind: safeKind(kind), reason: category, detail });
        }
    }
    function snapshot() {
        return [...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, entry]) => ({
            kind,
            answered: entry.answered,
            refused: entry.refused,
            skipped: entry.skipped,
            reasons: Object.fromEntries([...entry.reasons.entries()].sort(([a], [b]) => a.localeCompare(b))),
        }));
    }
    function describeRow(row) {
        const reasons = Object.entries(row.reasons).map(([name, count]) => `${name} x${count}`).join(', ');
        const suffix = reasons ? ` (reasons: ${reasons})` : '';
        return `- ${row.kind}: answered ${row.answered}, refused ${row.refused}, skipped ${row.skipped}${suffix}`;
    }
    function render(runReason) {
        const rows = snapshot();
        const known = REASONS.has(runReason) || ['stopped', 'completed'].includes(runReason);
        const lines = [
            '--- EP task support report (copy it by hand if you want to share it) ---',
            `Run ended: ${known ? runReason : 'other'}`,
        ];
        if (rows.length === 0) lines.push('No task types were met in this run.');
        lines.push(
            ...rows.map(describeRow),
            ...details.map(({ detail: d }) => `  unsupported detail: branch ${d.branch}, game mode ${d.game_mode}, question type ${d.question_type < 0 ? 'unknown' : d.question_type}, components ${d.components.join(', ') || 'none'}, guard ${d.guard}${countsText(d.guard_counts)}`),
            'Contains task type names, reason categories and the content-free shape of an unsupported question (branch, guard name, game mode, question type, component codes). No answers, question text or credentials.',
            '--- end of report ---',
        );
        return lines.join('\n');
    }
    return { record, snapshot, render, details: () => details.map(d => ({ ...d })), isEmpty: () => kinds.size === 0 };
}

module.exports = { createSupportReport, describeUnsupported, describeHandlerStop, needsShapeProbe, isValidDetail, BRANCHES, GAME_MODES, COMPONENT_CODES, CONTROL_KEYS, MAX_COMPONENTS, REASONS, TASK_TYPES };
