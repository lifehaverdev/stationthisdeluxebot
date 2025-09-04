import { getToolWindow, pushHistory, removeToolWindow, getAvailableTools, persistState, setToolWindowOutput } from '../state.js';
import { renderResultContent } from '../node/resultContent.js';
import { showError } from '../node/parameterInputs.js';
import { renderAllConnections } from '../connections/index.js';
import { createPermanentConnection } from '../connections/manager.js';
import { createToolWindow, rerenderToolWindowById } from '../node/toolWindow.js';
import { generationIdToWindowMap, generationCompletionManager } from '../node/websocketHandlers.js';

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

// ---------------------------------------------------------------------------
export async function executeSpell(windowId) {
  const spellWindow = getToolWindow(windowId);
  if (!spellWindow) {
    console.error(`[spellExecution] Could not find spell window with ID ${windowId} to execute.`);
    return;
  }
  const { spell, parameterMappings } = spellWindow;
  const inputs = {};
  if (spell.exposedInputs) {
    for (const input of spell.exposedInputs) {
      const uiKey = `${input.nodeId}_${input.paramKey}`;
      const mapping = parameterMappings[uiKey];
      if (mapping?.type === 'static') {
        inputs[input.paramKey] = mapping.value;
      } else if (mapping?.type === 'nodeOutput') {
        console.warn(`[spellExecution] Unsupported connected exposed input "${input.paramKey}". It will be ignored.`);
      }
    }
  }

  console.log(`[spellExecution] Executing spell "${spell.name}" with inputs:`, inputs);
  const masterAccountId = await getCurrentMasterAccountId();
  if (!masterAccountId) {
    alert('You must be logged in to cast spells.');
    return;
  }
  const spellSlug = spell.slug || spell.publicSlug || spell._id;
  if (!spellSlug) {
    alert('This spell is missing an identifier.');
    return;
  }
  const payload = {
    slug: spellSlug,
    context: { masterAccountId, parameterOverrides: inputs, platform: 'web-sandbox' }
  };
  try {
    const spellWindowEl = document.getElementById(windowId);
    // mapping will be done after backend returns castId
    showError(spellWindowEl, '');
    let progressIndicator = spellWindowEl.querySelector('.progress-indicator');
    if (!progressIndicator) {
      progressIndicator = document.createElement('div');
      progressIndicator.className = 'progress-indicator';
      spellWindowEl.appendChild(progressIndicator);
    }
    progressIndicator.textContent = 'Casting spell…';
    let progBar = spellWindowEl.querySelector('.spell-progress-bar');
    if (!progBar) {
      progBar = document.createElement('progress');
      progBar.className = 'spell-progress-bar';
      progBar.max = 100;
      progBar.value = 0;
      spellWindowEl.appendChild(progBar);
    }
    let stepList = spellWindowEl.querySelector('.spell-step-status');
    if (!stepList) {
      stepList = document.createElement('ul');
      stepList.className = 'spell-step-status';
      (spell.steps || []).forEach((step, idx) => {
        const li = document.createElement('li');
        li.dataset.stepId = step.id || idx;
        li.dataset.toolId = step.toolIdentifier || step.toolId;
        li.textContent = `${idx + 1}. ${step.displayName || step.toolIdentifier || 'step'}`;
        li.className = 'pending';
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
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    // --- Register castId returned from backend (ObjectId) ---
    if (result.castId) {
        spellWindowEl.dataset.castId = result.castId;
        (await import('../node/websocketHandlers.js')).castIdToWindowMap[result.castId] = spellWindowEl;
        window._wsCurrentCastId = result.castId;
    }
    if (!response.ok) {
      console.error('[spellExecution] Exec fetch failed', response.status, response.statusText, result);
      const msg = result?.error ? (result.error.message || JSON.stringify(result.error)) : 'Spell execution failed.';
      throw new Error(`${response.status} ${response.statusText} – ${msg}`);
    }
    const isFinalStatus = ['completed', 'success', 'failed'].includes(result.status);
    if (result.generationId && !isFinalStatus) {
      generationIdToWindowMap[result.generationId] = spellWindowEl;
      progressIndicator.textContent = `Status: ${result.status}`;
      progBar.value = 50;
      generationCompletionManager.createCompletionPromise(result.generationId).then(() => {
        spellWindowEl.querySelector('.progress-indicator')?.remove();
      });
      return;
    }
    progressIndicator.remove();
    let outputData;
    if (result.outputs?.steps) {
      outputData = { type: 'spell', steps: result.outputs.steps, ...(result.outputs.final ? { final: result.outputs.final } : {}) };
    } else if (Array.isArray(result.outputs) && result.outputs[0]?.data) {
      outputData = result.outputs[0].data;
    } else if (result.response) {
      outputData = { type: 'text', text: result.response };
    }
    if (outputData) {
      progBar.value = 100;
      if (outputData.steps) {
        outputData.steps.forEach((_, idx) => stepList.children[idx]?.classList.replace('pending', 'done'));
      } else {
        stepList.querySelectorAll('li').forEach(li => li.classList.replace('pending', 'done'));
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
    console.error('[spellExecution] Error executing spell:', error);
    const spellWindowEl = document.getElementById(windowId);
    if (!spellWindowEl) return;
    const isGateway = String(error.message || '').includes('502');
    if (isGateway) {
      let prog = spellWindowEl.querySelector('.progress-indicator');
      if (!prog) {
        prog = document.createElement('div');
        prog.className = 'progress-indicator';
        spellWindowEl.appendChild(prog);
      }
      prog.textContent = 'Spell accepted, awaiting updates…';
    } else {
      showError(spellWindowEl, error.message);
      spellWindowEl.querySelector('.progress-indicator')?.remove();
    }
  }
}

// ---------------------------------------------------------------------------
export function explodeSpell(spellWindowId, spell) {
  console.log(`[spellExecution] Exploding spell "${spell.name}" (${spellWindowId})`);
  pushHistory();
  const spellWindow = getToolWindow(spellWindowId);
  if (!spellWindow) {
    console.error(`[spellExecution] Cannot find spell window with ID ${spellWindowId} to explode.`);
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
  const createdNodeMap = new Map();
  spell.steps.forEach((step, index) => {
    let tool = toolMap.get(step.toolIdentifier || step.toolId) || toolMap.get((step.displayName || '').toLowerCase());
    if (!tool) {
      console.warn(`[spellExecution] Could not find tool "${step.toolIdentifier}" during spell explosion.`);
      return;
    }
    const pos = { x: startPosition.x + index * 350, y: startPosition.y };
    const newEl = createToolWindow(tool, pos, step.id);
    createdNodeMap.set(step.id, { id: newEl.id, el: newEl });
    const newWin = getToolWindow(newEl.id);
    if (newWin) {
      newWin.parameterMappings = step.parameterMappings || {};
      rerenderToolWindowById(newEl.id);
    }
  });
  if (spell.connections) {
    spell.connections.forEach(conn => {
      const fromEntry = createdNodeMap.get(conn.fromWindowId);
      const toEntry = createdNodeMap.get(conn.toWindowId);
      if (fromEntry && toEntry) {
        createPermanentConnection(fromEntry.el, toEntry.el, conn.fromOutput);
      }
    });
  }
  removeToolWindow(spellWindowId);
  document.getElementById(spellWindowId)?.remove();
  persistState();
  renderAllConnections();
}
