import { websocketClient } from '/js/websocketClient.js';
import { generateWindowId, getToolInputTypes } from './utils.js';
import {
    addToolWindow,
    removeToolWindow,
    getConnections,
    updateToolWindowPosition,
    OUTPUT_TYPE_EMOJI,
    setToolWindowOutput
} from './state.js';
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
            // Try to extract image URL from outputs
            let imageUrl = null;
            if (Array.isArray(outputs) && outputs.length > 0) {
                const firstOutput = outputs[0];
                if (firstOutput && firstOutput.data && Array.isArray(firstOutput.data.images) && firstOutput.data.images.length > 0) {
                    imageUrl = firstOutput.data.images[0].url;
                }
            }
            if (imageUrl) {
                resultContainer.innerHTML = `<p>Completed!</p><img src="${imageUrl}" alt="Generated Image" class="result-image" style="max-width: 100%; max-height: 300px; display: block; margin: 8px 0; cursor: pointer;" />`;
                // Add click handler for overlay
                const img = resultContainer.querySelector('.result-image');
                img.addEventListener('click', () => {
                    console.log('[DEBUG] result-image clicked, imageUrl:', imageUrl);
                    showImageOverlay(imageUrl);
                });
            } else {
                resultContainer.innerHTML = `<p>Completed!</p><pre>${JSON.stringify(outputs, null, 2)}</pre>`;
            }
        } else {
            resultContainer.innerHTML = `<p style=\"color: red;\">Failed: ${JSON.stringify(outputs, null, 2)}</p>`;
        }
        
        // Clean up the map entry
        delete generationIdToWindowMap[generationId];
    }
}

// Register WebSocket event listeners
websocketClient.on('generationProgress', handleGenerationProgress);
websocketClient.on('generationUpdate', handleGenerationUpdate);

// Inject image overlay modal if not present
function injectImageOverlay() {
    if (document.getElementById('image-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'image-overlay';
    overlay.className = 'image-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="image-overlay-content">
        <div class="image-overlay-img-container">
          <img class="image-overlay-img" src="" alt="Full Size" />
        </div>
        <button class="image-overlay-close">&times;</button>
      </div>
    `;
    const sandboxMain = document.querySelector('.sandbox-main');
    if (sandboxMain) {
        sandboxMain.appendChild(overlay);
    }

    // Event listeners for closing overlay
    overlay.querySelector('.image-overlay-close').onclick = hideImageOverlay;
    overlay.addEventListener('click', (e) => {
      // Only close if clicking the overlay background, not the modal content or its children
      if (e.target === overlay) hideImageOverlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideImageOverlay();
    });
}

function showImageOverlay(url) {
    console.log('[DEBUG] showImageOverlay called with url:', url);
    const overlay = document.getElementById('image-overlay');
    const img = overlay.querySelector('.image-overlay-img');
    img.src = url;
    overlay.style.display = 'flex';

    // Wait for image to load, then log sizes
    img.onload = () => {
        const overlayContent = overlay.querySelector('.image-overlay-content');
        const imgContainer = overlay.querySelector('.image-overlay-img-container');
        const overlayParent = overlay.parentElement;
        console.log('[DEBUG] overlay parent (.sandbox-main) size:', overlayParent.offsetWidth, overlayParent.offsetHeight);
        console.log('[DEBUG] overlay size:', overlay.offsetWidth, overlay.offsetHeight);
        console.log('[DEBUG] overlay-content size:', overlayContent.offsetWidth, overlayContent.offsetHeight);
        console.log('[DEBUG] img-container size:', imgContainer.offsetWidth, imgContainer.offsetHeight);
        console.log('[DEBUG] img size:', img.offsetWidth, img.offsetHeight);
        console.log('[DEBUG] window size:', window.innerWidth, window.innerHeight);
    };
    console.log('[DEBUG] overlay.style.display set to flex, overlay:', overlay, 'img:', img);
}

function hideImageOverlay() {
    console.log('[DEBUG] hideImageOverlay called');
    const overlay = document.getElementById('image-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.querySelector('.image-overlay-img').src = '';
}

document.addEventListener('DOMContentLoaded', () => {
    injectImageOverlay();
});

function renderResultContent(resultContainer, output) {
    resultContainer.innerHTML = '';
    if (output.type === 'image' && output.url) {
        resultContainer.innerHTML = `<p>Completed!</p><img src="${output.url}" alt="Generated Image" class="result-image" style="max-width: 100%; max-height: 300px; display: block; margin: 8px 0; cursor: pointer;" />`;
        // Add click handler for overlay
        const img = resultContainer.querySelector('.result-image');
        img.addEventListener('click', () => {
            showImageOverlay(output.url);
        });
    } else if (output.type === 'text' && output.text) {
        resultContainer.textContent = output.text;
    } else {
        resultContainer.textContent = 'Output available.';
    }
}

// Create a tool window
export function createToolWindow(tool, position, id = null, output = null) {
    console.log('[node.js] createToolWindow called for tool:', tool && tool.toolId, 'at workspace position:', position);
    const windowId = id || generateWindowId();
    // Prevent duplicate nodes: check if already exists in DOM or state
    if (document.getElementById(windowId)) {
        return document.getElementById(windowId);
    }
    if (typeof getToolWindow === 'function' && getToolWindow(windowId)) {
        // If already in state, return the DOM element if present, else do nothing
        const existing = document.getElementById(windowId);
        if (existing) return existing;
        // If not in DOM, fall through to create (should not happen in normal flow)
    }
    
    const toolWindowEl = document.createElement('div');
    toolWindowEl.id = windowId;
    toolWindowEl.className = 'tool-window';
    toolWindowEl.setAttribute('data-displayname', tool.displayName || '');

    const windowData = {
        id: windowId,
        tool: tool,
        element: toolWindowEl,
        workspaceX: position.x,
        workspaceY: position.y,
        output: output || null
    };
    addToolWindow(windowData);

    const { x: screenX, y: screenY } = window.sandbox.workspaceToScreen(position.x, position.y);
    toolWindowEl.style.left = `${screenX}px`;
    toolWindowEl.style.top = `${screenY}px`;

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
    let executeBtn = createExecuteButton();
    const anchorPoint = createAnchorPoint(tool, toolWindowEl);
    const inputAnchors = createInputAnchors(tool);

    // Assemble window
    toolWindowEl.append(
        header, 
        requiredSection, 
        showMoreBtn, 
        optionalSection, 
        // executeBtn will be replaced if output is present
        anchorPoint, 
        inputAnchors
    );

    // If output is present, replace execute button with Load button
    if (output) {
        const resultContainer = document.createElement('div');
        resultContainer.className = 'result-container';
        toolWindowEl.appendChild(resultContainer);
        const loadBtn = document.createElement('button');
        loadBtn.textContent = output.type === 'image' ? 'Load Image' : (output.type === 'text' ? 'Load Text' : 'Load Output');
        loadBtn.className = 'execute-button'; // Match style
        loadBtn.onclick = () => {
            renderResultContent(resultContainer, output);
            loadBtn.remove();
        };
        toolWindowEl.appendChild(loadBtn);
    } else {
        // Attach click handler to execute button
        executeBtn.addEventListener('click', async () => {
            // Clear previous results/errors
            const existingResult = toolWindowEl.querySelector('.result-container');
            if (existingResult) existingResult.remove();
            showError(toolWindowEl, '');

            // Show initial progress
            let progressIndicator = toolWindowEl.querySelector('.progress-indicator');
            if (!progressIndicator) {
                progressIndicator = document.createElement('div');
                progressIndicator.className = 'progress-indicator';
                toolWindowEl.appendChild(progressIndicator);
            }
            progressIndicator.textContent = 'Executing...';

            console.log('[node.js] Execute button clicked for tool:', tool && tool.toolId);
            // Gather inputs from the tool window
            const inputs = {};
            const inputElements = toolWindowEl.querySelectorAll('.parameter-input input');
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
                    showError(toolWindowEl, result.error?.message || 'Execution request failed');
                    if (progressIndicator) progressIndicator.remove(); // Remove progress on immediate failure
                    throw new Error(result.error?.message || 'Execution request failed');
                } else {
                    // Clear any previous error
                    showError(toolWindowEl, '');
                    // Link the generationId to this tool window for WebSocket updates
                    if (result.generationId) {
                        generationIdToWindowMap[result.generationId] = toolWindowEl;
                        progressIndicator.textContent = `Status: ${result.status}`;
                    }
                    // If the result is already completed, handle it immediately (for static tools)
                    if (result.status === 'completed' && result.outputs) {
                        handleGenerationUpdate({
                            generationId: result.generationId,
                            outputs: result.outputs,
                            status: result.status
                        });
                        // Persist output for restoration
                        // Handle both array and flat output structures
                        if (Array.isArray(result.outputs) && result.outputs[0]?.data?.images?.[0]?.url) {
                            setToolWindowOutput(windowId, { type: 'image', url: result.outputs[0].data.images[0].url });
                        } else if (result.outputs.imageUrl) {
                            setToolWindowOutput(windowId, { type: 'image', url: result.outputs.imageUrl });
                        } else if (result.outputs.text) {
                            setToolWindowOutput(windowId, { type: 'text', text: result.outputs.text });
                        } else {
                            setToolWindowOutput(windowId, { type: 'unknown', ...result.outputs });
                        }
                        // On successful output:
                        // renderResultContent(resultContainer, output)
                    }
                }
            } catch (error) {
                console.error('[node.js] Execution Error:', error);
                showError(toolWindowEl, error.message || 'Unknown error');
                if (progressIndicator) progressIndicator.remove(); // Remove progress on error
            }
        });
        toolWindowEl.appendChild(executeBtn);
    }

    // Make window draggable by its header
    setupDragging(windowData, header);

    const canvas = document.querySelector('.sandbox-canvas');
    if (canvas) {
        canvas.appendChild(toolWindowEl);
    } else {
        document.body.appendChild(toolWindowEl); // Fallback
    }
    
    // addToolWindow({ id: windowId, tool, window: toolWindowEl }); // Old way
    return toolWindowEl;
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
    function closeWindow() {
        const winEl = header.parentElement;
        if (winEl) {
            removeToolWindow(winEl.id); // This updates state and localStorage
        }
    }
    closeBtn.addEventListener('click', closeWindow);
    closeBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeWindow();
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
    anchorPoint.addEventListener('touchstart', (e) => {
        console.log('Anchor point touchstart event fired.');
        e.preventDefault();
        e.stopPropagation();
        startConnection(e, outputType, toolWindow);
    }, { passive: false });

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
function setupDragging(windowData, handle) {
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let initialWorkspacePos = { x: 0, y: 0 };

    const startDrag = (e, isTouch = false) => {
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        
        isDragging = true;
        dragStart = { x: clientX, y: clientY };
        initialWorkspacePos = { x: windowData.workspaceX, y: windowData.workspaceY };
        
        windowData.element.style.cursor = 'grabbing';
        handle.style.cursor = 'grabbing';
        if (isTouch) e.preventDefault();
    };

    const drag = (e, isTouch = false) => {
        if (!isDragging) return;
        if (isTouch) e.preventDefault();

        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        const scale = window.sandbox.getScale();

        const dx = (clientX - dragStart.x) / scale;
        const dy = (clientY - dragStart.y) / scale;

        windowData.workspaceX = initialWorkspacePos.x + dx;
        windowData.workspaceY = initialWorkspacePos.y + dy;
        
        // Live re-rendering from parent
        const { x: screenX, y: screenY } = window.sandbox.workspaceToScreen(windowData.workspaceX, windowData.workspaceY);
        windowData.element.style.left = `${screenX}px`;
        windowData.element.style.top = `${screenY}px`;

        // Update connections
            getConnections().forEach(conn => {
            if (conn.from === windowData.element || conn.to === windowData.element) {
                    updatePermanentConnection(conn);
                }
            });
    };

    const endDrag = (e, isTouch = false) => {
        if (!isDragging) return;
        if (isTouch) e.preventDefault();

        const gridSize = window.sandbox.getGridSize();
        const finalX = Math.round(windowData.workspaceX / gridSize) * gridSize;
        const finalY = Math.round(windowData.workspaceY / gridSize) * gridSize;

        updateToolWindowPosition(windowData.id, finalX, finalY);
        
        // Final render after snap
        const { x: screenX, y: screenY } = window.sandbox.workspaceToScreen(finalX, finalY);
        windowData.element.style.left = `${screenX}px`;
        windowData.element.style.top = `${screenY}px`;
        
        isDragging = false;
        windowData.element.style.cursor = '';
        handle.style.cursor = 'move';
    };

    // Mouse Events
    handle.addEventListener('mousedown', (e) => startDrag(e, false));
    document.addEventListener('mousemove', (e) => drag(e, false));
    document.addEventListener('mouseup', (e) => endDrag(e, false));

    // Touch Events
    handle.addEventListener('touchstart', (e) => startDrag(e, true), { passive: false });
    document.addEventListener('touchmove', (e) => drag(e, true), { passive: false });
    document.addEventListener('touchend', (e) => endDrag(e, true), { passive: false });
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