// Versioned, non-secret app preferences. Bad files never prevent startup.
const fs = require('node:fs');
const path = require('node:path');
const { storageRoot } = require('./storage-maintenance');

// Schema version 1 (the owner chose to number the current schema 1). Files
// written by the previous numbering (version 2) are read as the same schema
// so saved accuracy/delay choices survive, and every save writes version 1.
// Any other version is discarded. Retired keys never migrate: saved accuracy
// targets/bands (accuracy is a boolean: off or the 70-90% band) and the
// removed custom delay.override range.
const CONFIG_VERSION = 1;
const READABLE_VERSIONS = [1, 2];
function normalizeConfig(raw) {
    const result = { version: CONFIG_VERSION };
    if (!raw || !READABLE_VERSIONS.includes(raw.version)) return result;
    const a = raw.accuracy;
    if (a && typeof a.enabled === 'boolean') {
        result.accuracy = { enabled: a.enabled };
    }
    const d = raw.delay;
    if (d && typeof d.enabled === 'boolean') {
        result.delay = { enabled: d.enabled };
    }
    return result;
}
function readConfig({ home } = {}) {
    try {
        const file = path.join(storageRoot(home), 'config.json');
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return { version: CONFIG_VERSION };
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const config = normalizeConfig(raw);
        // A version 2 file is overwritten once as version 1 with the same kept
        // choices. Best effort: a failed rewrite never blocks startup.
        if (raw && raw.version !== CONFIG_VERSION) { try { writeConfig(config, { home }); } catch { /* keep reading the old file */ } }
        return config;
    } catch { return { version: CONFIG_VERSION }; }
}
function writeConfig(config, { home } = {}) {
    const root = storageRoot(home);
    const file = path.join(root, 'config.json');
    const temp = path.join(root, `.config-${process.pid}-${require('node:crypto').randomUUID()}.tmp`);
    let fd;
    let failure;
    try {
        fd = fs.openSync(temp, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(normalizeConfig(config), null, 2) + '\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temp, file);
    } catch (error) { failure = error; }
    // Cleanup must not replace the original write error.
    try { if (fd !== undefined) fs.closeSync(fd); } catch (error) { failure ||= error; }
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') failure ||= error; }
    if (failure) throw failure;
}
module.exports = { normalizeConfig, readConfig, writeConfig };
