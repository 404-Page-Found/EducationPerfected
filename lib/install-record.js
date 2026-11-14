// Install record: every installer writes educationperfected-install.json next
// to the executable it installs, so `uninstall` can remove exactly what that
// install created (program files, PATH entries, shortcuts, receipts).
// Old installs predate records; for those, the method is inferred from the
// executable's location and clearly reported as inferred, not recorded.
const fs = require('node:fs'), path = require('node:path');

const RECORD_NAME = 'educationperfected-install.json';
const METHODS = new Set(['setup-exe', 'install-ps1', 'install-sh', 'npm', 'deb', 'rpm', 'pkg']);
const PKG_RECEIPT = 'com.404pf.educationperfected';

function recordPathFor(executable) {
    return path.join(path.dirname(executable), RECORD_NAME);
}

function strings(value) {
    return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);
}

function normalizeRecord(raw) {
    if (!raw || raw.version !== 1 || !METHODS.has(raw.method)) return null;
    return {
        version: 1,
        method: raw.method,
        files: strings(raw.files) ? raw.files : [],
        pathEntries: strings(raw.pathEntries) ? raw.pathEntries : [],
        shortcuts: strings(raw.shortcuts) ? raw.shortcuts : [],
        uninstaller: typeof raw.uninstaller === 'string' && raw.uninstaller ? raw.uninstaller : null,
        receipt: typeof raw.receipt === 'string' && raw.receipt ? raw.receipt : null,
    };
}

function readInstallRecord(executable) {
    if (!path.isAbsolute(executable)) return null;
    let text;
    try { text = fs.readFileSync(recordPathFor(executable), 'utf8'); } catch { return null; }
    try { return normalizeRecord(JSON.parse(text)); } catch { return null; }
}

function isNpmPath(file) {
    const normalized = file.replace(/\\/g, '/');
    return normalized.includes('/node_modules/educationperfected/');
}

// Method inference for installs without a record. Each rule only fires where
// the install location is unambiguous; anything else is a bare binary whose
// only owned file is the executable itself.
function inferInstall({ executable, platform = process.platform, env = process.env, spawn = require('node:child_process').spawnSync } = {}) {
    // String operations follow the target platform's path rules, not the host's.
    const p = platform === 'win32' ? path.win32 : path.posix;
    const directory = p.dirname(executable);
    if (platform === 'win32') {
        // fs checks use the host path rules; p owns only platform string logic.
        const uninstaller = path.join(directory, 'unins000.exe');
        if (fs.existsSync(uninstaller)) {
            return { method: 'setup-exe', files: [executable], pathEntries: [], shortcuts: [], uninstaller, receipt: null, inferred: true };
        }
        if (isNpmPath(executable)) {
            return { method: 'npm', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
        }
        const localAppData = env.LOCALAPPDATA;
        if (localAppData && directory.toLowerCase() === p.join(localAppData, 'Programs', 'EducationPerfected').toLowerCase()) {
            return { method: 'install-ps1', files: [executable], pathEntries: [directory], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
        }
        return { method: 'raw-exe', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
    }
    if (isNpmPath(executable)) {
        return { method: 'npm', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
    }
    if (platform === 'linux' && directory === '/usr/bin') {
        const owned = command => {
            try { return spawn(command[0], command.slice(1), { stdio: 'ignore' }).status === 0; } catch { return false; }
        };
        if (owned(['dpkg', '-S', executable])) return { method: 'deb', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
        if (owned(['rpm', '-qf', executable])) return { method: 'rpm', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
        return { method: 'unknown-package', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
    }
    if (platform === 'darwin' && directory === '/usr/local/bin') {
        return { method: 'pkg', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: PKG_RECEIPT, inferred: true };
    }
    return { method: 'raw-binary', files: [executable], pathEntries: [], shortcuts: [], uninstaller: null, receipt: null, inferred: true };
}

// The install record wins when it exists; inference fills in old installs.
function detectInstall({ executable, platform, env, spawn } = {}) {
    const record = readInstallRecord(executable);
    if (record) return { ...record, inferred: false };
    return inferInstall({ executable, platform, env, spawn });
}

module.exports = { RECORD_NAME, METHODS, PKG_RECEIPT, recordPathFor, normalizeRecord, readInstallRecord, inferInstall, detectInstall };
