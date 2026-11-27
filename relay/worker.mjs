// EducationPerfected anonymous support report relay (Cloudflare Worker).
// Receives a fixed four-field report from the app and files or updates one
// public GitHub issue per (task type, reason). It never reads, stores or
// forwards the IP, headers or user agent, except that the connection address
// is handed to the rate limiter as its key and nothing else. Everything
// written to KV or GitHub is built from validated enums and counters.

export const TASK_TYPES = [
    'text', 'choice', 'gaps', 'textbox', 'numberbox', 'dropdown', 'dropdown-numberbox',
    'slide-surfaces', 'reflection', 'highlight', 'workingformula', 'info-slide',
    'audio', 'typed', 'dash-typed', 'unsupported', 'unknown',
];
export const REASONS = [
    'unsupported-question', 'no-handler', 'handler-stopped', 'empty-answer',
    'pre-submit-guard', 'futility-guard', 'other',
];
export const SCHEMA = 1;
// An unsupported-question refusal may also carry the shape of the round (still
// schema 1), all from the fixed lists below. Four-field reports from older
// builds stay valid.
export const BRANCHES = [
    'assessment', 'dash', 'unknown-game-mode', 'scope-unreadable', 'no-identity', 'translation-mode',
    'accompanying-component', 'foreign-controls', 'foreign-choice', 'foreign-multiselect', 'foreign-dropdown',
    'foreign-textbox', 'foreign-formula', 'foreign-slide-surfaces', 'multiple-components', 'renderer-association',
    'missing-metadata', 'generic-slide', 'detection-error', 'guard-refusal', 'handler-stop', 'other',
];
export const GAME_MODES = ['classic', 'assessment', 'lesson', 'unknown'];
export const COMPONENT_CODES = [
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
];
export const CONTROL_KEYS = ['buttons', 'canvases', 'editable', 'inputs', 'selects', 'textareas'];
const MAX_COMPONENTS = 8;
const MAX_COUNT = 99;
const MAX_SHAPES = 20;
const FIELDS = ['app_version', 'reason', 'schema', 'task_type'];
const FIELDS_DETAIL_BASE = [...FIELDS, 'branch', 'component_count', 'components', 'controls', 'game_mode', 'question_type'];
// Older clients send no guard; newer ones add it. Both key sets are accepted.
const FIELDS_DETAIL = FIELDS_DETAIL_BASE.slice().sort((a, b) => a.localeCompare(b));
const FIELDS_DETAIL_GUARD = [...FIELDS_DETAIL_BASE, 'guard', 'guard_counts'].sort((a, b) => a.localeCompare(b));
const GUARD_RE = /^[a-z][a-z0-9-]{0,39}$/;
const COUNT_KEY_RE = /^[A-Za-z][A-Za-z0-9.]{0,39}$/;
const MAX_GUARD_COUNTS = 12;
const validCounts = c => !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length <= MAX_GUARD_COUNTS
    && Object.keys(c).every(k => COUNT_KEY_RE.test(k) && Number.isSafeInteger(c[k]) && c[k] >= 0 && c[k] <= MAX_COUNT);
const countsText = c => { const e = Object.entries(c || {}).sort(([a], [b]) => a.localeCompare(b)); return e.length ? ` (${e.map(([k, v]) => `${k} ${v}`).join(', ')})` : ''; };
const VERSION_RE = /^20\d{2}\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12]\d|3[01])$/;
const MAX_BODY_BYTES = 1024;
const DEFAULT_DAILY_CAP = 30;
const LABEL = 'task-support';

const empty = status => new Response(null, { status });

function versionParts(version) { return version.split('.').map(Number); }
function isNewer(a, b) {
    if (!b) return true;
    const x = versionParts(a), y = versionParts(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
}

// -1 means unknown or unreadable.
const okCount = n => Number.isSafeInteger(n) && n >= -1 && n <= MAX_COUNT;
const known = n => (n < 0 ? 'unknown' : String(n));

function validateDetail(data) {
    const unsupported = data.task_type === 'unsupported' && data.reason === 'unsupported-question';
    const stopped = data.reason === 'handler-stopped' && data.task_type !== 'unsupported' && data.task_type !== 'unknown' && data.branch === 'handler-stop';
    if (!unsupported && !stopped) return null;
    if (unsupported && data.branch === 'handler-stop') return null;
    if (!BRANCHES.includes(data.branch) || !GAME_MODES.includes(data.game_mode)) return null;
    if (!okCount(data.question_type) || !okCount(data.component_count)) return null;
    if (!Array.isArray(data.components) || data.components.length > MAX_COMPONENTS || !data.components.every(c => COMPONENT_CODES.includes(c))) return null;
    const controls = data.controls;
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)) return null;
    if (Object.keys(controls).sort((a, b) => a.localeCompare(b)).join(',') !== CONTROL_KEYS.join(',')) return null;
    if (!CONTROL_KEYS.every(k => okCount(controls[k]))) return null;
    if ('guard_counts' in data && !validCounts(data.guard_counts)) return null;
    if ('guard' in data && data.guard !== 'unknown' && !(typeof data.guard === 'string' && GUARD_RE.test(data.guard))) return null;
    return {
        branch: data.branch,
        game_mode: data.game_mode,
        question_type: data.question_type,
        component_count: data.component_count,
        components: [...data.components],
        controls: Object.fromEntries(CONTROL_KEYS.map(k => [k, controls[k]])),
        guard: 'guard' in data ? data.guard : 'unknown',
        guard_counts: 'guard_counts' in data ? Object.fromEntries(Object.entries(data.guard_counts)) : {},
    };
}

export function validate(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const keys = Object.keys(data).sort((a, b) => a.localeCompare(b)).join(',');
    const detailed = keys === FIELDS_DETAIL.join(',') || keys === FIELDS_DETAIL_GUARD.join(',');
    if (!detailed && keys !== FIELDS.join(',')) return null;
    if (!TASK_TYPES.includes(data.task_type) || !REASONS.includes(data.reason)) return null;
    if (data.schema !== SCHEMA) return null;
    if (typeof data.app_version !== 'string' || !VERSION_RE.test(data.app_version)) return null;
    const report = { task_type: data.task_type, reason: data.reason, app_version: data.app_version };
    if (detailed) {
        const detail = validateDetail(data);
        if (!detail) return null;
        report.detail = detail;
    }
    return report;
}

// One issue per (task type, reason), and for a report with the round's shape per refusal
// branch too, so each branch gets its own issue.
export const pairKey = report => {
    const base = `pair:${report.task_type}:${report.reason}`;
    return report.detail ? `${base}:${report.detail.branch}` : base;
};
const shapeKey = d => [d.game_mode, d.question_type, d.component_count, d.components.join('+'), d.guard || 'unknown', JSON.stringify(d.guard_counts || {}), CONTROL_KEYS.map(k => d.controls[k]).join('/')].join('|');

function titleFor({ task_type, reason, detail }) {
    const suffix = detail ? `, ${detail.branch}` : '';
    return `Task support: ${task_type} not handled (${reason}${suffix})`;
}
function shapeLine(s) {
    const controls = CONTROL_KEYS.map(k => `${k} ${known(s.controls[k])}`).join(', ');
    const components = s.components.join(', ') || 'none';
    return `- x${s.count}: branch ${s.branch}, guard ${s.guard || 'unknown'}${countsText(s.guard_counts)}, game mode ${s.game_mode}, question type ${known(s.question_type)}, ${known(s.component_count)} components (${components}), controls ${controls}`;
}
function shapeLines(record) {
    const shapes = Object.values(record.shapes || {}).sort((a, b) => b.count - a.count);
    if (!shapes.length) return [];
    const lines = ['', 'Shapes seen (branch, guard, game mode, EP question type, component count, component codes, control counts):', ...shapes.map(shapeLine)];
    if (record.otherShapes) lines.push(`- plus ${record.otherShapes} reports with other shapes, not listed (limit ${MAX_SHAPES} shapes)`);
    return lines;
}
function bodyFor({ task_type, reason, detail }, record) {
    return [
        `EducationPerfected reported a "${task_type}" task it could not handle. Reason category: ${reason}.`,
        '',
        `Reports so far: ${record.count}`,
        `Newest app version seen: ${record.maxVersion}`,
        ...shapeLines(record),
        '',
        detail
            ? 'Filed automatically from anonymous reports. Each report holds a task type, a reason category, an app version, a schema number and the refusal branch and guard name, game mode, question type, component codes and control counts of the round, nothing else.'
            : 'Filed automatically from anonymous reports. Each report holds a task type, a reason category, an app version and a schema number, nothing else.',
    ].join('\n');
}

async function github(env, path, method, payload) {
    const res = await fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'educationperfected-support-relay',
            ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!res.ok) throw new Error(`github ${res.status}`);
    return res.json();
}

// Reports for one (task type, reason) pair are handled one at a time inside a
// Durable Object, so two reports arriving together cannot both file an issue.
// The daily write cap lives in a single Durable Object for the same reason.
async function takeWrite(env) {
    const res = await env.CAP.get(env.CAP.idFromName('cap')).fetch(new Request('https://cap.internal/take', { method: 'POST' }));
    return (await res.text()) === 'yes';
}

// Tallies a detailed report's shape on the record. True only when it adds a new entry to rec.shapes;
// a shape past the limit is counted in rec.otherShapes and returns false.
function countShape(rec, detail) {
    if (!detail) return false;
    rec.shapes = rec.shapes || {};
    const key = shapeKey(detail);
    if (rec.shapes[key]) {
        rec.shapes[key].count += 1;
        return false;
    }
    if (Object.keys(rec.shapes).length >= MAX_SHAPES) {
        rec.otherShapes = (rec.otherShapes || 0) + 1;
        return false;
    }
    rec.shapes[key] = { ...detail, count: 1 };
    return true;
}

export async function record(storage, env, report) {
    const key = pairKey(report);
    // First run after the move from KV: pick up the record the old code left there.
    const stored = (await storage.get('rec')) || (await env.REPORTS.get(key, 'json'));
    const rec = stored || { issue: null, count: 0, maxVersion: report.app_version };
    const newer = stored && isNewer(report.app_version, rec.maxVersion);
    rec.count += 1;
    const newShape = countShape(rec, report.detail);
    if (isNewer(report.app_version, rec.maxVersion)) rec.maxVersion = report.app_version;
    if (newShape) rec.dirty = true;
    try {
        if (!rec.issue) {
            if (await takeWrite(env)) {
                const issue = await github(env, '/issues', 'POST', { title: titleFor(report), body: bodyFor(report, rec), labels: [LABEL] });
                rec.issue = issue.number;
                rec.dirty = false;
            }
        } else {
            const issue = await github(env, `/issues/${rec.issue}`, 'GET');
            // Every report on an open issue refreshes its body, so a repeat report is
            // visible there instead of only raising a counter nobody can see. A closed
            // issue stays closed (and untouched) unless a newer app version reports it.
            if ((issue.state === 'open' || newer) && await takeWrite(env)) {
                await github(env, `/issues/${rec.issue}`, 'PATCH', { ...(issue.state === 'closed' ? { state: 'open' } : {}), body: bodyFor(report, rec) });
                rec.dirty = false;
            }
        }
    } catch { /* counted anyway; GitHub is retried on a later report */ }
    await storage.put('rec', rec);
}

export class Pair {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.queue = Promise.resolve();
    }

    // Outbound fetches let other requests in, so the queue is what makes this one-at-a-time.
    fetch(request) {
        const run = this.queue.then(async () => {
            await record(this.state.storage, this.env, await request.json());
            return empty(204);
        });
        this.queue = run.catch(() => {});
        return run;
    }
}

export class Cap {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.queue = Promise.resolve();
    }

    // The first take of a day also reads KV, which lets other requests in, so takes are queued.
    fetch() {
        const run = this.queue.then(() => this.take());
        this.queue = run.catch(() => {});
        return run;
    }

    async take() {
        const key = `cap:${new Date().toISOString().slice(0, 10)}`;
        const used = (await this.state.storage.get(key)) ?? (Number(await this.env.REPORTS.get(key)) || 0);
        if (used >= (Number(this.env.DAILY_WRITE_CAP) || DEFAULT_DAILY_CAP)) {
            await this.state.storage.put(key, used);
            return new Response('no');
        }
        await this.state.storage.put(key, used + 1);
        return new Response('yes');
    }
}

export default {
    async fetch(request, env) {
        if (String(env.DISABLED || '') !== '') return empty(204);
        if (request.method !== 'POST') return empty(405);
        const declared = Number(request.headers.get('content-length'));
        if (declared > MAX_BODY_BYTES) return empty(413);
        if (env.RATE_LIMITER) {
            const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
            if (!success) return empty(429);
        }
        const report = validate(await request.text());
        if (!report) return empty(400);
        const key = pairKey(report);
        return env.PAIRS.get(env.PAIRS.idFromName(key)).fetch(new Request('https://pair.internal/', { method: 'POST', body: JSON.stringify(report) }));
    },
};
