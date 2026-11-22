// Synthetic files/store only. Never removes user data or real credentials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {uninstallCommand,confirmUninstall,confirmInnoUninstall,removalPlan}=require('../packaging/uninstall');
const {PassThrough}=require('node:stream');
const {acquireMaintenance,storageRoot}=require('../lib/storage-maintenance');
const {createRuntimeDirectory}=require('../lib/runtime-directory');
(async()=>{
 const lockedHome=fs.mkdtempSync(path.join(os.tmpdir(),'ep-maintenance-inert-'));
 try{const root=storageRoot(lockedHome),write=fs.writeFileSync;try{fs.writeFileSync=()=>{throw Error('inert lock write');};assert.throws(()=>acquireMaintenance(root),/inert lock write/);}finally{fs.writeFileSync=write;}assert.equal(fs.existsSync(path.join(root,'MAINTENANCE.lock')),false);const release=acquireMaintenance(root);assert.throws(()=>createRuntimeDirectory({home:lockedHome}),{code:'EEXIST'});release();const runtime=createRuntimeDirectory({home:lockedHome});assert.ok(runtime.remove(true));}finally{fs.rmSync(lockedHome,{recursive:true,force:true});}
 const ALL={login:true,data:true,browsers:true};
 const choicesFor=scenario=>({
  cancel:{login:false,data:false,browsers:false},
  'keep-browsers':{login:true,data:true,browsers:false},
  'login-only':{login:true,data:false,browsers:false},
 }[scenario]||ALL);
 for(const scenario of ['cancel','empty','safe','keep-browsers','login-only','other-run','download-lock','unknown','store-error','browser-symlink','cleanup-error','app-data','legacy-app-data']){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-inert-'));
  try{
   const runtime=createRuntimeDirectory({home});
   const root=path.join(fs.realpathSync(home),'.educationperfected'),browsers=path.join(root,'browsers');
   fs.mkdirSync(browsers);fs.writeFileSync(path.join(browsers,'inert-browser'),'keep-until-confirmed');
   fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({version:1,delay:{enabled:false,override:null}}));
   if(scenario==='empty')fs.rmSync(browsers,{recursive:true});
   if(scenario==='other-run')fs.mkdirSync(path.join(root,'tmp','run-ABC123'));
   if(scenario==='download-lock')fs.writeFileSync(path.join(browsers,'version.lock'),'inert');
   if(scenario==='unknown')fs.writeFileSync(path.join(root,'unknown'),'inert');
   if(scenario==='app-data'){fs.mkdirSync(path.join(root,'app-data','Partitions'),{recursive:true});fs.writeFileSync(path.join(root,'app-data','Partitions','inert-session'),'inert');}
   if(scenario==='legacy-app-data'){const legacy=path.join(home,'.config','EducationPerfected');fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'Local State'),'inert');}
   if(scenario==='browser-symlink'){fs.rmSync(browsers,{recursive:true});fs.mkdirSync(path.join(home,'unrelated'));fs.writeFileSync(path.join(home,'unrelated','keep'),'inert');fs.symlinkSync(path.join(home,'unrelated'),browsers,process.platform==='win32'?'junction':'dir');}
   const choices=choicesFor(scenario);
   let removed=0,output='';
   const perform=()=>uninstallCommand({home,ownDirectory:runtime.directory,cleanupOwn:async()=>{if(scenario==='cleanup-error')throw Error('inert');runtime.remove(true);},executable:'inert.exe',env:{},confirm:async()=>choices,output:{write:text=>{output+=text;}},store:{async remove(){removed++;if(scenario==='store-error')throw Error('inert');}}});
   const result=await perform();
   assert.equal(removed,choices.login?1:0,'store.remove called exactly when the login item is confirmed');
   if(scenario==='cancel'){
    assert.equal(result.cancelled,true);assert.ok(fs.existsSync(runtime.directory));assert.ok(fs.existsSync(browsers));
    assert.ok(output.includes('Uninstall cancelled'));
   }else{
    assert.ok(!output.includes('Uninstall cancelled'));
    if(scenario==='empty'||scenario==='safe'){assert.equal(result.incomplete,false);assert.equal(fs.existsSync(root),false,'everything chosen, everything removed, root gone');}
    else if(scenario==='keep-browsers'){assert.equal(result.incomplete,false);assert.ok(fs.existsSync(path.join(browsers,'inert-browser')),'browser downloads deliberately kept');assert.equal(fs.existsSync(runtime.directory),false);}
    else if(scenario==='login-only'){assert.equal(result.incomplete,false);assert.ok(fs.existsSync(runtime.directory));assert.ok(fs.existsSync(path.join(browsers,'inert-browser')));}
    else if(scenario==='app-data'){assert.equal(result.incomplete,false);assert.equal(fs.existsSync(path.join(root,'app-data')),false,'desktop app data removed with app-data consent');assert.ok(output.includes('Desktop app data removed.'));}
    else if(scenario==='legacy-app-data'){assert.equal(result.incomplete,false);assert.equal(fs.existsSync(path.join(home,'.config','EducationPerfected')),false,'pre-relocation desktop app data removed with app-data consent');assert.ok(output.includes('Old desktop app data removed'));}
    else{
     assert.equal(result.incomplete,true,scenario);
     if(scenario==='browser-symlink')assert.ok(fs.existsSync(path.join(home,'unrelated','keep')),'symlinked browser dir never followed');
     else if(scenario==='download-lock')assert.ok(fs.existsSync(path.join(browsers,'inert-browser')),'live download lock retains the browsers');
     else assert.equal(fs.existsSync(browsers),false,'healthy browsers were chosen for removal')
    }
    // Program removal was offered but not confirmed (stub choices carry no
    // program key): the executable stays, with no manual-delete nudge.
    assert.ok(!output.includes('Delete the executable manually'),'declined program removal is not nagged about');
    assert.ok(output.includes('detected the install method'),'inert.exe has no record; method is inferred');
   }
   assert.equal(fs.existsSync(path.join(root,'config.json')),!choices.data,'settings removed only with app-data consent');
   assert.ok(!output.includes('Error:'));
  }finally{fs.rmSync(home,{recursive:true,force:true});}
 }
 // Program removal per install method (synthetic; spawns captured, never run).
 const runProgramScenario=async({record,platform,method,choices={},spawnStatus=0,execName})=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-program-'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-tmp-'));
  try{
   const runtime=createRuntimeDirectory({home});
   const exe=path.join(home,execName||'educationperfected');
   fs.writeFileSync(exe,'inert-program');
   let recordFile=null;
   if(record){
    if(record.uninstallerFixture){fs.writeFileSync(path.join(home,'unins000.exe'),'inert-uninstaller');record={...record,uninstaller:path.join(home,'unins000.exe')};delete record.uninstallerFixture;}
    else if(record.uninstallerFallbackFixture){fs.writeFileSync(path.join(home,'unins000.exe'),'inert-uninstaller');delete record.uninstallerFallbackFixture;}
    recordFile=path.join(home,'educationperfected-install.json');
    fs.writeFileSync(recordFile,JSON.stringify({version:1,method,files:[exe,path.join(home,'educationperfected-install.json')],...record}));
   }
   const spawns=[],detached=[];
   let output='';
   const result=await uninstallCommand({
    home,ownDirectory:runtime.directory,cleanupOwn:async()=>{runtime.remove(true);},
    waitForHelperReady:async()=>{},executable:exe,platform,env:{},tmpDir:tmp,pid:43210,
    confirm:async()=>({login:false,data:true,browsers:false,...choices}),
    confirmInno:async()=>choices.inno===true,
    output:{write:text=>{output+=text;}},
    store:{async remove(){throw Error('not asked');}},
    spawn:(...args)=>{spawns.push(args);return {status:spawnStatus};},
    spawnDetached:(...args)=>{detached.push(args);},
   });
   return {result,output,spawns,detached,exe,recordFile,home,tmp,runtime};
  }catch(error){fs.rmSync(home,{recursive:true,force:true});fs.rmSync(tmp,{recursive:true,force:true});throw error;}
 };
 const scriptFor=tmp=>path.join(tmp,fs.readdirSync(tmp).find(name=>name.endsWith('.ps1')));
 const cleanup=scenario=>{fs.rmSync(scenario.home,{recursive:true,force:true});fs.rmSync(scenario.tmp,{recursive:true,force:true});};
 // install.sh on macOS/Linux: record-listed files deleted directly.
 {
  const s=await runProgramScenario({method:'install-sh',record:{},platform:'linux',choices:{program:true}});
  assert.equal(s.result.incomplete,false);assert.equal(fs.existsSync(s.exe),false,'record exe removed');assert.equal(fs.existsSync(s.recordFile),false,'record removed');
  assert.ok(s.output.includes('Program removed.'));assert.ok(!s.output.includes('Delete the executable manually'));
  assert.ok(s.output.includes('from its install record'));assert.deepEqual(s.spawns,[]);assert.deepEqual(s.detached,[]);
  cleanup(s);
 }
 // install.sh with program NOT confirmed: files stay, no manual-delete nudge for a kept program.
 {
  const s=await runProgramScenario({method:'install-sh',record:{},platform:'linux',choices:{program:false}});
  assert.equal(fs.existsSync(s.exe),true);assert.ok(!s.output.includes('Delete the executable manually'));
  cleanup(s);
 }
 // npm on macOS/Linux: npm uninstall -g runs directly.
 {
  const s=await runProgramScenario({method:'npm',record:{},platform:'darwin',choices:{program:true}});
  assert.deepEqual(s.spawns.map(([c,a])=>[c,...a]),[['npm','uninstall','-g','educationperfected']]);
  assert.ok(s.output.includes('Program removed (npm uninstall -g educationperfected).'));
  cleanup(s);
 }
 // npm failure: reported incomplete with the manual command.
 {
  const s=await runProgramScenario({method:'npm',record:{},platform:'darwin',choices:{program:true},spawnStatus:1});
  assert.equal(s.result.incomplete,true);assert.ok(s.output.includes('run it by hand: npm uninstall -g educationperfected'));
  cleanup(s);
 }
 // .deb and .rpm go through the package manager with sudo.
 {
  const s=await runProgramScenario({method:'deb',record:{},platform:'linux',choices:{program:true}});
  assert.deepEqual(s.spawns.map(([c,a])=>[c,...a]),[['sudo','apt','remove','educationperfected']]);
  assert.ok(s.output.includes('Program removed (sudo apt remove educationperfected).'));
  cleanup(s);
 }
 {
  const s=await runProgramScenario({method:'rpm',record:{},platform:'linux',choices:{program:true}});
  assert.deepEqual(s.spawns.map(([c,a])=>[c,...a]),[['sudo','rpm','-e','educationperfected']]);
  cleanup(s);
 }
 // .pkg removes the recorded files and forgets the receipt, both with sudo.
 {
  const s=await runProgramScenario({method:'pkg',record:{receipt:'com.404pf.educationperfected'},platform:'darwin',choices:{program:true}});
  assert.deepEqual(s.spawns.map(([c,a])=>[c,...a]),[['sudo','rm','-rf',s.exe,s.recordFile],['sudo','pkgutil','--forget','com.404pf.educationperfected']]);
  assert.ok(s.output.includes('installer receipt forgotten'));
  cleanup(s);
 }
 // .pkg with the desktop app recorded: the .app directory goes in the same recursive removal.
 {
  const s=await runProgramScenario({method:'pkg',record:{receipt:'com.404pf.educationperfected',directories:['/Applications/EducationPerfected.app']},platform:'darwin',choices:{program:true}});
  assert.deepEqual(s.spawns.map(([c,a])=>[c,...a]),[['sudo','rm','-rf',s.exe,s.recordFile,'/Applications/EducationPerfected.app'],['sudo','pkgutil','--forget','com.404pf.educationperfected']]);
  cleanup(s);
 }
 // A record claiming unrelated directories: recursive removal is allowlisted to the installer-recorded app bundle.
 {
  const s=await runProgramScenario({method:'pkg',record:{receipt:'com.404pf.educationperfected',directories:['/System/Library','/Users']},platform:'darwin',choices:{program:true}});
  assert.deepEqual(s.spawns.map(([c,a])=>[c,...a]),[['sudo','rm','-rf',s.exe,s.recordFile],['sudo','pkgutil','--forget','com.404pf.educationperfected']]);
  cleanup(s);
 }
 // Windows install.ps1: background helper, PATH entry and files passed through, exe still present.
 {
  const s=await runProgramScenario({method:'install-ps1',record:{pathEntries:['C:\\\\Programs\\\\EducationPerfected']},platform:'win32',choices:{program:true},execName:'educationperfected.exe'});
  assert.equal(s.detached.length,1);assert.equal(s.detached[0][0],'powershell.exe');
  const helperPath=scriptFor(s.tmp);
  const helper=fs.readFileSync(helperPath,'utf8');
  assert.ok(helper.includes('Wait-Process -Id 43210'),'helper waits for the CLI pid');
  assert.ok(helper.includes(s.exe),'helper deletes the executable');
  assert.ok(helper.includes('c:\\\\programs\\\\educationperfected'),'helper removes the PATH entry (matched case-insensitively)');
  assert.ok(helper.includes(path.join(s.tmp,'educationperfected-uninstall.log')),'helper logs to the printed log file');
  assert.equal(fs.existsSync(s.exe),true,'the running exe is never deleted synchronously');
  assert.equal(s.result.programPending,true);
  assert.ok(s.output.includes('finishes in the background'));assert.ok(!s.output.includes('Delete the executable manually'));
  cleanup(s);
 }
 // Windows install.ps1 record written by PowerShell 5.1: pathEntries unwrapped
 // to a bare string still reaches the helper as the PATH entry to remove.
 {
  const s=await runProgramScenario({method:'install-ps1',record:{pathEntries:'C:\\Programs\\EducationPerfected'},platform:'win32',choices:{program:true},execName:'educationperfected.exe'});
  assert.equal(s.detached.length,1);
  const helper=fs.readFileSync(scriptFor(s.tmp),'utf8');
  assert.ok(helper.includes('c:\\programs\\educationperfected'),'bare-string PATH entry is removed by the helper');
  assert.equal(s.result.programPending,true);
  cleanup(s);
 }
 // Windows npm: helper runs npm uninstall after exit.
 {
  const s=await runProgramScenario({method:'npm',record:{},platform:'win32',choices:{program:true},execName:'educationperfected.exe'});
  const helper=fs.readFileSync(scriptFor(s.tmp),'utf8');
  assert.ok(helper.includes('npm.cmd'),'helper locates npm');assert.ok(helper.includes('uninstall -g educationperfected'));
  assert.equal(s.result.programPending,true);
  cleanup(s);
 }
 // Windows raw exe without a record: method inferred, helper still offered.
 {
  const s=await runProgramScenario({record:null,platform:'win32',choices:{program:true},execName:'educationperfected-windows-x64.exe'});
  assert.ok(s.output.includes('No install record found; detected the install method from the install location: raw-exe.'));
  assert.equal(s.detached.length,1);assert.equal(s.result.programPending,true);
  assert.ok(fs.existsSync(s.exe),'exe removed by the helper, not the CLI');
  cleanup(s);
 }
 // Windows setup exe: single confirm launches the Inno uninstaller via helper; no per-item prompts.
 {
  const s=await runProgramScenario({method:'setup-exe',record:{uninstallerFixture:true},platform:'win32',choices:{inno:true},execName:'educationperfected.exe'});
  assert.equal(s.detached.length,1);
  const helper=fs.readFileSync(scriptFor(s.tmp),'utf8');
  assert.ok(helper.includes('unins000.exe'),'helper starts the Inno uninstaller');
  assert.ok(helper.includes('waiting for cli pid'), 'helper logs its parent wait');
  assert.ok(helper.includes('FAILED: CLI is still running; nothing removed'), 'timeout never races a running program');
  assert.ok(helper.includes('/LOG='), 'Inno receives its own diagnostic log');
  assert.ok(helper.includes('-WorkingDirectory'), 'uninstaller does not inherit the installation directory');
  assert.ok(s.output.includes('The uninstaller starts after this program exits'));
  assert.equal(fs.existsSync(s.runtime.directory),true,'data steps untouched; the Inno uninstaller asks about them itself');
  assert.equal(s.result.helperStarted,true);
  cleanup(s);
 }
 // Windows setup exe whose record points at a path that does not exist (an
 // install record written before the installer escaped non-ASCII characters
 // comes back mangled): the uninstaller next to the executable is used.
 {
  const s=await runProgramScenario({method:'setup-exe',record:{uninstaller:'C:\\\\Edu\\uFFFDtionPerfected\\\\unins000.exe',uninstallerFallbackFixture:true},platform:'win32',choices:{inno:true},execName:'educationperfected.exe'});
  assert.equal(s.detached.length,1);
  const helper=fs.readFileSync(scriptFor(s.tmp),'utf8');
  assert.ok(helper.includes(path.join(s.home,'unins000.exe')),'helper starts the uninstaller next to the executable, not the mangled record path');
  assert.equal(s.result.helperStarted,true);
  cleanup(s);
 }
 // Windows setup exe whose uninstaller is nowhere: no invented path, manual line.
 {
  const s=await runProgramScenario({method:'setup-exe',record:{uninstaller:'C:\\\\gone\\\\unins000.exe'},platform:'win32',choices:{inno:true},execName:'educationperfected.exe'});
  assert.deepEqual(s.detached,[]);
  assert.ok(s.output.includes('Delete the executable manually: '+s.exe));
  cleanup(s);
 }
 // Windows setup exe declined: cancelled, nothing launched.
 {
  const s=await runProgramScenario({method:'setup-exe',record:{uninstallerFixture:true},platform:'win32',choices:{inno:false},execName:'educationperfected.exe'});
  assert.equal(s.result.cancelled,true);assert.deepEqual(s.detached,[]);
  cleanup(s);
 }
 // .pkg record without a receipt id: no program plan, no spawn with null args, manual line.
 {
  const s=await runProgramScenario({method:'pkg',record:{receipt:null},platform:'darwin',choices:{program:true}});
  assert.deepEqual(s.spawns,[],'no sudo spawn without a receipt');
  assert.ok(s.output.includes('Delete the executable manually: '+s.exe));
  assert.equal(s.result.incomplete,false);
  cleanup(s);
 }
 // A failing powershell.exe spawn (error event) rejects the uninstall with a
 // shown error instead of a silent no-op after quit, and is logged.
 {
  const {EventEmitter}=require('node:events');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-spawnerr-'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-tmp-'));
  try{
   const runtime=createRuntimeDirectory({home});
   const exe=path.join(home,'educationperfected.exe');fs.writeFileSync(exe,'inert');
   fs.writeFileSync(path.join(home,'educationperfected-install.json'),JSON.stringify({version:1,method:'install-ps1',files:[exe]}));
   const child=new EventEmitter();
   setTimeout(()=>child.emit('error',new Error('inert spawn failure')),20);
   await assert.rejects(
    uninstallCommand({home,ownDirectory:runtime.directory,cleanupOwn:async()=>{runtime.remove(true);},executable:exe,platform:'win32',env:{},tmpDir:tmp,pid:1,confirm:async()=>({login:false,data:false,browsers:false,program:true}),output:{write:()=>{}},store:{async remove(){}},spawnDetached:()=>child}),
    /Could not start the uninstall helper \(inert spawn failure\)/);
   assert.ok(fs.existsSync(exe),'exe untouched when the helper never started');
   const log=path.join(tmp,'educationperfected-uninstall.log');
   assert.ok(fs.readFileSync(log,'utf8').includes('helper spawn failed: inert spawn failure'));
  }finally{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(tmp,{recursive:true,force:true});}
 }
 // A confirmed helper spawn (spawn event) hands off and the helper script is
 // written with a UTF-8 BOM so PowerShell 5.1 parses non-ASCII paths.
 {
  const {EventEmitter}=require('node:events');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-spawnok-'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-tmp-'));
  try{
   const runtime=createRuntimeDirectory({home});
   const exe=path.join(home,'educationperfected.exe');fs.writeFileSync(exe,'inert');
   fs.writeFileSync(path.join(home,'educationperfected-install.json'),JSON.stringify({version:1,method:'install-ps1',files:[exe]}));
   const child=new EventEmitter();const spawned=[];
   setTimeout(()=>child.emit('spawn'),20);
   const result=await uninstallCommand({home,ownDirectory:runtime.directory,cleanupOwn:async()=>{runtime.remove(true);},executable:exe,platform:'win32',env:{},tmpDir:tmp,pid:1,confirm:async()=>({login:false,data:false,browsers:false,program:true}),output:{write:()=>{}},store:{async remove(){}},waitForHelperReady:async()=>{},spawnDetached:(...args)=>{spawned.push(args);return child;}});
   assert.equal(result.programPending,true);
   const ps1=scriptFor(tmp);
   const bytes=fs.readFileSync(ps1);
   assert.deepEqual([...bytes.subarray(0,3)],[0xEF,0xBB,0xBF],'helper script starts with a UTF-8 BOM');
  }finally{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(tmp,{recursive:true,force:true});}
 }
 // resolvePowerShell prefers the stable absolute SystemRoot path when it exists.
 {
  const {resolvePowerShell}=require('../packaging/uninstall-windows');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-winroot-'));
  try{
   const full=path.join(root,'System32','WindowsPowerShell','v1.0');fs.mkdirSync(full,{recursive:true});fs.writeFileSync(path.join(full,'powershell.exe'),'inert');
   assert.equal(resolvePowerShell({SystemRoot:root}),path.join(full,'powershell.exe'));
   assert.equal(resolvePowerShell({}),'powershell.exe');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
 // Unknown system package (no record, /usr/bin, neither dpkg nor rpm owns it): no program prompt, manual line.
 {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-uninstall-unknown-'));
  try{
   const runtime=createRuntimeDirectory({home});
   let output='';const prompts=[];
   const result=await uninstallCommand({
    home,ownDirectory:runtime.directory,cleanupOwn:async()=>{runtime.remove(true);},
    executable:'/usr/bin/educationperfected',platform:'linux',env:{},
    confirm:async(i,o,program)=>{prompts.push(program);return {login:false,data:true,browsers:false,program:program===null?undefined:false};},
    output:{write:text=>{output+=text;}},store:{async remove(){}},
    spawn:()=>({status:1}),
   });
   assert.deepEqual(prompts,[null],'no program prompt when the package owner is unknown');
   assert.ok(output.includes(': unknown-package.'));
   assert.ok(output.includes('Delete the executable manually: /usr/bin/educationperfected'));
  }finally{fs.rmSync(home,{recursive:true,force:true});}
 }
 // confirmUninstall parsing: empty answers and EOF default to No; pasted
 // multi-line input is buffered, not dropped; only y/yes counts as yes.
 for(const [typed,expected] of [
  ['\n\n\n',{login:false,data:false,browsers:false,program:false}],
  ['',{login:false,data:false,browsers:false,program:false}],
  ['y\nyes\nN\n',{login:true,data:true,browsers:false,program:false}],
  ['y\ny\ny\nextra\n',{login:true,data:true,browsers:true,program:false}],
  ['YES\nn\nmaybe\n',{login:true,data:false,browsers:false,program:false}],
 ]){
  const input=new PassThrough(),output=new PassThrough();
  input.isTTY=true;output.isTTY=true;
  const pending=confirmUninstall(input,output);
  if(typed)input.write(typed);
  input.end();
  assert.deepEqual(await pending,expected,'default-No parsing for '+JSON.stringify(typed));
 }
 // With a program removal offered, a fourth answer is consumed, default No.
 for(const [typed,expected] of [
  ['y\ny\ny\ny\n',{login:true,data:true,browsers:true,program:true}],
  ['y\ny\ny\n\n',{login:true,data:true,browsers:true,program:false}],
  ['y\ny\ny\n',{login:true,data:true,browsers:true,program:false}],
 ]){
  const input=new PassThrough(),output=new PassThrough();
  input.isTTY=true;output.isTTY=true;
  const pending=confirmUninstall(input,output,'a test removal');
  input.write(typed);input.end();
  assert.deepEqual(await pending,expected,'program prompt parsing for '+JSON.stringify(typed));
 }
 const noTty=new PassThrough();await assert.rejects(()=>confirmUninstall(noTty,Object.assign(new PassThrough(),{isTTY:true})),/interactive terminal/);
 await assert.rejects(()=>confirmInnoUninstall(noTty,Object.assign(new PassThrough(),{isTTY:true})),/interactive terminal/);
 // removalPlan never offers program removal for unknown methods.
 assert.equal(removalPlan({method:'unknown-package',files:[],pathEntries:[],shortcuts:[]},{platform:'linux',executable:'/usr/bin/educationperfected'}),null);
 console.log('Uninstall per-item Y/n (default No), program removal per install method (record + inferred), Windows detached helper, cancel keeps all, safe removal, live/unknown/download-lock retention, deliberate keeps, credential failure and prompt parsing (empty/EOF/paste) passed (synthetic).');
})().catch(error=>{console.error(error);process.exitCode=1;});
