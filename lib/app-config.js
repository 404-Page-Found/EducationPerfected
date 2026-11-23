// Versioned, non-secret app preferences. Bad files never prevent startup.
const fs = require('node:fs');
const path = require('node:path');
const { storageRoot } = require('./storage-maintenance');

// Version 2: the restore of the accuracy simulation came with both opt-in
// simulations defaulting to off, so upgrading from a version-1 file resets
// saved accuracy/delay choices to off exactly once; a choice made after the
// upgrade is saved at version 2 and sticks. Retired keys never migrate:
// saved accuracy targets/bands (accuracy is a boolean: off or the 70-90%
// band) and the removed custom delay.override range.
function normalizeConfig(raw) {
    const result = { version: 2 };
    if (!raw || raw.version !== 2) return result;
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
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return { version: 2 };
        return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { return { version: 2 }; }
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
