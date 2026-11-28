// Read existing objects only. EP public chunk606, checked 6 November 2026.
// DropDownComponent / DropDownComponentState. Do not invoke shuffledOptions:
// its getter can sort options and create state. change maps by trimmed description.
// https://mfe-student-app.educationperfect.com/main/mfe-hashed-assets-606-c22c0eb5e341ef24b769.js
// allowMix is set only by the mixed-slide orchestrator: `true` admits visible
// number-box inputs (the original dropdown+number-box contract), and an array
// of component type codes (NUMBER_BOX_COMPONENT, TEXT_BOX_COMPONENT and/or
// MULTICHOICE_COMPONENT) admits those visible input surfaces and their
// definitions (each verified by its own contract). Every other guard stays identical, and under the flag
// the descriptor adds the dropdown definitions' Marked flags so the
// orchestrator can require uniform marking across every surface.
// Single-surface reads keep the default and are unchanged.
function readDropdownsInPage(baseline, action, reportGuard = false, allowMix = false) {
    // The multi-select surface's only editable controls are its option
    // checkboxes; a choice surface shares the component root.
    const mixSelectors = { NUMBER_BOX_COMPONENT: 'input.number-box-component', TEXT_BOX_COMPONENT: 'input.text-box-component', MULTICHOICE_COMPONENT: 'div.multi-choice-component input' };
    let mixTypes = [];
    if (allowMix === true) mixTypes = ['NUMBER_BOX_COMPONENT'];
    else if (Array.isArray(allowMix)) mixTypes = allowMix.filter(t => Object.hasOwn(mixSelectors, t));
    const shown = el => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0);
    const lesson = document.querySelector('#ep-question-container');
    const selects = lesson ? [...lesson.querySelectorAll('select')].filter(shown) : [];
    if (!selects.length) return action==='diagnostic'||reportGuard?{guard:lesson?'no-visible-selects':'missing-question-container'}:null;
    const refuse = (guard='unclassified',fields) => {
        if (action==='diagnostic') return {guard,...(fields?{fields}:{})};
        if (guard==='assessment-mode') return {descriptor:{kind:'unsupported',assessment:true,reason:'Assessment mode is a graded whole-attempt flow that can autosave input and record focus; answering is disabled'},...(reportGuard?{guard}:{})};
        // Content-free refusal boundary: guard identifier, DOM select count
        // and fixed-shape control descriptions only, never option text,
        // answers or attribute values outside a fixed allowlist. The CLI
        // prints descriptor .diagnostic on its generic unsupported-question
        // line, so a live refusal names the exact guard that stopped the run.
        const descriptor={kind:'unsupported',reason:'Lesson dropdowns: unsafe, unsupported or changed renderer state',diagnostic:{kind:'dropdown-refusal',guard,domSelectCount:selects.length,...(fields?fields:{})}};
        return {descriptor,...(reportGuard?{guard}:{})};
    };
    const scopeModel=n=>{
        const a=window.angular?.element(n);
        for (const scope of a ? [a.isolateScope?.(),a.scope?.()] : []) if(scope?.self?.model?._currentQuestion)return scope.self;
        return null;
    };
    const modelOf = el => {
        for (let n=el, depth=0; n && depth<10; n=n.parentElement, depth++) {
            const found=scopeModel(n);
            if(found)return found;
        }
        return null;
    };
    const self=modelOf(selects[0]), model=self?.model, q=model?._currentQuestion;
    const own=(object,key)=>{
        const property=object&&Object.getOwnPropertyDescriptor(object,key);
        return property&&'value' in property?property.value:undefined;
    };
    const marking=checkMarking();
    if(marking.refusal)return marking.refusal;
    const selfMarked=marking.selfMarked;
    function checkMarking(){
        if(!q)return{refusal:refuse('missing-question-model')};
        if(model.gameMode===2)return{refusal:refuse('assessment-mode')};
        if(model.gameMode!==3)return{refusal:refuse('not-lesson-mode')};
        const group=self.sectionData?.activityGroup;
        const marked=group?.isSelfMarked===true&&group?.isAutoMarked===false;
        if(group?.isAutoMarked!==true&&!marked)return{refusal:refuse('not-explicit-auto-marked')};
        if(group?.isAutoMarked===true&&'isSelfMarked' in group&&group.isSelfMarked!==false)return{refusal:refuse('conflicting-activity-marking')};
        // Explicit self-marking permits the proven dropdown fill contract only.
        // Mixed surfaces and all submission/self-grading remain outside this path.
        if(marked&&mixTypes.length)return{refusal:refuse('self-marked-mixed-surfaces')};
        if(marked&&action==='submit')return{refusal:refuse('self-marked-no-submit')};
        if(!Number.isSafeInteger(q.contentID)||q.contentID<=0)return{refusal:refuse('invalid-content-id')};
        if(!Number.isSafeInteger(q.questionIndex)||q.questionIndex<0)return{refusal:refuse('invalid-question-index')};
        return{selfMarked:marked};
    }
    let extraEditables=[...lesson.querySelectorAll('input,textarea,select,[contenteditable]')].filter(el=>shown(el)&&(el.matches('input,textarea,select')||el.isContentEditable)).filter(el=>!selects.includes(el));
    if(mixTypes.length)extraEditables=extraEditables.filter(el=>!mixTypes.some(t=>el.matches(mixSelectors[t])));
    if (extraEditables.length)return refuse('mixed-editable-inputs',extraEditablesDetail());
    // Name the extra editable controls without their content: tag, an
    // allowlisted HTML input type, and boolean control flags. Never
    // values, labels, ids, classes or surrounding text. Capped so a
    // pathological slide cannot bloat the printed diagnostic.
    function extraEditablesDetail(){
        const extras=extraEditables.slice(0,8).map(describeExtraEditable);
        const inGaps=selects.filter(select=>select.closest('.fitg-component')).length;
        return{
            extraCount:extraEditables.length,
            extras,
            ...(extraEditables.length>8?{extrasTruncated:true}:{}),
            ...(inGaps?{selectsInGaps:inGaps===selects.length?'all':'mixed'}:{}),
            definitions:definitionMixDetail(),
        };
    }
    function describeExtraEditable(el){
        const detail={tag:el.tagName.toLowerCase()};
        if(el.tagName==='INPUT'){
            const type=(el.getAttribute('type')||'text').toLowerCase();
            detail.type=['button','checkbox','color','date','datetime-local','email','file','hidden','image','month','number','password','radio','range','reset','search','submit','tel','text','time','url','week'].includes(type)?type:'other';
        }
        // Fixed-shape layout hooks: membership in EP's known answer-box
        // classes and the fill-in-the-gaps wrapper, as booleans/fixed
        // names only. These decide whether the extra control is an
        // answer surface the text/number-box contract could verify.
        if(el.matches('input.text-box-component'))detail.answerBox='text-box';
        else if(el.matches('input.number-box-component'))detail.answerBox='number-box';
        if(el.closest('.fitg-component'))detail.inGapsComponent=true;
        if(el.isContentEditable)detail.contentEditable=true;
        if(el.disabled)detail.disabled=true;
        if(el.readOnly)detail.readOnly=true;
        return detail;
    }
    // Definition mix as counts under fixed component-type names (anything
    // else buckets into unlisted) plus marking tallies. Codes outside the
    // allowlist are never serialized, so the summary stays content-free
    // while naming exactly which answer surfaces share the slide.
    function definitionMixDetail(){
        const definitions={total:0,byType:{},marked:0,unmarked:0,invalidMarked:0};
        const defs=q.questionDef?.Components;
        if(!Array.isArray(defs))return definitions;
        definitions.total=defs.length;
        const typeNames={DROPDOWN_COMPONENT:'dropdown',TEXT_BOX_COMPONENT:'textBox',NUMBER_BOX_COMPONENT:'numberBox',SOUND_COMPONENT:'sound',ANNOTATED_TEXT_COMPONENT:'annotatedText'};
        for(const def of defs){
            const name=Object.hasOwn(typeNames,own(def,'ComponentTypeCode'))?typeNames[own(def,'ComponentTypeCode')]:'unlisted';
            definitions.byType[name]=(definitions.byType[name]||0)+1;
            const marked=own(def,'Marked');
            if(marked===1)definitions.marked++;
            else if(marked===0)definitions.unmarked++;
            else definitions.invalidMarked++;
        }
        return definitions;
    }
    // Definitions include non-answer companions. Compare selects with dropdowns,
    // but retain complete definition/cache coverage, never ignore another input.
    // chunk606: SoundComponent and AnnotatedTextComponent set isInput=false;
    // annotated-text is NOT_MARKED, sound returns weight=0 marking. No output,
    // parser, annotation or sound-player methods are invoked by this reader.
    const companionTypes={SOUND_COMPONENT:'sound',ANNOTATED_TEXT_COMPONENT:'annotated-text'};
    const definitionSets=checkDefinitionSets();
    if(definitionSets.refusal)return definitionSets.refusal;
    const {allDefs,renderer,parser,identified,base,defs,companions,mixDefs}=definitionSets;
    function checkDefinitionSets(){
        const all=q.questionDef?.Components, renderer=q.cachedRenderers?.[1];
        const parser=own(renderer,'parser');
        const identified=own(renderer,'identifiedComponents')||own(parser,'identifiedComponents');
        const base=own(identified,'baseComponents');
        if(!Array.isArray(all))return{refusal:refuse('definitions-not-array')};
        if(!all.length)return{refusal:refuse('definitions-empty')};
        if(all.length>20)return{refusal:refuse('definitions-limit')};
        const defs=all.filter(d=>own(d,'ComponentTypeCode')==='DROPDOWN_COMPONENT');
        const companions=all.filter(d=>Object.hasOwn(companionTypes,own(d,'ComponentTypeCode')));
        // Under the mix flag the admitted definitions belong to the companion
        // readers' own contracts; they are counted, never ignored or verified here.
        const mixDefs=mixTypes.length?all.filter(d=>mixTypes.includes(own(d,'ComponentTypeCode'))):[];
        if(defs.length!==selects.length||defs.length+mixDefs.length+companions.length!==all.length)return{refusal:refuse('definitions-select-count',{
            definitionCount:all.length,dropdownDefinitionCount:defs.length,...(mixTypes.length?{mixDefinitionCount:mixDefs.length}:{}),companionDefinitionCount:companions.length,
            unsupportedDefinitionCount:all.length-defs.length-mixDefs.length-companions.length,
            ...unsupportedDetail(all,companionTypes,base,defs,mixDefs),
        })};
        if(!base)return{refusal:refuse('missing-renderer-map')};
        const invalidDefinition=action==='diagnostic'
            ?defs.some(d=>own(d,'ComponentTypeCode')!=='DROPDOWN_COMPONENT'||typeof own(d,'ComponentID')!=='string'||!own(d,'ComponentID')||![0,1].includes(own(d,'Marked')))
            :defs.some(d=>d?.ComponentTypeCode!=='DROPDOWN_COMPONENT'||typeof d.ComponentID!=='string'||!d.ComponentID||![0,1].includes(d.Marked));
        if(invalidDefinition)return{refusal:refuse('definition-type-id-or-marking',invalidDefinitionFields(base,defs))};
        if(new Set(defs.map(d=>action==='diagnostic'?own(d,'Marked'):d.Marked)).size!==1)return{refusal:refuse('mixed-definition-marking')};
        if(all.some(d=>typeof own(d,'ComponentID')!=='string'||!own(d,'ComponentID')))return{refusal:refuse('definition-id')};
        if(new Set(all.map(d=>own(d,'ComponentID'))).size!==all.length)return{refusal:refuse('definition-duplicate-id')};
        if(Object.keys(base).length!==all.length)return{refusal:refuse('renderer-definition-count')};
        return{allDefs:all,renderer,parser,identified,base,defs,companions,mixDefs};
    }
    function unsupportedDetail(allDefs,companionTypes,base,defs,mixDefs){
        // Content-free detail for the unsupported definitions only: fixed
            // type-name allowlist (anything else buckets into unlisted) and the
            // cached renderer's isInput flag as a count. No IDs, text or values.
            // Mirrors lib/companion-components.js (issue #231); admitted
            // dropdown/sound/annotated-text codes are skipped via `admitted`
            // below, so they are not listed here. TYPE_* display codes are
            // recognized (caught by the foreign-editable boundary when editable).
            const known=new Set(['TEXT_BOX_COMPONENT','NUMBER_BOX_COMPONENT','MULTICHOICE_COMPONENT','HIGHLIGHT_COMPONENT','SCRATCH_PAD_COMPONENT','FILL_IN_GAPS_COMPONENT','WORKING_FORMULA_COMPONENT','LONG_ANSWER_COMPONENT','FORMULA_COMPONENT','FREEFORM_WORKING_COMPONENT','SOUND_RECORDER_COMPONENT','FILE_UPLOADER_COMPONENT','ANNOTATED_QUESTION_COMPONENT','DEPTH_COMPONENT','TYPE_ARROW_COMPONENT','TYPE_EQUALS_COMPONENT','TYPE_EXPONENT_COMPONENT','TYPE_GROUP_COMPONENT','TYPE_MATH_ENTITY_COMPONENT','TYPE_MATH_FUNCTION_COMPONENT','TYPE_MULTI_OPERATOR_COMPONENT','TYPE_NUMBER_COMPONENT','TYPE_OR_COMPONENT','TYPE_SUBSCRIPT_SUPERSCRIPT_COMPONENT','TYPE_TEXT_COMPONENT','TYPE_UNARY_OPERATOR_COMPONENT']);
            const admitted=new Set(['DROPDOWN_COMPONENT',...Object.keys(companionTypes),...(mixTypes||[])]);
            const {types,input}=tallyUnsupported(known,admitted);
            // A choice component beside dropdowns is not composed today. Name
            // the facts that decide whether it could be: visible choice
            // groups in the DOM (all/multi-select), the definitions' multi
            // flag and marking as fixed tallies, and whether each cached
            // renderer entry binds uniquely. Counts only, never option text.
            // Counted whether or not the caller admitted the type, so a refusal on
            // another definition still reports the choice surface.
            const choice=choiceSurfaceDetail();
            return {...(Object.keys(types).length?{unsupportedTypes:types,unsupportedIsInput:input}:{}),...(choice?{choiceSurface:choice}:{})};
            function tallyUnsupported(known,admitted){
                const types={},input={yes:0,no:0,unknown:0};
                for(const d of allDefs){
                    const code=own(d,'ComponentTypeCode');
                    if(admitted.has(code))continue;
                    const name=known.has(code)?code:'unlisted';
                    types[name]=(types[name]||0)+1;
                    input[inputFlagOf(d)]++;
                }
                return {types,input};
            }
            function inputFlagOf(d){
                const id=own(d,'ComponentID');
                const list=typeof id==='string'&&base?own(base,id):null;
                const entry=Array.isArray(list)&&list.length===1?list[0]:null;
                const flag=entry?own(entry,'isInput'):undefined;
                if(flag===true)return'yes';
                if(flag===false)return'no';
                return'unknown';
            }
            function choiceSurfaceDetail(){
                const choiceDefs=allDefs.filter(d=>own(d,'ComponentTypeCode')==='MULTICHOICE_COMPONENT');
                if(!choiceDefs.length)return null;
                const tally=(key,allowed)=>choiceDefs.reduce((t,d)=>{const v=own(d,key),k=allowed.includes(v)?String(v):'other';t[k]=(t[k]||0)+1;return t;},{});
                const groups=[...lesson.querySelectorAll('div.multi-choice-component')].filter(shown);
                let bound=0,ambiguous=0,missing=0;
                for(const d of choiceDefs){
                    const id=own(d,'ComponentID'),list=typeof id==='string'&&base?own(base,id):null;
                    if(Array.isArray(list)&&list.length===1&&own(list[0],'id')===id)bound++;else if(Array.isArray(list)&&list.length>1)ambiguous++;else missing++;
                }
                return{domGroups:groups.length,domMultiSelectGroups:groups.filter(g=>g.getAttribute('role')==='group'||g.classList.contains('multi-select')).length,allowMultiSelect:tally('AllowMultiSelect',[true,false,'true','false']),marked:tally('Marked',[0,1]),rendererEntries:{bound,ambiguous,missing},dropdownMarked:defs.reduce((t,d)=>{const v=own(d,'Marked'),k=[0,1].includes(v)?String(v):'other';t[k]=(t[k]||0)+1;return t;},{})};
            }
        }
    function invalidDefinitionFields(base,defs){
        if(action!=='diagnostic')return undefined;
        // Fixed allowlist of scalar fields only. Never serialize definitions,
        // option answers, arbitrary text or accessor values into diagnostics.
        const scalar=(object,key)=>{
            const value=own(object,key),type=value===null?'null':typeof value;
            if(['number','boolean'].includes(type))return{type,value:Number.isFinite(value)||type==='boolean'?value:'nonfinite'};
            if(type==='string')return /^[A-Za-z0-9_-]{1,80}$/.test(value)?{type,value}:{type,length:value.length,redacted:true};
            return{type};
        };
        return{gameMode:scalar(model,'gameMode'),isAutoMarked:scalar(self.sectionData?.activityGroup,'isAutoMarked'),definitions:defs.slice(0,20).map((d,index)=>{
            const rawType=own(d,'ComponentTypeCode'),id=own(d,'ComponentID'),rawMarked=own(d,'Marked'),entries=typeof id==='string'?own(base,id):undefined,component=Array.isArray(entries)&&entries.length===1?entries[0]:undefined;
            const metadata=own(own(component,'componentState'),'metadataInstance');
            return{index,failedOwnData:{type:rawType!=='DROPDOWN_COMPONENT',id:typeof id!=='string'||!id,marked:![0,1].includes(rawMarked)},raw:{type:scalar(d,'ComponentTypeCode'),id:scalar(d,'ComponentID'),marked:scalar(d,'Marked')},cached:{count:Array.isArray(entries)?entries.length:null,id:scalar(component,'id'),marked:scalar(component,'marked'),renderMode:scalar(own(component,'renderingParameters'),'mode')},metadata:{type:scalar(metadata,'ComponentTypeCode'),id:scalar(metadata,'ComponentID'),marked:scalar(metadata,'Marked')}};
        })};
    }
    const plain=s=>typeof s==='string'&&s.length>0&&s.length<=1024&&s===s.trim()
        &&!/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>`[\]@]/.test(s);
    // A non-breaking space inside the text is ordinary option content (issue #385);
    // at either edge it still refuses, because the trim() comparison below rejects it.
    // Permit boundary ASCII spaces only; EP maps by trim(), so normalized
    // descriptions must also be unique. Raw text and option identities stay exact.
    const optionText=s=>{
        if(typeof s!=='string'||s.length>1024||!plain(s.trim()))return false;
        let first=0,last=s.length;
        while(first<last&&s[first]===' ')first++;
        while(last>first&&s[last-1]===' ')last--;
        return s.slice(first,last)===s.trim();
    };
    const optionSafe=o=>o&&typeof o==='object'&&(o.Description===''||optionText(o.Description))
        &&['true','false'].includes(o.Correct)&&o.Validity==='true'&&Number.isFinite(o.SortOrder);
    // Content-free breakdown for an option-safety refusal: how many options fail
    // and which fixed character class or flag check each one fails. Counts only,
    // never option text (issue #385 guard source-option-text-or-flags).
    const optionBreakdown=options=>{
        const tally={optionCount:options.length,badDescription:0,badFlags:0,descAngle:0,descBracket:0,descAtOrTick:0,descControl:0,descNbspEdge:0,descEdgeSpace:0,descLong:0};
        for(const o of options)tallyOptionFailure(o,tally);
        return tally;
    };
    const optionFlagsBad=o=>!['true','false'].includes(o.Correct)||o.Validity!=='true'||!Number.isFinite(o.SortOrder);
    function tallyOptionFailure(o,tally){
        if(!o||typeof o!=='object'){tally.badFlags++;return;}
        tallyDescriptionFailure(o.Description,tally);
        if(optionFlagsBad(o))tally.badFlags++;
    }
    const descCharClasses=[['descAngle',/[<>]/],['descBracket',/[\[\]]/],['descAtOrTick',/[@`]/],['descControl',/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/],['descNbspEdge',/^ *\u00a0|\u00a0 *$/]];
    function tallyDescriptionFailure(d,tally){
        if(d===''||optionText(d))return;
        tally.badDescription++;
        if(typeof d!=='string')return;
        for(const [key,re] of descCharClasses)if(re.test(d))tally[key]++;
        if(d!==d.trim())tally.descEdgeSpace++;
        if(d.length>1024)tally.descLong++;
    }
    // EP chunk606, checked 9 November 2026: one BasicVariableInjector per raw
    // Description/Correct string keeps the exact template as literal TextPart
    // .text pieces and TempVariablePart .temporaryVariable.expression pieces.
    // applyVariableContext rewrites metadata.Options in place with the resolved
    // values (originalDropDownOptions shares those objects), so raw options
    // legitimately differ whenever a template carries a variable. Reconstruct
    // the template from the injector parts; any other shape is malformed.
    const injectorTemplate=injector=>{
        const parts=own(injector,'parts');
        if(!Array.isArray(parts)||parts.length>100)return null;
        let template='';
        for(const part of parts){
            const piece=injectorPartText(part);
            if(piece===null)return null;
            template+=piece;
        }
        return template;
    };
    // Linear equivalent of /{[^}]+}/: "{" then at least one char then
    // "}" (inner "{" allowed per EP splitParts /({[^}]+})/g). Keeps the
    // source grammar while avoiding super-linear backtracking (S8786).
    function hasBracedExpression(value){
        let from=0;
        while(true){
            const open=value.indexOf('{',from);
            if(open===-1)return false;
            const close=value.indexOf('}',open+1);
            if(close===-1)return false;
            if(close>open+1)return true;
            from=open+1;
        }
    }
    function injectorPartText(part){
        if(!part||typeof part!=='object')return null;
        const hasText=Object.hasOwn(part,'text'),hasVariable=Object.hasOwn(part,'temporaryVariable');
        if(hasText===hasVariable)return null;
        // A genuine parse turns every {expression} substring into a
        // variable part, so a text part carrying that pattern is forged.
        if(hasText){const text=own(part,'text');if(typeof text!=='string'||hasBracedExpression(text))return null;
        return text;}
        const expression=own(own(part,'temporaryVariable'),'expression');
        if(typeof expression!=='string'||expression.length>1024)return null;
        return '{'+expression+'}';
    }
    // Every raw field except the two templated strings must deep-equal the
    // resolved copy (metadata starts as ObjectHelper.cloneObject(def)).
    // Descriptor reads only: no getter, toJSON or proxy code ever executes,
    // and the depth bound turns cycles into a refusal instead of a crash.
    const dataEqual=(a,b,depth)=>{
        if(Object.is(a,b))return true;
        if(!a||!b||typeof a!=='object'||typeof b!=='object'||depth>10)return false;
        const keysA=Reflect.ownKeys(a),keysB=Reflect.ownKeys(b);
        if(keysA.length!==keysB.length)return false;
        return keysA.every(key=>{
            const pa=Object.getOwnPropertyDescriptor(a,key),pb=Object.getOwnPropertyDescriptor(b,key);
            return pb!==undefined&&Object.hasOwn(pa,'value')&&Object.hasOwn(pb,'value')&&dataEqual(pa.value,pb.value,depth+1);
        });
    };
    const nonTemplateFieldsEqual=(raw,resolved)=>{
        const skip=key=>key!=='Description'&&key!=='Correct';
        const rawKeys=Reflect.ownKeys(raw).filter(skip),resolvedKeys=Reflect.ownKeys(resolved).filter(skip);
        if(rawKeys.length!==resolvedKeys.length)return false;
        return rawKeys.every(key=>{
            const a=Object.getOwnPropertyDescriptor(raw,key),b=Object.getOwnPropertyDescriptor(resolved,key);
            return b!==undefined&&Object.hasOwn(a,'value')&&Object.hasOwn(b,'value')&&dataEqual(a.value,b.value,0);
        });
    };
    // EP's editor default-none sentinel is rendered as a synthetic blank option.
    // It is not an answer description and must never relax ordinary option text.
    const emptyDefault=o=>o&&typeof o==='object'&&['',' < None > '].includes(o.Description)
        &&o.Correct==='false'&&o.Validity==='true'&&Number.isFinite(o.SortOrder);
    const companionRows=[];
    for(const def of companions){
        const row=readCompanionRow(def);
        if(row.refusal)return row.refusal;
        companionRows.push(row.row);
    }
    function readCompanionRow(def){
        const id=own(def,'ComponentID'),code=own(def,'ComponentTypeCode'),entries=own(base,id);
        if(!Array.isArray(entries)||entries.length!==1)return{refusal:refuse('companion-binding')};
        const component=entries[0],state=own(component,'componentState'),metadata=own(state,'metadataInstance'),element=own(component,'visualElement');
        if(own(component,'id')!==id||own(component,'type')!==companionTypes[code]||own(component,'isInput')!==false
            ||own(component,'marked')!==(code==='ANNOTATED_TEXT_COMPONENT'?2:1)
            ||own(own(component,'renderingParameters'),'mode')!==1||own(state,'componentID')!==id
            ||!dataEqual(def,metadata,0)||!(element instanceof Element)||!lesson.contains(element)||!shown(element)
            ||selects.some(select=>element===select||element.contains(select))
            ||element.matches('input,textarea,select,[contenteditable],iframe,object,embed')
            ||element.querySelector('input,textarea,select,[contenteditable],iframe,object,embed'))return{refusal:refuse('companion-contract')};
        return{row:{def,component,state,metadata,element}};
    }
    const rows=[];
    for(const select of selects){
        const row=readSelectRow(select);
        if(row.refusal)return row.refusal;
        rows.push(row.row);
    }
    function readSelectRow(select){
        if(modelOf(select)?.model!==model||select.disabled||select.multiple||select.size>1||select.closest('.fitg-component'))return{refusal:refuse('select-control-or-model')};
        const matches=defs.filter(d=>Array.isArray(base[d.ComponentID])&&base[d.ComponentID].length===1&&base[d.ComponentID][0].dropDownList===select);
        if(matches.length!==1)return{refusal:refuse('component-select-binding')};
        const def=matches[0],component=base[def.ComponentID][0],state=component.componentState,metadata=state?.metadataInstance;
        const original=state?.originalDropDownOptions, shuffled=state?._shuffledOptions, dom=[...select.options];
        // The real getter sorts metadata.Options in place; rendering can then
        // unshift one blank into that same array after original was copied.
        const injected=Array.isArray(shuffled)&&Array.isArray(original)?shuffled.filter(o=>!original.includes(o)):[];
        const placeholder=injected.length===1&&shuffled[0]===injected[0]&&injected[0].Description===''&&optionSafe(injected[0])&&injected[0].Correct==='false';
        const metadataOptions=metadata?.Options;
        const sourceOptions=Array.isArray(metadataOptions)&&placeholder&&metadataOptions===shuffled?metadataOptions.filter(o=>o!==injected[0]):metadataOptions;
        const staticChecks=[
            [()=>component.id!==def.ComponentID,'component-id'],
            [()=>select.id!==def.ComponentID,'select-id'],
            [()=>component.visualElement!==select,'visual-element'],
            [()=>component.renderingParameters?.mode!==1,'render-mode'],
            [()=>component.marked!==1,'component-marked'],
            [()=>metadata?.ComponentTypeCode!=='DROPDOWN_COMPONENT','metadata-type'],
            [()=>metadata.ComponentID!==def.ComponentID,'metadata-id'],
            [()=>metadata.Marked!==def.Marked||![0,1].includes(metadata.Marked),'metadata-marked'],
            [()=>!Array.isArray(sourceOptions),'source-options-array'],
            [()=>!sourceOptions.length,'source-options-empty'],
            [()=>sourceOptions.length>50,'source-options-limit'],
            [()=>!sourceOptions.every(optionSafe),'source-option-text-or-flags',()=>optionBreakdown(sourceOptions)],
        ];
        for(const [failed,guard,fields] of staticChecks)if(failed())return{refusal:refuse(guard,fields?fields():undefined)};
        const rawRefusal=checkRawOptions(def,original,state,metadata);
        if(rawRefusal)return{refusal:rawRefusal};
        const shuffledRefusal=checkShuffledOptions();
        if(shuffledRefusal)return{refusal:shuffledRefusal};
        const correct=shuffled.filter(o=>o.Correct==='true');
        if(correct.length!==1||!optionText(correct[0].Description))return{refusal:refuse('correct-option')};
        const selected=shuffled[select.selectedIndex], cached=state._selectedOption;
        const selectionRefusal=checkCachedSelection(selected,cached,metadata);
        if(selectionRefusal)return{refusal:selectionRefusal};
        return{row:{select,def,component,state,metadata,original,shuffled,optionRefs:shuffled.slice(),originalRefs:original.slice(),dom,answer:correct[0],answerIndex:shuffled.indexOf(correct[0]),selectedIndex:select.selectedIndex,filled:selected.Description!==''}};
        function checkShuffledOptions(){
            const checks=[
                [()=>!Array.isArray(original),'original-options-array'],
                [()=>original.length!==sourceOptions.length,'original-source-count'],
                [()=>new Set(original).size!==original.length,'original-duplicate'],
                [()=>original.some(o=>!sourceOptions.includes(o)),'original-source-identity'],
                [()=>!Array.isArray(shuffled),'shuffled-array'],
                [()=>shuffled.length!==dom.length,'shuffled-dom-count'],
                [()=>!shuffled.length,'shuffled-empty'],
                [()=>shuffled.length>51,'shuffled-limit'],
                [()=>!shuffled.every(optionSafe),'shuffled-option-text-or-flags',()=>optionBreakdown(shuffled)],
                [()=>new Set(shuffled).size!==shuffled.length,'shuffled-duplicate'],
                [()=>new Set(shuffled.map(o=>o.Description.trim())).size!==shuffled.length,'shuffled-description-duplicate'],
                [()=>original.some(o=>!shuffled.includes(o)),'original-shuffled-identity'],
                [()=>injected.length!==0&&!placeholder,'synthetic-placeholder'],
                [()=>dom.some((o,i)=>o.parentElement!==select||o.textContent!==shuffled[i].Description||o.text!==shuffled[i].Description.trim()||o.disabled||o.hidden||o.children.length),'dom-option-contract'],
                [()=>dom.filter(o=>o.selected).length!==1,'dom-selected-count'],
                [()=>select.selectedIndex<0,'dom-selected-index'],
            ];
            for(const [failed,guard,fields] of checks)if(failed())return refuse(guard,fields?fields():undefined);
            return null;
        }
        // A blank placeholder is allowed only when no answer is cached, or when
        // it is the actual cached blank default/option. Never overwrite a prefill.
        function checkCachedSelection(selected,cached,metadata){
            if(selected.Description!=='')return cached!==selected?refuse('cached-selection-identity'):null;
            if(selected.Correct!=='false')return refuse('selected-blank-correct');
            if(cached!=null&&!(cached===selected||cached===metadata.DefaultSelection&&emptyDefault(cached)))return refuse('cached-blank-identity');
            return null;
        }
    }
    function checkRawOptions(def,original,state,metadata){
        if(!Array.isArray(def.Options)||!Array.isArray(original)||def.Options.length!==original.length)return refuse('raw-original-options');
        const descInjectors=own(state,'descInjectors'),correctInjectors=own(state,'correctInjectors');
        if(!Array.isArray(descInjectors)||!Array.isArray(correctInjectors)||descInjectors.length!==def.Options.length||correctInjectors.length!==def.Options.length)return refuse('option-injector-shape');
        for(let index=0;index<def.Options.length;index++){
            const refusal=rawOptionMatches(def.Options[index],original[index],descInjectors[index],correctInjectors[index]);
            if(refusal)return refusal;
        }
        if(JSON.stringify(def.DefaultSelection)!==JSON.stringify(metadata.DefaultSelection))return refuse('raw-default');
        if(!emptyDefault(metadata.DefaultSelection))return refuse('default-none-contract');
        return null;
        function rawOptionMatches(raw,resolved,descInjector,correctInjector){
            if(!raw||typeof raw!=='object'||!resolved||typeof resolved!=='object')return refuse('raw-original-options');
            const description=injectorTemplate(descInjector),correct=injectorTemplate(correctInjector);
            if(description===null||correct===null)return refuse('option-injector-shape');
            if(description!==raw.Description||correct!==raw.Correct)return refuse('raw-original-options');
            if(!nonTemplateFieldsEqual(raw,resolved))return refuse('raw-original-options');
            return null;
        }
    }
    if(new Set(rows.map(r=>r.def)).size!==defs.length)return refuse('component-coverage');
    const key='dropdown:'+q.contentID+':'+q.questionIndex;
    const signature=JSON.stringify([q.questionDef,rows.map(r=>[r.metadata,r.shuffled,r.original]),companionRows.map(r=>r.metadata)]);
    const descriptor={kind:'dropdown',key,autoMarked:!selfMarked,...(selfMarked?{selfMarked:true}:{}),signature,dropdowns:rows.map(r=>({id:r.def.ComponentID,answer:r.answer.Description,index:r.answerIndex,selectedIndex:r.selectedIndex,filled:r.filled})),...(mixTypes.length?{markings:defs.map(d=>own(d,'Marked'))}:{})};
    if(baseline&&baselineChanged())return refuse('baseline-changed');
    function baselineChanged(){
        if(baseline.q!==q||baseline.model!==model||baseline.renderer!==renderer||baseline.base!==base||baseline.parser!==parser||baseline.identified!==identified)return true;
        if(baseline.companionRows.length!==companionRows.length||companionRows.some((r,i)=>['def','component','state','metadata','element'].some(k=>r[k]!==baseline.companionRows[i][k])))return true;
        if(baseline.descriptor.autoMarked!==!selfMarked||Boolean(baseline.descriptor.selfMarked)!==selfMarked||baseline.descriptor.key!==key||baseline.descriptor.signature!==signature||baseline.rows.length!==rows.length)return true;
        return rows.some((r,i)=>{const b=baseline.rows[i];return ['select','def','component','state','metadata','original','shuffled','answer'].some(k=>r[k]!==b[k])||r.dom.some((o,j)=>o!==b.dom[j])||r.optionRefs.some((o,j)=>o!==b.optionRefs[j])||r.originalRefs.some((o,j)=>o!==b.originalRefs[j]);});
    }
    const result={descriptor,q,model,renderer,parser,identified,base,rows,companionRows};
    const targetRefusal=resolveTarget(result);
    if(targetRefusal)return targetRefusal;
    if(action==='diagnostic')return{guard:'supported',filled:rows.map(r=>r.filled)};
    if(action==='descriptor')return{descriptor};
    return result;
    function resolveTarget(result){
        if(Number.isSafeInteger(action)){
            if(action<0||!rows[action])return refuse('target-index');
            result.target=rows[action].select;
            return null;
        }
        if(action!=='verify'&&action!=='submit')return null;
        if(rows.some(r=>!r.filled||r.shuffled[r.selectedIndex]!==r.answer))return refuse('answers-not-verified');
        if(action!=='submit')return null;
        const bars=[...document.querySelectorAll('#sa-navigation-controls')].filter(shown).filter(b=>modelOf(b)?.model===model);
        if(bars.length!==1)return refuse('submit-bar');
        const buttons=[...bars[0].querySelectorAll('button')].filter(b=>shown(b)&&b.textContent.trim()==='Submit');
        const enabled=buttons.filter(b=>!b.disabled);
        const submitState={visible:buttons.length,enabled:enabled.length};
        if(buttons.length>1)return {...refuse('submit-button-ambiguous'),submitState};
        // EP SkillsControls locks Submit for one second after loading a question
        // (chunk171: lockedForNewQuestion). Exact answers may settle first.
        if(!enabled.length)return {...result,readiness:'not-ready',submitState};
        result.target=enabled[0];
        return null;
    }
}
module.exports={readDropdownsInPage};
