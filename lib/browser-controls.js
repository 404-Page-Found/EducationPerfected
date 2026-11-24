// Browser controls use the same in-process operations as the terminal.
// No network listener, arbitrary method lookup or renderer-provided code.
function createBrowserControl({ controls, validationOnly = false, restartNeeded = () => false, notify = async () => {} }) {
    return async (action, value) => {
        const read = action === 'status' || ((action === 'accuracy' || action === 'delay') && !String(value ?? '').trim());
        if (validationOnly && !read && action !== 'stop') throw new Error('Validation session: use the approved terminal one-shot command.');
        let result;
        switch (action) {
            case 'status': return controls.status();
            case 'start': result = restartNeeded() ? await controls.restartAfterDrain() : controls.start(); break;
            case 'stop': result = await controls.stop(); break;
            case 'mode': result = await controls.mode(value); break;
            case 'refresh': result = await controls.refresh(); break;
            case 'accuracy': result = read ? controls.status() : await controls.setAccuracy(value); break;
            case 'delay':
                if (!read && !['stopped', 'completed', 'error'].includes(controls.status().state)) throw new Error('Stop the run before changing pacing.');
                result = controls.delay(value); if (result.error) throw new Error(result.error); break;
            // No inspect-* diagnostics here: developer commands stay terminal-only (#281).
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
    // Plain-language status lines for action results; the live bar stays compact.
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
            if (!a.enabled) lines.push('Accuracy: off, no intentional mistakes.');
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
            else lines.push('Pacing: a short human-like pause before each answer (varies by question type).');
        }
        return lines;
    };
    const isStatus = value => value && typeof value === 'object' && typeof value.state === 'string' && typeof value.mode === 'string';
    // Action results read as sentences; the raw JSON stays under Technical details.
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
        host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>
            :host{color-scheme:dark;font:13px/1.45 system-ui,sans-serif;color:#eff4ff}
            *{box-sizing:border-box}details:not(#raw-details):not(#guide):not(#help){font:13px/1.45 system-ui,sans-serif;color:#eff4ff;width:min(340px,calc(100vw - 24px));background:#172234;border:1px solid #7184a0;border-radius:10px;box-shadow:0 4px 18px #0006}
            summary{cursor:grab;padding:11px 13px;font-weight:650;user-select:none;touch-action:none}
            section{padding:0 12px 12px;max-height:65vh;overflow:auto}p{margin:0 0 10px;color:#c2d3ed}
            .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}button,input,select{font:inherit;color:inherit;background:#263951;border:1px solid #8195b1;border-radius:5px;padding:6px;min-height:32px}
            button{cursor:pointer}button:hover{background:#3a5374}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #91c9ff;outline-offset:2px}
            pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 ui-monospace,monospace;max-height:160px;overflow:auto;margin:6px 0 0}
            output{display:block;color:#ffd28a;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
            #live{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 8px;color:#eff4ff}
            #raw-details{margin:6px 0 10px}#raw-details summary{padding:4px 0;font-weight:400;font-size:12px;color:#9db3d1;cursor:pointer}
            #guide,#help{margin:6px 0 10px}#guide summary,#help summary{padding:4px 0;font-weight:400;font-size:12px;color:#9db3d1;cursor:pointer}
            #guide ol{margin:4px 0 4px 18px;padding:0;color:#c2d3ed;font-size:12px}
            #guide li{margin:2px 0}
            #help dl{margin:4px 0 2px;font-size:12px;color:#c2d3ed}#help dt{font-weight:650;color:#eff4ff;margin-top:4px}#help dd{margin:0 0 2px}
            .row input{flex:1;min-width:0}.row select{flex:1;min-width:0}
            .setting-row{display:flex;align-items:center;gap:10px;margin:10px 0}.setting-row label{flex:1;font-weight:600}.setting-row small{display:block;font-weight:400;color:#c2d3ed}
            .setting-row .setting-toggle{appearance:none;flex:none;width:42px;height:24px;min-height:24px;border:0;border-radius:16px;background:#475569;padding:3px;margin:0;cursor:pointer}
            .setting-toggle::before{content:'';display:block;width:18px;height:18px;border-radius:50%;background:white}.setting-row .setting-toggle:checked{background:#3b82f6}.setting-toggle:checked::before{transform:translateX(18px)}.setting-toggle:disabled{opacity:.5;cursor:not-allowed}
        </style><details><summary>EducationPerfected</summary><section>
            <p id="live" role="status" aria-live="polite">Connecting...</p>
            <output id="message" role="status" aria-live="polite"></output><pre id="result" aria-label="Control result"></pre>
            <details id="raw-details"><summary>Technical details</summary><pre id="raw" aria-label="Raw JSON result"></pre></details>
            <details id="guide" open><summary>Quick start</summary><ol>
                <li>Sign in in this browser, then open a task starter page.</li>
                <li>Press Refresh words once per new task, then Start. Press Stop to stop.</li>
                <li>Auto submits for you; Semi-auto fills answers only. Status stays in the one-line bar; results appear just above the buttons.</li>
            </ol></details>
            <div class="row"><button data-action="start" title="Start answering this task. Press Stop to stop; after a finished run Start begins a new run." aria-label="Start answering">Start</button><button data-action="stop" title="Stop answering. The browser stays open so you can start again." aria-label="Stop answering">Stop</button><button data-action="refresh" title="Learn answers from this task's starter word lists. Press once per new task before Start." aria-label="Refresh words from starter page">Refresh words</button><button data-action="status" title="Show details below; the one-line bar stays as state | mode | accuracy | pacing." aria-label="Show status">Status</button></div>
            <div class="row"><select id="mode" aria-label="Mode: Auto submits answers, Semi-auto fills them only" title="Mode: Auto submits answers for you, Semi-auto fills them for you to submit."><option value="auto">Auto</option><option value="semi">Semi-auto</option></select><button data-action="mode" title="Apply the selected mode. Change mode only while stopped." aria-label="Apply mode">Apply mode</button></div>
            <div class="setting-row"><label for="accuracy">Accuracy<small>On: 70-90% correct. Off: no intentional mistakes.</small></label><input id="accuracy" class="setting-toggle" type="checkbox" role="switch" aria-label="Accuracy target: on or off" title="Accuracy: on (70-90%) or off. Saved for next launch; change only while stopped." disabled><button data-action="accuracy" data-read="true" aria-label="Read accuracy" title="Read the current accuracy target and first-try stats.">Read</button></div>
            <div class="setting-row"><label for="delay">Pacing<small>Pause before each answer. Saved for next launch.</small></label><input id="delay" class="setting-toggle" type="checkbox" role="switch" aria-label="Pause before each answer: on or off" title="Pacing pause: on or off. Saved for next launch; change only while stopped." disabled><button data-action="delay" data-read="true" aria-label="Read pacing" title="Read the current pacing setting.">Read</button></div>
            <details id="help"><summary>What does each button do?</summary><dl>
                <dt>Start</dt><dd>Start answering this task. Press Stop to stop; after a finished run Start begins a new run.</dd>
                <dt>Stop</dt><dd>Stop answering. The browser stays open so you can start again.</dd>
                <dt>Refresh words</dt><dd>Learn answers from this task's starter word lists. Press once per new task before Start.</dd>
                <dt>Status</dt><dd>Show details below; the one-line bar stays as state | mode | accuracy | pacing.</dd>
                <dt>Mode + Apply mode</dt><dd>Auto submits answers for you; Semi-auto fills them for you to submit. Change only while stopped.</dd>
                <dt>Accuracy toggle / Read</dt><dd>Switch on (70-90%) or off to apply immediately. Read shows the target and stats. Saved for next launch; change only while stopped.</dd>
                <dt>Pacing toggle / Read</dt><dd>Switch on or off to apply immediately. Each question type uses its own pause length. Change only while stopped; Read shows the current setting.</dd>
            </dl></details>
        </section></details>`;
        // EP must not see panel keystrokes, clicks or selection changes.
        for (const name of ['keydown', 'keyup', 'keypress', 'input', 'change', 'click', 'pointerdown', 'pointerup', 'pointermove']) {
            root.addEventListener(name, event => event.stopPropagation());
        }
        // Drag the panel by its header; the position persists on this origin.
        const clampPosition = (left, top) => {
            const rect = host.getBoundingClientRect();
            const maxLeft = Math.max(0, document.documentElement.clientWidth - rect.width);
            const maxTop = Math.max(0, document.documentElement.clientHeight - rect.height); // keep the whole panel before either scrollbar
            return [Math.min(Math.max(0, left), maxLeft), Math.min(Math.max(0, top), maxTop)];
        };
        let positioned = false; // only a drag or a saved position re-anchors the panel (all:initial makes host.style.left read "initial", which is truthy)
        const applyPosition = (left, top) => {
            positioned = true;
            host.style.right = 'auto';
            host.style.bottom = 'auto';
            host.style.left = `${left}px`;
            host.style.top = `${top}px`;
        };
        const savePosition = () => {
            try { localStorage.setItem('educationperfected-control-menu-position', JSON.stringify({ left: Number.parseFloat(host.style.left), top: Number.parseFloat(host.style.top) })); } catch { }
        };
        const summary = root.querySelector('summary');
        let drag = null;
        // Pointer capture retargets the whole gesture onto the header, so the
        // release always lands here even when the pointer is off-panel, and the
        // isolation above hides the drag from EP's page.
        summary.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            delete summary.dataset.dragged; // a new gesture clears any leftover swallow flag
            const rect = host.getBoundingClientRect();
            drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
            try { summary.setPointerCapture(event.pointerId); } catch { }
        });
        summary.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
            drag.moved = true;
            applyPosition(...clampPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y));
        });
        const endDrag = event => {
            if (!drag || (event && event.pointerId !== drag.pointerId)) return;
            if (drag.moved) { savePosition(); summary.dataset.dragged = '1'; }
            drag = null;
        };
        summary.addEventListener('pointerup', endDrag);
        summary.addEventListener('pointercancel', () => { drag = null; });
        summary.addEventListener('lostpointercapture', () => endDrag(null));
        summary.addEventListener('click', event => {
            // A drag ends with a click on the header; swallow it so the panel does not toggle.
            if (summary.dataset.dragged === '1') { event.preventDefault(); delete summary.dataset.dragged; }
        });
        const reclamp = () => {
            if (!positioned || host.getClientRects().length === 0) return;
            const rect = host.getBoundingClientRect();
            applyPosition(...clampPosition(rect.left, rect.top));
        };
        window.addEventListener('resize', reclamp);
        root.querySelector('details').addEventListener('toggle', reclamp);
        root.addEventListener('toggle', reclamp, true);
        const contentObserver = new MutationObserver(reclamp);
        contentObserver.observe(root.querySelector('section'), { childList: true, characterData: true, subtree: true });
        const sizeObserver = new ResizeObserver(reclamp);
        sizeObserver.observe(root.querySelector('details'));
        window.addEventListener('pagehide', () => { sizeObserver.disconnect(); contentObserver.disconnect(); }, { once: true });
        // Quick-start guide stays collapsible without bloating the panel after first use.
        const guide = root.getElementById('guide');
        try {
            if (guide && localStorage.getItem('educationperfected-control-menu-guide') === 'closed') guide.open = false;
        } catch { }
        guide?.addEventListener('toggle', () => {
            try { localStorage.setItem('educationperfected-control-menu-guide', guide.open ? 'open' : 'closed'); } catch { }
        });
        const live = root.getElementById('live');
        let lastStatus = '';
        let pending = false;
        let settingPending = false;
        let confirmedStatus = null;
        const syncToggles = () => {
            for (const [id, key] of [['accuracy', 'accuracy'], ['delay', 'pacing']]) {
                const field = root.getElementById(id);
                if (!settingPending) field.checked = Boolean(confirmedStatus?.[key]?.enabled);
                field.disabled = settingPending || !confirmedStatus || !['stopped', 'completed', 'error'].includes(confirmedStatus.state);
            }
        };
        // One-line status bar: state | mode | accuracy | pacing.
        const compactStatus = status => {
            const a = status.accuracy || {};
            const pacing = status.pacing;
            return `${status.state} | ${status.mode} | accuracy ${!a.enabled ? 'off' : a.target == null ? 'on (70-90%)' : `on (target ${a.target}%)`} | pacing ${pacing ? (pacing.enabled ? 'per type' : 'off') : 'unknown'}`;
        };
        const reportStatus = status => {
            confirmedStatus = status;
            syncToggles();
            const text = compactStatus(status);
            if (text !== lastStatus) { live.textContent = text; live.title = text; lastStatus = text; }
        };
        let pendingRead = Promise.resolve();
        const refresh = () => {
            if (pending || document.hidden || !host.isConnected) return null;
            pending = true;
            pendingRead = (async () => {
            try {
                const status = await window.epControl('status');
                reportStatus(status);
                return status;
            } catch { confirmedStatus = null; syncToggles(); live.textContent = 'Controls unavailable. Check the terminal.'; return null; }
            finally { pending = false; }
            })();
            return pendingRead;
        };
        root.addEventListener('change', async event => {
            const field = event.target;
            if (!['accuracy', 'delay'].includes(field.id) || field.disabled || settingPending) return;
            settingPending = true;
            syncToggles();
            const label = field.id === 'accuracy' ? 'Accuracy' : 'Pacing';
            root.getElementById('message').textContent = 'Working...';
            try {
                await window.epControl(field.id, field.checked ? 'on' : 'off');
                root.getElementById('message').textContent = `${label}: done.`;
            } catch (error) {
                root.getElementById('message').textContent = `Couldn't change ${label.toLowerCase()}: ${error.message || error}`;
            } finally {
                // Wait for any in-flight status read before asking for the final confirmed state.
                await pendingRead;
                await refresh();
                settingPending = false;
                syncToggles();
            }
        });
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
        try {
            const saved = JSON.parse(localStorage.getItem('educationperfected-control-menu-position') || 'null');
            if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) applyPosition(...clampPosition(saved.left, saved.top));
        } catch { }
        void refresh();
        const timer = setInterval(() => { if (!host.isConnected) clearInterval(timer); else void refresh(); }, 1000);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
}
module.exports = { createBrowserControl, installControlMenu };
