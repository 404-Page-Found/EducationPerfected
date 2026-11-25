const {readDropdownsInPage}=require('./dropdown-state');
const {observeDropdownInput}=require('./dropdown-input-trace');
const {BUILD,collectDropdownDiagnostics}=require('./dropdown-diagnostics');
// One process attempt, one question, at most one Submit. Never an answer loop.
function createSubmitDropdownOnce({detectQuestion,playDropdownRound,inputMode='legacy'}){
    const dropdownInputMode=inputMode==='f4-popup'?'f4-popup':'legacy';
    let consumed=false;
    return async function submitDropdownOnce(page,{shouldStop=()=>false}={}){
        if(consumed)return{status:'refused',reason:'attempt-consumed'};
        consumed=true;let baseline,final,button,trace,verified=false;
        try{
            if(shouldStop())return{status:'aborted'};
            const d=await detectQuestion(page);
            if(d?.kind!=='dropdown'||d.autoMarked!==true||!d.dropdowns?.length||d.dropdowns.some(x=>x.filled))return{status:'refused',reason:'requires-supported-empty-dropdowns',diagnostics:await collectDropdownDiagnostics(page,{shouldStop}).catch(()=>({build:BUILD,error:'inspection-unavailable'}))};
            baseline=await page.evaluateHandle(readDropdownsInPage,undefined,undefined,true);
            const preflightGuard=await baseline.evaluate((r,d)=>JSON.stringify(r?.descriptor)===JSON.stringify(d)?null:r?.guard||'descriptor-mismatch',d);
            if(preflightGuard)return{status:'refused',reason:'changed-before-selection',selectionDiagnostic:{phase:'preflight',dropdownIndex:null,keyDispatchesReturned:0,guard:preflightGuard}};
            if(shouldStop())return{status:'aborted'};
            trace=await page.evaluateHandle(observeDropdownInput,baseline,{popup:dropdownInputMode==='f4-popup'});
            const selectionFailure=await runVerifiedSelection(page,d,{playDropdownRound,baseline,trace,inputMode:dropdownInputMode,shouldStop,setVerified:value=>{verified=value;}});
            if(selectionFailure)return selectionFailure;
            if(shouldStop())return{status:'aborted'};
            final=await page.evaluateHandle(readDropdownsInPage,baseline,'submit');
            const verifiedTarget=await verifyDropdownSubmitTarget(final,baseline,page);
            button=verifiedTarget.button;
            if(verifiedTarget.reason)return{status:'stopped',reason:verifiedTarget.reason};
            if(shouldStop())return{status:'aborted'};
            await page.mouse.click(verifiedTarget.point.x,verifiedTarget.point.y);
            return{status:'submitted-once'}; // Dispatch only, not acceptance or points.
        }catch{return{status:'stopped',reason:'inspection-or-dispatch-uncertain'};}
        finally{if(trace){await trace.evaluate(observer=>observer.close()).catch(()=>{});await trace.dispose().catch(()=>{});}for(const handle of [button,final,baseline])if(handle)await handle.dispose().catch(()=>{});}
    };
}
// Plays the fill-only round and demands an explicit verification. Returns a
// refusal/stop result on failure, null once selection is verified complete.
async function runVerifiedSelection(page,d,{playDropdownRound,baseline,trace,inputMode,shouldStop,setVerified}){
    let verified=false;
    const markVerified=()=>{verified=true;setVerified(true);};
    const browserVersion=await page.browser().version().catch(()=> 'unavailable');
    const version=/^(?:Chrome|HeadlessChrome)\/\d+(?:\.\d+){0,3}$/.test(browserVersion)?browserVersion:'unavailable';
    const selected=await playDropdownRound(page,d,{baseline,enter:false,timeout:0,shouldStop:()=>verified||shouldStop(),onVerified:markVerified,inputMode,inputTrace:trace});
    if(!verified||selected?.status!=='aborted')return{status:selected?.status==='aborted'?'aborted':'stopped',reason:'selection-not-verified-may-be-partial',inputDiagnostic:{browserVersion:version,...await trace.evaluate(observer=>observer.snapshot()).catch(()=>({error:'trace-unavailable'}))},...(selected?.selectionDiagnostic?{selectionDiagnostic:selected.selectionDiagnostic}:{})};
    return null;
}

// Re-proves the descriptor and the exact Submit element around the click
// point. Returns {reason} on mismatch, else {button, point}.
async function verifyDropdownSubmitTarget(final,baseline,page){
    if(!await final.evaluate(r=>r?.descriptor?.kind==='dropdown'&&r.descriptor.autoMarked===true&&r.descriptor.dropdowns.every(d=>d.selectedIndex===d.index)&&!!r.target))return{reason:'changed-before-submit'};
    const button=await final.getProperty('target');const element=button.asElement();if(!element)return{reason:'missing-submit',button};
    await element.scrollIntoView();const point=await element.clickablePoint();
    const last=await page.evaluateHandle(readDropdownsInPage,baseline,'submit');
    try{if(!await last.evaluate((r,el)=>r?.descriptor?.kind==='dropdown'&&r.target===el,element))return{reason:'changed-before-submit',button};}finally{await last.dispose();}
    if(!await element.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return hit===el||el.contains(hit);},point))return{reason:'submit-covered',button};
    return{button,point};
}
module.exports={createSubmitDropdownOnce};
