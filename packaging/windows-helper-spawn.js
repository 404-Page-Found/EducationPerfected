// One spawn shape for every Windows background helper (CLI update, app update,
// uninstall): hidden console, ignored stdio, unref'd - and NOT detached. A
// detached console-subsystem helper (cmd.exe, powershell.exe) on Windows
// starts, reports a clean spawn, exits 0 and never executes a line: the app
// quits for the handoff and nothing happens, which is exactly the reported
// "the uninstaller never starts" (proven on windows-2025 in the
// uninstall-validation lane, 2026-11-22). Without detached the helper still
// outlives its parent: Windows never kills children when a parent exits, and
// the hidden window keeps the helper off the user's screen.
'use strict';
function spawnBackgroundHelper(command, args) {
    return require('node:child_process').spawn(command, args, { stdio: 'ignore', windowsHide: true }).unref();
}
module.exports = { spawnBackgroundHelper };
