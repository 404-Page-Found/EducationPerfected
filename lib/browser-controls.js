// Browser controls use the same in-process operations as the terminal.
// No network listener, arbitrary method lookup or renderer-provided code.
function createBrowserControl({ controls, validationOnly = false, restartNeeded = () => false, notify = async () => {} }) {
    return async (action, value) => {
        const read = action === 'status' || action === 'inspect-self-mark' || action === 'inspect-dash'
            || ((action === 'accuracy' || action === 'delay') && !String(value ?? '').trim());
        if (validationOnly && !read && action !== 'stop') throw new Error('Validation session: use the approved terminal one-shot command.');
        let result;
        switch (action) {
            case 'status': return controls.status();
            case 'start': result = restartNeeded() ? await controls.restartAfterDrain() : controls.start(); break;
            case 'stop': result = await controls.stop(); break;
            case 'mode': result = await controls.mode(value); break;
            case 'refresh': result = await controls.refresh(); break;
            case 'accuracy': result = read ? controls.status() : await controls.setAccuracy(value); break;
            case 'delay': result = controls.delay(value); if (result.error) throw new Error(result.error); break;
            case 'inspect-self-mark': result = await controls.inspect(); break;
            case 'inspect-dash': result = await controls.inspectDash(); break;
            default: throw new Error('Unknown browser control.');
        }
        await notify(`${action}: done. See the control menu for details.`);
        return result;
    };
}

// Self-contained so Puppeteer can install it in each top-level document.
function installControlMenu() {
    if (window.top !== window || window.__epControlMenuInstalled) return;
    window.__epControlMenuInstalled = true;
    // Plain-language status lines, shared by the live banner and the result view.
    const describeStatus = status => {
        const lines = [];
        const states = {
            stopped: 'Stopped.', running: 'Running.', stopping: 'Stopping...',
            closing: 'Closing...', updating: 'Applying a change...', closed: 'Browser closed.',
            error: 'Stopped after an error.', completed: 'Task finished.',
        };
        lines.push(states[status.state] || `State: ${status.state}.`);
        if (status.mode) lines.push(status.mode === 'auto'
            ? 'Auto mode: answers are submitted for you.'
            : 'Semi-auto mode: answers are filled in, you submit them.');
        const a = status.accuracy || {};
        if (status.accuracy) {
            if (!a.enabled) lines.push('Accuracy: every answer goes in correct (accuracy control off).');
            else {
                const target = a.target ?? a.fixedTarget;
                lines.push(target != null
                    ? `Accuracy: aiming for about ${target}% correct.`
                    : `Accuracy: aiming for about ${a.min}-${a.max}% correct; the exact target is picked each run.`);
                if (a.attempts > 0 && a.accuracy != null) {
                    lines.push(`So far this run: ${Math.round(a.accuracy)}% correct over ${a.attempts} answers (${a.mistakes} intentional mistake${a.mistakes === 1 ? '' : 's'}).`);
                }
            }
        }
        const p = status.pacing;
        if (p) {
            if (!p.enabled) lines.push('Pacing: off, answers are submitted at full speed.');
            else if (p.override) lines.push(`Pacing: waiting ${p.override[0] / 1000}-${p.override[1] / 1000}s before each answer.`);
            else lines.push('Pacing: a short human-like pause before each answer (varies by question type).');
        }
        return lines;
    };
    const isStatus = value => value && typeof value === 'object' && typeof value.state === 'string' && typeof value.mode === 'string';
    // Action results read as sentences; the raw JSON stays under Technical details.
    // Inspection captures are diagnostic output to copy, so they stay raw up front.
    const renderResult = (result, fresh) => {
        if (isStatus(result)) return { text: describeStatus(result).join('\n'), raw: true };
        if (result && typeof result === 'object' && typeof result.delay === 'string') {
            const pacing = fresh ? describeStatus(fresh).find(line => line.startsWith('Pacing:')) : null;
            return { text: pacing || `Pacing: ${result.delay}`, raw: true };
        }
        if (result && typeof result === 'object') return { text: JSON.stringify(result, null, 2), raw: false };
        return { text: String(result ?? ''), raw: false };
    };
    const mount = () => {
        if (!document.body || document.getElementById('educationperfected-controls')) return;
        const host = document.createElement('ep-control-menu');
        host.id = 'educationperfected-controls';
        host.style.cssText = 'all:initial;position:fixed;bottom:12px;right:12px;z-index:2147483646;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>
            :host{color-scheme:dark;font:13px/1.45 system-ui,sans-serif;color:#eff4ff}
            *{box-sizing:border-box}details{font:13px/1.45 system-ui,sans-serif;color:#eff4ff;width:min(310px,calc(100vw - 24px));background:#172234;border:1px solid #7184a0;border-radius:10px;box-shadow:0 4px 18px #0006}
            summary{cursor:pointer;padding:11px 13px;font-weight:650;user-select:none}
            section{padding:0 12px 12px;max-height:65vh;overflow:auto}p{margin:0 0 10px;color:#c2d3ed}
            .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}button,input,select{font:inherit;color:inherit;background:#263951;border:1px solid #8195b1;border-radius:5px;padding:6px;min-height:32px}
            button{cursor:pointer}button:hover{background:#3a5374}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #91c9ff;outline-offset:2px}
            input{width:100%;min-width:0}label{display:block;margin-top:10px}label span{display:block;margin-bottom:4px}
            pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 ui-monospace,monospace;max-height:160px;overflow:auto;margin:6px 0 0}
            output{display:block;color:#ffd28a;white-space:pre-wrap;font-size:12px}
            #live{white-space:pre-line;color:#eff4ff}
            #raw-details{margin-top:8px}#raw-details summary{padding:4px 0;font-weight:400;font-size:12px;color:#9db3d1}
        </style><details><summary>EducationPerfected</summary><section>
            <p id="live" role="status" aria-live="polite">Connecting...</p>
            <div class="row"><button data-action="start">Start</button><button data-action="stop">Stop</button><button data-action="refresh">Refresh words</button><button data-action="status">Status</button></div>
            <label><span>Mode</span><select id="mode"><option value="auto">Auto</option><option value="semi">Semi-auto</option></select></label>
            <div class="row"><button data-action="mode">Apply mode</button></div>
            <label><span>Accuracy target: 82, 70-90, on or off</span><input id="accuracy" placeholder="82, 70-90 or off" autocomplete="off"></label>
            <div class="row"><button data-action="accuracy">Apply accuracy</button><button data-action="accuracy" data-read="true">Read accuracy</button></div>
            <label><span>Pause before each answer: 2-6, on, off or reset</span><input id="delay" placeholder="2-6, on, off or reset" autocomplete="off"></label>
            <div class="row"><button data-action="delay">Apply pacing</button><button data-action="delay" data-read="true">Read pacing</button></div>
            <div class="row"><button data-action="inspect-self-mark">Inspect self-mark</button><button data-action="inspect-dash">Inspect Dash</button></div>
            <output id="message" role="status" aria-live="polite"></output><pre id="result" aria-label="Control result"></pre>
            <details id="raw-details"><summary>Technical details</summary><pre id="raw" aria-label="Raw JSON result"></pre></details>
        </section></details>`;
        // EP must not see panel keystrokes, clicks or selection changes.
        for (const name of ['keydown', 'keyup', 'keypress', 'input', 'change', 'click', 'pointerdown', 'pointerup']) {
            root.addEventListener(name, event => event.stopPropagation());
        }
        const live = root.getElementById('live');
        let lastStatus = '';
        let pending = false;
        const reportStatus = status => {
            const text = describeStatus(status).join('\n');
            if (text !== lastStatus) { live.textContent = text; lastStatus = text; }
        };
        const refresh = async () => {
            if (pending || document.hidden || !host.isConnected) return null;
            pending = true;
            try {
                const status = await window.epControl('status');
                reportStatus(status);
                return status;
            } catch { live.textContent = 'Controls unavailable. Check the terminal.'; return null; }
            finally { pending = false; }
        };
        root.addEventListener('click', async event => {
            const button = event.target.closest('button[data-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.action;
            const field = root.getElementById(action);
            const value = button.dataset.read ? undefined : field?.value;
            button.disabled = true;
            root.getElementById('message').textContent = 'Working...';
            try {
                const result = await window.epControl(action, value);
                const fresh = await refresh();
                const view = renderResult(result, fresh);
                root.getElementById('result').textContent = view.text;
                root.getElementById('raw').textContent = view.raw ? JSON.stringify(result, null, 2) : '';
                root.getElementById('message').textContent = `${button.textContent}: done.`;
            } catch (error) {
                root.getElementById('message').textContent = `Couldn't ${button.textContent.toLowerCase()}: ${error.message || error}`;
                await refresh();
            } finally { button.disabled = false; }
        });
        document.body.appendChild(host);
        void refresh();
        const timer = setInterval(() => { if (!host.isConnected) clearInterval(timer); else void refresh(); }, 1000);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
}
module.exports = { createBrowserControl, installControlMenu };
