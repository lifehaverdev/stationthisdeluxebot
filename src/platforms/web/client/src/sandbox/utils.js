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
        return { x: centerX, y: centerY };
    }

    // Stagger subsequent nodes around the first one in a circle so they don’t overlap.
    // Keep a roughly-constant on-screen distance regardless of current zoom level.
    const scale = (window.sandbox && typeof window.sandbox.getScale === 'function') ? window.sandbox.getScale() : 1;
    const radiusScreen = 180; // desired screen-pixel distance between nodes
    const radius = radiusScreen / scale; // convert to workspace units

    const angle = (toolWindows.length * (Math.PI * 2)) / 8; // 8 slots around the circle

    return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
    };
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