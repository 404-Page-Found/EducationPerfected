// Automatic client-end task support report. Local only: the run keeps a tally
// of the question types it met and what happened to each (answered, refused,
// skipped) with a reason CATEGORY. It never stores question text, answers,
// page content or credentials. The report is a plain text block printed to the
// console so the user can copy it by hand. The same enums can also go to the
// anonymous relay (lib/support-sender.js) unless sending is turned off.

const OUTCOMES = ['answered', 'refused', 'skipped'];

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
    function record(kind, outcome, reason) {
        if (!OUTCOMES.includes(outcome)) throw new Error('Unknown support report outcome');
        const entry = entryFor(kind);
        entry[outcome]++;
        if (outcome !== 'answered') {
            const category = REASONS.has(reason) ? reason : 'other';
            entry.reasons.set(category, (entry.reasons.get(category) || 0) + 1);
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
    function render(runReason) {
        const rows = snapshot();
        const lines = ['--- EP task support report (local only; copy it by hand if you want to share it) ---'];
        lines.push(`Run ended: ${REASONS.has(runReason) || ['stopped', 'completed'].includes(runReason) ? runReason : 'other'}`);
        if (rows.length === 0) lines.push('No task types were met in this run.');
        for (const row of rows) {
            const reasons = Object.entries(row.reasons).map(([name, count]) => `${name} x${count}`).join(', ');
            lines.push(`- ${row.kind}: answered ${row.answered}, refused ${row.refused}, skipped ${row.skipped}${reasons ? ` (reasons: ${reasons})` : ''}`);
        }
        lines.push('Contains task type names and reason categories only. No answers, question text or credentials. Nothing was sent.');
        lines.push('--- end of report ---');
        return lines.join('\n');
    }
    return { record, snapshot, render, isEmpty: () => kinds.size === 0 };
}

module.exports = { createSupportReport, REASONS, TASK_TYPES };
