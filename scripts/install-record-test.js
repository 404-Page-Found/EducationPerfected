// Synthetic install records and helper scripts only. No real installs touched.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {RECORD_NAME,PKG_RECEIPT,recordPathFor,normalizeRecord,readInstallRecord,inferInstall,detectInstall}=require('../lib/install-record');
const {windowsUninstallHelperScript,psLiteral}=require('../packaging/uninstall-windows');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-install-record-'));
const exe=path.join(home,'educationperfected');
fs.writeFileSync(exe,'inert');
// normalizeRecord shape checks
assert.equal(normalizeRecord(null),null);
assert.equal(normalizeRecord({version:2,method:'npm'}),null,'record version must be 1');
assert.equal(normalizeRecord({version:1,method:'curl'}),null,'unknown method rejected');
assert.deepEqual(normalizeRecord({version:1,method:'npm'}),{version:1,method:'npm',files:[],pathEntries:[],shortcuts:[],uninstaller:null,receipt:null});
assert.deepEqual(normalizeRecord({version:1,method:'deb',files:['/usr/bin/educationperfected'],pathEntries:'oops',shortcuts:[1]}).files,['/usr/bin/educationperfected']);
// PowerShell 5.1's ConvertTo-Json unwraps one-element arrays into bare strings
// and empty arrays into null; both forms must still normalize.
assert.deepEqual(normalizeRecord({version:1,method:'install-ps1',pathEntries:'C:\\Programs\\EducationPerfected'}).pathEntries,['C:\\Programs\\EducationPerfected'],'bare-string pathEntries counts as one entry');
assert.deepEqual(normalizeRecord({version:1,method:'install-ps1',pathEntries:null}).pathEntries,[],'null pathEntries normalizes to none');
assert.deepEqual(normalizeRecord({version:1,method:'install-ps1',files:'C:\\Programs\\EducationPerfected\\educationperfected.exe'}).files,[],'bare-string files dropped: the deletion list stays array-only');
assert.deepEqual(normalizeRecord({version:1,method:'install-ps1',shortcuts:'C:\\shortcut.lnk'}).shortcuts,[],'bare-string shortcuts dropped');
assert.deepEqual(normalizeRecord({version:1,method:'deb',pathEntries:[1],'shortcuts':['ok',2]}).pathEntries,[],'non-string arrays dropped');
assert.deepEqual(normalizeRecord({version:1,method:'deb',pathEntries:[1],shortcuts:['ok',2]}).shortcuts,[],'mixed arrays dropped');
// readInstallRecord: missing, malformed, valid; relative paths never read cwd.
assert.equal(readInstallRecord(path.join(home,'missing')),null,'no record file');
fs.writeFileSync(recordPathFor(exe),'not json');
assert.equal(readInstallRecord(exe),null,'malformed record treated as absent');
fs.writeFileSync(recordPathFor(exe),JSON.stringify({version:1,method:'install-sh',files:[exe]}));
assert.equal(readInstallRecord(exe).method,'install-sh');
assert.equal(readInstallRecord('relative.exe'),null,'relative executable has no record');
fs.rmSync(recordPathFor(exe));
// inferInstall: Windows locations
const winBase={platform:'win32',env:{},spawn:()=>({status:1})};
fs.writeFileSync(path.join(home,'unins000.exe'),'inert');
assert.equal(inferInstall({...winBase,executable:exe}).method,'setup-exe','unins000.exe next to the exe means the setup exe installed it');
fs.rmSync(path.join(home,'unins000.exe'));
assert.equal(inferInstall({...winBase,executable:'C:\\npm\\node_modules\\educationperfected\\vendor\\educationperfected.exe'}).method,'npm');
assert.equal(inferInstall({...winBase,env:{LOCALAPPDATA:'C:\\Users\\page\\AppData\\Local'},executable:'C:\\Users\\page\\AppData\\Local\\Programs\\EducationPerfected\\educationperfected.exe'}).method,'install-ps1');
assert.equal(inferInstall({...winBase,executable:'C:\\Users\\page\\Downloads\\educationperfected-windows-x64.exe'}).method,'raw-exe');
// inferInstall: POSIX locations
assert.equal(inferInstall({platform:'linux',env:{},executable:'/usr/lib/node_modules/educationperfected/vendor/educationperfected'}).method,'npm');
assert.equal(inferInstall({platform:'linux',env:{},executable:'/usr/bin/educationperfected',spawn:command=>command==='dpkg'?{status:0}:{status:1}}).method,'deb');
assert.equal(inferInstall({platform:'linux',env:{},executable:'/usr/bin/educationperfected',spawn:command=>command==='rpm'?{status:0}:{status:1}}).method,'rpm');
assert.equal(inferInstall({platform:'linux',env:{},executable:'/usr/bin/educationperfected',spawn:()=>({status:1})}).method,'unknown-package');
assert.equal(inferInstall({platform:'darwin',env:{},executable:'/usr/local/bin/educationperfected'}).method,'pkg');
assert.equal(inferInstall({platform:'darwin',env:{},executable:'/usr/local/bin/educationperfected'}).receipt,PKG_RECEIPT);
assert.equal(inferInstall({platform:'darwin',env:{},executable:path.join(home,'educationperfected-macos-arm64')}).method,'raw-binary');
// detectInstall: a record always wins over inference
fs.writeFileSync(recordPathFor(exe),JSON.stringify({version:1,method:'npm',files:[exe]}));
assert.deepEqual(detectInstall({executable:exe,platform:'win32',env:{}}).inferred,false);
assert.equal(detectInstall({executable:exe,platform:'win32',env:{}}).method,'npm');
fs.rmSync(recordPathFor(exe));
assert.equal(detectInstall({executable:exe,platform:'darwin',env:{}}).inferred,true);
// PowerShell helper script construction
assert.equal(psLiteral("C:\\it's"),"'C:\\it''s'",'single quotes doubled');
assert.throws(()=>psLiteral('a\nb'),/newlines/);
const filesScript=windowsUninstallHelperScript({pid:42,mode:'files',log:'C:\\ep-logs\\u.log',files:['C:\\ep\\educationperfected.exe'],pathEntries:['C:\\ep'],shortcuts:['C:\\ep\\ep.lnk']});
assert.ok(filesScript.includes('Wait-Process -Id 42'),'helper waits for the CLI process');
assert.ok(filesScript.includes('Remove-Item -LiteralPath $f -Force'),'helper deletes files');
assert.ok(filesScript.includes('C:\\ep\\educationperfected.exe'),'files embedded as literals');
assert.ok(filesScript.includes("'c:\\ep'"),'PATH entries embedded lowercased for case-insensitive matching');
assert.ok(filesScript.includes('ExpandString'),'PATH rewrite stays REG_EXPAND_SZ');
assert.ok(filesScript.includes('PathType Container'),'files mode never recursively deletes a directory entry');
assert.ok(filesScript.includes('skipped directory'),'directory entries are logged and skipped');
assert.ok(!filesScript.includes('-Recurse'),'no recursive removal in files mode');
assert.ok(filesScript.includes('$PSCommandPath'),'helper deletes itself');
const npmScript=windowsUninstallHelperScript({pid:42,mode:'npm',log:'C:\\ep-logs\\u.log'});
assert.ok(npmScript.includes('npm.cmd')&&npmScript.includes('uninstall -g educationperfected'));
assert.throws(()=>windowsUninstallHelperScript({pid:42,mode:'inno',log:'C:\\ep-logs\\u.log'}),/uninstaller path/);
assert.throws(()=>windowsUninstallHelperScript({pid:0,mode:'npm',log:'x'}),/process id/);
assert.throws(()=>windowsUninstallHelperScript({pid:1,mode:'bogus',log:'x'}),/mode/);
assert.throws(()=>windowsUninstallHelperScript({pid:1,mode:'files',log:'C:\\ep-logs\\u.log',files:['bad\npath']}),/newlines/);
fs.rmSync(home,{recursive:true,force:true});
console.log('Install record parse/inference precedence and Windows helper script construction passed (synthetic).');
