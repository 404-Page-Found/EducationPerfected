// Convert errors to fixed diagnostic categories. Never print arbitrary messages,
// stacks, URLs, paths, page text or credential-bearing process arguments.

// First matching hint wins; table order is the original priority order.
function matchHint(table, message, fallback) {
    for (const [test, hint] of table) if (test(message)) return hint;
    return fallback;
}

function diagnostic(error, action = 'Operation') {
    const code = ['ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code) ? error.code : null;
    const name = error?.name === 'TimeoutError' ? 'timeout' : null;
    const message = typeof error?.message === 'string' ? error.message : '';
    // Self-update failures get their own fixed categories: the startup hints below
    // would misreport an update problem as a browser/sign-in problem.
    if (action === 'Update') {
        const updateHint = matchHint([
            [m => /has no asset \S+ for this platform/.test(m), 'The newest stable release has no build for this platform; download it manually from the GitHub releases page.'],
            [m => /SHA256SUMS/.test(m), 'The newest stable release has no usable checksum file; download it manually from the GitHub releases page.'],
            [m => /checksum mismatch/.test(m), 'The downloaded update failed its integrity check; nothing was replaced.'],
            [m => /Unrecognized current version/.test(m), 'This build does not report a recognized stable version; update manually from the GitHub releases page.'],
            [m => /Another update is active/.test(m), 'Another update is active or was interrupted; close all EducationPerfected processes and retry.'],
            [m => /interactive terminal/i.test(m), 'Open this executable in an interactive terminal and retry.'],
        ], message, 'The update check or download failed; check the network and retry later, or download the newest release manually.');
        return `Update failed${code ? ` (${code})` : ''}: ${updateHint}`;
    }
    const hint = matchHint([
        [m => code === 'ENOENT' || /could not find Chrome|Browser was not found/i.test(m), 'A required browser or runtime file is missing.'],
        [m => /No usable sandbox|Failed to move to new namespace|SUID sandbox helper binary was found, but is not configured correctly/i.test(m), 'The browser sandbox was blocked by operating-system policy. Use a supported system or ask an administrator to review sandbox prerequisites; do not disable the browser sandbox.'],
        [() => code === 'EACCES' || code === 'EPERM', 'The operating system denied access.'],
        [() => name || code === 'ETIMEDOUT', 'The browser or sign-in step timed out.'],
        [() => code === 'ECONNREFUSED', 'The browser connection was refused.'],
        [m => /Target closed|Session closed|browser has disconnected/i.test(m), 'The browser connection closed.'],
        [m => /Failed to launch|Missing X server/i.test(m) || /\bDISPLAY\b/.test(m), 'The browser could not launch; check display and system browser dependencies.'],
    ], message, 'The operation failed; check the browser, sign-in state and installed runtime.');
    return `${action} failed${code ? ` (${code})` : ''}: ${hint}`;
}
module.exports = { diagnostic };
