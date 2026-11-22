# Packaged app storage

The packaged CLI and the desktop app use one app-owned root: `%USERPROFILE%\.educationperfected\`
on Windows, or `~/.educationperfected/` on Linux/macOS.

- `app-data/`: the desktop app's own data folder (Electron userData: saved web
  sessions, storage and caches). Older builds kept it at the OS app-data
  location (`%AppData%\EducationPerfected` on Windows); a first launch of this
  version migrates that folder under the root (skipped once `app-data/` exists,
  with any interrupted copy staged aside so a later launch can retry).
- `browsers/156.0.8078.47-<platform>/`: existing persistent Chrome download,
  notices and COMPLETE.json receipt. Existing downloads are reused unchanged.
- `browsers/.download-*` and `<version>-<platform>.lock`: existing acquisition
  staging/lock behavior, not deleted by runtime cleanup.
- `tmp/run-<random>/`: native keyring binding and Puppeteer's temporary Chrome
  profile. The bootstrap sets PUPPETEER_TMP_DIR to this run directory, overriding
  an inherited temporary-profile location for the packaged app only. Browser
  profile files may contain cookies/session tokens, website storage and caches.
  Development embedded-browser builds also extract their browser here.
- `tmp/run-<random>/OWNER.json`: PID/schema and cleanup state only, no credentials.

Normal confirmed browser closure plus native-worker exit permits run-directory
removal. The ownership receipt is deleted last, after payload files; a stale pending
receipt is safely replaced on retry. If removal fails after closure, the marker becomes cleanup-ready; next
startup retries removal only if that owner PID is definitively dead. Alive,
unqueryable, malformed, symlinked and running-marked directories are retained.
A dead app PID does not prove Chrome children exited, so crash leftovers are not
automatically deleted. This protects an old still-running browser profile. No
broad cleanup of OS temp folders or historical app temp files is performed.

Windows Credential Manager remains unchanged: service EducationPerfected,
account login-v1. No plaintext credential file is introduced. Chrome/Windows
AppContainer data under LocalAppData/Packages is outside this app-owned root
and cannot be moved by changing the Puppeteer profile directory. There is no
persistent answer database/log added by this change. Interactive accuracy and delay
settings are stored in `config.json` at the app root, for source and packaged runs.
The version-1 file contains only validated accuracy/pacing preferences, never
credentials. Missing, corrupt, unknown-version or unreadable files use defaults.
Writes use a private `0600` temporary file and an atomic rename; write failures
leave the current session working and print a warning. Startup precedence is
CLI accuracy flags > environment variables > saved settings > built-in defaults.
Flags and environment changes apply only to that invocation; interactive changes
are saved. Test and validation-only sessions do not read or write personal settings.
Terminal output
and OS/browser internal housekeeping remain separate.

Directories are checked as real non-symlink directories and uninstall removals are bounded
to recognized entries (the known files, `app-data/`, and empty containers)
to recognized run entries. These checks assume no hostile same-user writer racing
path operations; they are not a new OS security boundary or Windows ACL proof.
Synthetic fixtures do not establish Windows cleanup or clean-machine evidence.
Source `npm run cli` shares only the settings file; runtime leases remain a
packaged bootstrap policy.

After bootstrap hands signals to launchProgram, graceful startup Ctrl+C/TERM/HUP
reports browser closure to bootstrap only
after its awaited browser close succeeds. It may then remove or mark the runtime
safe for retry, preserving signal exit codes. Failed close or forced exit before confirmation leaves the running marker retained.
An already confirmed close remains safe if another signal arrives afterward.
Signals before handoff have no browser owner and use bootstrap's existing cleanup.

## Subcommands and uninstall

`setup` acquires Chrome with the existing explicit consent/checksum flow, then
offers optional credential storage with typed answers visible. Cached browser reuse skips another
download. `check-credentials` and `forget-credentials` do not download or launch
a browser. `help` and `version`, including -h/--help and -v/--version, return
before runtime/store initialization. Old credential/update/uninstall --flags
are refused with a hint and exit1, not silently accepted.

`uninstall` requires an interactive typed confirmation. Its app-data choice removes
the known `config.json` preferences file and the desktop app's `app-data/` folder
(saved sessions and caches); keeping app data keeps those settings and sessions.
An unexpected directory or symlink at that path is retained and reported incomplete.
Close every other app
copy, including source CLI and its browser, first. It removes only the app's
native OS credential-store record, not legacy keytar records. A maintenance lock blocks
new packaged runtime allocation while uninstall scans/deletes; stale maintenance
locks are retained for inspection. Other live/uncertain runtime entries, browser
download locks/staging, unknown root data or symlinks prevent browser deletion.
It never recursively deletes tmp/root and reports retained data as incomplete.
The current own native binding is removed only after native worker completion.
Source CLI does not hold packaged runtime leases, so closing source copies is
a user precondition, not claimed process discovery. No broad disk cleanup is promised.

## Program removal (install record)

Every installer writes `educationperfected-install.json` next to the executable
it installs: the method (`setup-exe`, `install-ps1`, `install-sh`, `npm`, `deb`,
`rpm`, `pkg`), the program files it owns, any user PATH entry it added, and
(for the setup exe) the shortcuts and uninstaller path. `uninstall` offers
program removal as a final per-item prompt, default No, after the data/login
prompts. Installs from before records existed (or raw downloads) have their
method inferred from the executable's location - an `unins000.exe` beside it
means the setup exe, an npm global package path means npm, the install.ps1
directory means install.ps1, `/usr/bin` plus dpkg/rpm ownership means a system
package, `/usr/local/bin` on macOS means the .pkg - and the inference is stated
in the output. When no removal path is known, the CLI prints what it could not
remove instead of guessing.

The desktop app carries no uninstaller: graphical users uninstall from the OS
or package manager (Settings > Apps on Windows, which runs the setup exe's Inno
uninstaller with its own per-item prompts; the package manager on Linux), and
the terminal CLI keeps `uninstall` with the per-item default-No prompts above.
On macOS, moving the app from Applications to the Bin removes only the app;
`uninstall` also removes the command, the install record and (by choice) the
saved login and app data.

Per method: the setup exe delegates to its own Inno uninstaller (which removes
the program, shortcuts and PATH entry and asks about the saved login and app
data itself); npm runs `npm uninstall -g educationperfected`; `.deb` runs
`sudo apt remove educationperfected`; `.rpm` runs `sudo rpm -e educationperfected`;
`.pkg` deletes its recorded files with sudo and runs `sudo pkgutil --forget
com.404pf.educationperfected`; install.sh/install.ps1/raw binaries delete their
recorded files (and the install.ps1 PATH entry). On Windows a background PowerShell helper waits for the CLI process to exit
before deleting anything. It records the wait and each removal stage in
`%TEMP%\educationperfected-uninstall.log`; the setup-exe path also enables
Inno diagnostics in the adjacent `educationperfected-uninstall.log.inno.log`.
The helper refuses removal if the CLI is still running after ten minutes.
The Inno uninstaller runs from the temporary directory, not the installation
directory, and retains its interactive, default-No data/login prompts.
The CLI reports that removal finishes in the background. Package-manager and npm removals
report failure with the exact manual command and mark the run incomplete.

The desktop app's Settings update does not swap files in place. It downloads
the same OS installer the release publishes for the install method (setup exe,
.pkg, .deb or .rpm), verifies it against the release's SHA256SUMS exactly like
the CLI update does for the raw binary, then hands off and closes: a detached
cmd helper waits for the app to exit and runs the setup exe silently, writing
`app-update-result.txt` in the app root for the next launch to show once; the
.pkg opens in the macOS Installer; the .deb/.rpm installs through pkexec (or
shows the exact sudo command and keeps the verified package when no desktop
elevation exists). App and CLI always update together, so a root-owned install
location never needs an in-place swap from the app.

Native credential fixtures use an explicitly inert cached-browser receipt in
disposable homes to exercise setup's cache-reuse path without launching that
inert file. macOS retains its runner HOME for keychain isolation and uses the
actual acquisition/cache path. Browser-download integrity/consent is tested
separately; credential fixtures are not Google acquisition proof.

Current uninstall retains browser caches even after confirmation because existing
receipts do not inventory nested files. It prints the exact directory for manual
inspection/deletion and reports incomplete rather than deleting unknown data.
