// Same-process controls shared by terminal and browser hotkeys. No listener or
// remotely reachable control endpoint is opened by this module.
function createRunControls({ run, requestStop, setMode, refresh, inspect, inspectDash, inspectComponents, inspectAssessment, assessmentWatcher, close }) {
    let active = null;
    let stopping = null;
    let closing = false;
    let changing = false;
    let update = null;
    let closePromise = null;
    let closed = false;
    let mode = 'auto';
    let failure = false;
    let completed = false;
    let restartVersion = 0;
    const status = () => ({
        state: closed ? 'closed' : closing ? 'closing' : changing ? 'updating' : stopping ? 'stopping' : active ? 'running' : failure ? 'error' : completed ? 'completed' : 'stopped',
        mode,
    });
    const start = () => {
        if (closed || closing || changing || stopping || active) return status();
        failure = false;
        completed = false;
        // Install the handle before invoking asynchronous work, including run
        // callbacks that throw synchronously.
        const current = Promise.resolve().then(() => {
            if (stopping || closing || closed) return;
            return run();
        });
        active = current;
        current.then(result => { completed = result?.reason === 'completed'; }, () => { failure = true; }).finally(() => {
            if (active === current) active = null;
        });
        return status();
    };
    const drain = () => {
        if (stopping) return stopping;
        const current = active;
        if (!current) return Promise.resolve(status());
        requestStop();
        stopping = current.catch(() => {}).then(() => {
            if (active === current) active = null;
            stopping = null;
            return status();
        });
        return stopping;
    };
    // Explicit stop/close supersedes a restart queued while old cleanup drains.
    const stop = () => { restartVersion += 1; return drain(); };
    return {
        status, start, stop,
        async restartAfterDrain() {
            if (closed || closing || changing || stopping || !active) return status();
            const version = ++restartVersion;
            await drain();
            if (version === restartVersion) start();
            return status();
        },
        browserClosed() {
            restartVersion += 1;
            closed = true;
            requestStop();
            return status();
        },
        async mode(value) {
            if (!['auto', 'semi'].includes(value)) throw new Error('Mode must be auto or semi.');
            if (active || stopping || changing || closing || closed) throw new Error('Stop the run before changing mode.');
            changing = true;
            try {
                update = Promise.resolve().then(() => setMode(value));
                await update;
                mode = value;
            } finally { changing = false; update = null; }
            return status();
        },
        async inspect() {
            if (active || stopping || changing || closing || closed) throw new Error('Stop before read-only inspection.');
            changing = true;
            try {
                update = Promise.resolve().then(inspect);
                return await update;
            } finally { changing = false; update = null; }
        },
        async inspectDash() {
            if (typeof inspectDash !== 'function') throw new Error('Dash inspection unavailable in this session.');
            if (active || stopping || changing || closing || closed) throw new Error('Stop before read-only inspection.');
            changing = true;
            try {
                update = Promise.resolve().then(inspectDash);
                return await update;
            } finally { changing = false; update = null; }
        },
        async inspectComponents() {
            if (typeof inspectComponents !== 'function') throw new Error('Component inspection unavailable in this session.');
            if (active || stopping || changing || closing || closed) throw new Error('Stop before read-only inspection.');
            changing = true;
            try {
                update = Promise.resolve().then(inspectComponents);
                return await update;
            } finally { changing = false; update = null; }
        },
        async inspectAssessment() {
            if (typeof inspectAssessment !== 'function') throw new Error('Assessment inspection unavailable in this session.');
            if (active || stopping || changing || closing || closed) throw new Error('Stop before read-only inspection.');
            changing = true;
            try {
                update = Promise.resolve().then(inspectAssessment);
                return await update;
            } finally { changing = false; update = null; }
        },
        watchAssessment(value) {
            if (!assessmentWatcher) throw new Error('Assessment watch unavailable in this session.');
            const arg = String(value || 'status').trim().toLowerCase();
            if (arg === 'on') {
                if (active || stopping || changing || closing || closed) throw new Error('Stop before watching an Assessment.');
                if (!assessmentWatcher.start() && !assessmentWatcher.running()) throw new Error('Assessment watch capture limit reached; restart the CLI to watch again.');
            } else if (arg === 'off') assessmentWatcher.stop();
            else if (arg !== 'status') throw new Error('Usage: watch-assessment [on|off|status].');
            return { watching: assessmentWatcher.running(), captures: assessmentWatcher.captures() };
        },
        async refresh() {
            if (active || stopping || changing || closing || closed) throw new Error('Stop the run before refreshing words.');
            changing = true;
            try { update = Promise.resolve().then(refresh); await update; } finally { changing = false; update = null; }
            return status();
        },
        close() {
            if (assessmentWatcher) assessmentWatcher.stop();
            if (closed) return stop();
            if (closePromise) return closePromise;
            closing = true;
            closePromise = (async () => {
                try {
                    if (update) await update.catch(() => {});
                    await stop();
                    await close();
                    closed = true;
                    return status();
                } finally { closing = false; closePromise = null; }
            })();
            return closePromise;
        },
    };
}
module.exports = { createRunControls };
