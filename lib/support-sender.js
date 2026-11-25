// Anonymous support report sender. Sends one tiny fixed-schema JSON report per
// distinct (task type, reason) per session to the relay, which files the
// GitHub issue. The payload has exactly four fields and nothing else: no
// timestamp, client ID, OS, run ID, question text, answer, URL or credential.
// Sending is on by default once a relay URL is set, and off when
// EP_SUPPORT_REPORTS=off, when the saved config has supportReports=false, or
// when no relay URL is configured. Every failure is swallowed.

const { TASK_TYPES, REASONS } = require('./support-report');

// Build constant. Empty means nothing is ever sent. Set when the relay is live.
const RELAY_URL = 'https://ep-support-relay.lucas20220605.workers.dev';
const SCHEMA = 1;
const TIMEOUT_MS = 3000;
const REPORTABLE_REASONS = new Set([...REASONS].filter(r => r !== 'completed' && r !== 'stopped-by-user' && r !== 'unreadable-question'));

function relayUrl(env = process.env) {
    // Test boots never use the built-in relay, so fixture runs cannot file real issues.
    return String(env.EP_SUPPORT_RELAY_URL || (env.EP_TEST_BOOT ? '' : RELAY_URL) || '');
}

function isEnabled({ env = process.env, config = {} } = {}) {
    if (String(env.EP_SUPPORT_REPORTS || '').toLowerCase() === 'off') return false;
    if (config?.supportReports === false) return false;
    return relayUrl(env) !== '';
}

function buildPayload(kind, reason, appVersion) {
    return {
        task_type: TASK_TYPES.has(kind) ? kind : 'unknown',
        reason: REPORTABLE_REASONS.has(reason) ? reason : 'other',
        app_version: String(appVersion),
        schema: SCHEMA,
    };
}

function createSupportSender({ fetchImpl = globalThis.fetch, env = process.env, config = {}, appVersion, timeoutMs = TIMEOUT_MS } = {}) {
    const sent = new Set();
    async function post(url, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
            });
            return Boolean(res?.ok);
        } finally { clearTimeout(timer); }
    }
    async function sendOne(url, body) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try { if (await post(url, body)) return true; } catch { /* retried once, then swallowed */ }
        }
        return false;
    }
    function pendingBodies(report) {
        const bodies = [];
        for (const row of report.snapshot()) {
            for (const reason of Object.keys(row.reasons)) {
                const key = `${row.kind}|${reason}`;
                if (!REPORTABLE_REASONS.has(reason) || sent.has(key)) continue;
                sent.add(key);
                bodies.push(JSON.stringify(buildPayload(row.kind, reason, appVersion)));
            }
        }
        return bodies;
    }
    // Never throws and never rejects. Returns the number of reports sent.
    async function sendRun(report) {
        try {
            if (!isEnabled({ env, config })) return 0;
            const url = relayUrl(env);
            const results = await Promise.all(pendingBodies(report).map(body => sendOne(url, body)));
            return results.filter(Boolean).length;
        } catch { return 0; }
    }
    return { sendRun, isEnabled: () => isEnabled({ env, config }) };
}

module.exports = { createSupportSender, buildPayload, isEnabled, relayUrl, SCHEMA, RELAY_URL, REPORTABLE_REASONS };
