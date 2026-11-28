// Fixed bootstrap with inert dependencies. Never downloads, launches or reads stores.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Inert config provider: status tests must never touch a personal store.
require('../lib/app-config').readConfig = () => ({version:1});
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
for(const bad of ['82','0','70-90','85%','100','101','90-70','bogus']) assert.match(parseCommand(['accuracy',bad]).error,/Usage: accuracy/);
assert.deepEqual(parseCommand(['accuracy','off']),{command:'run',accuracy:{perfect:true}});
assert.deepEqual(parseCommand(['accuracy','on']),{command:'run',accuracy:{on:true}});
assert.deepEqual(parseCommand(['--accuracy','on']),{command:'run',accuracy:{on:true}});
assert.match(parseCommand(['--accuracy']).error,/Missing value/);
assert.match(accuracyStatusText({}),/Accuracy: perfect \(100%\)/);
assert.match(accuracyStatusText({EP_ACCURACY:'on'}),/band 70-90%/);
assert.throws(()=>accuracyStatusText({EP_ACCURACY:'82'}),/Invalid EP_ACCURACY/);
assert.match(helpText(),/educationperfected accuracy <on\|off\|status>/);
// The real source-checkout dispatch prints the report without launching.
const statusOut=require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'../bin/cli.js'),'accuracy','status'],{encoding:'utf8',env:{PATH:process.env.PATH,EP_TEST_BOOT:'1'}});
assert.match(statusOut,/Accuracy: perfect \(100%\)/);
assert.match(helpText(),/no answers until start/);
assert.ok(helpText().includes('EP_ACCURACY=on|off'));
// `run` must never dispatch a maintenance subcommand: any bare token after it
// is rejected, and unknown flags fail as options (#331's strict parsing stays).
for(const command of ['setup','check-credentials','forget-credentials','update','uninstall','version','help'])assert.match(parseCommand(['run',command]).error,/one subcommand/);
assert.match(parseCommand(['run','setup','--browser-only']).error,/one subcommand/);
assert.match(parseCommand(['run','--bogus']).error,/Unknown option/);
assert.deepEqual(parseCommand(['run']),{command:'run',accuracy:{}});
assert.deepEqual(parseCommand(['run','--accuracy','on']),{command:'run',accuracy:{on:true}});
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
  if(id==='./update')return {updateCommand:async options=>{assert.equal(options.executable,'fixed.exe');events.push('update');if(updateFails)throw new Error('inert update failure');}};
  if(id==='../lib/credential-store')return {createCredentialStore:()=>({inert:true})};
  if(id==='./uninstall')return {uninstallCommand:async options=>{assert.equal(options.ownDirectory,'/inert-runtime');assert.equal(options.store.inert,true);events.push('uninstall');await options.cleanupOwn();return {incomplete:false};}};
  if(id==='./download-browser')return {ensureBrowser:async(options)=>{let step='acquire';if(options&&options.consent)step=(await options.consent())===true?'acquire-implied':'acquire-refused';events.push(step);if(downloadFails)throw new Error('inert cancellation');},downloadNotice:()=>'inert notice'};
  if(id==='../bin/cli')return {credentialCommand:async command=>{events.push(command);},runCli:async()=>{throw new Error('Must not launch browser');}};
  if(id==='./maintenance-exit')return {shouldExitAfterWindowsUninstall:()=>false,exitAfterMaintenanceHandoff:async()=>false};
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
 const uninstall=await probe(['uninstall']);
 assert.deepEqual(uninstall.events,['runtime','uninstall','cleanup','cleanup']);
 assert.ok(!uninstall.exitCode, 'uninstall probe succeeds without swallowed bootstrap errors');
 assert.deepEqual(uninstall.out,[], 'successful uninstall emits no startup error');
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
