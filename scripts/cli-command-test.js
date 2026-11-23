// Fixed bootstrap with inert dependencies. Never downloads, launches or reads stores.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseCommand,helpText,accuracyStatusText}=require('../lib/cli-command');
for(const command of ['setup','check-credentials','forget-credentials','update','uninstall','version','help'])assert.equal(parseCommand([command]).command,command);
for(const flag of ['-h','--help'])assert.equal(parseCommand([flag]).command,'help');
for(const flag of ['-v','--version'])assert.equal(parseCommand([flag]).command,'version');
for(const command of ['setup','check-credentials','forget-credentials','update','uninstall'])assert.equal(parseCommand(['--'+command]).error,`Use ${command} instead of --${command}.`);
assert.ok(parseCommand(['setup','help']).error);assert.ok(parseCommand(['nonsense']).error);
// Install-time variant: setup --browser-only is the one two-operand subcommand.
assert.deepEqual(parseCommand(['setup','--browser-only']),{command:'setup',browserOnly:true});
assert.ok(parseCommand(['setup','--bogus']).error);
assert.ok(parseCommand(['uninstall','--browser-only']).error);
// Top-level accuracy subcommand (issue #229): operand forms map onto the run's
// accuracy options for this invocation only; bare/status stays read-only.
assert.equal(parseCommand(['accuracy']).command,'accuracy-status');
assert.equal(parseCommand(['accuracy','status']).command,'accuracy-status');
assert.deepEqual(parseCommand(['accuracy','82']),{command:'run',accuracy:{fixedTarget:82}});
assert.deepEqual(parseCommand(['accuracy','0']),{command:'run',accuracy:{fixedTarget:0}});
assert.deepEqual(parseCommand(['accuracy','70-90']),{command:'run',accuracy:{min:70,max:90}});
assert.deepEqual(parseCommand(['accuracy','85%']),{command:'run',accuracy:{fixedTarget:85}});
assert.deepEqual(parseCommand(['accuracy','off']),{command:'run',accuracy:{perfect:true}});
assert.deepEqual(parseCommand(['accuracy','perfect']),{command:'run',accuracy:{perfect:true}});
assert.deepEqual(parseCommand(['accuracy','100']),{command:'run',accuracy:{perfect:true}});
assert.deepEqual(parseCommand(['accuracy','on']),{command:'run',accuracy:{min:70,max:90}});
assert.match(parseCommand(['accuracy','bogus']).error,/Usage: accuracy/);
assert.match(parseCommand(['accuracy','101']).error,/Usage: accuracy/);
assert.match(parseCommand(['accuracy','90-70']).error,/Usage: accuracy/);
// `--accuracy` stays a flag, not the legacy-subcommand hint.
assert.deepEqual(parseCommand(['--accuracy','82']),{command:'run',accuracy:{fixedTarget:82}});
assert.match(parseCommand(['--accuracy']).error,/Missing value/);
// Read-only status report resolves defaults and env without launching.
assert.match(accuracyStatusText({}),/Accuracy: perfect \(100%\)/);
assert.match(accuracyStatusText({EP_PERFECT:'1'}),/Accuracy: perfect/);
assert.match(accuracyStatusText({EP_ACCURACY:'82'}),/fixed target 82%/);
assert.match(accuracyStatusText({EP_ACCURACY_RANGE:'60-80'}),/band 60-80%/);
assert.throws(()=>accuracyStatusText({EP_ACCURACY:'oops'}),/Invalid EP_ACCURACY/);
assert.match(helpText(),/educationperfected accuracy <n\|min-max\|off\|on\|status>/);
// The real source-checkout dispatch prints the report without launching.
const statusOut=require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'../bin/cli.js'),'accuracy','status'],{encoding:'utf8',env:{PATH:process.env.PATH}});
assert.match(statusOut,/Accuracy: perfect \(100%\)/);
assert.match(helpText(),/no answers until start/);
// `run` must never dispatch a maintenance subcommand: any bare token after it
// is rejected, and unknown flags fail as options (#331's strict parsing stays).
for(const command of ['setup','check-credentials','forget-credentials','update','uninstall','version','help'])assert.match(parseCommand(['run',command]).error,/one subcommand/);
assert.match(parseCommand(['run','setup','--browser-only']).error,/one subcommand/);
assert.match(parseCommand(['run','--bogus']).error,/Unknown option/);
assert.deepEqual(parseCommand(['run']),{command:'run',accuracy:{}});
assert.deepEqual(parseCommand(['run','--accuracy','82']),{command:'run',accuracy:{fixedTarget:82}});
assert.ok(helpText().startsWith('EducationPerfected ' + require('../package.json').version + '\n'),'help header derives the version from package.json');
const source=fs.readFileSync(path.join(__dirname,'../packaging/bootstrap.js'),'utf8');
async function probe(args,downloadFails=false,updateFails=false){
 const events=[],out=[];
 const processFixture={argv:['fixed','fixed',...args],env:{},execPath:'fixed.exe',platform:'linux',on(){},removeListener(){}};
 const load=id=>{
  if(id==='../lib/cli-command')return require(id);
  if(id==='../package.json')return {version:'2026.0.0'};
  if(id==='../lib/runtime-directory')return {createRuntimeDirectory:()=>{events.push('runtime');return {directory:'/inert-runtime',remove:()=>{events.push('cleanup');return true;}};}};
  if(id==='node:fs')return {writeFileSync(){}};
  if(id==='node:module')return {createRequire:()=>()=>({})};
  if(id==='node:sea')return {getAsset:key=>key==='manifest'?JSON.stringify({browserMode:'direct-google-download',browserVersion:require('../packaging/browser-downloads.json').version}):new ArrayBuffer(0)};
  if(id==='modern-tar/fs')return {};
  if(id==='../lib/native-binding')return {setPackagedBinding(){}};
  if(id==='./update')return {updateCommand:async options=>{assert.equal(options.executable,'fixed.exe');events.push('update');if(updateFails)throw Error('inert update failure');}};
  if(id==='../lib/credential-store')return {createCredentialStore:()=>({inert:true})};
  if(id==='./uninstall')return {uninstallCommand:async options=>{assert.equal(options.ownDirectory,'/inert-runtime');assert.equal(options.store.inert,true);events.push('uninstall');await options.cleanupOwn();return {incomplete:false};}};
  if(id==='./download-browser')return {ensureBrowser:async(options)=>{events.push(options&&options.consent?(await options.consent())===true?'acquire-implied':'acquire-refused':'acquire');if(downloadFails)throw Error('inert cancellation');},downloadNotice:()=>'inert notice'};
  if(id==='../bin/cli')return {credentialCommand:async command=>{events.push(command);},runCli:async()=>{throw Error('Must not launch browser');}};
  if(id==='../lib/diagnostics')return {diagnostic:()=> 'inert'};
  return require(id);
 };
 vm.runInNewContext(source,{require:load,process:processFixture,Buffer,console:{log:text=>out.push(text),error:text=>out.push(text)}}); // NOSONAR - fixed repository bootstrap only with inert dependencies.
 for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
 return {events,out,exitCode:processFixture.exitCode};
}
(async()=>{
 for(const args of [['help'],['-h'],['--help'],['version'],['-v'],['--version']])assert.deepEqual((await probe(args)).events,[]);
 for(const command of ['setup','check-credentials','forget-credentials','update','uninstall']){
  const result=await probe(['--'+command]);assert.deepEqual(result.events,[]);assert.equal(result.exitCode,1);assert.ok(result.out[0].includes('Use '+command));
 }
 assert.deepEqual((await probe(['update'])).events,['update']);
 const failedUpdate=await probe(['update'],false,true);assert.deepEqual(failedUpdate.events,['update']);assert.equal(failedUpdate.exitCode,1);assert.deepEqual(failedUpdate.out,['inert']);
 assert.deepEqual((await probe(['uninstall'])).events,['runtime','uninstall','cleanup','cleanup']);
 assert.deepEqual((await probe(['setup'])).events,['runtime','acquire','--setup','cleanup']);
 assert.deepEqual((await probe(['setup'],true)).events,['runtime','acquire','cleanup']);
 // Install-time variant: implied consent, the notice, and no login prompt.
 const browserOnly=await probe(['setup','--browser-only']);
 assert.deepEqual(browserOnly.events,['runtime','acquire-implied','cleanup']);
 assert.ok(browserOnly.out.includes('inert notice'));
 assert.ok(browserOnly.out.some(line=>String(line).includes('Browser ready')));
 assert.deepEqual((await probe(['setup','--browser-only'],true)).events,['runtime','acquire-implied','cleanup']);
 for(const command of ['check-credentials','forget-credentials'])assert.deepEqual((await probe([command])).events,['runtime','--'+command,'cleanup']);
 // accuracy status stays read-only in the packaged bootstrap: no runtime, no browser.
 for(const args of [['accuracy'],['accuracy','status']]){
  const result=await probe(args);assert.deepEqual(result.events,[]);assert.match(result.out[0],/Accuracy: perfect \(100%\)/);assert.ok(!result.exitCode);
 }
 // `run uninstall` (and any maintenance token after `run`) is rejected, never dispatched.
 for(const command of ['uninstall','forget-credentials','update','setup']){
  const result=await probe(['run',command]);assert.deepEqual(result.events,[]);assert.equal(result.exitCode,1);assert.ok(result.out[0].includes('one subcommand'));
 }
 console.log('Subcommand/flag dispatch, side-effect-free help/version/legacy refusals, consent-before-optional-store setup passed (inert).');
})().catch(error=>{console.error(error);process.exitCode=1;});
