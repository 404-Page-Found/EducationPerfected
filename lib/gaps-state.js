// Read existing cached state only. Source: EP public chunk606, 4 November 2026.
// FillInTheGapsComponentState, FillInTheGapsDragDropRenderer, InlineDropzoneComponent.
// https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
// No renderer factories, marking methods, setters or internal interaction calls.
// allowMix is set only by the slide orchestrator: an array of other verified
// component type codes on the same slide (never this reader's own) admits
// those answer-bearing companions and their component-registry entries, each
// verified by its own contract. The default keeps the single-surface refusals.
function readGapsInPage(baseline, action, allowMix = false) {
    const foreignTypes = Array.isArray(allowMix) ? allowMix.filter(t => t !== 'FILL_IN_GAPS_COMPONENT') : [];
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const refuse = (reason,diagnostic) => ({ descriptor: { kind: 'unsupported', reason: 'Drag-and-drop gaps: ' + reason,...(diagnostic?{diagnostic:{kind:'gaps-refusal',...diagnostic}}:{}) } });
    const groups = [...document.querySelectorAll('.fitg-component')].filter(shown);
    if (!groups.length) return null;
    if (groups.length !== 1 || !groups[0].classList.contains('fitg-drag-drop')) return refuse('only one explicit drag-and-drop component is supported; textboxes are excluded');
    const group = groups[0];
    const modelOf = el => {
        for (let n = el, depth = 0; n && depth < 8; n = n.parentElement, depth++) {
            const a = window.angular?.element(n);
            for (const scope of a ? [a.isolateScope?.(), a.scope?.()] : []) {
                if (scope?.self?.model?._currentQuestion) return scope.self;
            }
        }
        return null;
    };
    const self = modelOf(group), model = self?.model, q = model?._currentQuestion;
    if (model?.gameMode === 2) return { descriptor: { kind: 'unsupported', assessment: true, reason: 'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled' } };
    if (model && model.gameMode !== 3) return refuse(`requires confirmed Smart Lesson practice mode; unknown modes (gameMode ${Number.isSafeInteger(model.gameMode) ? model.gameMode : 'unreadable'}) are not supported`);
    if (!q || !Number.isSafeInteger(q.contentID) || q.contentID <= 0
        || !Number.isSafeInteger(q.questionIndex) || q.questionIndex < 0) return refuse('missing current lesson identity');
    const defs = q.questionDef?.Components;
    // Lesson slides often pair one gaps question with static presentation.
    // Source-proven presentation-only companions (chunk606, checked
    // 19 November 2026): the factory maps SOUND_COMPONENT to SoundComponent
    // (isInput false; outputForMarking is a constant {score 1, max 1, weight 0}
    // payload independent of any response) and ANNOTATED_TEXT_COMPONENT to
    // AnnotatedTextComponent (isInput false, marked NOT_MARKED, output 0/0/0).
    // Neither accepts a response, so neither can be submitted blank. Every
    // other companion refuses, including malformed entries; recognized EP
    // type codes are named, anything unlisted is redacted.
    const PRESENTATION_COMPONENTS = new Set(['ANNOTATED_TEXT_COMPONENT', 'SOUND_COMPONENT']);
    // A scratch pad companion is grading-neutral unless marked under EP's own
    // loose check (marked == MARKED): anything else emits a constant 0/0/0
    // marking payload. chunk606, 19 November 2026.
    const unmarkedScratchPad = (c) => {
        const e = c?.ComponentTypeCode === 'SCRATCH_PAD_COMPONENT' ? q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[c.ComponentID] : null;
        return Array.isArray(e) && e.length === 1 && e[0]?.id === c.ComponentID && e[0].type === 'scratch-pad' && !(e[0].marked == 1);
    };
    const KNOWN_COMPONENT_CODES = new Set(('ANNOTATED_QUESTION ANNOTATED_TEXT DEPTH DROPDOWN FILE_UPLOADER FILL_IN_GAPS'
        + ' FORMULA FREEFORM_WORKING HIGHLIGHT LONG_ANSWER MULTICHOICE NUMBER_BOX SCRATCH_PAD SOUND SOUND_RECORDER'
        + ' TEXT_BOX TYPE_ARROW TYPE_EQUALS TYPE_EXPONENT TYPE_GROUP TYPE_MATH_ENTITY TYPE_MATH_FUNCTION'
        + ' TYPE_MULTI_OPERATOR TYPE_NUMBER TYPE_OR TYPE_SUBSCRIPT_SUPERSCRIPT TYPE_TEXT TYPE_UNARY_OPERATOR'
        + ' WORKING_FORMULA').split(' ').map(c => c + '_COMPONENT'));
    if (!Array.isArray(defs) || !defs.length) return refuse('missing question components');
    const gapsDefs = defs.filter(c => c?.ComponentTypeCode === 'FILL_IN_GAPS_COMPONENT');
    if (gapsDefs.length !== 1) return refuse('missing or duplicate drag-and-drop component');
    const extraIndex = defs.findIndex(c => c !== gapsDefs[0] && !PRESENTATION_COMPONENTS.has(c?.ComponentTypeCode) && !unmarkedScratchPad(c) && !foreignTypes.includes(c?.ComponentTypeCode));
    if (extraIndex !== -1) {
        const code = defs[extraIndex]?.ComponentTypeCode;
        return refuse('unsupported accompanying component: ' + (KNOWN_COMPONENT_CODES.has(code) ? code : 'redacted type'));
    }
    const comp = gapsDefs[0], id = comp.ComponentID;
    if (typeof id !== 'string' || !id || comp.InputType !== 2) return refuse('explicit drag-and-drop metadata required');
    const cached = q.cachedRenderers?.[1]?.identifiedComponents?.baseComponents?.[id];
    if (!Array.isArray(cached) || cached.length !== 1) return refuse('missing or ambiguous cached component');
    const component = cached[0], state = component?.componentState, metadata = state?.metadataInstance;
    const renderer = component?.questionRenderer;
    if (component?.id !== id || component.visualElement !== group || renderer?.container !== group || renderer.id !== id
        || renderer.componentState !== state || renderer.renderingParameters?.mode !== 1 || component.renderingParameters?.mode !== 1 || metadata?.ComponentID !== id || metadata.InputType !== 2) return refuse('renderer identity mismatch');
    const unsafeText = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>`[\]@]/;
    const plain = (s, allowOuterWhitespace = false) => typeof s === 'string' && s.length > 0 && s.length <= 4096
        && (allowOuterWhitespace ? s.trim().length > 0 : s === s.trim())
        && !unsafeText.test(s);
    const gaps = metadata.Gaps, indexes = state.gapIndexesShown, hints = state.hintsShown;
    if (!Array.isArray(gaps) || !gaps.length || gaps.length > 100 || !Array.isArray(comp.Gaps) || comp.Gaps.length !== gaps.length
        || !gaps.every(g => Number.isSafeInteger(g?.ID) && g.ID >= 0 && g.ID <= 99 && Array.isArray(g.CorrectOptions) && g.CorrectOptions.length > 0 && g.CorrectOptions.every(s => plain(s)))
        || new Set(gaps.map(g => g.ID)).size !== gaps.length
        || !Array.isArray(indexes) || !indexes.length || indexes.length > 100 || new Set(indexes).size !== indexes.length
        || indexes.some(i => !Number.isSafeInteger(i) || !gaps[i] || state.gapIDtoIndex?.[gaps[i].ID] !== i)
        // EP copies hints directly to textContent. Allow padding without changing raw identity or answer matching.
        // Exact duplicate labels are valid EP tiles; padded look-alikes remain unsupported.
        || !Array.isArray(hints) || !hints.length || hints.length > 200 || !hints.every(s => plain(s, true))
        || hints.some((s, i) => hints.some((t, j) => j < i && s !== t && s.trim() === t.trim()))) return refuse('incomplete, duplicate or non-text resolved metadata');
    const sources = [...group.querySelectorAll('.fitg-drag-list .draggable')];
    const drags = renderer.draggables, zones = renderer.dropZones, base = state.identifiedComponents?.baseComponents;
    const spans = [...group.querySelectorAll('.fitg-inline-dropzone .dropzone-answer')];
    // EP advanced-renders static question text separately from raw-text answer controls.
    // Only one direct template is trusted; maths in or around controls stays unsupported.
    const templates = [...group.querySelectorAll('.fitg-drop-content')];
    const staticMath = [...group.querySelectorAll('math,.katex')];
    const controls = '.fitg-drag-list,.draggable,.fitg-inline-dropzone,.dropzone-answer,input,textarea,select';
    if (staticMath.some(el => templates.length !== 1 || templates[0].parentElement !== group || !templates[0].contains(el)
        || el.closest(controls) || el.querySelector(controls))) return refuse('math outside static question template');
    // EP renders static question images (diagrams) inside the same single trusted template
    // via ImageComponent (chunk606: isInput false). Images in or around answer controls are
    // image-variant drag options and stay unsupported.
    const images = [...group.querySelectorAll('img')];
    if (images.some(el => templates.length !== 1 || templates[0].parentElement !== group || !templates[0].contains(el)
        || el.closest(controls))) return refuse('image outside static question template');
    if (sources.length !== hints.length) return refuse('source option count mismatch');
    if (!Array.isArray(drags) || drags.length !== hints.length) return refuse('draggable instance count mismatch');
    if (!Array.isArray(zones) || zones.length !== indexes.length) return refuse('drop zone count mismatch');
    if (spans.length !== indexes.length) return refuse('drop zone span count mismatch');
    // Registered non-input components (static images) sit beside the gaps in baseComponents;
    // each shown gap must own exactly one entry and every entry under any other key must be
    // non-input, even when it aliases a known drop zone object.
    const gapKeys = new Set(indexes.map(i => String(gaps[i].ID)));
    // The orchestrator's mix admits the companion surfaces' own registry
    // entries (each verified by its own reader), and a verified unmarked
    // scratch pad's entry is its own admission proof; every other key must
    // still be non-input.
    const foreignIds = new Set(foreignTypes.length ? defs.filter(d => foreignTypes.includes(d?.ComponentTypeCode)).map(d => d?.ComponentID) : []);
    const padIds = new Set(defs.filter(unmarkedScratchPad).map(d => d.ComponentID));
    if (!base || [...gapKeys].some(k => !Array.isArray(base[k]) || base[k].length !== 1)
        || Object.entries(base).some(([k, list]) => !gapKeys.has(k) && !foreignIds.has(k) && !padIds.has(k) && (!Array.isArray(list) || list.some(c => c?.isInput !== false)))) return refuse('component registry mismatch');
    if ([...group.querySelectorAll('input,textarea,select')].length) return refuse('editable control in question');
    if (Object.values(state.usersAnswers || {}).some(v => v !== '')) return refuse('stored prefilled answers are unsupported');
    const sourceRows = sources.map((el, i) => ({ el, drag: drags[i], text: el.textContent, used: el.classList.contains('used'), index: i }));
    if (sourceRows.some((r, i) => !shown(r.el) || r.text !== hints[i] || r.drag?.target !== r.el
        || r.el.getAttribute('data-draggable-index') !== String(i) || r.el.classList.contains('dragging') || r.el.classList.contains('ghost'))) return refuse('source option identity mismatch');
    // EP checks each dropped label against that gap's CorrectOptions. Multiple
    // exact alternatives are valid, not uncertainty about correctness. Allocate
    // distinct tiles across all gaps, avoiding greedy starvation. Recompute the
    // same deterministic matching across the filled prefix; never replay input.
    const candidates=spans.map(span=>{
        const gap=gaps.find(g=>String(g.ID)===span.id);
        return gap?sourceRows.filter(r=>gap.CorrectOptions.includes(r.text)):[];
    });
    const missing=candidates.findIndex(list=>!list.length);
    if(missing!==-1)return refuse('gap has no exact displayed correct answer label',{guard:'correct-label-missing',gapIndex:missing,gapCount:spans.length,sourceCount:sourceRows.length,correctOptionCount:gaps.find(g=>String(g.ID)===spans[missing].id)?.CorrectOptions.length||0,exactCandidateCount:0});
    const owner=new Map(),assignment=new Map();
    const match=(gapIndex,seen)=>{
        for(const source of candidates[gapIndex]){
            if(seen.has(source.index))continue;
            seen.add(source.index);
            const previous=owner.get(source.index);
            if(previous===undefined||match(previous,seen)){
                owner.set(source.index,gapIndex);assignment.set(gapIndex,source);return true;
            }
        }
        return false;
    };
    // Reverse admission preserves the existing first-DOM-copy allocation for
    // identical labels while still moving flexible gaps to exact alternatives.
    for(let i=spans.length-1;i>=0;i--){
        if(!match(i,new Set()))return refuse('not enough distinct source copies for correct answer labels',{guard:'correct-label-allocation',gapIndex:i,gapCount:spans.length,sourceCount:sourceRows.length,exactCandidateCount:candidates[i].length});
    }
    const rows = [];
    for (const span of spans) {
        const gap = gaps.find(g => String(g.ID) === span.id), gapIndex = gap ? gaps.indexOf(gap) : -1;
        const entries = gap && base[String(gap.ID)], zone = Array.isArray(entries) && entries.length === 1 ? entries[0] : null;
        const wrapper = span.parentElement;
        if (!gap || !indexes.includes(gapIndex) || !zone || !zones.includes(zone) || zone.id !== String(gap.ID)
            || zone.span !== span || zone.containerSpan !== wrapper || !wrapper.classList.contains('fitg-inline-dropzone')
            || wrapper.id !== id + '_input_' + gap.ID || !shown(span) || !shown(wrapper)) return refuse('gap ID/DOM association mismatch');
        const source = assignment.get(rows.length);
        const rawText = span.textContent;
        const text = rawText.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
        const empty = text === '';
        // Empty EP placeholders may contain known zero-width filler. Filled answers must be raw-exact.
        if (empty ? unsafeText.test(rawText.replace(/[\u200b-\u200d\ufeff]/g, ''))
            : !plain(rawText) || rawText !== source.text) return refuse('unsafe or non-exact gap text');
        if (empty ? (zone.droppedDragID !== null || wrapper.classList.contains('filled') || !wrapper.classList.contains('empty'))
            : (text !== source.text || zone.droppedDragID !== source.index || !wrapper.classList.contains('filled') || wrapper.classList.contains('empty'))) return refuse('gap text or selected state disagrees');
        rows.push({ gap, zone, span, wrapper, source, text });
    }
    if (renderer.displayOrderDropZones && (renderer.displayOrderDropZones.length !== rows.length || renderer.displayOrderDropZones.some((z, i) => z !== rows[i].zone))) return refuse('cached keyboard gap order disagrees with DOM');
    if (new Set(rows.map(r => r.gap.ID)).size !== rows.length || new Set(rows.map(r => r.source.index)).size !== rows.length) return refuse('reused gap or source option');
    // Keyboard Enter fills the first empty DOM-ordered gap. Only a verified prefix is valid.
    let emptySeen = false;
    for (const row of rows) {
        if (!row.text) emptySeen = true;
        else if (emptySeen) return refuse('non-prefix gap selection');
    }
    if (sourceRows.some(s => s.used !== rows.some(r => r.text && r.source === s))) return refuse('used sources disagree with filled gaps');
    if (typeof metadata.TextTemplate !== 'string' || metadata.TextTemplate.length > 32768) return refuse('missing or oversized resolved template');
    const tokens = [...metadata.TextTemplate.matchAll(/\[(\d{1,2}):[^\]]*\]/g)].map(m => Number(m[1]));
    const displayedIDs = tokens.filter(id => indexes.includes(state.gapIDtoIndex[id]));
    if (tokens.length !== gaps.length || new Set(tokens).size !== tokens.length || tokens.some(id => !gaps.some(g => g.ID === id))
        || displayedIDs.length !== rows.length || rows.some((r, i) => r.gap.ID !== displayedIDs[i])) return refuse('resolved template and displayed gap order disagree');
    const signature = JSON.stringify([comp, metadata, indexes, hints, state.checkOptions, state.usersAnswers]);
    const key = 'gaps:' + q.contentID + ':' + q.questionIndex;
    // Under the orchestrator's mix flag this surface contributes its
    // definition's Marked flag so the orchestrator can require uniform
    // marking across every surface, matching the box/dropdown contracts.
    if (foreignTypes.length && comp.Marked !== 0 && comp.Marked !== 1) return refuse('unexpected component marking');
    const descriptor = { kind: 'gaps', key, representation: 'gaps-renderer', signature,
        autoMarked: self.sectionData?.activityGroup?.isAutoMarked === true,
        gaps: rows.map(r => ({ id: r.gap.ID, answer: r.source.text, source: r.source.index, filled: !!r.text })),
        ...(foreignTypes.length ? { markings: [comp.Marked] } : {}) };
    if (baseline && (baseline.q !== q || baseline.comp !== comp || baseline.model !== model || baseline.component !== component
        || baseline.state !== state || baseline.metadata !== metadata || baseline.renderer !== renderer || baseline.group !== group
        || baseline.sources.length !== sourceRows.length || sourceRows.some((s, i) => s.el !== baseline.sources[i].el || s.drag !== baseline.sources[i].drag)
        || baseline.descriptor.signature !== signature || baseline.descriptor.key !== key
        || rows.some((r, i) => { const b = baseline.rows[i]; return !b || b.gap !== r.gap || b.zone !== r.zone || b.span !== r.span || b.wrapper !== r.wrapper || b.source.el !== r.source.el || b.source.drag !== r.source.drag; }))) return refuse('question or renderer changed');
    const result = { descriptor, q, comp, model, component, state, metadata, renderer, group, rows, sources: sourceRows };
    if (Number.isSafeInteger(action)) {
        if (descriptor.autoMarked !== true || action < 0 || !rows[action] || rows.findIndex(r => !r.text) !== action) return refuse('next empty gap changed');
        result.target = rows[action].source.el;
    } else if (action === 'verify' || action === 'submit') {
        if (descriptor.autoMarked !== true || rows.some(r => !r.text)) return refuse('exact answer set is incomplete');
        if (action === 'submit') {
            const bars = [...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(b => modelOf(b)?.model === model);
            if (bars.length !== 1) return refuse('unassociated navigation controls');
            const buttons = [...bars[0].querySelectorAll('button')].filter(b => shown(b) && !b.disabled && b.textContent.trim() === 'Submit');
            if (buttons.length > 1) return refuse('ambiguous Submit');
            if (!buttons.length) return { ...result, readiness: 'not-ready' };
            result.target = buttons[0];
        }
    }
    return action === 'descriptor' ? { descriptor } : result;
}
module.exports = { readGapsInPage };
