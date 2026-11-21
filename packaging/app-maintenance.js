// Desktop-app maintenance plumbing shared by the in-app update and uninstall:
// locating the installed CLI the OS installer placed next to the app, and the
// OS's graphical elevation for the removals the CLI uninstall performs with
// sudo in a terminal (the app has no terminal for sudo to ask on).
const path = require('node:path');

// Where each OS installer puts the CLI relative to the app it installed
// (installer design: installers install app and CLI together). Anything else -
// a source checkout, `npm run app`, an unpacked development build - has no
// paired CLI: null, and the app hides its update/uninstall controls.
function resolveCliExecutable({ platform = process.platform, execPath = process.execPath } = {}) {
    if (platform === 'win32') {
        // <install>\app\EducationPerfected.exe pairs with <install>\educationperfected.exe.
        // String operations follow the target platform's path rules, not the host's.
        const win = path.win32;
        if (win.basename(execPath) !== 'EducationPerfected.exe') return null;
        const appDirectory = win.dirname(execPath);
        if (win.basename(appDirectory) !== 'app') return null;
        return win.join(win.dirname(appDirectory), 'educationperfected.exe');
    }
    if (platform === 'darwin') {
        return execPath === '/Applications/EducationPerfected.app/Contents/MacOS/EducationPerfected'
            ? '/usr/local/bin/educationperfected'
            : null;
    }
    if (platform === 'linux') {
        return execPath === '/usr/lib/educationperfected/app/educationperfected-app'
            ? '/usr/bin/educationperfected'
            : null;
    }
    return null;
}

// The install methods whose program removal uninstall.js drives through sudo.
// Re-root those calls at the desktop's elevation: pkexec on Linux, a single
// administrator-privileges shell on macOS (its native password dialog). The
// user declining either prompt fails that removal step, exactly like saying
// no to sudo, and uninstall prints the manual command. Non-sudo commands pass
// through unchanged.
function shellQuote(value) {
    if (/^[A-Za-z0-9_\-./:=+]+$/.test(value)) return value;
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function appleScriptShell(commandLine) {
    return 'do shell script "' + commandLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '" with administrator privileges';
}

function elevatedSpawn({ platform = process.platform, spawnSync = require('node:child_process').spawnSync } = {}) {
    return (command, args, options) => {
        if (command !== 'sudo') return spawnSync(command, args, options);
        if (platform === 'darwin') {
            return spawnSync('osascript', ['-e', appleScriptShell(args.map(shellQuote).join(' '))], { stdio: 'ignore' });
        }
        if (platform === 'linux') {
            // apt asks its own [Y/n] on stdin, which is ignored here: the app's
            // dialog is the confirmation, so the elevated apt run answers it.
            const argv = args[0] === 'apt' && args[1] === 'remove' ? ['apt', '-y', ...args.slice(1)] : args;
            return spawnSync('pkexec', argv, { stdio: 'ignore' });
        }
        return { error: new Error('No desktop elevation available on ' + platform), status: null };
    };
}

module.exports = { resolveCliExecutable, elevatedSpawn, shellQuote, appleScriptShell };
