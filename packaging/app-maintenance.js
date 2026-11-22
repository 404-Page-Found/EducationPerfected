// Desktop-app maintenance plumbing for the in-app update: locating the
// installed CLI the OS installer placed next to the app. (Uninstall is not an
// app feature: graphical users uninstall from the OS or package manager, and
// the terminal CLI keeps `educationperfected uninstall`.)
const path = require('node:path');

// Where each OS installer puts the CLI relative to the app it installed
// (installer design: installers install app and CLI together). Anything else -
// a source checkout, `npm run app`, an unpacked development build - has no
// paired CLI: null, and the app keeps its update control visible but disabled.
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

// Quote one argument for the manual sudo command app-update prints when a
// Linux desktop has no pkexec to elevate through.
function shellQuote(value) {
    if (/^[A-Za-z0-9_\-./:=+]+$/.test(value)) return value;
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

module.exports = { resolveCliExecutable, shellQuote };
