document.addEventListener('DOMContentLoaded', async () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');

    if (sidebar && sidebarToggle) {
        // Collapse the sidebar by default on page load
        sidebar.classList.add('collapsed');
        sidebarToggle.textContent = '>';

        // Add click event listener to the toggle button
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            
            // Change the toggle button text based on the state
            if (sidebar.classList.contains('collapsed')) {
                sidebarToggle.textContent = '>';
            } else {
                sidebarToggle.textContent = '<';
            }
        });
    }

    initializeTools();
});

// Initialize click interaction elements
const rippleElement = document.createElement('img');
rippleElement.src = '/images/workspace/circularwaterripple.gif';
rippleElement.className = 'click-ripple';
document.body.appendChild(rippleElement);

const actionModal = document.createElement('div');
actionModal.className = 'action-modal';

// Create the main buttons and submenu
const createSubmenu = document.createElement('div');
createSubmenu.className = 'create-submenu';
createSubmenu.innerHTML = `
    <button type="button" data-type="image"><span>image</span> <span>🖼️</span></button>
    <button type="button" data-type="sound"><span>sound</span> <span>🎵</span></button>
    <button type="button" data-type="text"><span>text</span> <span>📝</span></button>
    <button type="button" data-type="movie"><span>movie</span> <span>🎬</span></button>
`;

actionModal.innerHTML = `
    <button type="button" class="upload-btn"><span>upload</span> <span>📎</span></button>
    <button type="button" class="create-btn"><span>create</span> <span>🎨</span></button>
`;

// Append submenu to the create button
const createBtn = actionModal.querySelector('.create-btn');
createBtn.appendChild(createSubmenu);

document.body.appendChild(actionModal);

// Handle click interactions
let activeModal = false;
let activeSubmenu = false;

// Tool category mapping for creation types
const CREATION_TYPE_TO_CATEGORY = {
    'image': 'text-to-image',
    'sound': 'text-to-audio',
    'text': 'text-to-text',
    'movie': 'text-to-video'
};

// Store tools globally after fetching
let availableTools = [];

// Workspace management
let activeToolWindows = [];
let lastClickPosition = null;

// Output type to emoji mapping
const OUTPUT_TYPE_EMOJI = {
    'image': '🖼️',
    'text': '📝',
    'audio': '🎵',
    'video': '🎬'
};

// Connection line management
let activeConnection = null;
let connectionLine = null;

// Connection management
let connections = [];

// Helper to check if a tool accepts image input
function toolAcceptsImageInput(tool) {
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

// Update output type mapping to match actual tool categories
const OUTPUT_TYPE_MAPPING = {
    'image': {
        emoji: '🖼️',
        modalTitle: 'Transform Image',
        categories: [
            {
                name: 'Transform',
                filter: tool => toolAcceptsImageInput(tool)
            }
        ]
    },
    'text': {
        emoji: '📝',
        modalTitle: 'Process Text',
        categories: [
            {
                name: 'Generate',
                filter: tool => tool.category?.startsWith('text-to-')
            },
            {
                name: 'Analyze',
                filter: tool => tool.category === 'text-to-text'
            }
        ]
    },
    'audio': {
        emoji: '🎵',
        modalTitle: 'Process Audio',
        categories: [
            {
                name: 'Transform',
                filter: tool => tool.category?.startsWith('audio-to-') || 
                    (tool.inputSchema && 'input_audio' in tool.inputSchema)
            }
        ]
    },
    'video': {
        emoji: '🎬',
        modalTitle: 'Process Video',
        categories: [
            {
                name: 'Transform',
                filter: tool => tool.category?.startsWith('video-to-') ||
                    (tool.inputSchema && 'input_video' in tool.inputSchema)
            }
        ]
    }
};

// Helper to generate unique IDs for tool windows
function generateWindowId() {
    return 'tool-' + Math.random().toString(36).substr(2, 9);
}

// Calculate position for new tool window from sidebar
function calculateCenterPosition(toolWindows) {
    const sandbox = document.querySelector('.sandbox-content');
    if (!sandbox) return { x: 0, y: 0 };

    const rect = sandbox.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (toolWindows.length === 0) {
        return { x: centerX, y: centerY };
    }

    // Calculate position in a circular pattern around the center
    const radius = 150; // Distance from center
    const angle = (toolWindows.length * (Math.PI * 2) / 8); // Divide circle into 8 positions
    return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
    };
}

// Helper to determine input types for a tool
function getToolInputTypes(tool) {
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

// Create a permanent connection between two tool windows
function createPermanentConnection(fromWindow, toWindow, type) {
    const connection = document.createElement('div');
    connection.className = 'connection-line permanent';
    connection.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: linear-gradient(90deg, 
            rgba(255, 255, 255, 0.8) 0%,
            rgba(255, 255, 255, 0.4) 50%,
            rgba(255, 255, 255, 0.8) 100%
        );
        background-size: 200% 100%;
        height: 2px;
        transform-origin: left center;
        z-index: 999;
        filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.4));
        animation: flowingLine 2s linear infinite;
    `;
    document.body.appendChild(connection);

    const connectionData = {
        element: connection,
        from: fromWindow,
        to: toWindow,
        type: type
    };
    connections.push(connectionData);
    updatePermanentConnection(connectionData);

    return connectionData;
}

// Update a permanent connection's position
function updatePermanentConnection(connection) {
    const fromRect = connection.from.getBoundingClientRect();
    const toRect = connection.to.getBoundingClientRect();

    // Get the exact position of the output and input anchors
    const fromAnchor = connection.from.querySelector('.anchor-point');
    const toAnchor = connection.to.querySelector(`.input-anchor[data-type="${connection.type}"]`);
    
    if (!fromAnchor || !toAnchor) return;

    const fromAnchorRect = fromAnchor.getBoundingClientRect();
    const toAnchorRect = toAnchor.getBoundingClientRect();

    const fromX = fromAnchorRect.right;
    const fromY = fromAnchorRect.top + (fromAnchorRect.height / 2);
    const toX = toAnchorRect.left;
    const toY = toAnchorRect.top + (toAnchorRect.height / 2);

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    connection.element.style.width = `${length}px`;
    connection.element.style.left = `${fromX}px`;
    connection.element.style.top = `${fromY}px`;
    connection.element.style.transform = `rotate(${angle}rad)`;
}

// Create input anchor point
function createInputAnchor(tool, type) {
    const anchor = document.createElement('div');
    anchor.className = 'input-anchor';
    anchor.dataset.type = type; // Add data attribute for type
    const emoji = OUTPUT_TYPE_MAPPING[type]?.emoji || '📄';
    anchor.textContent = emoji;
    anchor.style.cssText = `
        position: absolute;
        left: -20px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2em;
        transition: all 0.3s ease;
        z-index: 1001;
    `;

    // Add tooltip to show input type
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
        position: absolute;
        left: -8px;
        transform: translateX(-100%);
        background: rgba(0, 0, 0, 0.85);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.8em;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
    `;
    tooltip.textContent = `${type} input`;
    anchor.appendChild(tooltip);

    // Hover effects
    anchor.addEventListener('mouseenter', () => {
        anchor.style.transform = 'translateY(-50%) scale(1.1)';
        anchor.style.borderColor = 'rgba(255, 255, 255, 0.4)';
        anchor.style.filter = 'brightness(1.2)';
        tooltip.style.opacity = '1';
    });
    anchor.addEventListener('mouseleave', () => {
        anchor.style.transform = 'translateY(-50%) scale(1)';
        anchor.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        anchor.style.filter = 'none';
        tooltip.style.opacity = '0';
    });

    return anchor;
}

// Create a tool window
function createToolWindow(tool, position) {
    const windowId = generateWindowId();
    
    const toolWindow = document.createElement('div');
    toolWindow.id = windowId;
    toolWindow.className = 'tool-window';
    toolWindow.style.cssText = `
        position: absolute;
        left: ${position.x}px;
        top: ${position.y}px;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        min-width: 300px;
        color: white;
        font-family: monospace;
        z-index: 100;
        transition: all 0.3s ease;
    `;

    // Separate parameters into required and optional
    const params = Object.entries(tool.inputSchema || {}).reduce((acc, [key, param]) => {
        if (param.required) {
            acc.required.push([key, param]);
        } else {
            acc.optional.push([key, param]);
        }
        return acc;
    }, { required: [], optional: [] });

    // Window header with drag handle
    const header = document.createElement('div');
    header.className = 'tool-window-header';
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        cursor: move;
    `;

    const title = document.createElement('div');
    title.textContent = tool.displayName;
    title.style.fontWeight = 'bold';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background: none; border: none; color: white; cursor: pointer; padding: 4px 8px;';

    header.append(title, closeBtn);

    // Required parameters section
    const requiredSection = document.createElement('div');
    requiredSection.className = 'required-params';
    requiredSection.style.cssText = `
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;

    params.required.forEach(([key, param]) => {
        const input = createParameterInput(param);
        requiredSection.appendChild(input);
    });

    // Show more button
    const showMoreBtn = document.createElement('button');
    showMoreBtn.textContent = 'show more';
    showMoreBtn.style.cssText = `
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        padding: 8px;
        cursor: pointer;
        font-family: monospace;
        width: 100%;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.2s ease;
    `;

    // Optional parameters section (hidden initially)
    const optionalSection = document.createElement('div');
    optionalSection.className = 'optional-params';
    optionalSection.style.cssText = `
        padding: 16px;
        display: none;
        flex-direction: column;
        gap: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

    params.optional.forEach(([key, param]) => {
        const input = createParameterInput(param);
        optionalSection.appendChild(input);
    });

    // Execute button
    const executeBtn = document.createElement('button');
    executeBtn.textContent = 'Execute';
    executeBtn.style.cssText = `
        width: calc(100% - 32px);
        margin: 16px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        cursor: pointer;
        font-family: monospace;
        transition: all 0.2s ease;
    `;

    // Replace anchor point creation with new function
    const anchorPoint = createAnchorPoint(tool);

    // Show more functionality
    let isExpanded = false;
    showMoreBtn.addEventListener('click', () => {
        isExpanded = !isExpanded;
        optionalSection.style.display = isExpanded ? 'flex' : 'none';
        showMoreBtn.textContent = isExpanded ? 'show less' : 'show more';
        showMoreBtn.style.color = isExpanded ? 'white' : 'rgba(255, 255, 255, 0.6)';
    });

    // Button hover effects
    executeBtn.addEventListener('mouseenter', () => {
        executeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    });
    executeBtn.addEventListener('mouseleave', () => {
        executeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    });

    // Close functionality
    closeBtn.addEventListener('click', () => {
        toolWindow.remove();
        activeToolWindows = activeToolWindows.filter(w => w.id !== windowId);
    });

    // Add input anchors
    const inputTypes = getToolInputTypes(tool);
    const inputAnchorsContainer = document.createElement('div');
    inputAnchorsContainer.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        transform: translateX(-100%);
        padding: 8px 0;
    `;

    inputTypes.forEach((type, index) => {
        const anchor = createInputAnchor(tool, type);
        // Position anchors evenly along the height of the window
        anchor.style.position = 'relative';
        anchor.style.left = '0';
        anchor.style.transform = 'none';
        inputAnchorsContainer.appendChild(anchor);
    });

    // Assemble window
    toolWindow.append(header, requiredSection, showMoreBtn, optionalSection, executeBtn, anchorPoint, inputAnchorsContainer);

    // Make window draggable
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    toolWindow.addEventListener('mousedown', (e) => {
        if (e.target === toolWindow || e.target.classList.contains('tool-header')) {
            isDragging = true;
            dragOffset.x = e.clientX - toolWindow.offsetLeft;
            dragOffset.y = e.clientY - toolWindow.offsetTop;
            toolWindow.style.cursor = 'grabbing';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const x = e.clientX - dragOffset.x;
            const y = e.clientY - dragOffset.y;
            toolWindow.style.left = `${x}px`;
            toolWindow.style.top = `${y}px`;

            // Update all connections involving this window
            connections.forEach(conn => {
                if (conn.from === toolWindow || conn.to === toolWindow) {
                    updatePermanentConnection(conn);
                }
            });
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        toolWindow.style.cursor = '';
    });

    document.body.appendChild(toolWindow);
    activeToolWindows.push({ id: windowId, tool, window: toolWindow });
    return toolWindow;
}

// Helper to create parameter input
function createParameterInput(param) {
    const container = document.createElement('div');
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 4px;
    `;

    const input = document.createElement('input');
    input.type = param.type === 'number' || param.type === 'integer' ? 'number' : 'text';
    input.value = param.default || '';
    input.placeholder = param.name;
    input.style.cssText = `
        padding: 8px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        color: white;
        font-family: monospace;
        transition: all 0.2s ease;
    `;

    // Input hover/focus effects
    input.addEventListener('focus', () => {
        input.style.borderColor = 'rgba(255, 255, 255, 0.4)';
        input.style.background = 'rgba(255, 255, 255, 0.15)';
    });
    input.addEventListener('blur', () => {
        input.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        input.style.background = 'rgba(255, 255, 255, 0.1)';
    });

    container.appendChild(input);
    return container;
}

// Helper to make an element draggable
function makeDraggable(element, handle) {
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

// Update tool activation in both sidebar and modal
function activateTool(tool, position = null) {
    hideModal();

    // Check if a tool window with the same ID already exists
    const existingWindow = activeToolWindows.find(w => w.id === generateWindowId());
    if (existingWindow) {
        return;
    }

    if (!position) {
        position = calculateCenterPosition(activeToolWindows);
    }
    createToolWindow(tool, position);
}

document.addEventListener('click', (e) => {
    const clickedCreateBtn = e.target.closest('.create-btn');
    const clickedSubmenuBtn = e.target.closest('.create-submenu button');
    const clickedUploadBtn = e.target.closest('.upload-btn');

    // Handle create button click
    if (clickedCreateBtn && !activeSubmenu) {
        e.stopPropagation();
        createSubmenu.classList.add('active');
        activeSubmenu = true;
        return;
    }

    // Handle submenu option click
    if (clickedSubmenuBtn) {
        e.stopPropagation();
        const type = clickedSubmenuBtn.dataset.type;
        
        if (type === 'image') {
            // Show text-to-image tools
            const rect = clickedSubmenuBtn.getBoundingClientRect();
            showToolsForCategory(CREATION_TYPE_TO_CATEGORY[type], rect.right + 10, rect.top);
        } else if (type === 'sound') {
            // Show text-to-audio tools
            const rect = clickedSubmenuBtn.getBoundingClientRect();
            showToolsForCategory(CREATION_TYPE_TO_CATEGORY[type], rect.right + 10, rect.top);
        } else if (type === 'text') {
            // Show text-to-text tools
            const rect = clickedSubmenuBtn.getBoundingClientRect();
            showToolsForCategory(CREATION_TYPE_TO_CATEGORY[type], rect.right + 10, rect.top);
        } else if (type === 'movie') {
            // Show text-to-video tools
            const rect = clickedSubmenuBtn.getBoundingClientRect();
            showToolsForCategory(CREATION_TYPE_TO_CATEGORY[type], rect.right + 10, rect.top);
        }
        return;
    }

    // Handle upload button click
    if (clickedUploadBtn) {
        showUploadInterface(actionModal);
        return;
    }

    // If modal is active and click is outside, hide it
    if (activeModal) {
        hideModal();
        return;
    }

    // Only handle clicks in the sandbox area
    const sandbox = document.querySelector('.sandbox-content');
    if (!sandbox || !sandbox.contains(e.target)) {
        return;
    }

    // Show ripple effect
    rippleElement.style.left = `${e.clientX}px`;
    rippleElement.style.top = `${e.clientY}px`;
    rippleElement.classList.add('active');

    // Hide ripple after animation
    setTimeout(() => {
        rippleElement.classList.remove('active');
    }, 300);

    // Position and show modal
    const rect = sandbox.getBoundingClientRect();
    const modalHeight = 60; // Approximate height of modal
    const padding = 20; // Padding from edges

    let modalX = e.clientX;
    let modalY = e.clientY - modalHeight - padding; // Try to position above click

    // If too close to top, position below click
    if (modalY < rect.top + padding) {
        modalY = e.clientY + padding;
    }

    // Ensure modal stays within sandbox bounds
    modalX = Math.max(rect.left + padding, Math.min(rect.right - padding, modalX));
    modalY = Math.max(rect.top + padding, Math.min(rect.bottom - padding, modalY));

    actionModal.style.left = `${modalX}px`;
    actionModal.style.top = `${modalY}px`;
    actionModal.classList.add('active');
    activeModal = true;

    // Update click handling to save position
    lastClickPosition = { x: e.clientX, y: e.clientY };
});

// Helper function to hide modal and submenu
function hideModal() {
    actionModal.classList.remove('active');
    createSubmenu.classList.remove('active');
    activeModal = false;
    activeSubmenu = false;
}

// Update tools initialization to store tools globally
async function initializeTools() {
    const toolsContainer = document.querySelector('.tools-container');
    if (!toolsContainer) return;

    try {
        const response = await fetch('/api/v1/tools');
        availableTools = await response.json();

        // Clear loading message
        toolsContainer.innerHTML = '';

        // Group tools by category
        const toolsByCategory = availableTools.reduce((acc, tool) => {
            const category = tool.category || 'uncategorized';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(tool);
            return acc;
        }, {});

        // Create category sections
        Object.entries(toolsByCategory).forEach(([category, categoryTools]) => {
            // Create category header
            const categoryHeader = document.createElement('h4');
            categoryHeader.textContent = category
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            categoryHeader.style.margin = '16px 0 8px';
            categoryHeader.style.color = 'rgba(255, 255, 255, 0.9)';
            categoryHeader.style.fontFamily = 'monospace';
            toolsContainer.appendChild(categoryHeader);

            // Add tools for this category
            categoryTools.forEach(tool => {
                const toolButton = document.createElement('button');
                toolButton.className = 'tool-button';
                toolButton.style.cssText = `
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    padding: 12px;
                    margin: 4px 0;
                    cursor: pointer;
                    text-align: left;
                    width: 100%;
                    transition: all 0.2s ease;
                    color: white;
                `;

                const name = document.createElement('div');
                name.textContent = tool.displayName;
                name.style.fontFamily = 'monospace';
                name.style.marginBottom = '4px';

                const description = document.createElement('div');
                description.textContent = tool.description.split('.')[0]; // First sentence only
                description.style.fontSize = '0.8em';
                description.style.color = 'rgba(255, 255, 255, 0.6)';
                description.style.lineHeight = '1.4';

                toolButton.appendChild(name);
                toolButton.appendChild(description);

                // Hover effect
                toolButton.addEventListener('mouseenter', () => {
                    toolButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    toolButton.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                });
                toolButton.addEventListener('mouseleave', () => {
                    toolButton.style.background = 'rgba(255, 255, 255, 0.05)';
                    toolButton.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                });

                // Click handler
                toolButton.addEventListener('click', () => {
                    console.log('Tool clicked:', tool.toolId);
                    // TODO: Implement tool activation
                });

                toolsContainer.appendChild(toolButton);
            });
        });

    } catch (error) {
        console.error('Failed to fetch tools:', error);
        toolsContainer.innerHTML = `
            <div style="color: #ff6b6b; padding: 16px; text-align: center; font-family: monospace;">
                Failed to load tools
            </div>
        `;
    }
}

// Function to show tools for a specific category
function showToolsForCategory(category, x, y) {
    // Create tools submenu
    const toolsSubmenu = document.createElement('div');
    toolsSubmenu.className = 'tools-submenu';
    toolsSubmenu.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 12px;
        z-index: 1002;
        min-width: 200px;
        max-width: 300px;
        color: white;
        font-family: monospace;
    `;

    // Filter tools by category
    const categoryTools = availableTools.filter(tool => tool.category === category);

    if (categoryTools.length === 0) {
        toolsSubmenu.innerHTML = `
            <div style="padding: 8px; color: rgba(255, 255, 255, 0.6);">
                No ${category} tools available
            </div>
        `;
    } else {
        categoryTools.forEach(tool => {
            const toolButton = document.createElement('button');
            toolButton.style.cssText = `
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 12px;
                margin: 4px 0;
                cursor: pointer;
                text-align: left;
                width: 100%;
                color: white;
                transition: all 0.2s ease;
                display: block;
            `;

            const name = document.createElement('div');
            name.textContent = tool.displayName;
            name.style.marginBottom = '4px';

            const description = document.createElement('div');
            description.textContent = tool.description.split('.')[0];
            description.style.fontSize = '0.8em';
            description.style.color = 'rgba(255, 255, 255, 0.6)';

            toolButton.appendChild(name);
            toolButton.appendChild(description);

            // Hover effects
            toolButton.addEventListener('mouseenter', () => {
                toolButton.style.background = 'rgba(255, 255, 255, 0.1)';
                toolButton.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            });
            toolButton.addEventListener('mouseleave', () => {
                toolButton.style.background = 'transparent';
                toolButton.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            });

            // Tool activation
            toolButton.addEventListener('click', () => {
                hideModal();
                toolsSubmenu.remove();
                activateTool(tool, lastClickPosition);
            });

            toolsSubmenu.appendChild(toolButton);
        });
    }

    // Position the submenu
    document.body.appendChild(toolsSubmenu);
    
    // Calculate position to ensure it stays in viewport
    const rect = toolsSubmenu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust X position if it would overflow
    if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 20;
    }

    // Adjust Y position if it would overflow
    if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 20;
    }

    toolsSubmenu.style.left = `${x}px`;
    toolsSubmenu.style.top = `${y}px`;

    // Close submenu when clicking outside
    const closeSubmenu = (e) => {
        if (!toolsSubmenu.contains(e.target)) {
            toolsSubmenu.remove();
            document.removeEventListener('click', closeSubmenu);
        }
    };
    
    // Delay adding click listener to prevent immediate closure
    setTimeout(() => {
        document.addEventListener('click', closeSubmenu);
    }, 0);

    return toolsSubmenu;
}

// Initialize tools when document is ready
document.addEventListener('DOMContentLoaded', initializeTools);

// Update tool button click handlers
function updateToolButtonHandlers() {
    // In sidebar
    const sidebarToolButtons = document.querySelectorAll('.tool-button');
    sidebarToolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tool = availableTools.find(t => t.toolId === button.dataset.toolId);
            if (tool) {
                activateTool(tool);
            }
        });
    });
}

// Create connection line
function createConnectionLine() {
    const line = document.createElement('div');
    line.className = 'connection-line';
    line.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: linear-gradient(90deg, 
            rgba(255, 255, 255, 0.8), 
            rgba(255, 255, 255, 0.4)
        );
        height: 2px;
        transform-origin: left center;
        z-index: 1000;
        filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.4));
    `;
    document.body.appendChild(line);
    return line;
}

// Update connection line position
function updateConnectionLine(startX, startY, endX, endY) {
    if (!connectionLine) return;

    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    connectionLine.style.width = `${length}px`;
    connectionLine.style.left = `${startX}px`;
    connectionLine.style.top = `${startY}px`;
    connectionLine.style.transform = `rotate(${angle}rad)`;
}

// Show output-based tool selection
function showOutputBasedTools(outputType, x, y) {
    const typeConfig = OUTPUT_TYPE_MAPPING[outputType];
    if (!typeConfig) return;

    // Create tool selection modal
    const modal = document.createElement('div');
    modal.className = 'output-tools-modal';
    modal.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 16px;
        color: white;
        font-family: monospace;
        z-index: 1001;
        min-width: 240px;
    `;

    // Add header
    const header = document.createElement('div');
    header.textContent = typeConfig.modalTitle;
    header.style.cssText = `
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 12px;
        font-weight: bold;
        font-size: 1.1em;
    `;
    modal.appendChild(header);

    // Add categories
    typeConfig.categories.forEach(category => {
        // Filter tools for this category using the category's filter function
        const categoryTools = availableTools.filter(category.filter);

        // Only show category if it has tools
        if (categoryTools.length > 0) {
            // Category header
            const categoryHeader = document.createElement('div');
            categoryHeader.style.cssText = `
                padding: 8px;
                margin-top: 8px;
                color: rgba(255, 255, 255, 0.7);
                font-size: 0.9em;
                text-transform: uppercase;
                letter-spacing: 1px;
            `;
            categoryHeader.textContent = category.name;
            modal.appendChild(categoryHeader);

            // Add tools
            categoryTools.forEach(tool => {
                const button = document.createElement('button');
                button.style.cssText = `
                    width: 100%;
                    padding: 12px;
                    margin: 4px 0;
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                    text-align: left;
                    font-family: monospace;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                `;

                const emoji = document.createElement('div');
                emoji.style.cssText = `
                    font-size: 1.5em;
                    min-width: 24px;
                    text-align: center;
                `;
                emoji.textContent = typeConfig.emoji;
                button.appendChild(emoji);

                const textContent = document.createElement('div');
                textContent.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 4px;">${tool.displayName}</div>
                    <div style="font-size: 0.8em; color: rgba(255, 255, 255, 0.6);">
                        ${tool.description.split('.')[0]}
                    </div>
                `;
                button.appendChild(textContent);

                button.addEventListener('mouseenter', () => {
                    button.style.background = 'rgba(255, 255, 255, 0.1)';
                    button.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                });
                button.addEventListener('mouseleave', () => {
                    button.style.background = 'transparent';
                    button.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                });

                button.addEventListener('click', () => {
                    const newWindow = activateTool(tool, { x, y });
                    modal.remove();

                    // Create permanent connection if we're coming from an output
                    if (activeConnection) {
                        const sourceWindow = document.elementFromPoint(
                            activeConnection.startX,
                            activeConnection.startY
                        ).closest('.tool-window');

                        if (sourceWindow) {
                            createPermanentConnection(sourceWindow, newWindow, activeConnection.outputType);
                        }
                    }
                    activeConnection = null;
                });

                modal.appendChild(button);
            });
        }
    });

    // Only show modal if there are tools to display
    if (modal.children.length > 1) { // More than just the header
        // Add click outside handler
        function handleClickOutside(e) {
            if (!modal.contains(e.target)) {
                modal.remove();
                document.removeEventListener('click', handleClickOutside);
            }
        }
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);

        document.body.appendChild(modal);
    }
}

// Update the output anchor point creation
function createAnchorPoint(tool) {
    const anchorPoint = document.createElement('div');
    anchorPoint.className = 'anchor-point';
    const outputType = tool.metadata?.outputType || tool.category?.split('-').pop() || 'text';
    const emoji = OUTPUT_TYPE_MAPPING[outputType]?.emoji || '📄';
    anchorPoint.textContent = emoji;
    anchorPoint.style.cssText = `
        position: absolute;
        right: -20px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        transition: all 0.3s ease;
        font-size: 1.2em;
        z-index: 1001;
    `;

    // Add tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
        position: absolute;
        right: -8px;
        transform: translateX(100%);
        background: rgba(0, 0, 0, 0.85);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.8em;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
    `;
    tooltip.textContent = `${outputType} output`;
    anchorPoint.appendChild(tooltip);

    // Handle connection drawing
    anchorPoint.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeConnection = {
            startX: e.clientX,
            startY: e.clientY,
            outputType
        };
        connectionLine = createConnectionLine();
        anchorPoint.style.cursor = 'grabbing';

        function handleMouseMove(e) {
            if (activeConnection) {
                updateConnectionLine(
                    activeConnection.startX,
                    activeConnection.startY,
                    e.clientX,
                    e.clientY
                );
            }
        }

        function handleMouseUp(e) {
            if (activeConnection) {
                connectionLine.remove();
                connectionLine = null;
                showOutputBasedTools(outputType, e.clientX, e.clientY);
                activeConnection = null;
                anchorPoint.style.cursor = 'grab';
            }
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });

    // Hover effects
    anchorPoint.addEventListener('mouseenter', () => {
        anchorPoint.style.transform = 'translateY(-50%) scale(1.1)';
        anchorPoint.style.borderColor = 'rgba(255, 255, 255, 0.4)';
        anchorPoint.style.filter = 'brightness(1.2)';
        tooltip.style.opacity = '1';
    });
    anchorPoint.addEventListener('mouseleave', () => {
        anchorPoint.style.transform = 'translateY(-50%) scale(1)';
        anchorPoint.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        anchorPoint.style.filter = 'none';
        tooltip.style.opacity = '0';
    });

    return anchorPoint;
}

// Clean up connections when a window is closed
function closeToolWindow(windowId) {
    const windowToRemove = activeToolWindows.find(w => w.id === windowId);
    if (windowToRemove) {
        // Remove any connections involving this window
        connections = connections.filter(conn => {
            if (conn.from === windowToRemove || conn.to === windowToRemove) {
                conn.element.remove();
                return false;
            }
            return true;
        });
        windowToRemove.remove();
        activeToolWindows = activeToolWindows.filter(w => w.id !== windowId);
    }
}

// Add CSS for permanent connections
const style = document.createElement('style');
style.textContent = `
    .connection-line.permanent {
        background: linear-gradient(90deg,
            rgba(255, 255, 255, 0.8) 0%,
            rgba(255, 255, 255, 0.4) 50%,
            rgba(255, 255, 255, 0.8) 100%
        );
        background-size: 200% 100%;
        animation: flowingLine 2s linear infinite;
    }
`;
document.head.appendChild(style);

function createImageInSandbox(src, position) {
    const sandbox = document.querySelector('.sandbox-content');
    if (!sandbox) return;

    const container = document.createElement('div');
    container.className = 'sandbox-item image-item';
    
    const img = document.createElement('img');
    img.src = src;
    
    container.appendChild(img);
    makeDraggable(container, container);

    if (position) {
        container.style.left = `${position.x}px`;
        container.style.top = `${position.y}px`;
    } else {
        const center = calculateCenterPosition(activeToolWindows);
        container.style.left = `${center.x}px`;
        container.style.top = `${center.y}px`;
    }

    sandbox.appendChild(container);
    // You might want to manage this new item in an array or similar
}

// --- Upload Interface Logic ---

function showUploadInterface(modal) {
    const originalContent = modal.innerHTML;
    
    modal.innerHTML = `
        <div class="upload-area">
            <p>Drag & drop an image, or click</p>
            <input type="file" id="image-upload-input" style="display:none" accept="image/*">
        </div>
        <button type="button" class="modal-cancel-btn">Cancel</button>
    `;

    const uploadArea = modal.querySelector('.upload-area');
    const fileInput = modal.querySelector('#image-upload-input');
    const cancelBtn = modal.querySelector('.modal-cancel-btn');

    const handleFileSelect = (file) => {
        if (file && file.type.startsWith('image/')) {
            uploadFile(file, modal);
        } else {
            alert('Please select an image file.');
        }
    };

    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.add('active'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('active'));
    });

    uploadArea.addEventListener('drop', (e) => {
        handleFileSelect(e.dataTransfer.files[0]);
    });

    cancelBtn.addEventListener('click', () => {
        modal.innerHTML = originalContent;
        // Re-attach submenu to the create button if needed, although it's part of originalContent
    });
}

async function uploadFile(file, modal) {
    const uploadArea = modal.querySelector('.upload-area');
    if (uploadArea) {
        uploadArea.innerHTML = `<p>Uploading ${file.name}...</p>`;
    }

    try {
        const response = await fetch('/api/v1/storage/upload-url', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error.message || 'Could not get signed URL.');
        }
        const { signedUrl, permanentUrl } = await response.json();

        // Actually upload the file to the signed URL from R2
        const uploadResponse = await fetch(signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type,
            },
        });

        if (!uploadResponse.ok) {
            throw new Error('Failed to upload file to storage.');
        }

        createImageInSandbox(permanentUrl, lastClickPosition);
    } catch (error) {
        console.error('Upload failed:', error);
        alert(`Upload failed: ${error.message}`);
    } finally {
        hideModal();
    }
}

function createImageInSandbox(src, position) {
    const sandbox = document.querySelector('.sandbox-content');
    if (!sandbox) return;

    const container = document.createElement('div');
    container.className = 'sandbox-item image-item';
    
    const img = document.createElement('img');
    img.src = src;
    
    container.appendChild(img);
    makeDraggable(container, container);

    if (position) {
        container.style.left = `${position.x}px`;
        container.style.top = `${position.y}px`;
    } else {
        const center = calculateCenterPosition(activeToolWindows);
        container.style.left = `${center.x}px`;
        container.style.top = `${center.y}px`;
    }

    sandbox.appendChild(container);
} 