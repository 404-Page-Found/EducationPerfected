function expectedPopupKeys(count, partialSecondDropdown = false) {
    const first = ['F4', 'ArrowDown', 'ArrowDown', 'Enter'].map(key => ({ id: 'dropdown-0', key, trusted: true }));
    if (partialSecondDropdown) return first.concat(['F4', 'ArrowDown'].map(key => ({ id: 'dropdown-1', key, trusted: true })));
    return Array.from({ length: count }, (_, index) => ['F4', 'ArrowDown', 'ArrowDown', 'Enter'].map(key => ({ id: 'dropdown-' + index, key, trusted: true }))).flat();
}

function expectedPopupChanges(count) {
    return Array.from({ length: count }, (_, index) => ({ id: 'dropdown-' + index, index: 2, trusted: false }));
}

async function installPopupEmulation(page, { commitDuringNavigation = false, closeOnArrow = false, closeOnArrowAt = null, openDelayMs = 0, neverOpen = false, replaceOnF4At = null } = {}) {
    await page.evaluate((commit, close, closeAt, delay, never, replaceAt) => {
        const selects = [...document.querySelectorAll('select')];
        const original = HTMLSelectElement.prototype.matches;
        let open = false;
        let openNode = null; // per-node open state once a select has been replaced
        let provisional = 0;
        window.__restoreSelectMatches = () => { HTMLSelectElement.prototype.matches = original; };
        HTMLSelectElement.prototype.matches = function(selector) {
            if (selector === ':open') return openNode ? openNode === this : open;
            return original.call(this, selector);
        };
        const isOpen = select => openNode ? openNode === select : open;
        const attach = select => {
            select.addEventListener('keydown', event => {
                const index = selects.indexOf(select);
                if (event.key === 'F4') {
                    if (never) { event.preventDefault(); return; }
                    let opened = select;
                    if (index === replaceAt) {
                        const clone = select.cloneNode(true);
                        clone.selectedIndex = select.selectedIndex;
                        select.replaceWith(clone);
                        attach(clone);
                        opened = clone;
                        openNode = clone;
                    }
                    const mark = () => { if (openNode) openNode = opened; else open = true; };
                    if (delay) setTimeout(mark, delay); else mark();
                    provisional = select.selectedIndex;
                    event.preventDefault();
                } else if (isOpen(select) && event.key === 'ArrowDown') {
                    provisional = Math.min(select.options.length - 1, provisional + 1);
                    event.preventDefault();
                    if (commit) {
                        select.selectedIndex = provisional;
                        select.dispatchEvent(new Event('input', { bubbles: true }));
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    if (close || index === closeAt) { open = false; if (openNode === select) openNode = null; }
                } else if (isOpen(select) && event.key === 'Enter') {
                    open = false;
                    if (openNode === select) openNode = null;
                    select.selectedIndex = provisional;
                    event.preventDefault();
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, true);
        };
        for (const select of selects) attach(select);
    }, commitDuringNavigation, closeOnArrow, closeOnArrowAt, openDelayMs, neverOpen, replaceOnF4At);
}

async function restorePopupEmulation(page) {
    await page.evaluate(() => window.__restoreSelectMatches?.());
}

// Records which focus recovery the handler runs on a page whose focus probes
// are stubbed: the window raise and the CDP focus-emulation send are counted
// through wrappers, proving the path taken instead of trusting the stub.
function trackFocusRecovery(page) {
    const calls = { bringToFront: 0, emulation: 0 };
    const originalRaise = page.bringToFront.bind(page);
    page.bringToFront = async () => { calls.bringToFront++; return originalRaise(); };
    const originalSession = page.createCDPSession.bind(page);
    page.createCDPSession = async () => {
        const session = await originalSession();
        const send = session.send.bind(session);
        session.send = (method, params) => {
            if (method === 'Emulation.setFocusEmulationEnabled' && params?.enabled === true) calls.emulation++;
            return send(method, params);
        };
        return session;
    };
    return calls;
}

function untrackFocusRecovery(page) {
    delete page.bringToFront;
    delete page.createCDPSession;
}

module.exports = { expectedPopupChanges, expectedPopupKeys, installPopupEmulation, restorePopupEmulation, trackFocusRecovery, untrackFocusRecovery };
