import { websocketClient } from '../../../../../core/services/websocket/client.js';
import { generateWindowId, getToolInputTypes } from './utils.js';
import { addToolWindow, removeToolWindow, getConnections, OUTPUT_TYPE_EMOJI } from './state.js';
import { makeDraggable } from './canvas.js';
import { calculateCenterPosition } from './utils.js';
import { startConnection, updatePermanentConnection } from './connections.js';

// A map to associate generation IDs with their corresponding tool window elements
const generationIdToWindowMap = {};

/**
 * Handles real-time progress updates from the WebSocket.
 * @param {object} payload - The progress payload from the server.
 */
function handleGenerationProgress(payload) {
    console.log('[Sandbox] Generation progress received:', payload);
    const { generationId, progress, status, liveStatus } = payload;
    const toolWindow = generationIdToWindowMap[generationId];

    if (toolWindow) {
        let progressIndicator = toolWindow.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            toolWindow.appendChild(progressIndicator);
        }
        const progressPercent = progress ? `(${(progress * 100).toFixed(1)}%)` : '';
        progressIndicator.textContent = `Status: ${liveStatus || status} ${progressPercent}`;
    }
}

/**
 * Handles the final result update from the WebSocket.
 * @param {object} payload - The final result payload from the server.
 */
function handleGenerationUpdate(payload) {
    console.log('[Sandbox] Generation update received:', payload);
    const { generationId, outputs, status } = payload;
    const toolWindow = generationIdToWindowMap[generationId];

    if (toolWindow) {
        // Remove progress indicator
        const progressIndicator = toolWindow.querySelector('.progress-indicator');
        if (progressIndicator) progressIndicator.remove();

        let resultContainer = toolWindow.querySelector('.result-container');
        if (!resultContainer) {
            resultContainer = document.createElement('div');
            resultContainer.className = 'result-container';
            toolWindow.appendChild(resultContainer);
        }

        if (status === 'completed' || status === 'success') {
            resultContainer.innerHTML = `<p>Completed!</p><pre>${JSON.stringify(outputs, null, 2)}</pre>`;
        } else {
            resultContainer.innerHTML = `<p style="color: red;">Failed: ${JSON.stringify(outputs, null, 2)}</p>`;
        }
        
        // Clean up the map entry
        delete generationIdToWindowMap[generationId];
    }
}

// Register WebSocket event listeners
websocketClient.on('generationProgress', handleGenerationProgress);
websocketClient.on('generationUpdate', handleGenerationUpdate);


// Create a tool window
export function createToolWindow(tool, position) {
    console.log('[node.js] createToolWindow called for tool:', tool && tool.toolId, 'at position:', position);
    const windowId = generateWindowId();
    
    const toolWindow = document.createElement('div');
    toolWindow.id = windowId;
    toolWindow.className = 'tool-window';
    toolWindow.style.left = `${position.x}px`;
    toolWindow.style.top = `${position.y}px`;

    // Separate parameters into required and optional
    const params = Object.entries(tool.inputSchema || {}).reduce((acc, [key, param]) => {
        if (param.required) {
            acc.required.push([key, param]);
        } else {
            acc.optional.push([key, param]);
        }
        return acc;
    }, { required: [], optional: [] });

    // Create window components
    const header = createWindowHeader(tool.displayName);
    const requiredSection = createParameterSection(params.required, 'required-params');
    const optionalSection = createParameterSection(params.optional, 'optional-params');
    const showMoreBtn = createShowMoreButton(optionalSection);
    const executeBtn = createExecuteButton();
    const anchorPoint = createAnchorPoint(tool, toolWindow);
    const inputAnchors = createInputAnchors(tool);

    // Attach click handler to execute button
    executeBtn.addEventListener('click', async () => {
        // Clear previous results/errors
        const existingResult = toolWindow.querySelector('.result-container');
        if (existingResult) existingResult.remove();
        showError(toolWindow, '');

        // Show initial progress
        let progressIndicator = toolWindow.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            toolWindow.appendChild(progressIndicator);
        }
        progressIndicator.textContent = 'Executing...';

        console.log('[node.js] Execute button clicked for tool:', tool && tool.toolId);
        // Gather inputs from the tool window
        const inputs = {};
        const inputElements = toolWindow.querySelectorAll('.parameter-input input');
        inputElements.forEach(input => {
            const paramName = input.placeholder;
            inputs[paramName] = input.value;
        });
        const payload = {
            toolId: tool.toolId,
            inputs: inputs,
            metadata: {
                platform: 'web-sandbox'
            }
        };
        console.log('[node.js] Sending execution payload:', payload);
        try {
            // Get CSRF token
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            console.log('[node.js] CSRF token:', csrfToken);
            // Log cookies (if possible)
            console.log('[node.js] Document cookies:', document.cookie);

            const response = await fetch('/api/v1/generation/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken
                },
                credentials: 'include', // Ensure cookies are sent
                body: JSON.stringify(payload),
            });
            console.log('[node.js] Raw fetch response:', response);
            const result = await response.json();
            console.log('[node.js] Execution response:', result);

            if (!response.ok) {
                // Show error in UI
                showError(toolWindow, result.error?.message || 'Execution request failed');
                if (progressIndicator) progressIndicator.remove(); // Remove progress on immediate failure
                throw new Error(result.error?.message || 'Execution request failed');
            } else {
                // Clear any previous error
                showError(toolWindow, '');
                // Link the generationId to this tool window for WebSocket updates
                if (result.generationId) {
                    generationIdToWindowMap[result.generationId] = toolWindow;
                    progressIndicator.textContent = `Status: ${result.status}`;
                }
            }
        } catch (error) {
            console.error('[node.js] Execution Error:', error);
            showError(toolWindow, error.message || 'Unknown error');
            if (progressIndicator) progressIndicator.remove(); // Remove progress on error
        }
    });
    console.log('[node.js] Execute button handler attached for tool:', tool && tool.toolId);

    // Assemble window
    toolWindow.append(
        header, 
        requiredSection, 
        showMoreBtn, 
        optionalSection, 
        executeBtn, 
        anchorPoint, 
        inputAnchors
    );

    // Make window draggable by its header
    setupDragging(toolWindow, header);

    document.body.appendChild(toolWindow);
    addToolWindow({ id: windowId, tool, window: toolWindow });
    return toolWindow;
}

// Create window header
function createWindowHeader(title) {
    const header = document.createElement('div');
    header.className = 'tool-window-header';

    const titleElement = document.createElement('div');
    titleElement.textContent = title;
    titleElement.style.fontWeight = 'bold';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'close-button';
    closeBtn.addEventListener('click', () => {
        header.parentElement.remove();
        removeToolWindow(header.parentElement.id);
    });

    header.append(titleElement, closeBtn);
    return header;
}

// Create parameter section
function createParameterSection(params, className) {
    const section = document.createElement('div');
    section.className = className;

    params.forEach(([key, param]) => {
        const input = createParameterInput(param);
        section.appendChild(input);
    });

    return section;
}

// Create parameter input
function createParameterInput(param) {
    const container = document.createElement('div');
    container.className = 'parameter-input';

    const input = document.createElement('input');
    input.type = param.type === 'number' || param.type === 'integer' ? 'number' : 'text';
    input.value = param.default || '';
    input.placeholder = param.name;

    container.appendChild(input);
    return container;
}

// Create show more button
function createShowMoreButton(optionalSection) {
    const button = document.createElement('button');
    button.textContent = 'show more';
    button.className = 'show-more-button';

    let isExpanded = false;
    button.addEventListener('click', () => {
        isExpanded = !isExpanded;
        optionalSection.style.display = isExpanded ? 'flex' : 'none';
        button.textContent = isExpanded ? 'show less' : 'show more';
        button.classList.toggle('active', isExpanded);
    });

    return button;
}

// Create execute button
function createExecuteButton() {
    const button = document.createElement('button');
    button.textContent = 'Execute';
    button.className = 'execute-button';
    return button;
}

// Create anchor point
function createAnchorPoint(tool, toolWindow) {
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

    return anchorPoint;
}

// Create input anchors
function createInputAnchors(tool) {
    const container = document.createElement('div');
    container.className = 'input-anchors-container';

    const inputTypes = getToolInputTypes(tool);
    inputTypes.forEach(type => {
        const anchor = document.createElement('div');
        anchor.className = 'input-anchor';
        anchor.dataset.type = type;
        const emoji = OUTPUT_TYPE_EMOJI[type] || '📄';
        anchor.textContent = emoji;

        const tooltip = document.createElement('div');
        tooltip.className = 'anchor-tooltip';
        tooltip.textContent = `${type} input`;
        anchor.appendChild(tooltip);

        container.appendChild(anchor);
    });

    return container;
}

// Setup dragging functionality
function setupDragging(toolWindow, handle) {
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragOffset.x = e.clientX - toolWindow.offsetLeft;
        dragOffset.y = e.clientY - toolWindow.offsetTop;
        toolWindow.style.cursor = 'grabbing';
        handle.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const x = e.clientX - dragOffset.x;
            const y = e.clientY - dragOffset.y;
            toolWindow.style.left = `${x}px`;
            toolWindow.style.top = `${y}px`;

            // Update all connections involving this window
            getConnections().forEach(conn => {
                if (conn.from === toolWindow || conn.to === toolWindow) {
                    updatePermanentConnection(conn);
                }
            });
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        toolWindow.style.cursor = '';
        handle.style.cursor = 'move';
    });
} 

function showError(toolWindow, message) {
    let errorDiv = toolWindow.querySelector('.tool-error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'tool-error-message';
        errorDiv.style.color = 'red';
        errorDiv.style.marginTop = '8px';
        toolWindow.appendChild(errorDiv);
    }
    errorDiv.textContent = message;
} 