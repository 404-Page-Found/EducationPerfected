// Shared plumbing and in-page helper source for the read-only inspection
// captures (lib/self-mark-diagnostics.js, lib/dash-diagnostics.js).
//
// Capture code runs INSIDE the page via page.evaluate and must stay
// self-contained there. Each capture composes its page program from
// INSPECTION_HELPERS plus its own body so the helpers have a single source
// instead of a copy per capture.
const INSPECTION_HELPERS = `
    // Cached model properties must be own data properties. Accessors are not run.
    const data = (o, k) => o && typeof o === 'object' ? Object.getOwnPropertyDescriptor(o, k)?.value : undefined;
    const integer = v => Number.isSafeInteger(v) ? v : null;
    const bool = v => typeof v === 'boolean' ? v : null;
    const shape = (o, k) => {
        const d = o && typeof o === 'object' ? Object.getOwnPropertyDescriptor(o, k) : null;
        if (!d) return 'absent';
        if (!Object.hasOwn(d, 'value')) return 'accessor';
        const v = d.value;
        return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    };
`;

// Race the page evaluation against cancellation and a bounded timeout, always
// reporting a fixed guard string instead of throwing.
async function collectInspection(page, { build, program, shouldStop = () => false, timeoutMs = 2000 }) {
    if (shouldStop()) return { build, guard: 'cancelled' };
    let timer;
    const pending = Promise.resolve().then(() => shouldStop() ? { build, guard: 'cancelled' } : page.evaluate(program))
        .catch(() => ({ build, guard: 'inspection-unavailable' }));
    const deadline = Date.now() + Math.min(2000, Math.max(1, timeoutMs));
    const stop = new Promise(resolve => {
        const poll = () => {
            if (shouldStop()) resolve({ build, guard: 'cancelled' });
            else if (Date.now() >= deadline) resolve({ build, guard: 'timeout' });
            else timer = setTimeout(poll, Math.min(25, deadline - Date.now()));
        };
        poll();
    });
    try { return await Promise.race([pending, stop]); } finally { clearTimeout(timer); }
}
module.exports = { INSPECTION_HELPERS, collectInspection };
