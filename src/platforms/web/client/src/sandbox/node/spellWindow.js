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
import { createToolWindow, rerenderToolWindowById } from './toolWindow.js';
import SpellWindow from '../window/SpellWindow.js';
import { generationIdToWindowMap, generationCompletionManager } from './websocketHandlers.js';

// TODO: Implement spell-specific execution logic
// import { executeSpellAndDependencies } from './spellExecution.js'; 

// Adapter: createSpellWindow using class-based implementation
export function createSpellWindow(spell, position, id = null, output = null) {
  console.log('[spellWindow.js] [ADAPTER] createSpellWindow → SpellWindow class', spell.slug);

  const win = new SpellWindow({ spell, position, id, output });
  win.mount();
  return win.el;
}

// Re-export internal helpers so new class-based SpellWindow can reuse them
export { executeSpell, explodeSpell };

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
        let tool = toolMap.get(step.toolIdentifier || step.toolId);
        if (!tool) {
            tool = toolMap.get((step.displayName || '').toLowerCase());
        }
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

    // Prepare payload for Spells API
    const masterAccountId = await getCurrentMasterAccountId();
    if (!masterAccountId) {
        alert('You must be logged in to cast spells.');
        return;
    }

    // Determine slug: prefer slug, then publicSlug, then _id (legacy)
    const spellSlug = spell.slug || spell.publicSlug || spell._id;
    if (!spellSlug) {
        alert('This spell is missing an identifier.');
        return;
    }

    const payload = {
        slug: spellSlug,
        context: {
            masterAccountId,
            parameterOverrides: inputs,
            platform: 'web-sandbox'
        }
    };

    try {
        const spellWindowEl = document.getElementById(windowId);
        showError(spellWindowEl, ''); // Clear previous errors

        // --- Progress UI bootstrap ---
        let progressIndicator = spellWindowEl.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            spellWindowEl.appendChild(progressIndicator);
        }
        progressIndicator.textContent = 'Casting spell...';

        // Create progress bar element once
        let progBar = spellWindowEl.querySelector('.spell-progress-bar');
        if(!progBar){
           progBar = document.createElement('progress');
           progBar.className='spell-progress-bar';
           progBar.max=100;
           progBar.value=0;
           spellWindowEl.appendChild(progBar);
        }

        // Create step status list once
        let stepList = spellWindowEl.querySelector('.spell-step-status');
        if(!stepList){
           stepList = document.createElement('ul');
           stepList.className='spell-step-status';
           // populate list items for each step
           (spell.steps||[]).forEach((step,idx)=>{
               const li=document.createElement('li');
               li.dataset.stepId=step.id||idx;
               li.dataset.toolId=step.toolIdentifier||step.toolId;
               li.textContent=`${idx+1}. ${step.displayName||step.toolIdentifier||'step'}`;
               li.className='pending';
               stepList.appendChild(li);
           });
           spellWindowEl.appendChild(stepList);
        }

        const csrfRes = await fetch('/api/v1/csrf-token');
        const { csrfToken } = await csrfRes.json();

        const response = await fetch('/api/v1/spells/cast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify(payload),
        });

        const result = await response.json();
        console.log('[spellWindow] Raw execution result:', result);

        if (!response.ok) {
            console.error('[spellWindow] Exec fetch failed', response.status, response.statusText, result);
            const msg = result && result.error ? (result.error.message || JSON.stringify(result.error)) : 'Spell execution failed.';
            throw new Error(`${response.status} ${response.statusText} – ${msg}`);
        }

        // If the execution is async (status processing/pending) we wait for websocket updates.
        const isFinalStatus = result.status === 'completed' || result.status === 'success' || result.status === 'failed';

        if (result.generationId && !isFinalStatus) {
            // Map generationId to this spell window for future websocket updates
            generationIdToWindowMap[result.generationId] = document.getElementById(windowId);
            progressIndicator.textContent = `Status: ${result.status}`;
            progBar.value=50;
            // Optional: wait until completion then remove indicator
            generationCompletionManager.createCompletionPromise(result.generationId).then(() => {
                const progEl = document.getElementById(windowId)?.querySelector('.progress-indicator');
                if (progEl) progEl.remove();
            });
            return; // Rendering will be handled on websocket completion
        }

        // Immediate path (synchronous tool)
        progressIndicator.remove();

        let outputData;
        if (result.outputs?.steps) {
            // Spell pipeline returned each step’s output
            outputData = { type: 'spell', steps: result.outputs.steps };
            // Optionally include a final output shortcut if present
            if (result.outputs.final) outputData.final = result.outputs.final;
        } else if (Array.isArray(result.outputs) && result.outputs[0]?.data) {
            outputData = result.outputs[0].data;
        } else if (result.response) {
            outputData = { type: 'text', text: result.response };
        }

        if (outputData) {
            progBar.value=100;
            // mark steps complete if we have breakdown
            if(outputData.steps){
               outputData.steps.forEach((stepRes,idx)=>{
                   const li=stepList.children[idx];
                   if(li) li.className='done';
               });
            } else {
               stepList.querySelectorAll('li').forEach(li=>li.className='done');
            }
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
            const isGateway=String(error.message||'').includes('502');
            if(isGateway){
                // Non-fatal: backend accepted but timed out. Keep indicator and wait for websockets.
                let prog=spellWindowEl.querySelector('.progress-indicator');
                if(!prog){prog=document.createElement('div');prog.className='progress-indicator';spellWindowEl.appendChild(prog);}                
                prog.textContent='Spell accepted, awaiting updates...';
            } else {
                showError(spellWindowEl, error.message);
                const progressIndicator = spellWindowEl.querySelector('.progress-indicator');
                if (progressIndicator) progressIndicator.remove();
            }
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
    const toolMap = new Map();
    availableTools.forEach(t => {
        const identifier = t.toolIdentifier || t.toolId;
        if (identifier) toolMap.set(identifier, t);
        if (t.displayName) toolMap.set(t.displayName.toLowerCase(), t);
    });
    
    // 1. Create all the tool windows from the spell's steps
    const createdNodeMap = new Map(); // Map original step ID to { id, element }
    spell.steps.forEach((step, index) => {
        let tool = toolMap.get(step.toolIdentifier || step.toolId);
        if (!tool) {
            tool = toolMap.get((step.displayName || '').toLowerCase());
        }
        if (tool) {
            // Arrange the new nodes in a neat row to avoid overlap
            const position = {
                x: startPosition.x + (index * 350), // Stagger horizontally
                y: startPosition.y
            };
            const newWindowEl = createToolWindow(tool, position, step.id);
            // Track mapping and element
            createdNodeMap.set(step.id, { id: newWindowEl.id, el: newWindowEl });

            // Restore the parameter mappings for this node
            const newToolWindow = getToolWindow(newWindowEl.id);
            if (newToolWindow) {
                newToolWindow.parameterMappings = step.parameterMappings || {};
                rerenderToolWindowById(newWindowEl.id);
            }
        } else {
            console.warn(`[spellWindow] Could not find tool with identifier "${step.toolIdentifier}" during spell explosion.`);
        }
    });

    // 2. Re-create the connections between the new windows
    if (spell.connections) {
        spell.connections.forEach(conn => {
            const fromEntry = createdNodeMap.get(conn.fromWindowId);
            const toEntry = createdNodeMap.get(conn.toWindowId);

            if (fromEntry && toEntry) {
                const fromEl = fromEntry.el;
                const toEl = toEntry.el;
                // Use the stored type (outputKey) as the connection type
                createPermanentConnection(fromEl, toEl, conn.fromOutput);
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

// --- Helper: fetch & cache current user's MasterAccountId ---
let _cachedMasterAccountId = null;
async function getCurrentMasterAccountId() {
    if (_cachedMasterAccountId) return _cachedMasterAccountId;
    try {
        const res = await fetch('/api/v1/user/dashboard', { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        _cachedMasterAccountId = data.masterAccountId || null;
        return _cachedMasterAccountId;
    } catch {
        return null;
    }
} 