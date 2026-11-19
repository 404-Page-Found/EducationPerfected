// Single-choice slide reader (Smart Lessons), extracted verbatim from
// detect-question.js on 17 November 2026 so the slide orchestrator
// (lib/slide-surfaces-state.js) can compose a choice surface with other
// verified surfaces under an explicit allow-mix set. Live-verified
// 2026-10-30 (Italian Smart Lesson choice slide) and grounded in EP's
// public chunks 171/606; see the detect-question.js header for the full
// provenance notes, which moved with the reader where choice-specific.
//
// One static Puppeteer callback serves detection (no arguments) and handle
// reads (element, descriptor), sharing the exact renderer association
// checks. readChoiceInPage runs INSIDE the page (via page.evaluate); it
// must stay self-contained: no references to anything outside its own body.
//
// allowMix is set only by the slide orchestrator: an array of component
// type codes (never this reader's own MULTICHOICE_COMPONENT) admits those
// visible input surfaces and their definitions, each verified by its own
// contract. Single-surface reads keep the default and are unchanged.
function readChoiceInPage(el = null, descriptor = null, allowMix = false) {
    // Read existing cached objects only. No renderer initialization, conversion,
    // selection, text equivalence or positional assumptions. Public EP bundles:
    // 171 EPTestQuestion.cachedRenderers[MODE_QUESTION=1]; 606 ComponentIndex,
    // MultiChoiceComponentState.previewOptions and MCQPreviewOption element/option.

    // EP's rich-text template fields carry markup like @@009900@...@@ and
    // [multichoice id="..."]; strip it before comparing text.
    const stripMarkup = (value) => String(value == null ? '' : value)
        .replace(/@@[0-9A-Fa-f]{6}@/g, '')
        .replace(/@@/g, '')
        .replace(/\[(?=([^\]]*\]))\1/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const visible = (el) => !!(el && (el.offsetParent !== null
        || (el.getClientRects && el.getClientRects().length > 0)));

    // The game model hangs off the AngularJS scope's `self`. EP nests
    // components, so walk up a few ancestors looking for a scope that has the
    // current question on it.
    const currentQuestionFrom = (el) => {
        if (!el || !window.angular || typeof angular.element !== 'function') return null;
        for (let node = el, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
            try {
                const scope = angular.element(node).scope && angular.element(node).scope();
                const self = scope && scope.self;
                if (self && self.model && self.model._currentQuestion) {
                    return { self, question: self.model._currentQuestion };
                }
            } catch (e) { /* not a scoped node; keep walking */ }
        }
        return null;
    };

    // How EP says this activity is graded, with provenance. Captured live
    // (2026-10-30) on a Smart Lesson at
    // scope.self.sectionData.activityGroup: isAutoMarked: true as a real
    // boolean (alongside isSelfMarked: false, QuestionMarkingStyle: -1).
    // Fail closed: only an explicit boolean true is "auto"; an explicit false
    // is manual; anything else is 'unknown', and handlers must not treat
    // unknown as auto.
    const autoMarkingOf = (self) => {
        try {
            const group = self?.sectionData?.activityGroup;
            if (!group) return 'unknown';
            if (group.isAutoMarked === true) return true;
            if (group.isAutoMarked === false) return false;
            return 'unknown';
        } catch (e) { return 'unknown'; }
    };

    const validIdentity = q => Number.isSafeInteger(q.contentID) && q.contentID > 0
        && Number.isSafeInteger(q.questionIndex) && q.questionIndex >= 0;


    function readMathChoiceInPage(group, q, comp, plainBlock = false, association) {
        // Content-free identification of the exact refusal boundary, surfaced
        // through the caller's unsupported-question diagnostic. Never carries
        // template text, attribute values or page content.
        const fail = (boundary, detail) => {
            if (association) {
                association.boundary = boundary;
                if (detail) Object.assign(association, detail);
            }
            return null;
        };
        // Narrow source grammar: TemplateParser opens [block on its own line,
        // renders inner paragraphs, then closes a standalone ]. Not a general
        // EP parser. Do not strip arbitrary brackets or infer image/math text.
        // chunk606 TemplateParser.beginFormatBlock honors align/width and
        // ignores other attributes; the editor's TextAlign command writes
        // left, right, center (CENTRE) or justify. Presentation attributes
        // never alter rendered text, which stays bound by the exact
        // renderGroup text comparison below.
        const blockHeader = line => {
            if (typeof line !== 'string' || !line.startsWith('[block')) return null;
            const rest = line.slice(6);
            if (rest === '') return true;
            if (!rest.startsWith(' ')) return null;
            const keys = new Set();
            // Attribute values may contain quoted spaces; split only between attributes.
            const tokens = [];
            let current = '', quoted = false;
            for (const character of rest.trim()) {
                if (character === '"') quoted = !quoted;
                if (character === ' ' && !quoted) {
                    if (current) { tokens.push(current); current = ''; }
                } else current += character;
            }
            if (quoted) return null;
            if (current) tokens.push(current);
            for (const token of tokens) {
                const pair = token.match(/^([a-zA-Z][a-zA-Z0-9-]*)(?:=("[A-Za-z0-9 _%.-]*"|[A-Za-z0-9_.%-]+))?$/);
                if (!pair || keys.has(pair[1])) return null;
                keys.add(pair[1]);
                if (pair[1] === 'align' && !['"left"', '"center"', '"right"', '"justify"', 'left', 'center', 'right', 'justify'].includes(pair[2])) return null;
                if (pair[1] === 'width' && !/^"?\d+"?$/.test(pair[2] || '')) return null;
            }
            return true;
        };
        // Content-free triage tag for a body-bracket refusal: a fixed
        // allowlist name, or one of three shape words. Never template text.
        const bracketTag = body => {
            const known = ['table', 'image', 'link', 'list', 'audio', 'video', 'quote', 'code', 'block'];
            const open = body.split('\n').map(l => l.match(/^\[([a-z][a-z0-9-]*)/)).find(Boolean);
            if (open) return known.includes(open[1]) ? open[1] : 'unlisted-directive';
            return /^\s*\]/m.test(body) && !body.includes('[') ? 'stray-close' : 'inline-bracket';
        };
        const blockText = (template, record, raw = false) => {
            const reject = (check, tag) => { if (record) record(check, tag); return null; };
            if (typeof template !== 'string' || template.length > 8192) return reject('template');
            // Raw (unresolved) templates can carry EP variable expressions and
            // literal < > { } text: chunk606 MultiChoiceComponentState builds a
            // BasicVariableInjector per raw Options template (splitParts on
            // /({[^}]+})/g) and applyVariableContext resolves TextTemplate in
            // the metadata clone this guard binds below. Raw text feeds only
            // the drift signature, so expressions normalize to an opaque token
            // here; the token is a palette digit so an expression inside a
            // color span (@@{color}@..@@) still parses structurally. Line-level
            // [directives stay refused: they change structure, not text.
            const normalized = raw ? template.replace(/{(?=([^}]+}))\1/g, '1') : template;
            const lines = normalized.split('\n');
            if (lines.length < 3) return reject('line-count');
            if (!blockHeader(lines[0])) return reject('header');
            if (lines.at(-1) !== ']') return reject('closer');
            const body = lines.slice(1, -1).join('\n');
            // Only structure characters stay refused: [ ] open/close directives
            // and the formula delimiter. Literal < > { } are ordinary text in
            // chunk606's grammar (splitParts leaves non-expression parts
            // literal) and the exact renderGroup text comparison binds them.
            // Controls are named before blankness: trim() strips vertical tab
            // and form feed, so a blank-looking body can still hide one.
            const illegal = body.match(/[\[\]`\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
            if (illegal) {
                const kind = { '[': 'bracket', ']': 'bracket', '`': 'backtick' }[illegal[0]] || 'control';
                return reject('body-' + kind, kind === 'bracket' ? bracketTag(body) : undefined);
            }
            if (!body.trim()) return reject('body-blank');
            // InlineTextElement.splitFormattedText consumes these exact style
            // toggles. Support balanced toggles with nonblank total text; escapes, headings,
            // highlight and sub/sup remain outside this narrowed contract.
            const toggles=new Map([['**',false],['__',false],['//',false],['~~',false]]);
            const styled=/\*\*|__|\/\/|~~/.test(body);
            if((styled&&body.includes('\\'))||/##|[₍₎⁽⁾]|^#{1,6} /m.test(body))return reject('inline-format');
            // EP InlineTextElement colors: palette @@1@..@@9@ or explicit
            // @@RGB@ / @@RRGGBB@, closed by @@. Accept only balanced, nonnested
            // spans. Stray @, escaped syntax and unknown tokens fail closed.
            // Source: public chunk606 parseFormattedText + serializeTextColor.
            let text = '', colored = false;
            for (let i = 0; i < body.length;) {
                const token=body.slice(i,i+2);
                if(toggles.has(token)){toggles.set(token,!toggles.get(token));i+=2;continue;}
                if (body[i] !== '@') { text += body[i++]; continue; }
                if (i > 0 && body[i - 1] === '\\') return reject('color');
                if (colored) {
                    if (!body.startsWith('@@', i)) return reject('color');
                    const nested = body.slice(i).match(/^@@(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}|[1-9])@/);
                    if (nested) return reject('color');
                    colored = false; i += 2;
                } else {
                    const opening = body.slice(i).match(/^@@(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}|[1-9])@/);
                    if (!opening) return reject('color');
                    colored = true; i += opening[0].length;
                }
            }
            if ([...toggles.values()].some(Boolean)) return reject('inline-format');
            if (colored || !text.trim()) return reject('color');
            return text.replace(/\s+/g, ' ').trim();
        };
        // EP DOMComposition.render appends each DOMParagraph <p> directly:
        // textContent inserts no newline. Bind each template line to one paragraph
        // rather than inventing separators for arbitrary nested layout.
        const paragraphTextMatches=(render,template)=>{
            const lines=template.split('\n').slice(1,-1);
            if(lines.length<1)return false;
            let container=render;
            for(let depth=0;depth<3;depth++){
                const nodes=[...container.childNodes].filter(n=>n.nodeType!==3||n.textContent.trim());
                if(nodes.length!==1||nodes[0].nodeType!==1||nodes[0].tagName!=='DIV')break;
                container=nodes[0];
            }
            const nodes=[...container.childNodes].filter(n=>n.nodeType!==3||n.textContent.trim());
            if(nodes.length!==lines.length||nodes.some(n=>n.nodeType!==1||n.tagName!=='P'))return false;
            return nodes.every((paragraph,i)=>{
                if([...paragraph.querySelectorAll('*')].some(n=>n.tagName!=='SPAN'))return false;
                return paragraph.textContent.replace(/\s+/g,' ').trim()===(lines[i].trim()?blockText('[block\n'+lines[i]+'\n]'):'');
            });
        };
        const own = (object, key) => {
            if (!object || typeof object !== 'object') return undefined;
            const property = Object.getOwnPropertyDescriptor(object, key);
            return property && Object.hasOwn(property, 'value') ? property.value : undefined;
        };
        const marked = o => o?.Correct === true || (typeof o?.Correct === 'string' && o.Correct.toLowerCase() === 'true');
        const visible = el => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        if (typeof comp.ComponentID !== 'string' || !comp.ComponentID) return fail('component-id');
        const raw = comp.Options;
        if (!Array.isArray(raw) || !raw.length || raw.length > 100) return fail('metadata');
        if (plainBlock) {
            for (let i = 0; i < raw.length; i++) {
                let check = 'template', directive;
                const template = raw[i]?.TextTemplate;
                if (typeof template !== 'string' || !template.trim() || !blockText(template, (c, d) => { check = c; directive = d; }, true)) return fail('raw-template', { option: i, check, ...(directive ? { directive } : {}) });
            }
        } else if (raw.some(o => typeof o?.TextTemplate !== 'string' || !o.TextTemplate.trim() || !o.TextTemplate.includes('`'))) return fail('raw-template', { check: 'template' });
        if (new Set(raw.map(o => o.TextTemplate)).size !== raw.length) return fail('raw-template', { check: 'duplicate' });
        // Access dictionary properties, not lazy public getters that may initialize
        // a renderer. Every object must already be bound to this exact live DOM.
        const cached = own(own(q, 'cachedRenderers'), '1');
        const index = own(cached, 'identifiedComponents') || own(own(cached, 'parser'), 'identifiedComponents');
        const registry = own(index, 'baseComponents');
        const components = registry?.[comp.ComponentID];
        if (!Array.isArray(components) || components.length !== 1) return fail('renderer-graph');
        const component = components[0];
        const state = component?.componentState;
        const metadata = state?.metadataInstance;
        const previews = state?.previewOptions;
        const elements = [...group.querySelectorAll('div.mcq-preview-option')].filter(visible);
        if (component.type !== 'multichoice' || component.id !== comp.ComponentID
            || component.visualElement !== group || metadata?.ComponentID !== comp.ComponentID
            || metadata.AllowMultiSelect !== comp.AllowMultiSelect
            || !Array.isArray(metadata.Options) || metadata.Options.length !== raw.length
            || !Array.isArray(previews) || previews.length !== elements.length || !elements.length
            || new Set(previews.map(p => p?.element)).size !== previews.length) return fail('component-binding');
        // EP clones raw metadata, then resolves TextTemplate AND Correct in
        // metadataInstance. Raw/resolved string equality is not an identity.
        // Ground the current resolved state in the same cached object graph EP
        // uses for selection/marking; never evaluate variables or infer indexes.
        const original = state.originalMultiChoiceOptions;
        const displayed = state.displayedOptions;
        const sameObjects = (a, b) => Array.isArray(a) && Array.isArray(b)
            && a.length === b.length && new Set(a).size === a.length
            && new Set(b).size === b.length && a.every(o => b.includes(o));
        if (state.componentID !== comp.ComponentID
            || !sameObjects(original, metadata.Options)
            || !sameObjects(displayed, previews.map(p => p?.option))
            || !displayed.every(o => metadata.Options.includes(o))) return fail('option-graph');
        if (plainBlock) {
            for (let i = 0; i < metadata.Options.length; i++) {
                let check = 'template';
                const option = metadata.Options[i];
                if (typeof option?.TextTemplate !== 'string' || !option.TextTemplate.trim() || !blockText(option.TextTemplate, c => { check = c; })) return fail('resolved-template', { option: i, check });
                if (!(typeof option.Correct === 'boolean'
                    || (typeof option.Correct === 'string' && ['true', 'false'].includes(option.Correct.toLowerCase())))) return fail('resolved-template', { option: i, check: 'marking' });
            }
        } else if (metadata.Options.some(o => typeof o?.TextTemplate !== 'string' || !o.TextTemplate.trim()
            || !o.TextTemplate.includes('`')
            || !(typeof o.Correct === 'boolean'
                || (typeof o.Correct === 'string' && ['true', 'false'].includes(o.Correct.toLowerCase()))))) return fail('resolved-template', { check: 'template' });
        if (new Set(metadata.Options.map(o => o.TextTemplate)).size !== raw.length) return fail('resolved-template', { check: 'duplicate' });
        const rows = [];
        for (let row = 0; row < elements.length; row++) {
            const el = elements[row];
            const matches = previews.filter(p => p?.element === el);
            if (matches.length !== 1) return fail('option-dom', { option: row, check: 'preview-association' });
            const preview = matches[0], option = preview.option;
            if (!metadata.Options.includes(option) || option.PreviewOption !== preview
                || preview.componentID !== comp.ComponentID || preview.correct !== marked(option)
                || preview.renderer?.templateString !== option.TextTemplate
                || (!plainBlock && !el.querySelector('.katex, math, .inline-formula'))
                || el.querySelector('img:not(.answer-icon)')
                || !el.contains(preview.fields?.renderGroup)) return fail('option-dom', { option: row, check: 'option-binding' });
            if (plainBlock) {
                const render = preview.fields.renderGroup;
                // MCQPreviewOption's native radio is outside rendered content.
                // Bind only this exact cached field, never arbitrary inputs.
                const check = preview.fields.check, inputs = [...el.querySelectorAll('input')];
                if (![false, 'false'].includes(comp.AllowMultiSelect)
                    || !check || inputs.length !== 1 || inputs[0] !== check
                    || check.tagName !== 'INPUT' || check.type !== 'radio' || check.id !== 'check'
                    || check.name !== comp.ComponentID || check.getAttribute('tabindex') !== '-1' || check.disabled || check.matches(':disabled')
                    || check.parentElement?.id !== 'button-group' || !el.contains(check.parentElement)
                    || render.id !== 'render-group' || render.parentElement !== check.parentElement || render.contains(check)) return fail('option-dom', { option: row, check: 'input-binding' });
                if (el.querySelector('.katex,math,.inline-formula,textarea,select,[contenteditable]')) return fail('option-dom', { option: row, check: 'render-structure' });
                const multilineParagraphs=option.TextTemplate.split('\n').length>3||/\*\*|__|\/\/|~~/.test(option.TextTemplate);
                if (multilineParagraphs ? !paragraphTextMatches(render,option.TextTemplate)
                    : render.textContent.replace(/\s+/g, ' ').trim() !== blockText(option.TextTemplate)) return fail('option-dom', { option: row, check: 'render-text', templateLines: option.TextTemplate.split('\n').length-2, renderedParagraphs: render.querySelectorAll('p').length, inlineStyleTokens: /\*\*|__|\/\/|~~/.test(option.TextTemplate), headingToken: /^#{1,6} /m.test(option.TextTemplate), highlightToken: option.TextTemplate.includes('##'), scriptToken: /[₍₎⁽⁾]/.test(option.TextTemplate), escapeToken: option.TextTemplate.includes('\\') });
            }
            rows.push({ element: el, text: option.TextTemplate, correct: marked(option) });
        }
        if (new Set(rows.map(r => r.text)).size !== rows.length) return fail('resolved-template', { check: 'duplicate' });
        // Do not silently reduce the correct set to displayed/readable subset.
        if (plainBlock) {
            const controls = [...group.querySelectorAll('input,textarea,select,[contenteditable]')];
            const checks = previews.map(p => p?.fields?.check);
            if (group.isContentEditable || controls.length !== checks.length
                || new Set(checks).size !== checks.length || controls.some(c => !checks.includes(c))
                || elements.some(e => e.isContentEditable) || previews.some(p => p.fields.renderGroup.isContentEditable)) return fail('group-controls');
        }
        if (rows.filter(r => r.correct).length !== metadata.Options.filter(marked).length) return fail('correct-set');
        rows.signature = JSON.stringify([raw.map(o => [o.TextTemplate, o.Correct]), metadata.Options.map(o => [o.TextTemplate, o.Correct])]);
        return rows;
    }

    if (el) {
        let context;
        for (let node = el, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
            const scope = window.angular?.element(node)?.scope?.();
            if (scope?.self?.model?._currentQuestion) { context = scope.self.model; break; }
        }
        // Dash rounds (issue #230) run on the QuizModel (isDash === true),
        // never Smart Lesson mode; a Dash descriptor confirms that model
        // instead of gameMode 3.
        const modeConfirmed = descriptor.dash === true ? context?.isDash === true : context?.gameMode === 3;
        if (!modeConfirmed || `choice:${context._currentQuestion.contentID}:${context._currentQuestion.questionIndex}` !== descriptor.key) return { visible: false, text: '' };
        if (descriptor.representation === 'renderer-template') {
            const groups = [...document.querySelectorAll('div.multi-choice-component[role=radiogroup]')]
                .filter(g => g.offsetParent !== null || g.getClientRects().length > 0);
            if (groups.length !== 1 || !groups[0].contains(el)) return { visible: false, text: '' };
            let q, self;
            for (let node = groups[0], depth = 0; node && depth < 8; node = node.parentElement, depth++) {
                const scope = window.angular?.element(node)?.scope?.();
                if (scope?.self?.model?._currentQuestion) { self = scope.self; q = self.model._currentQuestion; break; }
            }
            if (!q || self.sectionData?.activityGroup?.isAutoMarked !== true || `choice:${q.contentID}:${q.questionIndex}` !== descriptor.key) return { visible: false, text: '' };
            const choices = q.questionDef?.Components?.filter(c => c?.ComponentTypeCode === 'MULTICHOICE_COMPONENT');
            if (choices?.length !== 1 || ![false, 'false'].includes(choices[0].AllowMultiSelect)) return { visible: false, text: '' };
            const rows = readMathChoiceInPage(groups[0], q, choices[0], descriptor.plainBlock === true);
            if (!rows || rows.signature !== descriptor.associationSignature || JSON.stringify(rows.filter(r => r.correct).map(r => r.text)) !== JSON.stringify(descriptor.correct)) return { visible: false, text: '' };
            const row = rows.find(r => r.element === el);
            return { visible: !!row, text: row?.text || '' };
        }
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.shortcut-key').forEach(k => k.remove());
        return {
            visible: el.offsetParent !== null || el.getClientRects().length > 0,
            text: (clone.textContent || '')
                .replace(/@@[0-9A-Fa-f]{6}@/g, '').replace(/@@/g, '')
                .replace(/\[(?=([^\]]*\]))\1/g, '').replace(/\s+/g, ' ').trim(),
        };
    }

    // 1. multiple-choice slide (Smart Lessons / Assessments)
    const groups = [...document.querySelectorAll('div.multi-choice-component[role=radiogroup]')].filter(visible);
    if (groups.length > 1) return { kind: 'unsupported', reason: 'multiple visible choice components; cannot safely associate answer state with one component' };
    const group = groups[0];
    if (group) {
        const found = currentQuestionFrom(group);
        if (!found) return { kind: 'unsupported', reason: 'choice question detected, but EP\'s answer state could not be read (AngularJS scope unavailable)' };
        const { self, question: q } = found;
        if (self.model.gameMode === 2) return { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' };
        // EP chunk606, checked 9 November 2026: ComponentStateFactory builds a
        // state for every def in questionDef.Components and BaseComponent marks
        // every component MARKED except AnnotatedText (NOT_MARKED) and display
        // types, and Submit grades the whole question. A co-resident
        // answer-bearing component would be submitted blank, so refuse the mix.
        // The legacy TYPE_* math-entry codes are deliberately not deny-listed:
        // chunk606's factory never builds them, TYPE_TEXT_COMPONENT is a legacy
        // display type, and any editable legacy part is still caught by the
        // foreign-editable DOM boundary below. DEPTH_COMPONENT appears in
        // chunk606 only as a WebGL texture constant, never a question component.
        const answerBearingCodes = ['DROPDOWN_COMPONENT', 'FORMULA_COMPONENT', 'WORKING_FORMULA_COMPONENT', 'FREEFORM_WORKING_COMPONENT',
            'LONG_ANSWER_COMPONENT', 'FILL_IN_GAPS_COMPONENT', 'FILE_UPLOADER_COMPONENT',
            'SOUND_RECORDER_COMPONENT', 'HIGHLIGHT_COMPONENT', 'TEXT_BOX_COMPONENT', 'NUMBER_BOX_COMPONENT', 'ANNOTATED_QUESTION_COMPONENT'];
        // A scratch pad companion is grading-neutral unless marked under
        // EP's own loose check (marked == MARKED): anything else emits a
        // constant 0/0/0 marking payload. chunk606, 19 November 2026. Read
        // own data only, never the lazy getters this reader avoids.
        const ownData = (o, k) => {
            const p = o && typeof o === 'object' ? Object.getOwnPropertyDescriptor(o, k) : null;
            return p && Object.hasOwn(p, 'value') ? p.value : undefined;
        };
        const scratchPadAnswerBearing = (c) => {
            if (c?.ComponentTypeCode !== 'SCRATCH_PAD_COMPONENT') return false;
            const cr = ownData(ownData(q, 'cachedRenderers'), '1');
            const ix = ownData(cr, 'identifiedComponents') || ownData(ownData(cr, 'parser'), 'identifiedComponents');
            const e = ownData(ownData(ix, 'baseComponents'), c.ComponentID);
            return !Array.isArray(e) || e.length !== 1 || e[0]?.id !== c.ComponentID || e[0].type !== 'scratch-pad' || e[0].marked == 1;
        };
        // Dash (timed sprint, issue #230) runs on EP's QuizModel: gameMode
        // CLASSIC with isDash === true (public chunk 171, QuizModel
        // constructor). The 2026-11-19 live capture (EP_DASH_INSPECT)
        // recorded the round: gameMode null, no sectionData, one
        // MULTICHOICE_COMPONENT (AllowMultiSelect false, Marked 1, four
        // options, exactly one Correct string "true"), one visible
        // radiogroup with four options, one button.submit-button, and a
        // route whose path includes "dash". Only that confirmed shape is
        // answered; every deviation refuses by name below.
        if (self.model.isDash === true) {
            const dashRefuse = (guard, reason) => ({ kind: 'unsupported', dash: true, reason: `Dash timed sprint round: ${reason}`, diagnostic: { renderer: 'dash-choice', guard } });
            // Segment-boundary match: a "dash" path segment (dash, dash-task,
            // ...), never a substring like /learning/dashboard.
            const dashPath = String(typeof location !== 'undefined' && location && location.pathname || '');
            const onDashRoute = /(^|\/)dash([\/\-_.]|$)/i.test(dashPath);
            if (!onDashRoute) return { kind: 'unsupported', dash: true, reason: 'Dash timed sprint round detected outside a confirmed dash route; refusing an unconfirmed shape. Stop the run, type inspect-dash and send the EP_DASH_INSPECT line (read-only capture).' };
            // The captured Dash model has no sectionData (undefined live,
            // absent in the fixture); one that appears is an unverified shape.
            if (self.sectionData !== undefined) return dashRefuse('section-data', 'the Dash model carries sectionData; the captured round has none');
            if (Array.isArray(allowMix)) return dashRefuse('mixed-slide', 'a Dash round is single-surface only; mixed slides are not supported');
            // Captured gameMode null; chunk 171's QuizModel constructor sets
            // CLASSIC (1). Any other mode contradicts the model.
            const dashMode = self.model.gameMode;
            if (!(dashMode === null || dashMode === undefined || dashMode === 1)) return dashRefuse('game-mode', `unexpected gameMode ${Number.isSafeInteger(dashMode) ? dashMode : 'unreadable'} on a Dash model; only the captured null and chunk-171 CLASSIC (1) are confirmed`);
            const dashDefs = q.questionDef?.Components;
            const dashChoices = (Array.isArray(dashDefs) ? dashDefs : []).filter(c => c?.ComponentTypeCode === 'MULTICHOICE_COMPONENT');
            if (dashChoices.length !== 1) return dashRefuse('component-count', `${dashChoices.length} multi-choice components; the captured round has exactly one`);
            const dashComp = dashChoices[0];
            if (![false, 'false'].includes(dashComp.AllowMultiSelect)) return dashRefuse('multi-select', 'a multi-select Dash round; only single-select was captured');
            if (dashComp.Marked !== 1) return dashRefuse('marking-flag', `component marking flag ${Number.isSafeInteger(dashComp.Marked) ? dashComp.Marked : 'unreadable'}; the captured round carries Marked 1 (MARKED)`);
            if (dashDefs.some(c => c !== dashComp && (answerBearingCodes.includes(c?.ComponentTypeCode) || scratchPadAnswerBearing(c)))) return dashRefuse('companion-components', 'other answer-bearing question components; answering one part would submit the rest blank');
            const dashRoot = document.querySelector('#ep-question-container') || document;
            const dashForeign = [...dashRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
                .filter(el => visible(el) && (el.matches('input,textarea,select') || el.isContentEditable) && !group.contains(el));
            if (dashForeign.length) return dashRefuse('foreign-editable', 'editable controls outside the choice component; answering would submit them blank');
            if (!Array.isArray(dashComp.Options) || !dashComp.Options.length) return dashRefuse('options-missing', 'option metadata is missing or unreadable; no answer was selected');
            // Plain word options only: the captured round is word-to-word.
            // Formula/block templates belong to the Smart Lesson renderer
            // association, which has no Dash grounding.
            if (dashComp.Options.some(o => typeof o?.TextTemplate !== 'string' || !o.TextTemplate.trim())) return dashRefuse('option-template', 'an option has no usable text template');
            if (dashComp.Options.some(o => o.TextTemplate.includes('`') || o.TextTemplate.includes('[block'))) return dashRefuse('option-template-format', 'formula or block option templates; only plain word options were captured');
            // EP's renderer compares Correct.toLowerCase() with 'true'; the
            // captured round carries exactly one string "true".
            const dashCorrect = dashComp.Options.filter(o => o && (o.Correct === true
                || (typeof o.Correct === 'string' && o.Correct.toLowerCase() === 'true')));
            if (dashCorrect.length === 0) return dashRefuse('no-correct-option', 'no option is marked correct; stopping instead of guessing');
            if (dashCorrect.length !== 1) return dashRefuse('multiple-correct-options', `${dashCorrect.length} options are marked correct; exactly one was captured`);
            const dashTexts = dashComp.Options.map(o => stripMarkup(o.TextTemplate));
            if (dashTexts.includes('')) return dashRefuse('empty-option-text', 'an option template strips to empty text');
            if (new Set(dashTexts).size !== dashTexts.length) return dashRefuse('duplicate-options', 'duplicate option texts; cannot associate the answer with one option');
            if (!validIdentity(q)) return dashRefuse('identity', 'no stable identity (contentID/questionIndex missing from EP\'s question state)');
            return {
                kind: 'choice',
                key: `choice:${q.contentID}:${q.questionIndex}`,
                options: Array.from(group.querySelectorAll('div.mcq-preview-option')).map(el => {
                    const clone = el.cloneNode(true);
                    clone.querySelectorAll('.shortcut-key').forEach(k => k.remove());
                    return { text: stripMarkup(clone.textContent), visible: visible(el) };
                }),
                correct: [stripMarkup(dashCorrect[0].TextTemplate)],
                multi: false,
                dash: true,
                // Dash has no sectionData/activityGroup (captured undefined),
                // so the Smart Lesson marking proof does not apply. Dash
                // marks client-side: chunk 171 QuizInGamePage.submitAnswer ->
                // markingManager.markAnswerWithSecondChance, the captured
                // component carries Marked 1 and the Correct flags ship to
                // the client. That is this round's auto-marking proof.
                autoMarked: true,
            };
        }
        if (self.model.gameMode !== 3) return { kind: 'unsupported', reason: `Choice answering requires confirmed Smart Lesson practice mode; unknown modes (gameMode ${Number.isSafeInteger(self.model.gameMode) ? self.model.gameMode : 'unreadable'}) are not supported` };
        const components = q.questionDef?.Components;
        const choices = (Array.isArray(components) ? components : [])
            .filter(c => c?.ComponentTypeCode === 'MULTICHOICE_COMPONENT');
        // allowMix containing this reader's own type code names the sibling
        // multi-select surface (same component type, AllowMultiSelect true),
        // verified by the multi-select reader's own contract. The default
        // keeps the single-surface refusal.
        const siblingChoice = Array.isArray(allowMix) && allowMix.includes('MULTICHOICE_COMPONENT');
        // A lone choice component is accepted whatever its multi flag (the
        // descriptor reports the flag); a sibling pair composes only as one
        // single-choice plus one multi-select.
        const singles = choices.filter(c => c?.AllowMultiSelect !== true);
        const comp = choices.length === 1 ? choices[0]
            : (siblingChoice && choices.length === 2 && singles.length === 1 ? singles[0] : null);
        if (!comp) return { kind: 'unsupported', reason: 'choice slide without exactly one identifiable multi-choice component in the readable question state' };
        // allowMix is set only by the slide orchestrator: an array of other
        // verified component type codes on the same slide (never this
        // reader's own) admits those answer-bearing companions, each verified
        // by its own contract. The default keeps the single-surface refusal.
        const foreignTypes = Array.isArray(allowMix) ? allowMix.filter(t => t !== 'MULTICHOICE_COMPONENT') : [];
        if ((foreignTypes.length || siblingChoice) && comp.Marked !== 0 && comp.Marked !== 1) return { kind: 'unsupported', reason: 'choice component has an unexpected marking flag' };
        if (components.some(c => c !== comp && !choices.includes(c) && (answerBearingCodes.includes(c?.ComponentTypeCode) || scratchPadAnswerBearing(c)) && !foreignTypes.includes(c?.ComponentTypeCode))) {
            return { kind: 'unsupported', reason: 'choice slide has other answer-bearing question components; answering one part would submit the rest blank' };
        }
        // The transition DOM can briefly lack the lesson container (the next
        // slide's group can be re-mounted before a fresh container), so fall
        // back to a document-wide scan: the foreign-editable boundary is
        // never silently skipped.
        const lessonRoot = document.querySelector('#ep-question-container') || document;
        // The sibling multi-select surface's checkboxes belong to its own
        // reader; every other foreign control still refuses.
        const foreignControl = el => (siblingChoice && el.matches('div.multi-choice-component input'))
            || foreignTypes.some(t => t === 'DROPDOWN_COMPONENT'
            ? el.tagName === 'SELECT'
            : (t === 'TEXT_BOX_COMPONENT' || t === 'NUMBER_BOX_COMPONENT')
                && el.matches(t === 'TEXT_BOX_COMPONENT' ? 'input.text-box-component' : 'input.number-box-component'));
        const foreignEditable = [...lessonRoot.querySelectorAll('input,textarea,select,[contenteditable]')]
            .filter(el => visible(el) && (el.matches('input,textarea,select') || el.isContentEditable) && !group.contains(el) && !foreignControl(el));
        if (foreignEditable.length) return { kind: 'unsupported', reason: 'choice slide has editable controls outside the choice component; answering would submit them blank' };
        if (!Array.isArray(comp.Options)) return { kind: 'unsupported', reason: 'choice option metadata is missing or unreadable; no answer was selected' };
        // EP's public renderer compares Correct.toLowerCase() with 'true'.
        // Source: main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
        // Preserve boolean support, but never coerce numbers or other values.
        let correct = comp.Options
            .filter(o => o && (o.Correct === true
                || (typeof o.Correct === 'string' && o.Correct.toLowerCase() === 'true')))
            .map(o => typeof o.TextTemplate === 'string' ? stripMarkup(o.TextTemplate) : '');
        // Never reduce a partially unreadable answer set to a plausible subset.
        // Raw formula templates enter the guarded path before math DOM is ready.
        const hasMath = comp.Options.some(o => typeof o?.TextTemplate === 'string' && o.TextTemplate.includes('`'))
            || !!group.querySelector('.katex, math, .inline-formula');
        const hasPlainBlock = !hasMath && comp.Options.some(o => typeof o?.TextTemplate === 'string' && o.TextTemplate.includes('[block'));
        const association = {};
        const mathRows = hasMath || hasPlainBlock ? readMathChoiceInPage(group, q, comp, hasPlainBlock, association) : null;
        const optionCount = Array.isArray(comp.Options) ? comp.Options.length : null;
        if (hasPlainBlock && !mathRows) return { kind: 'unsupported', reason: 'plain block choices lack a complete current renderer association; stopping instead of stripping or guessing', diagnostic: { renderer: 'plain-block', ...association, options: optionCount } };
        if (hasMath && !mathRows) return { kind: 'unsupported', reason: 'formula choices lack a unique current renderer-to-option association; stopping instead of guessing', diagnostic: { renderer: 'formula', ...association, options: optionCount } };
        if (mathRows) correct = mathRows.filter(r => r.correct).map(r => r.text);
        if (correct.includes('')) return { kind: 'unsupported', reason: 'a correct-marked choice option has no usable text; stopping with incomplete answer metadata' };
        const options = mathRows ? mathRows.map(r => ({ text: r.text, visible: true })) : Array.from(group.querySelectorAll('div.mcq-preview-option')).map(el => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.shortcut-key').forEach(k => k.remove());
            return { text: stripMarkup(clone.textContent), visible: visible(el) };
        });
        // A round key needs a stable identity: without both fields the caller
        // cannot tell one slide from the next and must not answer.
        if (!validIdentity(q)) {
            return { kind: 'unsupported', reason: 'choice question without a stable identity (contentID/questionIndex missing from EP\'s question state)' };
        }
        return {
            kind: 'choice',
            ...(mathRows ? { representation: 'renderer-template', ...(hasPlainBlock ? { plainBlock: true } : {}), associationSignature: mathRows.signature } : {}),
            key: `choice:${q.contentID}:${q.questionIndex}`,
            options,
            correct,
            multi: comp.AllowMultiSelect !== false && comp.AllowMultiSelect !== 'false',
            autoMarked: autoMarkingOf(self),
            // Under the orchestrator's mix flag this surface contributes its
            // definition's Marked flag so the orchestrator can require uniform
            // marking across every surface, matching the other contracts.
            ...(foreignTypes.length || siblingChoice ? { markings: [comp.Marked] } : {}),
        };
    }

    // No choice component: round transition or another question shape.
    return null;
}

// The single-choice radiogroup's selected option, as normalized rendered
// text, or null when no unique selection is present. Self-contained for
// page.evaluate. The slide orchestrator binds this right after its trusted
// selection click and re-proves it at Submit click time, so a selection
// tampered between fill and Submit stops the round before the click.
function readSelectedChoiceInPage() {
    const visible = (el) => !!(el && (el.offsetParent !== null
        || (el.getClientRects && el.getClientRects().length > 0)));
    const groups = [...document.querySelectorAll('div.multi-choice-component[role=radiogroup]')].filter(visible);
    if (groups.length !== 1) return null;
    const selected = [...groups[0].querySelectorAll('div.mcq-preview-option')]
        .filter(o => o.querySelector('input')?.checked || o.getAttribute('aria-selected') === 'true' || o.getAttribute('aria-checked') === 'true');
    if (selected.length !== 1) return null;
    const clone = selected[0].cloneNode(true);
    clone.querySelectorAll('.shortcut-key').forEach(k => k.remove());
    const text = (clone.textContent || '')
        .replace(/@@[0-9A-Fa-f]{6}@/g, '').replace(/@@/g, '')
        .replace(/\[(?=([^\]]*\]))\1/g, '').replace(/\s+/g, ' ').trim();
    return text || null;
}

module.exports = { readChoiceInPage, readSelectedChoiceInPage };
