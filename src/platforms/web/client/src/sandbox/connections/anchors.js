// Utility: highlight valid input anchors for a given type and source node
export function highlightValidAnchors(type, fromWindowId) {
    document.querySelectorAll('.input-anchor').forEach(anchor => {
        const anchorType = anchor.dataset.type;
        const parentWindow = anchor.closest('.tool-window');
        if (anchorType === type && parentWindow && parentWindow.id !== fromWindowId) {
            anchor.classList.add('anchor-highlight-valid');
        } else {
            anchor.classList.add('anchor-highlight-invalid');
        }
    });
}
export function clearAnchorHighlights() {
    document.querySelectorAll('.input-anchor').forEach(anchor => {
        anchor.classList.remove('anchor-highlight-valid', 'anchor-highlight-invalid');
    });
}

export function getAnchorPoint(windowEl, type, isOutput) {
    if (!windowEl) return null;
    if (isOutput) {
        return windowEl.querySelector('.anchor-point');
    } else {
        // Find input anchor matching type
        return windowEl.querySelector(`.input-anchor[data-type="${type}"]`);
    }
} 