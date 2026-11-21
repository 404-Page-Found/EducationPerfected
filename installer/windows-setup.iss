; Per-user EducationPerfected installer for Windows. No administrator rights.
; Compiled by the beta-preparation and Publish candidate lanes with /DAppVersion, /DSourceExe and /DAppPayload.
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
Name: "{group}\EducationPerfected"; Filename: "{app}\educationperfected.exe"
Name: "{group}\EducationPerfected App"; Filename: "{app}\app\EducationPerfected.exe"
Name: "{group}\Uninstall EducationPerfected"; Filename: "{uninstallexe}"

[Run]
; Install-time setup: the pinned Chrome download, non-interactive. Consent is
; presented here; the app's first-run wizard is the repair path on failure.
; Inno does not surface a [Run] program's exit code as an installer error
; (only a launch failure), so a failed download cannot fail the installation.
Filename: "{app}\educationperfected.exe"; Parameters: "setup --browser-only"; Description: "Download the pinned Chrome browser now (about 200 MB from Google; downloading accepts Google's terms). Required before first use."; Flags: postinstall runasoriginaluser skipifsilent waituntilterminated

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

function JsonEscape(S: string): string;
var
  I: Integer;
begin
  Result := '';
  for I := 1 to Length(S) do
    if S[I] = '\' then
      Result := Result + '\\'
    else
      Result := Result + S[I];
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
    + ',"shortcuts":["' + JsonEscape(ExpandConstant('{group}\EducationPerfected.lnk')) + '","' + JsonEscape(ExpandConstant('{group}\EducationPerfected App.lnk')) + '","' + JsonEscape(ExpandConstant('{group}\Uninstall EducationPerfected.lnk')) + '"]'
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
    if MsgBox('Also remove the saved EducationPerfected login from the Windows credential store?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = idYes then
      if not Exec(ExpandConstant('{app}\educationperfected.exe'), 'forget-credentials', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
        MsgBox('The saved login could not be removed automatically. Run: educationperfected.exe forget-credentials', mbInformation, MB_OK);
    AppData := ExpandConstant('{%USERPROFILE}\.educationperfected');
    if DirExists(AppData) and (MsgBox('Also remove EducationPerfected app data and downloaded browsers (' + AppData + ')?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = idYes) then
      DelTree(AppData, True, True, True);
  end;
  if CurUninstallStep = usPostUninstall then
    RemoveAppFromPath;
end;
