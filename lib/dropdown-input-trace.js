// Passive, bounded telemetry for bounded native-select key sequences.
// No text/value reads, event cancellation, input synthesis or selection writes.
function observeDropdownInput(baseline,options) {
    const popup=options?.popup===true;
    const selects=baseline.rows.map(row=>row.select);
    if(!selects.length||selects.length>20||selects.some(el=>!(el instanceof HTMLSelectElement)))throw new Error('invalid trace controls');
    const events=[],timers=new Set(),limit=64;
    let dropped=0,closed=false;
    const index=value=>Number.isInteger(value)&&value>=-1&&value<=50?value:null;
    const openState=()=>selects.map(el=>{try{return el.matches(':open');}catch{return null;}});
    // The trace records the genuine platform state, so it reads through the
    // native getters the always-focused environment stashed before overriding
    // what page scripts see; without the stash, the plain reads are the state.
    const realFocus=()=>window.__epNativeFocus?window.__epNativeFocus.hasFocus():document.hasFocus();
    const realVisibility=()=>window.__epNativeFocus?window.__epNativeFocus.visibilityState():document.visibilityState;
    const visibilityCodes=new Map([['visible',0],['hidden',1]]);
    const appearanceCodes=new Map([['auto',0],['none',1],['base-select',2]]);
    const keyCodes=new Map([['Home',0],['ArrowDown',1],...(popup?[['F4',2],['Enter',3]]:[])]);
    const keyCode=name=>keyCodes.get(name)??null;
    const state=()=>{
        const result={actual:selects.map(el=>index(el.selectedIndex)),focusedDropdownIndex:selects.indexOf(document.activeElement),documentHasFocus:realFocus(),visibility:visibilityCodes.get(realVisibility())??2};
        if(popup)result.open=openState();
        return result;
    };
    const appearance=selects.map(el=>{
        const value=getComputedStyle(el).appearance;
        return appearanceCodes.get(value)??3;
    });
    const initial=state();
    const listener=event=>{
        const targetIndex=selects.indexOf(event.target);
        if(closed||targetIndex<0)return;
        const key=keyCode(event.key);
        if((event.type==='keydown'||event.type==='keyup')&&key===null)return;
        if(events.length>=limit){dropped=Math.min(dropped+1,65535);return;}
        const record={type:['keydown','keyup','input','change'].indexOf(event.type),targetIndex,trusted:event.isTrusted,key,code:keyCode(event.code),modifiers:(event.altKey?1:0)|(event.ctrlKey?2:0)|(event.metaKey?4:0)|(event.shiftKey?8:0),defaultPreventedAtCapture:event.defaultPrevented,atCapture:state(),completionPending:true};
        events.push(record);
        const timer=setTimeout(()=>{
            timers.delete(timer);
            if(closed)return;
            record.defaultPreventedAfterTask=event.defaultPrevented;
            record.afterTask=state();
            record.completionPending=false;
        },0);
        timers.add(timer);
    };
    const types=['keydown','keyup','input','change'];
    types.forEach(type=>window.addEventListener(type,listener,{capture:true,passive:true}));
    return {
        snapshot:()=>({schema:popup?2:1,initial,current:state(),appearance,events,dropped}),
        close:()=>{
            closed=true;
            types.forEach(type=>window.removeEventListener(type,listener,true));
            timers.forEach(timer=>clearTimeout(timer));timers.clear();
        }
    };
}
module.exports={observeDropdownInput};
