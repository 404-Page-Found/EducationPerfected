// Read-only Assessment capture (issue #33). Assessment answering stays
// disabled; this command only records the STRUCTURE of an Assessment page so a
// real capture can drive the renderer/markability mapping that
// research/assessment-question-state.md lists as the remaining unknown.
//
// Like the other captures it runs inside the page, records fixed field names,
// counts, shapes and recognized codes only, and never question text, answer
// text, option text, stored answers, ids, class strings or attribute values.
// It reads own data properties through descriptors (accessors are never run),
// calls no EP method (no getQuestionWithIndex, no marking, no storage call,
// no cleanup), fires no events and clicks nothing. It does NOT apply the
// refusal that question detection applies to an Assessment shell: reading
// the Assessment shape is its whole purpose, and it is still non-mutating.
// A page that is not an Assessment (gameMode other than 2) is refused.
const fs = require('node:fs');
const path = require('node:path');
const { INSPECTION_HELPERS, collectInspection } = require('./inspection');
const {
    KNOWN_COMPONENT_CODES,
    VISIBILITY_COUNTERS,
    ROUTING,
    MODEL_WALK,
    GAME_MODE_FLAGS,
    QUESTION_DEFS,
    COMPONENT_SUMMARY,
} = require('./question-inspection');
const BUILD = 'assessment-inspect-v1';
const FULL_CAPTURE = `
    // ---- FULL capture (written to a file by the caller; never printed). ----
    // Own data properties only; text is kept (clipped) because the person
    // running their own session attaches this file.
    const CLIP = 400;
    const clip = x => { const t = String(x); return t.length > CLIP ? t.slice(0, CLIP) + '...[+' + (t.length - CLIP) + ']' : t; };
    let budget = 0, seenSet = null;
    const ser = (v, d) => {
        if (budget-- <= 0) return '[budget]';
        if (v === null) return null;
        const t = typeof v;
        if (t === 'undefined') return '[undefined]';
        if (t === 'string') return clip(v);
        if (t === 'number' || t === 'boolean') return v;
        if (t === 'bigint') return String(v) + 'n';
        if (t === 'function' || t === 'symbol') return '[' + t + ']';
        try {
            if (v instanceof Node || v === window) return '[dom]';
            if (seenSet.has(v)) return '[cycle]';
            if (d <= 0) return Array.isArray(v) ? '[array ' + v.length + ']' : '[object]';
            seenSet.add(v);
            try {
            if (Array.isArray(v)) {
                const len = Number.isSafeInteger(v.length) ? v.length : 0, out = [];
                for (let i = 0; i < Math.min(len, 60); i++) {
                    const dsc = Object.getOwnPropertyDescriptor(v, String(i));
                    out.push(dsc && Object.hasOwn(dsc, 'value') ? ser(dsc.value, d - 1) : '[accessor]');
                }
                if (len > 60) out.push('[+' + (len - 60) + ' more]');
                return out;
            }
            const out = {};
            let n = 0;
            for (const k of Object.getOwnPropertyNames(v)) {
                if (k.charAt(0) === '$') continue; // AngularJS internals
                if (n++ >= 80) { out['[truncated]'] = true; break; }
                const dsc = Object.getOwnPropertyDescriptor(v, k);
                out[k] = dsc && Object.hasOwn(dsc, 'value') ? ser(dsc.value, d - 1) : '[accessor]';
            }
            return out;
            } finally { seenSet.delete(v); }
        } catch (e) { return '[unreadable]'; }
    };
    const dump = (v, d) => { budget = 4000; seenSet = new WeakSet(); return ser(v, d); };
    const attrsOf = el => {
        const o = {};
        for (const a of el.attributes) { if (/^on/i.test(a.name)) continue; o[a.name] = a.name === 'value' && el.type === 'password' ? '[redacted]' : clip(a.value); }
        return o;
    };
    const SKIP = new Set(['script', 'style', 'noscript', 'link', 'meta']);
    const ctx = { n: 0, max: 3000 };
    const domNode = (el, d) => {
        if (ctx.n++ >= ctx.max) return '[node budget]';
        const tag = el.tagName.toLowerCase();
        const node = { tag, a: attrsOf(el), visible: shown(el) };
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            node.state = { type: el.type, disabled: el.disabled, checked: el.checked, readOnly: el.readOnly, value: el.type === 'password' ? '[redacted]' : clip(el.value) };
        } else if (tag === 'button') node.state = { disabled: el.disabled };
        if (el.isContentEditable && el.hasAttribute('contenteditable')) node.editable = clip(el.textContent);
        const text = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent.trim()).filter(Boolean).join(' ');
        if (text) node.text = clip(text);
        if (tag === 'svg' || tag === 'canvas') return node;
        const kids = [];
        if (d > 0) for (const c of el.children) { if (!SKIP.has(c.tagName.toLowerCase())) kids.push(domNode(c, d - 1)); }
        else if (el.children.length) node.childCount = el.children.length;
        if (kids.length) node.kids = kids;
        return node;
    };
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const controlSel = 'button,a[href],input,select,textarea,[role=button],[role=tab],[role=radio],[role=checkbox],[role=option],[contenteditable]';
    const controls = [...document.querySelectorAll(controlSel)].slice(0, 400).map(el => ({
        tag: el.tagName.toLowerCase(),
        text: clip((el.innerText || (el.type === 'password' ? '[redacted]' : el.value) || el.getAttribute('aria-label') || '').trim().slice(0, 120)),
        type: el.type || null,
        role: el.getAttribute('role'),
        id: el.id || null,
        cls: clip(el.getAttribute('class') || ''),
        disabled: el.disabled === true,
        ariaDisabled: el.getAttribute('aria-disabled'),
        ariaPressed: el.getAttribute('aria-pressed'),
        ariaChecked: el.getAttribute('aria-checked'),
        ariaSelected: el.getAttribute('aria-selected'),
        checked: el.checked === true,
        visible: shown(el),
        shell: (el.closest('game-assessment-action-bar,game-assessment-side-bar,game-assessment-navigation-controls') || {}).tagName?.toLowerCase() || null,
        rect: rectOf(el),
    }));
    const matching = re => [...document.querySelectorAll('*')].filter(el => {
        const key = (el.id || '') + ' ' + (el.getAttribute('class') || '') + ' ' + el.tagName;
        return re.test(key);
    }).slice(0, 40).map(el => ({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: clip(el.getAttribute('class') || ''), visible: shown(el), text: clip((el.innerText || '').trim().slice(0, 160)) }));
    const focusInfo = {
        hasFocus: document.hasFocus(),
        visibilityState: document.visibilityState,
        fullscreenElement: document.fullscreenElement ? document.fullscreenElement.tagName.toLowerCase() : null,
        fullscreenEnabled: document.fullscreenEnabled,
        activeElement: document.activeElement ? document.activeElement.tagName.toLowerCase() : null,
        window: { inner: [window.innerWidth, window.innerHeight], outer: [window.outerWidth, window.outerHeight], screen: [screen.width, screen.height], dpr: window.devicePixelRatio },
        indicators: matching(/lockdown|focus-?(track|warn|lost)|warning|fullscreen|proctor|security|blur/i),
    };
    const full = {
        capturedAt: new Date().toISOString(),
        href: location.href,
        title: document.title,
        model: dump(model, 5),
        self: dump(self, 3),
        question: dump(q, 7),
        controls,
        timers: matching(/timer|countdown|clock|time-?(left|remaining)|autosave|saving|saved/i),
        focus: focusInfo,
        dom: domNode(document.body, 18),
        domNodeCount: ctx.n,
    };
`;
const buildProgram = withFull => '(() => {' + INSPECTION_HELPERS
    + KNOWN_COMPONENT_CODES
    + VISIBILITY_COUNTERS
    + `
    const result = { build: 'assessment-inspect-v1', readOnly: true };
`
    + ROUTING
    + MODEL_WALK
    + GAME_MODE_FLAGS
    + `
    if (gameMode !== 2) return { ...result, guard: 'not-assessment', routing, gameMode, isDash };
`
    + QUESTION_DEFS
    + COMPONENT_SUMMARY
    + `
    // Mounted-shell census: element and visible-button counts per fixed
    // custom element, never the element's text or markup.
    const shellCount = tag => {
        const els = [...document.querySelectorAll(tag)];
        return {
            elements: els.length,
            visible: els.filter(shown).length,
            visibleControls: els.reduce((n, el) => n + [...el.querySelectorAll('button,a,input,select,textarea,[role="button"]')].filter(shown).length, 0),
        };
    };
    // Shape-only probes of fixed stored-state keys on the current question.
    // Values are never read into the report.
    const storedKeys = ['UsersAnswer', 'UserState', 'QuestionState', 'Attempted', 'Seen', 'FlaggedForLater', 'Grade', 'ScoreFraction'];
    const stored = {};
    for (const key of storedKeys) stored[key] = shape(q, key);

`
    + (withFull ? FULL_CAPTURE : '    const full = null;\n')
    + `
    return {
        ...result,
        guard: 'captured',
        ...(full ? { full } : {}),
        routing,
        gameMode,
        isDash,
        modelShapes: {
            _currentQuestion: shape(model, '_currentQuestion'),
            questions: shape(model, 'questions'),
            activityData: shape(self, 'activityData'),
            sectionData: shape(self, 'sectionData'),
        },
        question: q ? {
            contentIdValid: Number.isSafeInteger(data(q, 'contentID')) && data(q, 'contentID') > 0,
            questionIndexValid: Number.isSafeInteger(data(q, 'questionIndex')) && data(q, 'questionIndex') >= 0,
            questionType: integer(data(q, 'questionType')),
            translationMode: integer(data(q, 'translationMode')),
            componentCount: Array.isArray(defs) ? defs.length : null,
            components,
            componentsTruncated: Array.isArray(defs) && defs.length > 20,
            stored,
        } : null,
        shell: {
            actionBar: shellCount('game-assessment-action-bar'),
            sideBar: shellCount('game-assessment-side-bar'),
            navigationControls: shellCount('game-assessment-navigation-controls'),
        },
        dom: {
            questionText: count('#question-text'),
            answerText: count('input#answer-text'),
            speaker: count('.voice-speaker'),
            choiceGroups: count('div.multi-choice-component[role=radiogroup]'),
            choiceOptions: count('div.multi-choice-component[role=radiogroup] div.mcq-preview-option'),
            submitButtons: count('button.submit-button'),
            exitButton: count('.exit-button'),
            inputs: count('input'),
            textareas: count('textarea'),
            selects: count('select'),
            contentEditables: count('[contenteditable]'),
            canvases: count('canvas'),
        },
    };
})()`;
const INSPECT_ASSESSMENT_PROGRAM = buildProgram(true);
const SUMMARY_PROGRAM = buildProgram(false);
// Structure-only summary (no `full`): what the short stdout line carries and
// what existing callers/tests compare.
async function collectAssessmentDiagnostics(page, { shouldStop, timeoutMs } = {}) {
    return collectInspection(page, { build: BUILD, program: SUMMARY_PROGRAM, shouldStop, timeoutMs });
}
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const stamp = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
    + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
let sequence = 0;
// Full capture: runs the in-page program (bounded, never throws), writes the
// whole result to <dir>/assessment-<time>-<n>.json (mode 0600) and returns the
// structure-only summary plus the file path.
async function captureAssessment(page, { dir = path.join(process.cwd(), 'assessment-captures'), shouldStop = () => false, timeoutMs = 10000, now = () => new Date() } = {}) {
    if (shouldStop()) return { build: BUILD, guard: 'cancelled' };
    let timer;
    const pending = Promise.resolve().then(() => page.evaluate(INSPECT_ASSESSMENT_PROGRAM)).catch(() => ({ build: BUILD, guard: 'inspection-unavailable' }));
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ build: BUILD, guard: 'timeout' }), timeoutMs); });
    let result;
    try { result = await Promise.race([pending, timeout]); } finally { clearTimeout(timer); }
    if (result?.guard !== 'captured') return result;
    const { full, ...summary } = result;
    let body = JSON.stringify({ summary, full }, null, 1);
    // Enforce the size limit: drop the heaviest sections until the file fits.
    const trimmed = { ...full };
    for (const key of ['dom', 'self', 'model', 'controls']) {
        if (Buffer.byteLength(body) <= MAX_FILE_BYTES) break;
        trimmed[key] = '[omitted: over size limit]';
        body = JSON.stringify({ summary, full: trimmed }, null, 1);
    }
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) return { ...summary, fileError: 'too-large' };
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, 'assessment-' + stamp(now()) + '-' + String(++sequence).padStart(3, '0') + '.json');
        fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
        return { ...summary, file, bytes: Buffer.byteLength(body) };
    } catch (error) {
        return { ...summary, fileError: String(error?.code || 'write-failed') };
    }
}

// Passive watch: a read-only probe every few seconds; a new full capture is
// written only when the page's signature changes (page text, address, which
// input is checked, typed values). It never clicks, types or navigates,
// pauses while an answering run is active, and stops itself after repeated
// failures.
const SIGNATURE_PROGRAM = `(() => {
    // Clock-like text (10:05, 12 min, 30s) is ignored so a ticking countdown
    // does not count as a change; every other character is hashed.
    const hash = text => {
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
        return text.length + ':' + h;
    };
    const text = String(document.body.innerText || '')
        .replace(/[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?/g, '#')
        .replace(/[0-9]+ ?(seconds?|secs?|minutes?|mins?|s|m)(?![a-z])/gi, '#');
    const inputs = [...document.querySelectorAll('input,textarea,select')]
        .map((el, i) => i + (el.checked ? '*' : '-') + (el.type === 'password' ? '' : String(el.value || '')));
    return JSON.stringify([location.href, hash(text), hash(inputs.join('|')),
        document.querySelectorAll('game-assessment-side-bar [aria-current],game-assessment-side-bar .active,game-assessment-side-bar .selected').length]);
})()`;
// About 2.5 minutes of an unreadable page (a slow reload) before giving up.
const MAX_FAILURES = 60;
function createAssessmentWatcher({ page, dir, isBusy = () => false, log = () => {}, intervalMs = 2500, maxCaptures = 200, minGapMs = 5000 }) {
    let lastAt = 0, timer = null, last = null, captures = 0, failures = 0, ticking = false, generation = 0;
    const stop = reason => {
        if (timer) clearInterval(timer);
        timer = null;
        generation++;
        if (reason) log(reason);
    };
    const failed = () => {
        failures++;
        if (failures >= MAX_FAILURES) stop('Assessment watch stopped: page unavailable.');
    };
    async function probe() {
        const signature = await page.evaluate(SIGNATURE_PROGRAM);
        if (signature === last || Date.now() - lastAt < minGapMs) return;
        return { signature, result: await captureAssessment(page, { dir }) };
    }
    async function tick() {
        if (ticking || isBusy()) return;
        ticking = true;
        const mine = generation;
        try {
            const probed = await probe();
            if (mine !== generation || !probed) return;
            const { signature, result } = probed;
            if (result.guard === 'not-assessment') { last = signature; failures = 0; return; }
            if (result.guard !== 'captured' || result.fileError) { failed(); return; }
            failures = 0;
            last = signature;
            lastAt = Date.now();
            captures++;
            log('EP_ASSESSMENT_WATCH ' + JSON.stringify({ n: captures, file: result.file }));
            if (captures >= maxCaptures) stop('Assessment watch stopped: capture limit reached.');
        } catch {
            if (mine === generation) failed();
        } finally { ticking = false; }
    }
    return {
        start() {
            if (timer || captures >= maxCaptures) return false;
            last = null;
            failures = 0;
            timer = setInterval(tick, intervalMs);
            if (timer.unref) timer.unref();
            return true;
        },
        stop() { const was = !!timer; stop(); return was; },
        running() { return !!timer; },
        captures() { return captures; },
        tick,
    };
}
// Wiring helper so the launcher adds one line: the two controls run-controls
// accepts, bound to the live page.
function assessmentControls({ page, status }) {
    const busy = () => ['running', 'stopping', 'updating'].includes(status().state);
    return {
        inspectAssessment: () => captureAssessment(page),
        assessmentWatcher: createAssessmentWatcher({ page, isBusy: busy, log: line => console.log(line) }),
    };
}
// Terminal side of watch-assessment: prints the status line, or the usage /
// refusal message. Returns false when the command was refused.
function runWatchCommand(controls, arg, output) {
    let watch;
    try { watch = controls.watchAssessment(arg.trim()); } catch (error) {
        output.write(String(error?.message ?? error) + '\n');
        return false;
    }
    output.write('Assessment watch: ' + (watch.watching ? 'on' : 'off') + ', ' + watch.captures + ' capture(s) written. Passive read-only; a new file is written only when the page changes.\n');
    return true;
}
// Pre-arm from the environment (EP_WATCH_ASSESSMENT=1) so nothing has to be
// typed after the Assessment opens; the CLI window never takes focus.
function armWatchFromEnv(controls, env, output) {
    if (String(env.EP_WATCH_ASSESSMENT || '').trim() !== '1') return false;
    return runWatchCommand(controls, 'on', output);
}
module.exports = { armWatchFromEnv, runWatchCommand, assessmentControls, BUILD, INSPECT_ASSESSMENT_PROGRAM, collectAssessmentDiagnostics, captureAssessment, createAssessmentWatcher };
