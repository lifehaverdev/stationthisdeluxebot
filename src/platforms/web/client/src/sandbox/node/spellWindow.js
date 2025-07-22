// src/platforms/web/client/src/sandbox/node/spellWindow.js
// This file is a work-in-progress, modeled after toolWindow.js, for creating spell nodes.

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
import { createPermanentConnection } from '../connections/manager.js';
import { renderResultContent } from './resultContent.js';
import { createParameterSection, showError } from './parameterInputs.js';
import { createAnchorPoint, createInputAnchors } from './anchors.js';
import { setupDragging } from './drag.js';

// TODO: Implement spell-specific execution logic
// import { executeSpellAndDependencies } from './spellExecution.js'; 

// Create a spell window
export function createSpellWindow(spell, position, id = null, output = null) {
    console.log('[spellWindow.js] createSpellWindow called for spell:', spell.name, 'at workspace position:', position);
    
    // If we're creating a new window (not restoring), it's a new action.
    if (!id) {
        pushHistory();
    }

    const windowId = id || generateWindowId('spell-');
    const existingWindow = getToolWindow(windowId);

    // Allow re-creation for rerendering
    const existing = document.getElementById(windowId);
    if (existing) {
        existing.remove();
    }
    
    const spellWindowEl = document.createElement('div');
    spellWindowEl.id = windowId;
    // Add both classes for styling inheritance and specific overrides
    spellWindowEl.className = 'tool-window spell-window'; 
    spellWindowEl.setAttribute('data-spell-id', spell._id);
    spellWindowEl.setAttribute('data-displayname', spell.name || '');

    spellWindowEl.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        if (e.shiftKey) {
            toggleNodeSelection(windowId);
        } else {
            selectNode(windowId, false);
        }
        e.stopPropagation();
    });

    spellWindowEl.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleNodeSelection(windowId);
    });

    const availableTools = getAvailableTools();
    const toolMap = new Map(availableTools.map(t => [t.toolId, t]));

    // Map spell's exposedInputs to a format that createParameterSection understands.
    const parameterMappings = existingWindow ? existingWindow.parameterMappings : {};
    const spellInputSchemaForUI = {};

    if (spell.exposedInputs) {
        spell.exposedInputs.forEach(input => {
            const originalNode = spell.steps.find(s => s.id === input.nodeId);
            const originalTool = originalNode ? toolMap.get(originalNode.toolIdentifier) : null;
            const originalParam = originalTool ? originalTool.inputSchema[input.paramKey] : null;

            if (originalParam) {
                // The key for the UI and mapping will be unique to the spell node
                const uiKey = `${input.nodeId}_${input.paramKey}`;
                spellInputSchemaForUI[uiKey] = {
                    ...originalParam,
                    name: `${originalTool.displayName}: ${originalParam.displayName || input.paramKey}`
                };

                if (!existingWindow) {
                    parameterMappings[uiKey] = {
                        type: 'static',
                        value: originalNode.parameterMappings[input.paramKey]?.value || originalParam.default || ''
                    };
                }
            }
        });
    }

    const windowData = {
        id: windowId,
        spell: spell, // Store the full spell object
        element: spellWindowEl,
        isSpell: true, // Flag to identify this as a spell window
        workspaceX: position.x,
        workspaceY: position.y,
        output: output || (existingWindow ? existingWindow.output : null),
        parameterMappings
    };
    addToolWindow(windowData);

    if (!id) {
        persistState();
    }

    const { x: screenX, y: screenY } = window.sandbox.workspaceToScreen(position.x, position.y);
    spellWindowEl.style.left = `${screenX}px`;
    spellWindowEl.style.top = `${screenY}px`;
    
    const header = createSpellWindowHeader(spell.name);
    
    // Create parameter section using the standard function
    const paramsForUI = Object.entries(spellInputSchemaForUI);
    const paramsSection = createParameterSection(paramsForUI, 'required-params', parameterMappings, getToolWindows());
    
    // Create input anchors based on the generated schema
    const inputAnchors = createInputAnchors({ inputSchema: spellInputSchemaForUI });
    
    const { showMoreBtn, detailsContainer } = createShowMoreButtonForSpell(windowId, spell);
    const executeBtn = createExecuteButton();

    spellWindowEl.append(
        header,
        paramsSection,
        inputAnchors,
        detailsContainer, // Add the container, it's hidden by default
        showMoreBtn,
        executeBtn
    );
    
    executeBtn.addEventListener('click', async () => {
        await executeSpell(windowId);
    });

    setupDragging(windowData, header);
    
    const canvas = document.querySelector('.sandbox-canvas');
    if (canvas) {
        canvas.appendChild(spellWindowEl);
    } else {
        document.body.appendChild(spellWindowEl); // Fallback
    }
    
    return spellWindowEl;
}

function createSpellWindowHeader(title) {
    const header = document.createElement('div');
    header.className = 'tool-window-header';

    const titleElement = document.createElement('div');
    // Add a magic wand icon for spells
    titleElement.innerHTML = `🪄 <span style="font-weight: bold;">${title}</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'close-button';
    // --- Close logic (adapted from toolWindow.js) ---
    function closeWindow() {
        const winEl = header.parentElement;
        if (!winEl) return;
        const windowId = winEl.id;

        console.log(`[spellWindow] Closing spell window ${windowId}`);

        // Record history for undo/redo
        pushHistory();

        // Remove connections related to this window and reset any dependent mappings
        const allConnections = getConnections();
        const connectionsToRemove = allConnections.filter(
            conn => conn.fromWindowId === windowId || conn.toWindowId === windowId
        );

        connectionsToRemove.forEach(conn => {
            if (conn.fromWindowId === windowId) {
                const targetWindow = getToolWindow(conn.toWindowId);
                if (targetWindow && targetWindow.parameterMappings && targetWindow.parameterMappings[conn.toInput]) {
                    // Reset the mapping to default static value
                    targetWindow.parameterMappings[conn.toInput] = { type: 'static', value: '' };
                }
            }
        });

        clearConnectionsForWindow(windowId);
        removeToolWindow(windowId);
        persistState();

        // Remove DOM element
        if (winEl.parentElement) {
            winEl.parentElement.removeChild(winEl);
        }

        // Re-render connections to reflect removal
        renderAllConnections();
    }
    closeBtn.addEventListener('click', closeWindow);
    closeBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeWindow();
    });

    header.append(titleElement, closeBtn);
    return header;
}

/**
 * Creates the “show more” button and details container for a spell node.
 * @param {string} windowId – The DOM/id of the spell window so we can reference it for actions like explode.
 * @param {object} spell – The spell object.
 */
function createShowMoreButtonForSpell(windowId, spell) {
    const button = document.createElement('button');
    button.textContent = 'show more';
    button.className = 'show-more-button';

    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'spell-details-container';
    // Allow scrolling if content is tall
    detailsContainer.style.maxHeight = '400px';
    detailsContainer.style.overflowY = 'auto';

    // Populate the details container
    const descHeader = document.createElement('h4');
    descHeader.textContent = 'Description';
    const desc = document.createElement('p');
    desc.textContent = spell.description || 'No description provided.';
    
    const stepsHeader = document.createElement('h4');
    stepsHeader.textContent = 'Steps';
    const stepsList = document.createElement('ul');
    stepsList.className = 'spell-steps-list';

    const availableTools = getAvailableTools();
    const toolMap = new Map(availableTools.map(t => [t.toolId, t]));

    // Allow users to click a step to view its parameter overrides
    spell.steps.forEach(step => {
        const tool = toolMap.get(step.toolIdentifier);
        const li = document.createElement('li');
        li.className = 'spell-step-item';
        // Create a caret icon so it's clear the item is expandable
        const caret = document.createElement('span');
        caret.className = 'step-caret';
        caret.textContent = '▸';

        // Create a label element for the step title so we can prepend the caret neatly
        const stepLabel = document.createElement('span');
        stepLabel.textContent = tool ? tool.displayName : (step.displayName || 'Unknown Tool');

        li.append(caret, stepLabel);

        // Build a hidden container with editable parameter details
        const paramContainer = document.createElement('ul');
        paramContainer.className = 'step-param-list';
        paramContainer.style.display = 'none';

        // Determine which parameters to show: use the tool's inputSchema when available
        const paramKeys = tool && tool.inputSchema ? Object.keys(tool.inputSchema) : Object.keys(step.parameterOverrides || {});

        paramKeys.forEach(paramKey => {
            const paramDef = tool && tool.inputSchema ? tool.inputSchema[paramKey] : null;
            const currentValue = (step.parameterOverrides && step.parameterOverrides[paramKey] !== undefined)
                ? step.parameterOverrides[paramKey]
                : (paramDef ? paramDef.default || '' : '');

            const paramLi = document.createElement('li');

            const label = document.createElement('label');
            label.textContent = `${paramKey}: `;

            const input = document.createElement('input');
            input.type = (paramDef && paramDef.type === 'number') ? 'number' : 'text';
            input.value = currentValue;
            input.className = 'spell-param-input';

            // Update step parameter overrides in real-time
            input.addEventListener('input', (e) => {
                if (!step.parameterOverrides) step.parameterOverrides = {};
                step.parameterOverrides[paramKey] = (input.type === 'number') ? parseFloat(e.target.value) : e.target.value;
            });

            // Prevent click-through when editing
            input.addEventListener('click', (e) => e.stopPropagation());

            paramLi.appendChild(label);
            paramLi.appendChild(input);
            paramContainer.appendChild(paramLi);
        });

        li.appendChild(paramContainer);

        // Indent the parameter list for better readability
        paramContainer.style.marginLeft = '20px';

        // Toggle visibility on click of list item (but not on input interaction)
        li.addEventListener('click', (e) => {
            // Ignore if the click was inside an input
            if (e.target.tagName.toLowerCase() === 'input') return;
            const isVisible = paramContainer.style.display === 'block';
            paramContainer.style.display = isVisible ? 'none' : 'block';

            // Update caret and open state
            caret.textContent = isVisible ? '▸' : '▾';
            li.classList.toggle('open', !isVisible);
        });

        stepsList.appendChild(li);
    });

    // TODO: Add explode logic to this button
    const explodeBtn = document.createElement('button');
    explodeBtn.textContent = 'Explode Spell';
    explodeBtn.className = 'explode-spell-button';
    explodeBtn.addEventListener('click', () => {
        explodeSpell(windowId, spell);
    });

    detailsContainer.append(descHeader, desc, stepsHeader, stepsList, explodeBtn);

    let isExpanded = false;
    button.addEventListener('click', () => {
        isExpanded = !isExpanded;
        detailsContainer.style.display = isExpanded ? 'flex' : 'none';
        button.textContent = isExpanded ? 'show less' : 'show more';
        button.classList.toggle('active', isExpanded);
    });
    
    return { showMoreBtn: button, detailsContainer };
}

async function executeSpell(windowId) {
    const spellWindow = getToolWindow(windowId);
    if (!spellWindow) {
        console.error(`[spellWindow] Could not find spell window with ID ${windowId} to execute.`);
        return;
    }

    const { spell, parameterMappings } = spellWindow;
    const inputs = {};

    // Gather the values from the exposed inputs
    if (spell.exposedInputs) {
        for (const input of spell.exposedInputs) {
            const uiKey = `${input.nodeId}_${input.paramKey}`;
            const mapping = parameterMappings[uiKey];

            if (mapping && mapping.type === 'static') {
                inputs[input.paramKey] = mapping.value;
            } else if (mapping && mapping.type === 'nodeOutput') {
                // This would require a more complex, graph-aware execution flow.
                // For now, we'll assume exposed inputs must be static values at execution time.
                console.warn(`[spellWindow] Execution of spells with connected exposed inputs is not yet supported. Parameter "${input.paramKey}" will be ignored.`);
            }
        }
    }

    console.log(`[spellWindow] Executing spell "${spell.name}" with inputs:`, inputs);

    const payload = {
        toolId: `spell:${spell.slug}`,
        inputs: inputs,
        metadata: { platform: 'web-sandbox' }
    };

    try {
        const spellWindowEl = document.getElementById(windowId);
        showError(spellWindowEl, ''); // Clear previous errors

        let progressIndicator = spellWindowEl.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            spellWindowEl.appendChild(progressIndicator);
        }
        progressIndicator.textContent = 'Casting spell...';

        const csrfRes = await fetch('/api/v1/csrf-token');
        const { csrfToken } = await csrfRes.json();

        const response = await fetch('/api/v1/generation/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify(payload),
        });

        const result = await response.json();
        console.log('[spellWindow] Raw execution result:', result);

        if (!response.ok) {
            throw new Error(result.error?.message || 'Spell execution failed.');
        }

        // TODO: Handle spell output rendering. Spells might have complex outputs.
        // For now, we assume a simple text or image output might come back.
        progressIndicator.remove();

        const outputData = result.outputs?.[0]?.data || result.response;
        if (outputData) {
            setToolWindowOutput(windowId, outputData);
            let resultContainer = spellWindowEl.querySelector('.result-container');
            if (!resultContainer) {
                resultContainer = document.createElement('div');
                resultContainer.className = 'result-container';
                spellWindowEl.appendChild(resultContainer);
            }
            renderResultContent(resultContainer, outputData);
        }

    } catch (error) {
        console.error(`[spellWindow] Error executing spell:`, error);
        const spellWindowEl = document.getElementById(windowId);
        if (spellWindowEl) {
            showError(spellWindowEl, error.message);
            const progressIndicator = spellWindowEl.querySelector('.progress-indicator');
            if (progressIndicator) progressIndicator.remove();
        }
    }
}

function explodeSpell(spellWindowId, spell) {
    console.log(`[spellWindow] Exploding spell "${spell.name}" (${spellWindowId})`);
    
    // This is a significant, user-driven action, so we record the state before proceeding.
    pushHistory();

    const spellWindow = getToolWindow(spellWindowId);
    if (!spellWindow) {
        console.error(`[spellWindow] Cannot find spell window with ID ${spellWindowId} to explode.`);
        return;
    }
    const startPosition = { x: spellWindow.workspaceX, y: spellWindow.workspaceY };

    const availableTools = getAvailableTools();
    const toolMap = new Map(availableTools.map(t => [t.toolIdentifier, t]));
    
    // 1. Create all the tool windows from the spell's steps
    const createdNodeIds = new Map(); // Map original step ID to new window ID
    spell.steps.forEach((step, index) => {
        const tool = toolMap.get(step.toolIdentifier);
        if (tool) {
            // Arrange the new nodes in a neat row to avoid overlap
            const position = {
                x: startPosition.x + (index * 350), // Stagger horizontally
                y: startPosition.y
            };
            const newWindow = createToolWindow(tool, position, step.id);
            // We'll need the new ID to recreate connections
            createdNodeIds.set(step.id, newWindow.id); 

            // Restore the parameter mappings for this node
            const newToolWindow = getToolWindow(newWindow.id);
            if (newToolWindow) {
                newToolWindow.parameterMappings = step.parameterMappings;
            }
        } else {
            console.warn(`[spellWindow] Could not find tool with identifier "${step.toolIdentifier}" during spell explosion.`);
        }
    });

    // 2. Re-create the connections between the new windows
    if (spell.connections) {
        spell.connections.forEach(conn => {
            const fromId = createdNodeIds.get(conn.fromWindowId);
            const toId = createdNodeIds.get(conn.toWindowId);
            
            if (fromId && toId) {
                createPermanentConnection({
                    from: { windowId: fromId, outputKey: conn.fromOutput },
                    to: { windowId: toId, paramKey: conn.toInput }
                });
            }
        });
    }

    // 3. Remove the original spell window from state and the DOM
    removeToolWindow(spellWindowId);
    const spellWindowEl = document.getElementById(spellWindowId);
    if (spellWindowEl) {
        spellWindowEl.remove();
    }

    // 4. Persist the new state and re-render all connections
    persistState();
    renderAllConnections();
}

function createExecuteButton() {
    const button = document.createElement('button');
    button.textContent = 'Execute Spell';
    button.className = 'execute-button';
    return button;
} 