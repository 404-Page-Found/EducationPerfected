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
        </style><details><summary>EducationPerfected</summary><section>
            <p id="live" role="status" aria-live="polite">Connecting...</p>
            <div class="row"><button data-action="start">Start</button><button data-action="stop">Stop</button><button data-action="refresh">Refresh words</button><button data-action="status">Status</button></div>
            <label><span>Mode</span><select id="mode"><option value="auto">Auto</option><option value="semi">Semi-auto</option></select></label>
            <div class="row"><button data-action="mode">Apply mode</button></div>
            <label><span>Accuracy: n, min-max, on or off</span><input id="accuracy" placeholder="82, 70-90 or off" autocomplete="off"></label>
            <div class="row"><button data-action="accuracy">Apply accuracy</button><button data-action="accuracy" data-read="true">Read accuracy</button></div>
            <label><span>Pacing: seconds, on, off or reset</span><input id="delay" placeholder="2-6, on, off or reset" autocomplete="off"></label>
            <div class="row"><button data-action="delay">Apply pacing</button><button data-action="delay" data-read="true">Read pacing</button></div>
            <div class="row"><button data-action="inspect-self-mark">Inspect self-mark</button><button data-action="inspect-dash">Inspect Dash</button></div>
            <output id="message" role="status" aria-live="polite"></output><pre id="result" aria-label="Control result"></pre>
        </section></details>`;
        // EP must not see panel keystrokes, clicks or selection changes.
        for (const name of ['keydown', 'keyup', 'keypress', 'input', 'change', 'click', 'pointerdown', 'pointerup']) {
            root.addEventListener(name, event => event.stopPropagation());
        }
        const live = root.getElementById('live');
        let lastStatus = '';
        let pending = false;
        const reportStatus = status => {
            const a = status.accuracy || {};
            const pacing = status.pacing;
            const text = `${status.state} | ${status.mode} | accuracy ${a.enabled ? a.target ?? (a.fixedTarget ?? `${a.min}-${a.max}`) : 100}% | pacing ${pacing ? (pacing.enabled ? (pacing.override ? `${pacing.override[0] / 1000}-${pacing.override[1] / 1000}s` : 'per type') : 'off') : 'unknown'}`;
            if (text !== lastStatus) { live.textContent = text; lastStatus = text; }
        };
        const refresh = async () => {
            if (pending || document.hidden || !host.isConnected) return;
            pending = true;
            try { reportStatus(await window.epControl('status')); }
            catch { live.textContent = 'Controls unavailable. Check the terminal.'; }
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
                root.getElementById('result').textContent = JSON.stringify(result, null, 2);
                root.getElementById('message').textContent = `${button.textContent}: done.`;
            } catch (error) {
                root.getElementById('message').textContent = String(error.message || error);
            } finally { button.disabled = false; await refresh(); }
        });
        document.body.appendChild(host);
        refresh();
        const timer = setInterval(() => { if (!host.isConnected) clearInterval(timer); else refresh(); }, 1000);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
}
module.exports = { createBrowserControl, installControlMenu };
