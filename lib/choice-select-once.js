// One consumed process attempt. Caller owns approval and exclusive stopped controls.
// No Submit, Next, keyboard, retry, navigation or answering-loop path.
function readChoiceSelectionInPage(key) {
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    if ([...document.querySelectorAll('div[uib-modal-window=modal-window]')].some(shown)) return null;
    const groups = [...document.querySelectorAll('div.multi-choice-component[role=radiogroup]')].filter(shown);
    if (groups.length !== 1) return null;
    const group = groups[0];
    const q=lookupQuestion(group);
    if (!q) return null;
    const shape=readStructure(q, group);
    if (!shape) return null;
    const state=shape.state,previews=shape.previews;
    // EP leaves the selectedOptions backing field undefined on an untouched
    // question. Do not write an empty array into EP: accept this initial shape
    // only when every associated preview independently proves it is unselected.
    const uninitialized=state.selectedOptions===undefined;
    const original=state.originalMultiChoiceOptions, ids=uninitialized?[]:state.selectedOptions;
    if(!validOptionIds(original, ids)) return null;
    const rows=readRows(previews);
    if(!rows) return null;
    if(uninitialized && rows.some(r=>r.selected!==false || r.checked!==false || (r.aria!==null && r.aria!=='false'))) return null;
    if(ids.some(id=>!rows.some(r=>r.id===id && r.selected))) return null;
    return {rows,selectedCount:ids.length};
    function lookupSelf(host) {
        for (let n=host,depth=0;n && depth<8;n=n.parentElement,depth++) {
            const scope=window.angular?.element(n)?.scope?.();
            if (scope?.self?.model?._currentQuestion) return scope.self;
        }
        return undefined;
    }
    function lookupQuestion(host) {
        const self=lookupSelf(host);
        const q=self?.model?._currentQuestion;
        if (self?.model?.gameMode!==3 || self.sectionData?.activityGroup?.isAutoMarked!==true
            || !q || `choice:${q.contentID}:${q.questionIndex}`!==key) return null;
        return q;
    }
    function readStructure(question, host) {
        const own=(o,k)=>{const p=o && Object.getOwnPropertyDescriptor(o,k);return p && Object.hasOwn(p,'value')?p.value:undefined;};
        const defs=question.questionDef?.Components?.filter(c=>c?.ComponentTypeCode==='MULTICHOICE_COMPONENT');
        if (defs?.length!==1 || ![false,'false'].includes(defs[0].AllowMultiSelect)) return null;
        const renderer=own(own(question,'cachedRenderers'),'1');
        const index=own(renderer,'identifiedComponents') || own(own(renderer,'parser'),'identifiedComponents');
        const entries=own(index,'baseComponents')?.[defs[0].ComponentID];
        if (!Array.isArray(entries) || entries.length!==1) return null;
        const c=entries[0],state=c?.componentState,previews=state?.previewOptions;
        if (c?.visualElement!==host || !Array.isArray(previews) || !previews.length || previews.length>100) return null;
        return {state,previews};
    }
    function validOptionIds(original, ids) {
        return Array.isArray(ids) && ids.length<=100
            && Array.isArray(original) && original.length>0 && original.length<=100
            && new Set(original).size===original.length && new Set(ids).size===ids.length
            && !ids.some(id=>!Number.isSafeInteger(id) || id<0 || id>=original.length);
    }
    function readRows(previewList) {
        const out=[];
        for(const p of previewList) {
            const check=p?.fields?.check;
            if(!p.element || !group.contains(p.element) || !check || !p.element.contains(check)
                || typeof p.isSelected!=='boolean' || typeof check.checked!=='boolean') return null;
            const id=original.indexOf(p.option);
            if(id<0 || original.filter(o=>o?.TextTemplate===p.option?.TextTemplate).length!==1
                || ids.includes(id)!==p.isSelected) return null;
            out.push({template:p.option?.TextTemplate,id,selected:p.isSelected,checked:check.checked,aria:p.element.getAttribute('aria-selected')});
        }
        return out;
    }
}
const empty=s=>s && s.selectedCount===0 && s.rows.every(r=>r.selected===false && r.checked===false && (r.aria===null || r.aria==='false'));
const supportedChoice=d=>d?.kind==='choice' && d.multi===false && d.autoMarked===true && d.representation==='renderer-template'
    && d.plainBlock===true && d.correct?.length===1;
const sameChoice=(fresh,d)=>fresh?.key===d.key && fresh?.associationSignature===d.associationSignature && fresh?.autoMarked===true
    && fresh?.multi===false && fresh?.plainBlock===true && fresh?.representation==='renderer-template'
    && JSON.stringify(fresh.correct)===JSON.stringify(d.correct);
const visibleCorrect=(s,d)=>Boolean(s?.visible) && s.text===d.correct[0];
const onlyCorrectSelected=(after,selected,d)=>after.selectedCount===1 && selected.length===1 && selected[0].template===d.correct[0]
    && selected[0].selected===true && selected[0].checked===true && selected[0].aria==='true';
function createSelectChoiceOnce({detectQuestion,detectQuestionInPage,readSelection=readChoiceSelectionInPage}) {
    let attempted=false;
    return async function selectChoiceOnce(page,{shouldStop=()=>false}={}) {
        if(attempted) return {status:'refused',reason:'attempt-consumed'};
        attempted=true; let invoked=false;
        const handles=[];
        try {
            if(shouldStop()) return {status:'aborted'};
            const d=await detectQuestion(page);
            if(!supportedChoice(d)) return {status:'refused',reason:'requires-supported-single-block-choice'};
            if(!empty(await page.evaluate(readSelection,d.key))) return {status:'refused',reason:'not-confirmed-empty'};
            const fresh=await detectQuestion(page);
            if(!sameChoice(fresh,d)) return {status:'refused',reason:'changed'};
            handles.push(...await page.$$('div.multi-choice-component[role=radiogroup] div.mcq-preview-option'));
            const matches=[];
            for(const h of handles) {
                const s=await h.evaluate(detectQuestionInPage,d);
                if(visibleCorrect(s,d)) matches.push(h);
            }
            if(matches.length!==1) return {status:'refused',reason:'not-one-exact-match'};
            const last=await matches[0].evaluate(detectQuestionInPage,d);
            if(!visibleCorrect(last,d) || !empty(await page.evaluate(readSelection,d.key))) return {status:'refused',reason:'changed-before-click'};
            if(shouldStop()) return {status:'aborted'};
            await matches[0].scrollIntoView();
            const point=await matches[0].clickablePoint();
            const final=await matches[0].evaluate(detectQuestionInPage,d);
            if(!visibleCorrect(final,d) || !empty(await page.evaluate(readSelection,d.key))) return {status:'refused',reason:'changed-after-scroll'};
            if(!await matches[0].evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return hit===el || el.contains(hit);},point)) return {status:'refused',reason:'obstructed'};
            if(shouldStop()) return {status:'aborted'};
            invoked=true;
            await page.mouse.click(point.x,point.y,{clickCount:1});
            // Read once, never retry or interact with an advanced question.
            const after=await page.evaluate(readSelection,d.key);
            if(!after) return {status:'selection-unconfirmed',reason:'question-or-state-changed'};
            const selected=after.rows.filter(r=>r.selected || r.checked || r.aria==='true');
            if(onlyCorrectSelected(after,selected,d)) return {status:'selected-only'};
            return {status:'selection-unconfirmed',reason:'selection-not-verified'};
        } catch {return {status:invoked?'selection-unconfirmed':'stopped',reason:invoked?'click-outcome-uncertain':'inspection-failed'};}
        finally {for(const h of handles)await h.dispose().catch(()=>{});}
    };
}
module.exports={createSelectChoiceOnce,readChoiceSelectionInPage};
