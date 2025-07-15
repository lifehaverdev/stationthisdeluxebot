import {
    getToolWindow,
    addToolWindow,
    removeToolWindow,
    getConnections,
    getToolWindows,
    pushHistory,
    persistState,
    clearConnectionsForWindow,
    setToolWindowOutput,
    getAvailableTools
} from '../state.js';
import { generateWindowId } from '../utils.js';
import { renderAllConnections } from '../connections/index.js';
import { generationIdToWindowMap, registerWebSocketHandlers, generationCompletionManager } from './websocketHandlers.js';
import { renderResultContent } from './resultContent.js';
import { createParameterSection, showError } from './parameterInputs.js';
import { createAnchorPoint, createInputAnchors } from './anchors.js';
import { setupDragging } from './drag.js';
import { handleGenerationUpdate } from './websocketHandlers.js';
import { bindPromptFieldOverlays } from './overlays/textOverlay.js';
import { websocketClient } from '/js/websocketClient.js';

// Call once to register the handlers
registerWebSocketHandlers();

// Create a tool window
export function createToolWindow(tool, position, id = null, output = null) {
    // If we're creating a new window (not restoring), it's a new action.
    if (!id) {
        pushHistory();
    }

    console.log('[node.js] createToolWindow called for tool:', tool && tool.toolId, 'at workspace position:', position);
    const windowId = id || generateWindowId();
    const existingWindow = getToolWindow(windowId);

    // Allow re-creation for rerendering
    const existing = document.getElementById(windowId);
    if (existing) {
        existing.remove();
    }
    
    const toolWindowEl = document.createElement('div');
    toolWindowEl.id = windowId;
    toolWindowEl.className = 'tool-window';
    toolWindowEl.setAttribute('data-displayname', tool.displayName || '');

    // Use existing parameterMappings if they exist, otherwise initialize them.
    const parameterMappings = existingWindow ? existingWindow.parameterMappings : {};
    if (!existingWindow && tool.inputSchema) {
        Object.entries(tool.inputSchema).forEach(([paramKey, paramDef]) => {
            parameterMappings[paramKey] = {
                type: 'static',
                value: paramDef.default !== undefined ? paramDef.default : ''
            };
        });
    }

    const windowData = {
        id: windowId,
        tool: tool,
        element: toolWindowEl,
        workspaceX: position.x,
        workspaceY: position.y,
        output: output || (existingWindow ? existingWindow.output : null),
        parameterMappings
    };
    addToolWindow(windowData);

    // If we created a new window, persist the state.
    if (!id) {
        persistState();
    }

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
    const requiredSection = createParameterSection(params.required, 'required-params', parameterMappings, getToolWindows());
    const optionalSection = createParameterSection(params.optional, 'optional-params', parameterMappings, getToolWindows());
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
        anchorPoint, 
        inputAnchors
    );

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
        executeBtn.addEventListener('click', async () => {
            await executeNodeAndDependencies(windowId);
        });
        toolWindowEl.appendChild(executeBtn);
    }

    setupDragging(windowData, header);

    const canvas = document.querySelector('.sandbox-canvas');
    if (canvas) {
        canvas.appendChild(toolWindowEl);
    } else {
        document.body.appendChild(toolWindowEl); // Fallback
    }
    
    bindPromptFieldOverlays();
    return toolWindowEl;
}

async function executeNodeAndDependencies(startNodeId) {
    const executionOrder = getNodeExecutionOrder(startNodeId);
    
    if (executionOrder.length > 1) {
        const confirmed = window.confirm(
            `This action will trigger the execution of ${executionOrder.length} nodes in sequence. Are you sure you want to proceed?\n\nExecution Plan:\n${executionOrder.map((id, i) => `${i + 1}. ${getToolWindow(id).tool.displayName}`).join('\n')}`
        );
        if (!confirmed) {
            console.log('Execution cancelled by user.');
            return;
        }
    }

    for (const nodeId of executionOrder) {
        const toolWindowEl = document.getElementById(nodeId);
        if (!toolWindowEl) continue;

        const executeBtn = toolWindowEl.querySelector('.execute-button');
        if (executeBtn) {
            // We need to await the result of each execution before starting the next one.
            // This requires the execution logic to return a promise that resolves on completion.
            await executeSingleNode(toolWindowEl);
        }
    }
}

function getNodeExecutionOrder(startNodeId) {
    const order = [];
    const visited = new Set();
    const allWindows = getToolWindows();

    function visit(nodeId) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const node = allWindows.find(w => w.id === nodeId);
        if (!node) return;

        // If the node already has output, don't re-execute it or its dependencies.
        // An explicit execution of a node (the startNodeId) should always run.
        if (node.output && nodeId !== startNodeId) {
            return;
        }

        if (node.parameterMappings) {
            // Visit all dependencies (inputs from other nodes) first
            for (const mapping of Object.values(node.parameterMappings)) {
                if (mapping.type === 'nodeOutput' && mapping.nodeId) {
                    visit(mapping.nodeId);
                }
            }
        }

        // Add the current node to the order *after* all its dependencies have been added
        order.push(nodeId);
    }

    visit(startNodeId);
    return order;
}

// This function will contain the logic from the original 'click' handler
async function executeSingleNode(toolWindowEl) {
    return new Promise(async (resolve, reject) => {
        const windowId = toolWindowEl.id;
        const tool = getToolWindow(windowId).tool;
        
        const existingResult = toolWindowEl.querySelector('.result-container');
        if (existingResult) existingResult.remove();
        showError(toolWindowEl, '');

        let progressIndicator = toolWindowEl.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            toolWindowEl.appendChild(progressIndicator);
        }
        progressIndicator.textContent = 'Executing...';
        
        // The rest of the execution logic from the original handler goes here...
        // ... (Gathering inputs, sending fetch request, handling response)

        // At the end, resolve the promise
        // For example, after handleGenerationUpdate is called for completion/failure.
        // This part needs careful integration with the async nature of websocket updates.
        // For now, we'll simulate it. This is a simplification.
        
        // --- Paste Original Execution Logic Here ---
        console.log('[node.js] Execute button clicked for tool:', tool && tool.toolId);
        const win = getToolWindow(windowId);
        const allToolWindows = getToolWindows();
        const parameterMappings = win.parameterMappings || {};
        const inputs = {};
        let missingRequired = false;

        for (const [paramName, paramDef] of Object.entries(tool.inputSchema || {})) {
            const mapping = parameterMappings[paramName];

            if (mapping && mapping.type === 'nodeOutput') {
                const sourceWin = allToolWindows.find(w => w.id === mapping.nodeId);
                if (sourceWin && sourceWin.output) {
                    if (sourceWin.output.type === mapping.outputKey) {
                        if (sourceWin.output.type === 'image' && sourceWin.output.url) {
                            inputs[paramName] = sourceWin.output.url;
                        } else if (sourceWin.output.type === 'text' && sourceWin.output.text) {
                            inputs[paramName] = sourceWin.output.text;
                        } else {
                            inputs[paramName] = sourceWin.output.value || sourceWin.output;
                        }
                    } else {
                        missingRequired = true;
                        showError(toolWindowEl, `Type mismatch for '${paramName}'. Expected '${mapping.outputKey}' but got '${sourceWin.output.type}'.`);
                        break;
                    }
                } else {
                    missingRequired = true;
                    const sourceName = sourceWin ? sourceWin.tool.displayName : mapping.nodeId;
                    showError(toolWindowEl, `Missing output for parameter '${paramName}' from node '${sourceName}'. Run it first.`);
                    break;
                }
            } else if (mapping && mapping.type === 'static') {
                inputs[paramName] = mapping.value;
            } else if (paramDef.required) {
                missingRequired = true;
                showError(toolWindowEl, `Required parameter '${paramName}' is not mapped or filled.`);
                break;
            }
        }
        
        if (missingRequired) {
            if (progressIndicator) progressIndicator.remove();
            reject(new Error('Missing required inputs.'));
            return;
        }

        const payload = {
            toolId: tool.toolId,
            inputs: inputs,
            metadata: { platform: 'web-sandbox' }
        };
        
        try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();

            const response = await fetch('/api/v1/generation/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                credentials: 'include',
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            console.log('[DEBUG] Raw execution result:', JSON.stringify(result, null, 2));

            if (!response.ok) {
                // Handle insufficient funds (402)
                if (response.status === 402 && result.error?.code === 'INSUFFICIENT_FUNDS') {
                    showError(toolWindowEl, `Not enough points to run this workflow.\nRequired: ${result.error.details?.required}, Available: ${result.error.details?.available}`);
                } else {
                    showError(toolWindowEl, result.error?.message || 'Execution request failed');
                }
                if (progressIndicator) progressIndicator.remove();
                reject(new Error(result.error?.message || 'Execution request failed'));
            } else {
                showError(toolWindowEl, '');

                // Check if the job is already complete in the initial response.
                const isFinalStatus = result.status === 'completed' || result.status === 'success' || result.status === 'failed';

                if (result.generationId && !isFinalStatus) {
                    // ASYNC PATH: It's a long-running job. Wait for the websocket update.
                    generationIdToWindowMap[result.generationId] = toolWindowEl;
                    progressIndicator.textContent = `Status: ${result.status}`;
                    await generationCompletionManager.createCompletionPromise(result.generationId);
                    
                } else {
                    // IMMEDIATE PATH: The result is final, handle it now.
                    // This covers cases where status is final, regardless of whether a generationId is present.
                    if (progressIndicator) progressIndicator.remove();

                    if (isFinalStatus && result.status !== 'failed') {
                        let outputData;
                        if (Array.isArray(result.outputs) && result.outputs[0]?.data?.images?.[0]?.url) {
                            outputData = { type: 'image', url: result.outputs[0].data.images[0].url };
                        } else if (result.outputs?.imageUrl) {
                            outputData = { type: 'image', url: result.outputs.imageUrl };
                        } else if (result.response && typeof result.response === 'string') {
                            // Handle immediate, direct text response (like from the user's log)
                            outputData = { type: 'text', text: result.response };
                        } else if (result.outputs?.text) {
                            outputData = { type: 'text', text: result.outputs.text };
                        } else if (result.outputs?.response) {
                             // Handle text from a nested 'response' property in the output
                            outputData = { type: 'text', text: result.outputs.response };
                        } else {
                            outputData = { type: 'unknown', ...result.outputs };
                        }
                        
                        setToolWindowOutput(windowId, outputData);
                        const resultContainer = toolWindowEl.querySelector('.result-container') || document.createElement('div');
                        if (!resultContainer.parentElement) {
                            resultContainer.className = 'result-container';
                            toolWindowEl.appendChild(resultContainer);
                        }
                        renderResultContent(resultContainer, outputData);
                    } else if (result.status === 'failed') {
                        showError(toolWindowEl, result.outputs?.error || 'Execution failed.');
                    }
                }
                
                // Whether we waited or handled it immediately, the step is now done.
                resolve();
            }
        } catch (error) {
            console.error('[node.js] Execution Error:', error);
            showError(toolWindowEl, error.message || 'Unknown error');
            if (progressIndicator) progressIndicator.remove();
            reject(error);
        }
        // --- End of Pasted Logic ---
    });
}

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
        if (!winEl) return;
        const windowId = winEl.id;
        
        console.log(`[WindowManager] Closing window ${windowId}`);

        // This is an atomic action, so we manage its history here.
        pushHistory();

        const allConnections = getConnections();
        
        // Find all connections linked to this window
        const connectionsToRemove = allConnections.filter(
            conn => conn.fromWindowId === windowId || conn.toWindowId === windowId
        );

        // For any connection that originates from this node, we must update the target node's parameter mapping
        connectionsToRemove.forEach(conn => {
            if (conn.fromWindowId === windowId) {
                const targetWindow = getToolWindow(conn.toWindowId);
                if (targetWindow && targetWindow.parameterMappings && targetWindow.parameterMappings[conn.toInput]) {
                    console.log(`[WindowManager] Resetting parameter '${conn.toInput}' on target window ${targetWindow.id}`);
                    const tool = getAvailableTools().find(t => t.toolId === targetWindow.tool.toolId);
                    const paramDef = tool?.inputSchema?.[conn.toInput];
                    const defaultValue = paramDef?.default !== undefined ? paramDef.default : '';
                    
                    targetWindow.parameterMappings[conn.toInput] = {
                        type: 'static',
                        value: defaultValue
                    };
                    // We will rerender all affected windows at the end.
                }
            }
        });

        // Now, update the main state arrays
        clearConnectionsForWindow(windowId); // This removes from `connections` array
        removeToolWindow(windowId);         // This removes from `activeToolWindows` array
        
        // Persist all accumulated changes to localStorage
        persistState();
        
        // Rerender all connections and any windows that might have been affected by the state change.
        // A full rerender is safest here to ensure UI consistency.
        rerenderAllUI();
    }
    closeBtn.addEventListener('click', closeWindow);
    closeBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeWindow();
    });

    header.append(titleElement, closeBtn);
    return header;
}

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

function createExecuteButton() {
    const button = document.createElement('button');
    button.textContent = 'Execute';
    button.className = 'execute-button';
    return button;
}

// Rerender a tool window by ID
export function rerenderToolWindowById(windowId) {
    const win = getToolWindow(windowId);
    if (!win) return;
    
    // Remove old DOM node
    const oldEl = document.getElementById(windowId);
    if (oldEl && oldEl.parentNode) {
        oldEl.parentNode.removeChild(oldEl);
    }
    
    // Find the tool definition using the unique toolId
    const tool = getAvailableTools().find(t => t.toolId === win.tool.toolId);
    
    if (tool) {
        // Use stored workspaceX/Y and output
        createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
    } else {
        console.warn(`Could not find tool definition for toolId '${win.tool.toolId}' during rerender. It might have been removed or renamed.`);
    }
} 

function rerenderAllUI() {
    // A helper function to perform a full UI refresh based on the current state.
    // This is useful after complex state mutations like node deletion.
    const windows = getToolWindows();
    const connections = getConnections();
    
    // Clear the canvas
    document.querySelectorAll('.tool-window, .connection-line.permanent').forEach(el => el.remove());
    
    // Re-create all windows from the clean state
    windows.forEach(win => {
        const tool = getAvailableTools().find(t => t.toolId === win.tool.toolId);
        if (tool) {
            createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
        }
    });
    
    // Re-draw all connections
    renderAllConnections();
} 