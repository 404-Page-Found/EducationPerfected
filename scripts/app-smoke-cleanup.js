'use strict';

// The source smoke starts a Node launcher which owns Electron. Timeout cleanup
// must stop both, not leave Electron alive after killing only the launcher.
function killSmokeTree(child, { platform = process.platform, run = require('node:child_process').spawnSync, kill = process.kill } = {}) {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return;
    if (platform === 'win32') {
        run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000, windowsHide: true });
    } else {
        try { kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
}

module.exports = { killSmokeTree };
