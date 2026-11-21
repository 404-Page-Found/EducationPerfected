// Destructive maintenance requires local per-item confirmation; every prompt
// defaults to No (keeping the item). No native binding is loaded here;
// bootstrap supplies its owned store and cleanup callback.
// Program removal uses the install record (educationperfected-install.json)
// every installer writes next to the executable; old installs without a record
// are detected from the install location and reported as inferred.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {storageRoot,acquireMaintenance}=require('../lib/storage-maintenance');
const {detectInstall,recordPathFor}=require('../lib/install-record');
const {startWindowsUninstallHelper}=require('./uninstall-windows');

const PACKAGE_NAME='educationperfected';

async function confirmUninstall(input=process.stdin,output=process.stdout,program=null){
 if(!input.isTTY||!output.isTTY)throw new Error('Uninstall requires an interactive terminal');
 output.write('Close every other EducationPerfected copy (including source CLI) and its Chrome window first.\n');
 const rl=require('node:readline').createInterface({input,output});
 // The async iterator buffers pasted multi-line input instead of dropping
 // lines between prompts, and ends (done) on EOF/Ctrl+D: both resolve as No.
 const lines=rl[Symbol.asyncIterator]();
 const ask=async question=>{
  output.write(question);
  const {done,value}=await lines.next();
  return !done&&/^\s*y(es)?\s*$/i.test(value);
 };
 try{
  const login=await ask('Remove the saved login from the OS credential store? [y/N] ');
  const data=await ask('Remove EducationPerfected app data (settings and temporary files)? [y/N] ');
  const browsers=await ask('Remove downloaded browsers (about 200 MB)? [y/N] ');
  const programChoice=program?await ask('Remove the EducationPerfected program itself ('+program+')? [y/N] '):false;
  return {login,data,browsers,program:programChoice};
 }finally{rl.close();}
}

// The Windows setup exe delegates everything to its own Inno uninstaller: it
// removes the program, shortcuts and PATH entry and asks about the saved login
// and app data itself. One confirmation here; the rest is the uninstaller's.
async function confirmInnoUninstall(input=process.stdin,output=process.stdout){
 if(!input.isTTY||!output.isTTY)throw new Error('Uninstall requires an interactive terminal');
 output.write('Close every other EducationPerfected copy (including source CLI) and its Chrome window first.\n');
 const rl=require('node:readline').createInterface({input,output});
 try{
  output.write('Run the EducationPerfected uninstaller now? It removes the program, its Start-menu shortcuts and the PATH entry, then asks about the saved login and app data. [y/N] ');
  const {done,value}=await rl[Symbol.asyncIterator]().next();
  return !done&&/^\s*y(es)?\s*$/i.test(value);
 }finally{rl.close();}
}

function realDirectory(file){const stat=fs.lstatSync(file);return stat.isDirectory()&&!stat.isSymbolicLink();}
function safeRuntimeRoot(tmp,own){
 try{
  if(!realDirectory(tmp))return false;
  for(const name of fs.readdirSync(tmp)){
   const file=path.join(tmp,name);
   if(file===own)continue;
   // Safe stale directories are swept by startup before uninstall. Anything
   // remaining may belong to a live/uncertain browser; do not guess.
   return false;
  }
  return true;
 }catch(error){return error.code==='ENOENT';}
}

// What "remove the program" means per install method. null = nothing the CLI
// can safely remove; it prints what it could not remove instead.
function removalPlan(install,{platform,executable}){
 const recordFile=fs.existsSync(recordPathFor(executable))?recordPathFor(executable):null;
 const ownedFiles=[...new Set([...install.files,...(recordFile?[recordFile]:[])])];
 switch(install.method){
  case 'setup-exe':
   return platform==='win32'&&install.uninstaller?{kind:'inno',uninstaller:install.uninstaller}:null;
  case 'raw-exe':
  case 'install-ps1':
   return platform==='win32'
    ?{kind:'helper-files',files:ownedFiles,pathEntries:install.pathEntries,shortcuts:install.shortcuts,detail:'a background helper removes the executable'+(install.pathEntries.length?' and its PATH entry':'')+' after this program exits'}
    :{kind:'posix-files',files:ownedFiles,detail:'deletes '+ownedFiles.join(', ')};
  case 'raw-binary':
  case 'install-sh':
   return {kind:'posix-files',files:ownedFiles,detail:'deletes '+ownedFiles.join(', ')};
  case 'npm':
   return platform==='win32'
    ?{kind:'helper-npm',detail:'a background helper runs npm uninstall -g '+PACKAGE_NAME+' after this program exits'}
    :{kind:'npm-direct',detail:'runs npm uninstall -g '+PACKAGE_NAME};
  case 'deb':
   return {kind:'package',command:['sudo','apt','remove',PACKAGE_NAME],detail:'runs sudo apt remove '+PACKAGE_NAME};
  case 'rpm':
   return {kind:'package',command:['sudo','rpm','-e',PACKAGE_NAME],detail:'runs sudo rpm -e '+PACKAGE_NAME};
  case 'pkg':
   // No receipt id means no receipt can be forgotten; without one this is a
   // manual removal, not a null argument to spawn. Directories (the .app
   // bundle) are removed recursively; only installer-recorded paths.
   return install.receipt?{kind:'pkg',files:ownedFiles,directories:install.directories||[],receipt:install.receipt,detail:'removes the installed files and the desktop app with sudo and forgets the installer receipt'}:null;
  default:
   return null;
 }
}

async function uninstallCommand({store,ownDirectory,cleanupOwn,home,executable=process.execPath,platform=process.platform,env=process.env,pid=process.pid,tmpDir=os.tmpdir(),confirm=confirmUninstall,confirmInno=confirmInnoUninstall,output=process.stdout,spawn=require('node:child_process').spawnSync,spawnDetached=(command,args)=>require('node:child_process').spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true}).unref()}={}){
 const install=detectInstall({executable,platform,env,spawn});
 output.write(install.inferred
  ?'No install record found; detected the install method from the install location: '+install.method+'.\n'
  :'Install method (from its install record): '+install.method+'.\n');
 const plan=removalPlan(install,{platform,executable});
 const log=path.join(tmpDir,'educationperfected-uninstall.log');
 // The setup exe's own uninstaller owns the whole flow, including its prompts.
 if(plan&&plan.kind==='inno'){
  if(!await confirmInno()){
   output.write('Uninstall cancelled; nothing removed.\n');
   return {cancelled:true};
  }
  startWindowsUninstallHelper({pid,mode:'inno',log,uninstaller:plan.uninstaller,tmp:tmpDir,spawnDetached});
  output.write('The uninstaller starts after this program exits, so the running program can be removed. Uninstaller log: '+log+'\n');
  return {helperStarted:true};
 }
 const choices=await confirm(undefined,undefined,plan?plan.detail:null);
 if(!choices||(!choices.login&&!choices.data&&!choices.browsers&&!choices.program)){output.write('Uninstall cancelled; no app data, browser downloads, saved login or program removed.\n');return {cancelled:true};}
 const root=storageRoot(home),release=acquireMaintenance(root);
 let incomplete=false;
 try{
  // Credential deletion is authorized by the same explicit local confirmation.
  if(choices.login){
   try{await store.remove();output.write('App saved login removed (or none existed).\n');}
   catch{incomplete=true;output.write('Saved login removal failed; unlock the native OS credential store and retry.\n');}
  }
  const tmp=path.join(root,'tmp'),browsers=path.join(root,'browsers');
  if(choices.browsers&&fs.existsSync(browsers)){
   let safe=realDirectory(browsers);
   try{if(safe&&fs.readdirSync(browsers).some(name=>name.endsWith('.lock')||name.startsWith('.download-')))safe=false;}catch{safe=false;}
   if(safe){fs.rmSync(browsers,{recursive:true});output.write('Downloaded browsers removed.\n');}
   else{incomplete=true;output.write('Browser downloads retained: a live download lock or an unexpected path. Close every copy and inspect before removing manually: '+browsers+'\n');}
  }
  if(choices.data){
   let safe=safeRuntimeRoot(tmp,ownDirectory);
   // Unknown root entries are not recursively deleted, nor followed as links.
   try{if(fs.readdirSync(root).some(name=>!['tmp','browsers','MAINTENANCE.lock','config.json'].includes(name)))safe=false;}catch{safe=false;}
   if(!safe){incomplete=true;output.write('Live/uncertain runtime files or unknown app data retained. Close all app/browser processes and inspect before retrying.\n');}
   const config=path.join(root,'config.json');
   try{
    const stat=fs.lstatSync(config);
    if(stat.isFile()&&!stat.isSymbolicLink()){fs.unlinkSync(config);output.write('Saved app settings removed.\n');}
    else{incomplete=true;output.write('Unexpected settings path retained for inspection.\n');}
   }catch(error){if(error.code!=='ENOENT'){incomplete=true;output.write('Saved app settings could not be removed.\n');}}
   try{await cleanupOwn();}catch{incomplete=true;output.write('Owned runtime cleanup failed; retained for inspection.\n');}
   // Only remove empty containers. No recursive root or temp deletion.
   try{fs.rmdirSync(tmp);}catch(error){if(error.code!=='ENOENT')incomplete=true;}
  }
 }finally{release();}
 // Removing the root is best-effort: entries the user chose to keep make it
 // non-empty, which is deliberate, not a failure.
 try{fs.rmdirSync(root);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTEMPTY'&&error.code!=='ENOTDIR')incomplete=true;}
 output.write((incomplete?'Uninstall incomplete; retained data remains.':'Requested items removed.')+'\n');
 // Program removal runs last: on Windows a helper waits for this process to
 // exit, so nothing below may need the executable again.
 let programPending=false;
 if(choices.program&&plan){
  if(plan.kind==='helper-files'){
   startWindowsUninstallHelper({pid,mode:'files',log,files:plan.files,pathEntries:plan.pathEntries,shortcuts:plan.shortcuts,tmp:tmpDir,spawnDetached});
   programPending=true;
  }else if(plan.kind==='helper-npm'){
   startWindowsUninstallHelper({pid,mode:'npm',log,tmp:tmpDir,spawnDetached});
   programPending=true;
  }else if(plan.kind==='posix-files'){
   let failed=null;
   for(const file of plan.files){try{fs.rmSync(file,{force:true});}catch(error){failed=file;incomplete=true;output.write('Could not remove '+file+': '+error.message+'\n');}}
   if(!failed)output.write('Program removed.\n');
  }else if(plan.kind==='npm-direct'){
   const result=spawn('npm',['uninstall','-g',PACKAGE_NAME],{stdio:'inherit'});
   if(result.error||result.status!==0){incomplete=true;output.write('npm uninstall failed; run it by hand: npm uninstall -g '+PACKAGE_NAME+'\n');}
   else output.write('Program removed (npm uninstall -g '+PACKAGE_NAME+').\n');
  }else if(plan.kind==='package'){
   const result=spawn(plan.command[0],plan.command.slice(1),{stdio:'inherit'});
   if(result.error||result.status!==0){incomplete=true;output.write('Package removal failed; run it by hand: '+plan.command.join(' ')+'\n');}
   else output.write('Program removed ('+plan.command.join(' ')+').\n');
  }else if(plan.kind==='pkg'){
   const remove=spawn('sudo',['rm','-rf',...plan.files,...plan.directories],{stdio:'inherit'});
   const forget=remove.error||remove.status!==0?null:spawn('sudo',['pkgutil','--forget',plan.receipt],{stdio:'inherit'});
   if(remove.error||remove.status!==0||(forget&&(forget.error||forget.status!==0))){incomplete=true;output.write('Package removal failed; remove the files and forget the receipt by hand: sudo rm -f '+plan.files.join(' ')+' && sudo pkgutil --forget '+plan.receipt+'\n');}
   else output.write('Program removed (files deleted, installer receipt forgotten).\n');
  }
 }
 if(programPending)output.write('The program removal finishes in the background after this program exits. Log: '+log+'\n');
 else if(!plan)output.write('Delete the executable manually: '+executable+'\n');
 return {incomplete,programPending};
}
module.exports={uninstallCommand,confirmUninstall,confirmInnoUninstall,safeRuntimeRoot,removalPlan};
