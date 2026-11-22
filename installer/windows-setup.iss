; Per-user EducationPerfected installer for Windows. No administrator rights.
; Compiled by the Publish candidate lane with /DAppVersion, /DSourceExe and /DAppPayload (installer-compile-check compiles it with a stub on PRs).
[Setup]
AppId={{5C0EDD47-9C42-5901-AF48-2393F39A36CD}
AppName=EducationPerfected
AppVersion={#AppVersion}
AppPublisher=404-Page-Found
DefaultDirName={localappdata}\Programs\EducationPerfected
DefaultGroupName=EducationPerfected
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=educationperfected-windows-x64-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableDirPage=yes
DisableProgramGroupPage=yes
UninstallDisplayName=EducationPerfected
SetupIconFile=..\branding\educationperfected.ico
WizardImageFile=wizard-image.bmp
WizardSmallImageFile=wizard-small.bmp
UninstallDisplayIcon={app}\educationperfected.exe
ChangesEnvironment=yes

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "educationperfected.exe"; Flags: ignoreversion
; The desktop app payload (built by packaging/build-app.js on the native runner).
Source: "{#AppPayload}\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "addtopath"; Description: "Add EducationPerfected to your PATH"; GroupDescription: "Extra options:"

[Icons]
; The Start menu gets the one app launcher and nothing else. Uninstall stays in
; Settings > Apps (UninstallDisplayName) and in the app itself; no separate
; uninstaller shortcut is created here.
Name: "{group}\EducationPerfected"; Filename: "{app}\app\EducationPerfected.exe"

; The app payload includes Electron's Chromium. [Files] installs the browser
; before the finish page. Do not launch the terminal CLI's separate download.

[InstallDelete]
; Remove the previous separate app launcher on upgrade. The remaining shortcut
; is replaced by [Icons] to launch the desktop app, not the terminal CLI.
Type: files; Name: "{group}\EducationPerfected App.lnk"
; Up to v2026.11.22 the installer added a "Uninstall EducationPerfected"
; Start-menu shortcut; remove it from existing installs on upgrade.
Type: files; Name: "{group}\Uninstall EducationPerfected.lnk"

[UninstallDelete]
Type: files; Name: "{app}\educationperfected-install.json"
Type: files; Name: "{app}\educationperfected.exe.backup"
Type: files; Name: "{app}\educationperfected.exe.update-result"
Type: files; Name: "{app}\educationperfected.exe.update.lock"
Type: filesandordirs; Name: "{app}\.update-*"

[Code]
const
  EnvironmentKey = 'Environment';

procedure AddAppToPath;
var
  CurrentPath, Entry, Rest: string;
  P: Integer;
begin
  if not RegQueryStringValue(HKCU, EnvironmentKey, 'Path', CurrentPath) then
    CurrentPath := '';
  Rest := CurrentPath;
  while True do
  begin
    P := Pos(';', Rest);
    if P = 0 then
      Entry := Rest
    else
    begin
      Entry := Copy(Rest, 1, P - 1);
      Rest := Copy(Rest, P + 1, Length(Rest));
    end;
    if CompareText(Entry, ExpandConstant('{app}')) = 0 then
      Exit;
    if P = 0 then
      Break;
  end;
  if CurrentPath = '' then
    RegWriteExpandStringValue(HKCU, EnvironmentKey, 'Path', ExpandConstant('{app}'))
  else
    RegWriteExpandStringValue(HKCU, EnvironmentKey, 'Path', CurrentPath + ';' + ExpandConstant('{app}'));
end;

procedure RemoveAppFromPath;
var
  CurrentPath, Entry, Rest, Cleaned: string;
  P: Integer;
begin
  if not RegQueryStringValue(HKCU, EnvironmentKey, 'Path', CurrentPath) then
    Exit;
  Rest := CurrentPath;
  Cleaned := '';
  while True do
  begin
    P := Pos(';', Rest);
    if P = 0 then
      Entry := Rest
    else
    begin
      Entry := Copy(Rest, 1, P - 1);
      Rest := Copy(Rest, P + 1, Length(Rest));
    end;
    if CompareText(Entry, ExpandConstant('{app}')) <> 0 then
    begin
      if Cleaned = '' then
        Cleaned := Entry
      else
        Cleaned := Cleaned + ';' + Entry;
    end;
    if P = 0 then
      Break;
  end;
  if Cleaned <> CurrentPath then
    RegWriteExpandStringValue(HKCU, EnvironmentKey, 'Path', Cleaned);
end;

function Hex4(N: Integer): string;
var
  Digits: string;
  K: Integer;
begin
  Digits := '0123456789abcdef';
  Result := '';
  for K := 1 to 4 do
  begin
    Result := Digits[(N and $F) + 1] + Result;
    N := N shr 4;
  end;
end;

function JsonEscape(S: string): string;
var
  I: Integer;
begin
  { The record is written ANSI (SaveStringToFile has no UTF-8 mode) but read
    back as UTF-8 by the CLI, so anything above ASCII must travel as a JSON
    unicode escape: pure-ASCII bytes survive every codepage, and a stray byte
    can never mangle an install path (a non-ASCII Windows username puts one
    in the default install location). Surrogate pairs escape per unit, which
    is exactly how JSON spells astral characters. }
  Result := '';
  for I := 1 to Length(S) do
    if S[I] = '\' then
      Result := Result + '\\'
    else if Ord(S[I]) < 128 then
      Result := Result + S[I]
    else
      Result := Result + '\u' + Hex4(Ord(S[I]));
end;

{ Install record: the CLI uninstall reads this to learn the install method and
  what this install created (program files, shortcuts, PATH entry, uninstaller). }
procedure WriteInstallRecord;
var
  Json, PathPart: string;
begin
  PathPart := '';
  if WizardIsTaskSelected('addtopath') then
    PathPart := ',"pathEntries":["' + JsonEscape(ExpandConstant('{app}')) + '"]';
  Json := '{"version":1,"method":"setup-exe"'
    + ',"files":["' + JsonEscape(ExpandConstant('{app}\educationperfected.exe')) + '","' + JsonEscape(ExpandConstant('{app}\educationperfected-install.json')) + '"]'
    + ',"directories":["' + JsonEscape(ExpandConstant('{app}\app')) + '"]'
    + ',"shortcuts":["' + JsonEscape(ExpandConstant('{group}\EducationPerfected.lnk')) + '"]'
    + ',"uninstaller":"' + JsonEscape(ExpandConstant('{app}\unins000.exe')) + '"'
    + PathPart + '}';
  SaveStringToFile(ExpandConstant('{app}\educationperfected-install.json'), Json, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('addtopath') then
      AddAppToPath;
    WriteInstallRecord;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppData: string;
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    { Scripted MsgBox calls are NOT suppressed by /SUPPRESSMSGBOXES: without
      this guard a silent uninstall (/VERYSILENT) hangs on these prompts
      forever. Silent uninstalls skip optional data removal and keep it. }
    if not UninstallSilent then
    begin
      if MsgBox('Also remove the saved EducationPerfected login from the Windows credential store?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = idYes then
        if not Exec(ExpandConstant('{app}\educationperfected.exe'), 'forget-credentials', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
          MsgBox('The saved login could not be removed automatically. Run: educationperfected.exe forget-credentials', mbInformation, MB_OK);
      AppData := ExpandConstant('{%USERPROFILE}\.educationperfected');
      if DirExists(AppData) and (MsgBox('Also remove EducationPerfected app data, saved sessions and downloaded browsers (' + AppData + ')?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = idYes) then
        DelTree(AppData, True, True, True);
      { Builds before the move under %USERPROFILE%\.educationperfected kept the desktop
        app's Electron data in the OS default location; remove it with its own prompt. }
      AppData := ExpandConstant('{%APPDATA}\EducationPerfected');
      if DirExists(AppData) and (MsgBox('Also remove the old desktop app data left by earlier builds (' + AppData + ')?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = idYes) then
        DelTree(AppData, True, True, True);
    end;
  end;
  if CurUninstallStep = usPostUninstall then
    RemoveAppFromPath;
end;
