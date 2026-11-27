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

module.exports = { expectedPopupChanges, expectedPopupKeys, installPopupEmulation, restorePopupEmulation };
