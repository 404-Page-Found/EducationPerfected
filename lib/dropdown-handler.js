const {readDropdownsInPage}=require('./dropdown-state');
const {observeDropdownInput}=require('./dropdown-input-trace');
const {waitForDropdownSubmit}=require('./dropdown-submit-readiness');
const {clickVerifiedSubmit}=require('./submit-click');
const {watchQuestionTransition}=require('./transition-watch');
async function playDropdownRound(page,descriptor,opts){
    const stop=opts.shouldStop||(()=>false);
    // Set only by the mixed-slide handler: every internal re-read then
    // allows the verified companion surfaces alongside.
    const mix=opts.mixedSurfaces??(opts.mixedNumberBox===true);
    const inputMode=opts.inputMode==='f4-popup'?'f4-popup':'legacy';
    let phase='initial',dropdownIndex=null,keyDispatchesReturned=0,guard='descriptor-mismatch',nativeState,submitState,focusEmulation=null;
    const selectionDiagnostic=()=>({phase,dropdownIndex,keyDispatchesReturned,guard,...(nativeState?{nativeState}:{}),...(submitState?{submitState}:{})});
    const refused=()=>({status:'stopped',reason:'unsafe-or-changed-state',message:'Lesson dropdowns stopped: changed or unsupported state; no retry.',selectionDiagnostic:selectionDiagnostic()});
    let baseline,trace=opts.inputTrace,ownsTrace=false;const handles=[];
    try{
        if(descriptor.kind!=='dropdown'||!(descriptor.autoMarked===true&&descriptor.selfMarked!==true||descriptor.autoMarked===false&&descriptor.selfMarked===true)||descriptor.dropdowns.some(d=>d.filled))return refused();
        // Bind one-shot input to the caller's pre-input identities when supplied.
        phase='baseline';
        baseline=await page.evaluateHandle(readDropdownsInPage,opts.baseline,undefined,true,mix);
        const baselineFailure=await baseline.evaluate((r,d)=>JSON.stringify(r?.descriptor)===JSON.stringify(d)?null:r?.guard||'descriptor-mismatch',descriptor);
        if(baselineFailure){guard=baselineFailure;return refused();}
        const expected=descriptor.dropdowns.map(d=>d.selectedIndex);
        const check=async(index,focus,previous)=>{
            const state=await page.evaluateHandle(readDropdownsInPage,baseline,index,true,mix);
            try{
                const failure=await state.evaluate((r,values,active,before)=>{
                    if(r?.descriptor?.kind!=='dropdown')return r?.guard||'unsupported-state';
                    const nativeState={actual:r.descriptor.dropdowns.map(d=>d.selectedIndex),expected:values,focusedDropdownIndex:r.rows.findIndex(row=>row.select===document.activeElement)};
                    if(active&&document.activeElement!==r.target)return {guard:'focus-mismatch',nativeState};
                    if(r.descriptor.dropdowns.every((d,i)=>d.selectedIndex===values[i]))return null;
                    if(before&&r.descriptor.dropdowns.every((d,i)=>d.selectedIndex===before[i]))return {guard:'key-state-pending',nativeState};
                    return {guard:'selected-index-mismatch',nativeState};
                },expected,focus,previous);
                if(failure){guard=typeof failure==='string'?failure:failure.guard;nativeState=typeof failure==='string'?undefined:failure.nativeState;return null;}
                nativeState=undefined;
                if(focus)return true;
                const handle=await state.getProperty('target');handles.push(handle);return handle.asElement();
            }finally{await state.dispose();}
        };
        // Read-only grace only for the exact valid pre-key state. No input retry.
        const settled=async(index,previous)=>{
            const deadline=Date.now()+200;
            const poll=async()=>{
                if(stop())return false;
                if(Date.now()>=deadline){guard='key-state-did-not-settle';return false;}
                const matched=await check(index,true,previous);
                if(stop())return false;
                if(Date.now()>=deadline){guard='key-state-did-not-settle';return false;}
                if(matched)return true;
                if(guard!=='key-state-pending')return false;
                await new Promise(resolve=>setTimeout(resolve,25));
                return poll();
            };
            return poll();
        };
        const popupState=async element=>await element.evaluate(el=>{
            try{return el.matches(':open');}catch{return null;}
        }).catch(()=>null);
        // Content-free trace facts for a popup-open refusal: whether this select's
        // F4 keydown was observed, whether it was canceled, whether any select read
        // open around it, and page focus/visibility. Small integers only.
        const popupTraceDiagnostics=async index=>{
            if(!trace)return undefined;
            const snapshot=await trace.evaluate(observer=>observer.snapshot()).catch(()=>null);
            if(!snapshot)return undefined;
            const f4=(snapshot.events||[]).filter(event=>event.targetIndex===index&&event.key===2);
            const anyOpen=state=>Array.isArray(state?.open)&&state.open.some(value=>value===true);
            return {popup:{
                f4Seen:f4.some(event=>event.type===0)?1:0,
                f4Prevented:f4.some(event=>event.defaultPreventedAtCapture===true||event.defaultPreventedAfterTask===true)?1:0,
                openSeen:(anyOpen(snapshot.initial)||anyOpen(snapshot.current)||f4.some(event=>anyOpen(event.atCapture)||anyOpen(event.afterTask)))?1:0,
                hasFocus:snapshot.current?.documentHasFocus===true?1:0,
                hidden:typeof snapshot.current?.visibility==='number'?snapshot.current.visibility:2,
                focusIndex:typeof snapshot.current?.focusedDropdownIndex==='number'?snapshot.current.focusedDropdownIndex+1:undefined,
            }};
        };
        const waitPopupState=async(element,open,limit=200)=>{
            const deadline=Date.now()+limit;
            while(Date.now()<deadline){
                if(stop())return 'aborted';
                const state=await popupState(element);
                if(state===open||state===null)return state;
                await new Promise(resolve=>setTimeout(resolve,25));
            }
            if(stop())return 'aborted';
            return popupState(element);
        };
        // Like waitPopupState(element,true) but re-resolves the select each poll
        // through the identity-checked read: a re-render can replace the node
        // between dispatch and the open check, and the stale node never reads open.
        // Returns the live open element, false on a closed window, null when :open
        // is unsupported, 'aborted' on stop and 'refused' when an identity check
        // fails (guard already set).
        const waitLivePopupOpen=async(index,limit)=>{
            const deadline=Date.now()+limit;
            while(Date.now()<deadline){
                if(stop())return 'aborted';
                const live=await check(index);
                if(!live)return 'refused';
                const state=await popupState(live);
                if(state===true)return live;
                if(state===null)return null;
                await new Promise(resolve=>setTimeout(resolve,25));
            }
            if(stop())return 'aborted';
            const live=await check(index);
            if(!live)return 'refused';
            const state=await popupState(live);
            return state===true?live:state===null?null:false;
        };
        const popupNavigationClean=async index=>{
            if(!trace){guard='popup-trace-required';return false;}
            const snapshot=await trace.evaluate(observer=>observer.snapshot()).catch(()=>null);
            if(!snapshot){guard='popup-trace-unavailable';return false;}
            if(snapshot.dropped>0){guard='popup-trace-capacity-exceeded';return false;}
            if(snapshot.events?.some(event=>event.targetIndex===index&&(event.type===2||event.type===3))){guard='popup-navigation-committed';return false;}
            return true;
        };
        // EP always takes focus itself before dispatching F4: an unfocused window or
        // app guest never receives the key even when its select is the active element
        // (report #397). Raise the window when there is one; a target with no window
        // to raise (the desktop app's embedded guest) gets CDP focus emulation, kept
        // attached on its session for the rest of the browser session (detaching can
        // clear the emulation). Any probe that cannot confirm focus is treated as
        // unfocused, and the round stops only when focus still does not hold.
        // The probe reads the genuine platform focus through the native getters the
        // always-focused environment stashed before its overrides (a page that only
        // ever looks focused to EP's scripts can still lack real key delivery);
        // without the stash, plain document.hasFocus() is the only state there is.
        const focusLost=async()=>await page.evaluate(()=>window.__epNativeFocus?window.__epNativeFocus.hasFocus():document.hasFocus()).catch(()=>undefined)!==true;
        const ensureWindowFocus=async()=>{
            if(!await focusLost())return true;
            await page.bringToFront().catch(()=>{});
            if(!await focusLost())return true;
            if(!focusEmulation){
                focusEmulation=await page.createCDPSession().catch(()=>null);
                if(focusEmulation)await focusEmulation.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{focusEmulation=null;});
            }
            if(!await focusLost())return true;
            guard='window-not-focused';
            return false;
        };
        const navigatePopup=async(element,i,targetIndex)=>{
            while(expected[i]<targetIndex){
                if(stop())return{status:'aborted'};
                phase='popup-arrow-dispatch';await element.press('ArrowDown');keyDispatchesReturned++;expected[i]++;phase='after-popup-arrow';
                const stillOpen=await waitPopupState(element,true);
                if(stillOpen==='aborted')return{status:'aborted'};
                if(stillOpen!==true){guard=stillOpen===null?'popup-open-state-unsupported':'popup-closed-before-commit';return refused();}
                if(!await popupNavigationClean(i))return refused();
            }
            return null;
        };
        const runPopupInput=async(i,element)=>{
            if(!trace){trace=await page.evaluateHandle(observeDropdownInput,baseline,{popup:true});ownsTrace=true;}
            const startIndex=expected[i],targetIndex=descriptor.dropdowns[i].index;
            if(targetIndex<startIndex){guard='popup-target-before-start';return refused();}
            const beforePopup=expected.slice();
            if(!await ensureWindowFocus())return{...refused(),message:'Lesson dropdowns stopped: window focus could not be taken; click the EducationPerfected browser window and start again. No input retry.',diagnostic:await popupTraceDiagnostics(i)};
            if(stop())return{status:'aborted'};
            phase='f4-dispatch';await element.press('F4');keyDispatchesReturned++;phase='after-f4';
            // The first F4 on a heavy mixed slide can open the native popup late, and a
            // re-render can replace the node; poll the live, identity-checked select.
            // Read-only polling, no input retry.
            const opened=await waitLivePopupOpen(i,1500);
            if(opened==='aborted')return{status:'aborted'};
            if(opened==='refused')return refused();
            if(opened===null){guard='popup-open-state-unsupported';return refused();}
            if(opened===false){guard='popup-open-unverified';return {...refused(),diagnostic:await popupTraceDiagnostics(i)};}
            element=opened;
            if(!await popupNavigationClean(i))return refused();
            const navigated=await navigatePopup(element,i,targetIndex);
            if(navigated)return navigated;
            if(stop())return{status:'aborted'};
            phase='popup-enter-dispatch';await element.press('Enter');keyDispatchesReturned++;phase='after-popup-enter';
            const closed=await waitPopupState(element,false);
            if(closed==='aborted')return{status:'aborted'};
            if(closed!==false){guard=closed===null?'popup-open-state-unsupported':'popup-close-unverified';return refused();}
            if(!await settled(i,beforePopup))return stop()?{status:'aborted'}:refused();
            return null;
        };
        const runLegacyInput=async(i,element)=>{
            // Native select keys, not DOM-selectedIndex assignment or synthetic change.
            // Intermediate choices may be saved by EP; each key is checked and never retried.
            const beforeHome=expected.slice();
            phase='home-dispatch';await element.press('Home');keyDispatchesReturned++;expected[i]=0;phase='after-home';
            if(!await settled(i,beforeHome))return stop()?{status:'aborted'}:refused();
            for(let n=0;n<descriptor.dropdowns[i].index;n++){
                if(stop())return{status:'aborted'};
                phase='before-arrow';if(!await check(i,true))return refused();
                const beforeArrow=expected.slice();
                phase='arrow-dispatch';await element.press('ArrowDown');keyDispatchesReturned++;expected[i]++;phase='after-arrow';
                if(!await settled(i,beforeArrow))return stop()?{status:'aborted'}:refused();
            }
            return null;
        };
        for(let i=0;i<descriptor.dropdowns.length;i++){
            if(stop())return{status:'aborted'};
            dropdownIndex=i;phase='target';guard='missing-target';
            let element=await check(i);if(!element)return refused();
            phase='focus';await element.focus();if(!await check(i,true))return refused();
            if(stop())return{status:'aborted'};
            const inputFailure=inputMode==='f4-popup'?await runPopupInput(i,element):await runLegacyInput(i,element);
            if(inputFailure)return inputFailure;
        }
        if(stop())return{status:'aborted'};
        phase='final-verification';
        let final;
        if(opts.enter&&!descriptor.selfMarked){
            phase='submit-readiness';
            const ready=await waitForDropdownSubmit(page,baseline,{shouldStop:stop,timeout:opts.timeout,mixedNumberBox:mix});
            if(ready.status==='aborted')return{status:'aborted'};
            if(ready.status!=='ready'){guard=ready.guard;submitState=ready.submitState;return refused();}
            final=ready.handle;
        }else final=await page.evaluateHandle(readDropdownsInPage,baseline,'verify',true,mix);
        const confirmAndSubmit=async final=>{
            const failure=await final.evaluate(r=>r?.descriptor?.kind==='dropdown'&&r.descriptor.dropdowns.every(d=>d.selectedIndex===d.index)?null:r?.guard||'final-selection-mismatch');
            if(failure){guard=failure;return refused();}
            opts.onVerified?.();
            opts.log?.('Selected exact lesson dropdown answers.');
            if(descriptor.selfMarked)return{status:'self-marked-filled',selectionDiagnostic:selectionDiagnostic()};
            // Fill-only phase for the mixed handler: verified fill, no Submit.
            if(opts.fillOnly)return{status:'filled',selectionDiagnostic:selectionDiagnostic()};
            if(!opts.enter)return null;
            await opts.beforeSubmit?.(); // human pacing: one randomized wait before Submit (issue #221)
            phase='submit-target';guard='missing-submit';
            const button=await final.getProperty('target');handles.push(button);const element=button.asElement();if(!element)return refused();
            const outcome=await clickVerifiedSubmit(page,element,async el=>{
                const last=await page.evaluateHandle(readDropdownsInPage,baseline,'submit',false,mix);
                try{return!!await last.evaluate((r,el)=>r?.descriptor?.kind==='dropdown'&&r.target===el,el);}finally{await last.dispose();}
            },stop);
            if(outcome==='aborted')return{status:'aborted'};
            if(outcome!=='clicked'){guard=outcome==='changed'?'changed-before-submit':'submit-covered';return refused();}
            return null;
        };
        try{
            const confirmed=await confirmAndSubmit(final);
            if(confirmed)return confirmed;
        }finally{await final.dispose();}
        phase='post-selection';guard='result-not-confirmed';
        const transition=await watchQuestionTransition(page,descriptor.key,{shouldStop:stop,timeout:opts.enter?opts.timeout:Infinity,detectQuestion:require('./detect-question').detectQuestion});
        if(['advanced','modal','complete','aborted'].includes(transition.status))return transition;
        return refused();
    }catch{guard='inspection-or-dispatch-uncertain';return{status:'stopped',reason:guard,message:'Lesson dropdowns stopped: input result uncertain; no retry.',selectionDiagnostic:selectionDiagnostic()};}
    finally{
        if(trace&&ownsTrace){await trace.evaluate(observer=>observer.close()).catch(()=>{});await trace.dispose().catch(()=>{});}
        for(const h of handles)await h.dispose().catch(()=>{});if(baseline)await baseline.dispose().catch(()=>{});
    }
}
module.exports={playDropdownRound};
