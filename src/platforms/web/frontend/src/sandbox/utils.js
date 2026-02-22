import { availableTools } from './state.js';

// Generate unique IDs for tool windows
export function generateWindowId() {
    return 'tool-' + Math.random().toString(36).substr(2, 9);
}

// Update tool button click handlers
export function updateToolButtonHandlers(activateToolCallback) {
    const sidebarToolButtons = document.querySelectorAll('.tool-button');
    sidebarToolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tool = availableTools.find(t => t.toolId === button.dataset.toolId);
            if (tool) {
                activateToolCallback(tool);
            }
        });
    });
}

// Check if a position would overlap with existing nodes
function hasOverlap(x, y, existingNodes, nodeWidth = 320, nodeHeight = 200) {
    const padding = 40; // Minimum spacing between nodes
    const halfWidth = (nodeWidth + padding) / 2;
    const halfHeight = (nodeHeight + padding) / 2;
    
    return existingNodes.some(node => {
        const dx = Math.abs(node.workspaceX - x);
        const dy = Math.abs(node.workspaceY - y);
        return dx < halfWidth && dy < halfHeight;
    });
}

// Find next position using spiral placement algorithm
function findNextPosition(centerX, centerY, existingNodes) {
    const scale = (window.sandbox && typeof window.sandbox.getScale === 'function') ? window.sandbox.getScale() : 1;
    const baseRadius = 200 / scale; // Base radius in workspace units
    const angleStep = Math.PI / 4; // 45 degrees per step
    const nodeWidth = 320;
    const nodeHeight = 200;
    
    // Start with center position
    if (!hasOverlap(centerX, centerY, existingNodes, nodeWidth, nodeHeight)) {
        return { x: centerX, y: centerY };
    }
    
    // Spiral outward, checking 8 positions per ring
    let radius = baseRadius;
    for (let ring = 0; ring < 10; ring++) {
        for (let i = 0; i < 8; i++) {
            const angle = i * angleStep + (ring * 0.1); // Slight rotation per ring
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            if (!hasOverlap(x, y, existingNodes, nodeWidth, nodeHeight)) {
                return { x, y };
            }
        }
        radius += baseRadius; // Expand to next ring
    }
    
    // Fallback: place at center with slight offset
    return { 
        x: centerX + baseRadius * Math.cos(existingNodes.length * angleStep),
        y: centerY + baseRadius * Math.sin(existingNodes.length * angleStep)
    };
}

// Calculate center position for new tool windows
export function calculateCenterPosition(toolWindows) {
    const sandboxContent = document.querySelector('.sandbox-content');
    if (!sandboxContent) return { x: 0, y: 0 };

    // Calculate the screen-space centre of the visible sandbox
    const rect = sandboxContent.getBoundingClientRect();
    const screenCenterX = rect.left + rect.width / 2;
    const screenCenterY = rect.top + rect.height / 2;

    // Translate to workspace coordinates (pan/zoom aware)
    let { x: centerX, y: centerY } = {
        x: screenCenterX,
        y: screenCenterY
    };
    if (window.sandbox && typeof window.sandbox.screenToWorkspace === 'function') {
        ({ x: centerX, y: centerY } = window.sandbox.screenToWorkspace(screenCenterX, screenCenterY));
    }

    if (toolWindows.length === 0) {
        // No existing nodes – simply place at the current viewport centre.
        return { x: centerX, y: centerY };
    }

    // Use spiral placement algorithm with overlap detection
    return findNextPosition(centerX, centerY, toolWindows);
}

// Helper to determine input types for a tool
export function getToolInputTypes(tool) {
    const inputTypes = new Set();
    
    // Check category prefix
    if (tool.category?.includes('-to-')) {
        inputTypes.add(tool.category.split('-to-')[0]);
    }

    // Check input schema
    const inputSchema = tool.inputSchema || {};
    Object.keys(inputSchema).forEach(param => {
        if (param.startsWith('input_image')) inputTypes.add('image');
        if (param.startsWith('input_audio')) inputTypes.add('audio');
        if (param.startsWith('input_video')) inputTypes.add('video');
        if (param === 'input_prompt' || param === 'prompt') inputTypes.add('text');
    });

    return Array.from(inputTypes);
}

// Helper to check if a tool accepts image input
export function toolAcceptsImageInput(tool) {
    // Check if it's explicitly an image-to-x tool
    if (tool.category?.startsWith('image-to-')) return true;

    // Check input schema for image-related parameters
    const imageInputParams = [
        'input_image',
        'input_style_image',
        'input_control_image',
        'input_reference_image',
        'input_mask_image'
    ];

    return Object.keys(tool.inputSchema || {}).some(param => 
        imageInputParams.includes(param)
    );
}

export function makeDraggable(element, handle) {
    let offsetX, offsetY;
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    handle.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === handle) {
            isDragging = true;
        }
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            element.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }

    function dragEnd() {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }
}

export function hideModal() {
    const actionModal = document.querySelector('.action-modal');
    const createSubmenu = document.querySelector('.create-submenu');
    if (actionModal) {
        actionModal.classList.remove('active');
    }
    if (createSubmenu) {
        createSubmenu.classList.remove('active');
    }
} 