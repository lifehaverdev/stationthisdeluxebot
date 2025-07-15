import {
    injectImageOverlay
} from './overlays/imageOverlay.js';
import {
    bindPromptFieldOverlays
} from './overlays/textOverlay.js';
import {
    createToolWindow,
    rerenderToolWindowById
} from './toolWindow.js';

// The original node.js had a DOMContentLoaded listener.
// We'll export the functions that were called there.
document.addEventListener('DOMContentLoaded', () => {
    injectImageOverlay();
    // We need to ensure that tool windows are rendered before binding overlays.
    // This is now handled in createToolWindow.
    // bindPromptFieldOverlays();
});

export {
    createToolWindow,
    rerenderToolWindowById,
    injectImageOverlay,
    bindPromptFieldOverlays
}; 