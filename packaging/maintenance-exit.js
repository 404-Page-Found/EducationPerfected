// A successful Windows removal handoff must release this executable, not wait
// for unrelated console handles/timers to let Node's event loop become idle.
'use strict';
function shouldExitAfterWindowsUninstall(result, { platform = process.platform, hasLiveWorkers = false } = {}) {
    return platform === 'win32' && !hasLiveWorkers && !result?.incomplete &&
        (result?.helperStarted === true || result?.programPending === true);
}
function flush(stream) {
    return new Promise((resolve, reject) => stream.write('', error => error ? reject(error) : resolve()));
}
async function exitAfterMaintenanceHandoff(result, { stdout = process.stdout, stderr = process.stderr, exit = code => process.exit(code), exitCode = process.exitCode || 0 } = {}) {
    if (result?.exitAfterHandoff !== true) return false;
    // Called only after bootstrap's finally has cleaned the owned runtime and
    // confirmed there are no live credential workers. Drain output before the
    // explicit exit so the handoff/log message is not lost on redirected IO.
    await Promise.all([flush(stdout), flush(stderr)]);
    exit(exitCode);
    return true;
}
module.exports = { shouldExitAfterWindowsUninstall, exitAfterMaintenanceHandoff };
