// Fixed repository source only; no Inno compile or installer execution.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const iss=fs.readFileSync(path.join(__dirname,'../installer/windows-setup.iss'),'utf8');
for(const required of [
 'AppId={{5C0EDD47-9C42-5901-AF48-2393F39A36CD}','PrivilegesRequired=lowest',
 '{localappdata}\\Programs\\EducationPerfected','OutputBaseFilename=educationperfected-windows-x64-setup',
 'DestName: "educationperfected.exe"','Name: "addtopath"','{group}\\EducationPerfected',
 'Source: "{#AppPayload}\\*"; DestDir: "{app}\\app"; Flags: ignoreversion recursesubdirs createallsubdirs',
 'CurUninstallStepChanged','RemoveAppFromPath','UninstallDisplayName=EducationPerfected',
 '[UninstallDelete]','educationperfected.exe.backup','educationperfected.exe.update-result',
 'educationperfected.exe.update.lock','{app}\\.update-*',
 'MB_DEFBUTTON2','forget-credentials','DelTree','{%USERPROFILE}\\.educationperfected',
 'WriteInstallRecord','JsonEscape','educationperfected-install.json','"method":"setup-exe"','"uninstaller"','SaveStringToFile',
])assert.ok(iss.includes(required),required);
// SaveStringToFile writes ANSI while the CLI reads the record as UTF-8, so the
// record writer escapes every non-ASCII character as a JSON \uXXXX sequence:
// a non-ASCII Windows username puts one in the default install location, and
// an unescaped byte came back mangled, pointing the uninstall handoff at a
// nonexistent uninstaller (the app quit, nothing started).
assert.ok(iss.includes(String.raw`\u' + Hex4(Ord(S[I]))`),'JsonEscape emits \\uXXXX for non-ASCII');
assert.ok(iss.includes('else if Ord(S[I]) < 128'),'JsonEscape passes ASCII through only');
// The desktop browser is part of AppPayload, copied by [Files] before the
// finish page. A leftover [Run] hook starts an unrelated CLI download in a
// console after setup finishes, even though the app already has its browser.
assert.doesNotMatch(iss, /^\[Run\]/m, 'no post-setup processes or terminal browser downloads');
assert.doesNotMatch(iss, /setup\s+--browser-only|Flags:[^\r\n]*postinstall/i, 'no CLI setup on the finish page');
assert.equal((iss.match(/MB_DEFBUTTON2/g)||[]).length,3,'every uninstall prompt defaults to No');
assert.doesNotMatch(iss,/PrivilegesRequired=(admin|poweruser)/);
assert.ok(!iss.includes('ChangesUninstall'),'not a valid Inno directive; ISCC aborts on it');
assert.ok(!iss.includes('StringChange'),'PATH removal matches whole ;-delimited entries, never substrings');
assert.ok(iss.includes('WizardIsTaskSelected'),'task check uses the wizard-context function');
assert.ok(iss.includes('Type: files; Name: "{app}\\educationperfected-install.json"'),'the Inno uninstaller removes the install record');
assert.ok(!iss.includes('RegWriteStringValue'),'PATH writes must preserve REG_EXPAND_SZ');
assert.ok(iss.includes('RegWriteExpandStringValue'),'PATH writes use RegWriteExpandStringValue');
const icons = iss.split('[Icons]')[1].split('[')[0];
assert.ok(icons.includes('Name: "{group}\\EducationPerfected"; Filename: "{app}\\app\\EducationPerfected.exe"'), 'the single launcher opens the desktop app');
assert.ok(!icons.includes('Uninstall EducationPerfected'), 'no Start-menu Uninstall shortcut: uninstall lives in Settings > Apps and the terminal CLI');
assert.ok(!iss.split('WriteInstallRecord')[1].includes('Uninstall EducationPerfected'), 'the install record lists only the shortcuts the installer still creates');
assert.equal((icons.match(/Filename: "\{app\}/g)||[]).length, 1, 'only one program launcher, no duplicate CLI launcher');
const installDelete = iss.split('[InstallDelete]')[1].split(/^\[/m)[0];
assert.ok(installDelete.includes('Type: files; Name: "{group}\\EducationPerfected App.lnk"'), 'upgrades remove the old separate app shortcut');
assert.ok(installDelete.includes('Type: files; Name: "{group}\\Uninstall EducationPerfected.lnk"'), 'upgrades remove the old Start-menu Uninstall shortcut');
assert.ok(iss.includes("ExpandConstant('{%APPDATA}\\EducationPerfected')"), 'uninstall offers removing the pre-relocation desktop app data in %AppData%');
const publish=fs.readFileSync(path.join(__dirname,'../.github/workflows/publish.yml'),'utf8');
for(const required of [
 'Inno Setup 6\\ISCC.exe',"require('./package.json').version",'/DAppVersion','/DSourceExe',
 'installer\\windows-setup.iss','educationperfected-windows-x64-setup.exe >> SHA256SUMS',
 "runner.os == 'Windows'",
])assert.ok(publish.includes(required),required);
const isccStep=publish.split('      - name: Build the per-user Windows installer')[1].split('      - name:')[0];
assert.ok(isccStep.includes('Join-Path $root'),'ISCC receives absolute paths; Inno resolves relative Source/OutputDir against the script directory');
assert.doesNotMatch(isccStep,/\/DSourceExe=build\\/,'no repo-root-relative /DSourceExe');
const compileCheck=fs.readFileSync(path.join(__dirname,'../.github/workflows/installer-compile-check.yml'),'utf8');
for(const required of ['pull_request:','windows-2025','Inno Setup 6\\ISCC.exe','stub executable, compile proof only','Join-Path $root','contents: read'])assert.ok(compileCheck.includes(required),required);
assert.doesNotMatch(compileCheck,/upload-artifact|contents: write|pull_request_target/,'compile proof only, no artifacts or write access');
const bundles=publish.split('      - name: Upload validated downloadable candidate bundle')[1].split('      - name:')[0];
assert.match(bundles,/educationperfected\*/,'candidate upload picks up the installer via glob');
for(const required of ['windows-x64:educationperfected-windows-x64-setup.exe',' is not byte-identical to the validated candidate','20 payload files'])assert.ok(publish.includes(required),required);
assert.ok(require('../package.json').scripts['test:phase3'].includes('windows-installer-policy-test.js'),'wired into test:phase3');
console.log('Windows installer: per-user Inno Setup script, the Publish candidate lane builds, checksums and bundles it byte-identical, raw exe asset names unchanged.');
