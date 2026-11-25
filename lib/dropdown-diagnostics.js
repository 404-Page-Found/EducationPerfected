const {readDropdownsInPage}=require('./dropdown-state');
// Displayed controls only. Never serializes EP model/answers, cookies, URLs with
// queries, Angular scopes or surrounding question/student text. No writes/getters.
const BUILD='dropdown-diagnostics-v2';
function inspectDropdownDom(){
    const text=s=>String(s??'').slice(0,160);
    const shown=el=>!el.hidden&&(el.offsetParent!==null||el.getClientRects().length>0);
    const lesson=document.querySelector('#ep-question-container');
    const allSelects=[...document.querySelectorAll('select')];
    const selects=lesson?[...lesson.querySelectorAll('select')]:[];
    let shadowHosts=0;for(const el of document.querySelectorAll('*'))if(el.shadowRoot)shadowHosts++;
    return{questionContainer:!!lesson,selectCount:selects.length,outsideQuestionSelectCount:allSelects.length-selects.length,shadowHosts,
        selects:selects.slice(0,20).map(el=>({tag:el.tagName,inQuestion:!!lesson?.contains(el),visible:shown(el),disabled:el.disabled,multiple:el.multiple,size:el.size,selectedIndex:el.selectedIndex,value:text(el.value),optionCount:el.options.length,
            options:[...el.options].slice(0,51).map(o=>({text:text(o.textContent),value:text(o.value),selected:o.selected,disabled:o.disabled,hidden:o.hidden})),optionsTruncated:el.options.length>51})),selectsTruncated:selects.length>20};
}
// One operation raced against stop/expiry. Reports the end reason through setEnded.
async function raceWithStop(operation,shouldStop,deadline,setEnded){
    if(shouldStop()){setEnded('cancelled');return null;}
    if(Date.now()>=deadline){setEnded('timeout');return null;}
    let timer;
    const pending=Promise.resolve().then(operation).then(value=>({value}),()=>({error:true}));
    const stop=new Promise(resolve=>{const poll=()=>{
        if(shouldStop()){setEnded('cancelled');resolve(null);}
        else if(Date.now()>=deadline){setEnded('timeout');resolve(null);}
        else timer=setTimeout(poll,Math.min(25,deadline-Date.now()));
    };poll();});
    try{return await Promise.race([pending,stop]);}finally{clearTimeout(timer);}
}
// Deadline bounds waiting, not remote execution. An in-flight read may finish
// later; its rejection is handled, and no further reads start after stop/expiry.
async function collectDropdownDiagnostics(page,{shouldStop=()=>false,timeoutMs=2000,definitionsOnly=false}={}){
    const deadline=Date.now()+Math.min(2000,Math.max(1,timeoutMs));
    let ended;
    const read=operation=>raceWithStop(operation,shouldStop,deadline,reason=>{ended=reason;});
    const frames=typeof page.frames==='function'?page.frames():[page];
    const result={build:BUILD,readOnly:true,frameCount:frames.length,frames:[],framesTruncated:frames.length>8};
    for(const [index,frame]of frames.slice(0,8).entries()){
        const {row,stop}=await readFrameRow(page,index,frame,definitionsOnly,read,()=>ended);
        if(stop==='withhold'){result.incomplete=ended;break;}
        result.frames.push(row);
        if(stop){result.incomplete=ended;break;}
    }
    return result;
}
// One frame's diagnostic row. stop='withhold' keeps the partial row out (the
// read ended before detection ran); stop='keep' pushes it with incomplete set.
async function readFrameRow(page,index,frame,definitionsOnly,read,getEnded){
    const row={index,main:typeof page.mainFrame==='function'?frame===page.mainFrame():index===0};
    const dom=definitionsOnly?{value:null}:await read(()=>frame.evaluate(inspectDropdownDom));
    if(getEnded())return{row,stop:'withhold'};
    if(!definitionsOnly){if(dom.error)row.domError='inspection-unavailable';else row.dom=dom.value;}
    const detection=await read(()=>frame.evaluate(readDropdownsInPage,null,'diagnostic'));
    if(getEnded())return{row,stop:'keep'};
    row.detection=detection.error?{guard:'inspection-threw'}:detection.value;
    return{row};
}
module.exports={BUILD,inspectDropdownDom,collectDropdownDiagnostics};
