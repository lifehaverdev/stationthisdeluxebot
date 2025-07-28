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
    getAvailableTools,
    toggleNodeSelection,
    selectNode,
    clearSelection,
    getSelectedNodeIds
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
import executionClient from '../executionClient.js';

// Call once to register the handlers
registerWebSocketHandlers();

// Create a tool window
export function createToolWindow(tool, position, id = null, output = null, parameterMappings = null) {
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
    // Store toolId for easier mapping of spell completion events
    if (tool && tool.toolId) {
        toolWindowEl.setAttribute('data-toolid', tool.toolId);
    }

    toolWindowEl.addEventListener('click', (e) => {
        // Only handle left mouse button
        if (e.button !== 0) return;
        if (e.shiftKey) {
            toggleNodeSelection(windowId);
        } else {
            selectNode(windowId, false);
        }
        e.stopPropagation();
    });

    // Mobile: tap toggles selection (multi-select by default)
    toolWindowEl.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleNodeSelection(windowId);
    });

    // Use provided parameterMappings if present, otherwise use existingWindow or initialize from schema.
    let paramMappings;
    if (parameterMappings) {
        paramMappings = JSON.parse(JSON.stringify(parameterMappings));
    } else if (existingWindow) {
        paramMappings = existingWindow.parameterMappings;
    } else if (tool.inputSchema) {
        paramMappings = {};
        Object.entries(tool.inputSchema).forEach(([paramKey, paramDef]) => {
            paramMappings[paramKey] = {
                type: 'static',
                value: paramDef.default !== undefined ? paramDef.default : ''
            };
        });
    } else {
        paramMappings = {};
    }

    const windowData = {
        id: windowId,
        tool: tool,
        element: toolWindowEl,
        workspaceX: position.x,
        workspaceY: position.y,
        output: output || (existingWindow ? existingWindow.output : null),
        parameterMappings: paramMappings
    };
    addToolWindow(windowData);

    // If we created a new window, persist the state.
    if (!id) {
        persistState();
    }

    toolWindowEl.style.left = `${position.x}px`;
    toolWindowEl.style.top = `${position.y}px`;

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
    const requiredSection = createParameterSection(params.required, 'required-params', paramMappings, getToolWindows());
    const optionalSection = createParameterSection(params.optional, 'optional-params', paramMappings, getToolWindows());
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
        // Each click creates a *new* window (5px offset) and runs execution there.
        executeBtn.addEventListener('click', async () => {
            const OFFSET = 5;
            // Create a duplicate window slightly offset so the previous result stays visible
            const dupPos = { x: windowData.workspaceX + OFFSET, y: windowData.workspaceY + OFFSET };
            // Pass parameterMappings to duplicate
            const dupEl = createToolWindow(tool, dupPos, null, null, windowData.parameterMappings);

            // ---- NEW: randomize seed in mappings for duplicate ----
            const dupWinData = getToolWindow(dupEl.id);
            if (dupWinData) {
                randomizeSeedInMappings(dupWinData.parameterMappings);
                persistState();
            }
            // ------------------------------------------------------

            // Execute the duplicate (includes dependencies)
            await executeNodeAndDependencies(dupEl.id);
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
            const execResult = await executionClient.execute(payload);
            console.log('[DEBUG] Normalised execution result:', JSON.stringify(execResult, null, 2));

            showError(toolWindowEl, '');

            if (execResult.generationId && !execResult.final) {
                // Long-running job – wait for websocket updates
                generationIdToWindowMap[execResult.generationId] = toolWindowEl;
                progressIndicator.textContent = `Status: ${execResult.status}`;
                await generationCompletionManager.createCompletionPromise(execResult.generationId);
            } else {
                // Immediate result
                if (progressIndicator) progressIndicator.remove();

                if (execResult.final && execResult.status !== 'failed') {
                    let outputData;
                    if (Array.isArray(execResult.outputs?.images) && execResult.outputs.images[0]?.url) {
                        outputData = { type: 'image', url: execResult.outputs.images[0].url, generationId: execResult.generationId };
                    } else if (execResult.outputs?.imageUrl) {
                        outputData = { type: 'image', url: execResult.outputs.imageUrl, generationId: execResult.generationId };
                    } else if (execResult.outputs?.response) {
                        outputData = { type: 'text', text: execResult.outputs.response, generationId: execResult.generationId };
                    } else if (execResult.outputs?.text) {
                        outputData = { type: 'text', text: execResult.outputs.text, generationId: execResult.generationId };
                    } else {
                        outputData = { type: 'unknown', generationId: execResult.generationId, ...execResult.outputs };
                    }

                    setToolWindowOutput(windowId, outputData);
                    const resultContainer = toolWindowEl.querySelector('.result-container') || document.createElement('div');
                    if (!resultContainer.parentElement) {
                        resultContainer.className = 'result-container';
                        toolWindowEl.appendChild(resultContainer);
                    }
                    renderResultContent(resultContainer, outputData);
                } else if (execResult.status === 'failed') {
                    showError(toolWindowEl, execResult.outputs?.error || 'Execution failed.');
                }
            }

            resolve();
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
        
        // --- Improved Refresh Logic ---
        // 1. Remove the closed window element from the DOM.
        if (winEl && winEl.parentElement) {
            winEl.parentElement.removeChild(winEl);
        }

        // 2. Rerender ONLY the windows whose parameter mappings we had to reset.
        const windowsToRefresh = new Set();
        connectionsToRemove.forEach(conn => {
            if (conn.fromWindowId === windowId) {
                windowsToRefresh.add(conn.toWindowId);
            }
        });

        windowsToRefresh.forEach(wId => {
            rerenderToolWindowById(wId);
        });

        // 3a. Update any generation → window element mappings that might have been affected.
        try {
            Object.entries(generationIdToWindowMap).forEach(([genId, el]) => {
                if (el && windowsToRefresh.has(el.id)) {
                    const newEl = document.getElementById(el.id);
                    if (newEl) {
                        generationIdToWindowMap[genId] = newEl;
                    }
                }
            });
        } catch (err) {
            console.warn('[WindowManager] Could not update generationIdToWindowMap after window close:', err);
        }
         
        // 3. Re-draw connections to reflect the new state without touching executing windows.
        renderAllConnections();
        // --- End Improved Refresh Logic ---
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

// ---- NEW UTILITY ---------------------------------------------------------
/**
 * Walk through a parameterMappings object and randomise any key that appears to
 * be a seed ("seed", "input_seed", or contains the word "seed" case-insensitively).
 * We only touch mappings of type "static" so nodeOutput mappings remain intact.
 */
function randomizeSeedInMappings(mappings) {
    if (!mappings) return;
    Object.entries(mappings).forEach(([key, map]) => {
        if (map && map.type === 'static' && /seed/i.test(key)) {
            map.value = Math.floor(Math.random() * 1e9);
        }
    });
}
// Make globally accessible for other modules that may be loaded after this script
if (typeof window !== 'undefined') {
    window.randomizeSeedInMappings = randomizeSeedInMappings;
}
// -------------------------------------------------------------------------

// Export helpers for use in other modules
export { executeNodeAndDependencies }; 