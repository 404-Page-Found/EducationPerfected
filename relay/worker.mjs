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
const FIELDS = ['app_version', 'reason', 'schema', 'task_type'];
const VERSION_RE = /^20\d{2}\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12]\d|3[01])$/;
const MAX_BODY_BYTES = 512;
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

export function validate(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (Object.keys(data).sort((a, b) => a.localeCompare(b)).join(',') !== FIELDS.join(',')) return null;
    if (!TASK_TYPES.includes(data.task_type) || !REASONS.includes(data.reason)) return null;
    if (data.schema !== SCHEMA) return null;
    if (typeof data.app_version !== 'string' || !VERSION_RE.test(data.app_version)) return null;
    return { task_type: data.task_type, reason: data.reason, app_version: data.app_version };
}

const titleFor = ({ task_type, reason }) => `Task support: ${task_type} not handled (${reason})`;
function bodyFor({ task_type, reason }, record) {
    return [
        `EducationPerfected reported a "${task_type}" task it could not handle. Reason category: ${reason}.`,
        '',
        `Reports so far: ${record.count}`,
        `Newest app version seen: ${record.maxVersion}`,
        '',
        'Filed automatically from anonymous reports. Each report holds a task type, a reason category, an app version and a schema number, nothing else.',
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

async function takeWrite(env) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `cap:${day}`;
    const used = Number(await env.REPORTS.get(key)) || 0;
    if (used >= (Number(env.DAILY_WRITE_CAP) || DEFAULT_DAILY_CAP)) return false;
    await env.REPORTS.put(key, String(used + 1), { expirationTtl: 172800 });
    return true;
}

async function record(env, report) {
    const key = `pair:${report.task_type}:${report.reason}`;
    const stored = await env.REPORTS.get(key, 'json');
    const rec = stored || { issue: null, count: 0, maxVersion: report.app_version };
    const newer = stored && isNewer(report.app_version, rec.maxVersion);
    rec.count += 1;
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
        } else if (THRESHOLDS.has(rec.count) && await takeWrite(env)) {
            await github(env, `/issues/${rec.issue}`, 'PATCH', { body: bodyFor(report, rec) });
        }
    } catch { /* counted anyway; GitHub is retried on a later report */ }
    await env.REPORTS.put(key, JSON.stringify(rec));
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
        await record(env, report);
        return empty(204);
    },
};
