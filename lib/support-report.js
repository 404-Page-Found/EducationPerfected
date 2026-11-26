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
    'accompanying-component', 'foreign-controls', 'multiple-components', 'renderer-association',
    'missing-metadata', 'generic-slide', 'detection-error', 'guard-refusal', 'other',
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
        ['unknown-game-mode', /unknown modes \(gameMode/],
        ['scope-unreadable', /AngularJS scope unavailable|answer state could not be read|unreadable/],
        ['no-identity', /stable identity|contentID/],
        ['translation-mode', /translationMode/],
        ['accompanying-component', /accompanying component|other answer-bearing/],
        ['multiple-components', /multiple visible choice|exactly one identifiable/],
        ['renderer-association', /renderer|plain block|formula choices/],
        ['foreign-controls', /editable controls|lesson inputs|unsafe, unsupported or changed/],
        ['missing-metadata', /metadata|no usable text|marking flag/],
        ['generic-slide', /unsupported question type \(not text/],
        ['detection-error', /^Question detection failed/],
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

function describeUnsupported(descriptor) {
    const diag = descriptor?.diagnostic && typeof descriptor.diagnostic === 'object' ? descriptor.diagnostic : {};
    return {
        branch: classifyBranch(descriptor),
        game_mode: GAME_MODE_NAMES[diag.gameMode] ?? 'unknown',
        question_type: boundedInt(diag.questionType),
        component_count: boundedInt(diag.componentCount),
        components: componentCodes(diag),
        controls: controlCounts(diag),
    };
}

// True only for a shape that is entirely inside the fixed vocabularies.
function isValidDetail(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (Object.keys(d).sort(byName).join(',') !== 'branch,component_count,components,controls,game_mode,question_type') return false;
    if (!BRANCHES.has(d.branch) || !GAME_MODES.has(d.game_mode)) return false;
    const okInt = n => Number.isSafeInteger(n) && n >= UNKNOWN && n <= MAX_COUNT;
    if (!okInt(d.question_type) || !okInt(d.component_count)) return false;
    if (!Array.isArray(d.components) || d.components.length > MAX_COMPONENTS || !d.components.every(c => COMPONENT_CODES.has(c))) return false;
    if (!d.controls || typeof d.controls !== 'object' || Object.keys(d.controls).sort(byName).join(',') !== [...CONTROL_KEYS].sort(byName).join(',')) return false;
    return CONTROL_KEYS.every(k => okInt(d.controls[k]));
}

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
            ...details.map(({ detail: d }) => `  unsupported detail: branch ${d.branch}, game mode ${d.game_mode}, question type ${d.question_type < 0 ? 'unknown' : d.question_type}, components ${d.components.join(', ') || 'none'}`),
            'Contains task type names and reason categories only. No answers, question text or credentials.',
            '--- end of report ---',
        );
        return lines.join('\n');
    }
    return { record, snapshot, render, details: () => details.map(d => ({ ...d })), isEmpty: () => kinds.size === 0 };
}

module.exports = { createSupportReport, describeUnsupported, isValidDetail, BRANCHES, GAME_MODES, COMPONENT_CODES, CONTROL_KEYS, MAX_COMPONENTS, REASONS, TASK_TYPES };
