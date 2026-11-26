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
// Schema 2 is only for an unsupported-question refusal. It adds the shape of
// the round, all from the fixed lists below.
export const SCHEMA_DETAIL = 2;
export const BRANCHES = [
    'assessment', 'dash', 'unknown-game-mode', 'scope-unreadable', 'no-identity', 'translation-mode',
    'accompanying-component', 'foreign-controls', 'multiple-components', 'renderer-association',
    'missing-metadata', 'generic-slide', 'detection-error', 'guard-refusal', 'other',
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
const FIELDS_DETAIL = [...FIELDS, 'branch', 'component_count', 'components', 'controls', 'game_mode', 'question_type'].sort((a, b) => a.localeCompare(b));
const VERSION_RE = /^20\d{2}\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12]\d|3[01])$/;
const MAX_BODY_BYTES = 1024;
const THRESHOLDS = new Set([10, 100, 1000]);
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

const okCount = n => n === null || (Number.isSafeInteger(n) && n >= 0 && n <= MAX_COUNT);

function validateDetail(data) {
    if (data.task_type !== 'unsupported' || data.reason !== 'unsupported-question') return null;
    if (!BRANCHES.includes(data.branch) || !GAME_MODES.includes(data.game_mode)) return null;
    if (!okCount(data.question_type) || !okCount(data.component_count)) return null;
    if (!Array.isArray(data.components) || data.components.length > MAX_COMPONENTS || !data.components.every(c => COMPONENT_CODES.includes(c))) return null;
    const controls = data.controls;
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)) return null;
    if (Object.keys(controls).sort((a, b) => a.localeCompare(b)).join(',') !== CONTROL_KEYS.join(',')) return null;
    if (!CONTROL_KEYS.every(k => okCount(controls[k]))) return null;
    return {
        branch: data.branch,
        game_mode: data.game_mode,
        question_type: data.question_type,
        component_count: data.component_count,
        components: [...data.components],
        controls: Object.fromEntries(CONTROL_KEYS.map(k => [k, controls[k]])),
    };
}

export function validate(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const keys = Object.keys(data).sort((a, b) => a.localeCompare(b)).join(',');
    const detailed = data.schema === SCHEMA_DETAIL;
    if (keys !== (detailed ? FIELDS_DETAIL : FIELDS).join(',')) return null;
    if (!TASK_TYPES.includes(data.task_type) || !REASONS.includes(data.reason)) return null;
    if (data.schema !== SCHEMA && !detailed) return null;
    if (typeof data.app_version !== 'string' || !VERSION_RE.test(data.app_version)) return null;
    const report = { task_type: data.task_type, reason: data.reason, app_version: data.app_version };
    if (detailed) {
        const detail = validateDetail(data);
        if (!detail) return null;
        report.detail = detail;
    }
    return report;
}

// One issue per (task type, reason), and for a detailed report per refusal
// branch too, so each branch gets its own issue.
export const pairKey = report => `pair:${report.task_type}:${report.reason}${report.detail ? `:${report.detail.branch}` : ''}`;
const shapeKey = d => [d.game_mode, d.question_type, d.component_count, d.components.join('+'), CONTROL_KEYS.map(k => d.controls[k]).join('/')].join('|');

const titleFor = ({ task_type, reason, detail }) => `Task support: ${task_type} not handled (${reason}${detail ? `, ${detail.branch}` : ''})`;
function shapeLines(record) {
    const shapes = Object.entries(record.shapes || {}).sort(([, a], [, b]) => b.count - a.count);
    if (!shapes.length) return [];
    return [
        '',
        'Shapes seen (game mode, EP question type, component count, component codes, control counts):',
        ...shapes.map(([, s]) => `- x${s.count}: game mode ${s.game_mode}, question type ${s.question_type ?? 'unknown'}, ${s.component_count ?? 'unknown'} components (${s.components.join(', ') || 'none'}), controls ${CONTROL_KEYS.map(k => `${k} ${s.controls[k] ?? '?'}`).join(', ')}`),
    ];
}
function bodyFor({ task_type, reason, detail }, record) {
    return [
        `EducationPerfected reported a "${task_type}" task it could not handle. Reason category: ${reason}.`,
        '',
        `Reports so far: ${record.count}`,
        `Newest app version seen: ${record.maxVersion}`,
        '',
        ...shapeLines(record),
        '',
        detail
            ? 'Filed automatically from anonymous reports. Each report holds a task type, a reason category, an app version, a schema number and the refusal branch, game mode, question type, component codes and control counts of the round, nothing else.'
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

export async function record(storage, env, report) {
    const key = pairKey(report);
    // First run after the move from KV: pick up the record the old code left there.
    const stored = (await storage.get('rec')) || (await env.REPORTS.get(key, 'json'));
    const rec = stored || { issue: null, count: 0, maxVersion: report.app_version };
    const newer = stored && isNewer(report.app_version, rec.maxVersion);
    rec.count += 1;
    let newShape = false;
    if (report.detail) {
        rec.shapes = rec.shapes || {};
        const sk = shapeKey(report.detail);
        if (rec.shapes[sk]) rec.shapes[sk].count += 1;
        else if (Object.keys(rec.shapes).length < MAX_SHAPES) { rec.shapes[sk] = { ...report.detail, count: 1 }; newShape = true; }
    }
    if (isNewer(report.app_version, rec.maxVersion)) rec.maxVersion = report.app_version;
    try {
        if (!rec.issue) {
            if (await takeWrite(env)) {
                const issue = await github(env, '/issues', 'POST', { title: titleFor(report), body: bodyFor(report, rec), labels: [LABEL] });
                rec.issue = issue.number;
            }
        } else if (newer) {
            const issue = await github(env, `/issues/${rec.issue}`, 'GET');
            if (issue.state === 'closed' && await takeWrite(env)) {
                await github(env, `/issues/${rec.issue}`, 'PATCH', { state: 'open', body: bodyFor(report, rec) });
            }
        } else if ((newShape || THRESHOLDS.has(rec.count)) && await takeWrite(env)) {
            await github(env, `/issues/${rec.issue}`, 'PATCH', { body: bodyFor(report, rec) });
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
