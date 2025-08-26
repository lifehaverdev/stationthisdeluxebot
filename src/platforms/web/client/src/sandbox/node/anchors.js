import { OUTPUT_TYPE_EMOJI } from '../state.js';
import { startConnection } from '../connections/index.js';

// Create anchor point
export function createAnchorPoint(tool, toolWindow) {
    const anchorPoint = document.createElement('div');
    anchorPoint.className = 'anchor-point';
    const outputType = tool.metadata?.outputType || tool.category?.split('-').pop() || 'text';
    const emoji = OUTPUT_TYPE_EMOJI[outputType] || '📄';
    anchorPoint.textContent = emoji;

    // Add tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'anchor-tooltip';
    tooltip.textContent = `${outputType} output`;
    anchorPoint.appendChild(tooltip);

    // Handle connection drawing
    anchorPoint.addEventListener('mousedown', (e) => {
        console.log('Anchor point mousedown event fired.');
        e.preventDefault();
        e.stopPropagation(); // Prevent window dragging
        startConnection(e, outputType, toolWindow);
    });
    anchorPoint.addEventListener('touchstart', (e) => {
        console.log('Anchor point touchstart event fired.');
        e.preventDefault();
        e.stopPropagation();
        startConnection(e, outputType, toolWindow);
    }, { passive: false });

    return anchorPoint;
}

// Create input anchors (one per major parameter)
export function createInputAnchors(tool) {
    const container = document.createElement('div');
    container.className = 'input-anchors-container';

    // Only create anchors for major types
    const MAJOR_TYPES = ['text', 'image', 'video', 'audio', 'sound'];
    const inputSchema = tool.inputSchema || {};
    Object.entries(inputSchema).forEach(([paramKey, paramDef]) => {
        // Determine type for anchor
        let type = paramDef.type;
        // Normalize type (e.g., 'textany' -> 'text', 'numberslider' -> skip)
        if (type === 'string') type = 'text';
        if (Array.isArray(type)) type = type[0];
        if (type === 'textany') type = 'text';
        if (type === 'numberslider' || type === 'integer' || type === 'number' || type === 'checkpoint' || type === 'seed') return; // skip granular types
        if (!MAJOR_TYPES.includes(type)) return;

        const anchor = document.createElement('div');
        anchor.className = 'input-anchor';
        anchor.dataset.type = type;
        anchor.dataset.param = paramKey;
        // Emoji/icon for type
        const emoji = OUTPUT_TYPE_EMOJI[type] || '📄';
        anchor.textContent = emoji;

        // Tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'anchor-tooltip';
        tooltip.textContent = `${paramKey} (${type})`;
        anchor.appendChild(tooltip);

        // --- Conditional visibility ---
        if (paramDef.visibleIf && paramDef.visibleIf.field && Array.isArray(paramDef.visibleIf.values)) {
            const dependentField = paramDef.visibleIf.field;
            const updateVisibility = () => {
                const root = container.closest('.tool-window');
                if (!root) return;
                const depEl = root.querySelector(`[name="${dependentField}"]`);
                if (!depEl) return;
                const depValue = depEl.value;
                const shouldShow = paramDef.visibleIf.values.includes(depValue);
                anchor.style.display = shouldShow ? '' : 'none';
            };

            setTimeout(updateVisibility, 0);

            // Attach listeners to update on changes
            setTimeout(() => {
                const depEl = container.closest('.tool-window')?.querySelector(`[name="${dependentField}"]`);
                if (depEl) {
                    depEl.addEventListener('change', updateVisibility);
                    depEl.addEventListener('input', updateVisibility);
                }
            }, 0);
        }

        container.appendChild(anchor);
    });

    return container;
} 