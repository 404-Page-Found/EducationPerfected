// Versioned, non-secret app preferences. Bad files never prevent startup.
const fs = require('node:fs');
const path = require('node:path');
const { storageRoot } = require('./storage-maintenance');

function normalizeConfig(raw) {
    const result = { version: 1 };
    if (!raw || raw.version !== 1) return result;
    // Retired settings are dropped silently: a saved `accuracy` block (the
    // removed intentional-mistake simulation) and a saved `delay.override`
    // (the removed custom pacing range) simply stop applying, while the
    // delay on/off choice still migrates.
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
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return { version: 1 };
        return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { return { version: 1 }; }
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
