// src/platforms/web/client/src/sandbox/window/ToolWindow.js
// FIRST ITERATION — thin wrapper around existing createToolWindow logic so we can
// progressively migrate functionality from the huge node/toolWindow.js file.
// This file does **not** replace the old implementation yet; we will wire it in
// after validating parity.

import BaseWindow from './BaseWindow.js';
import { getToolWindows, addToolWindow, persistState, pushHistory, getWindowCost } from '../state.js';
import { executeNodeAndDependencies, getLatestExchangeRates } from '../node/toolWindow.js';
import { generateWindowId } from '../utils.js';
import { createParameterSection } from '../node/parameterInputs.js';
import { createAnchorPoint, createInputAnchors } from '../node/anchors.js';
import { setupDragging } from '../node/drag.js';
import { renderAllConnections } from '../connections/index.js';
import { renderResultContent } from '../node/resultContent.js';
import createVersionSelector from './versionSelector.js';

// (Removed duplicated createVersionSelector; now imported)

/**
 * ToolWindow – vanilla-JS class representing a single tool node in the sandbox.
 * For now we embed the existing procedural logic so behaviour is unchanged.
 */
export default class ToolWindow extends BaseWindow {
  /**
   * @param {object} opts
   * @param {object} opts.tool – tool definition from registry
   * @param {object} opts.position – { x, y }
   * @param {string} [opts.id] – existing window id (for restore)
   * @param {object|null} [opts.output] – prior output data
   * @param {object|null} [opts.parameterMappings] – restored param mappings
   */
  constructor({ tool, position, id = null, output = null, parameterMappings = null, outputVersions = null, currentVersionIndex = null }) {
    const windowId = id || generateWindowId();
    super({ id: windowId, title: tool.displayName, position, classes: [], icon: '' }, { register: false });

    this.tool = tool;
    this.output = output;
    // Build parameter mappings (defaults) if not provided
    if (parameterMappings) {
      this.parameterMappings = JSON.parse(JSON.stringify(parameterMappings));
    } else {
      this.parameterMappings = {};
      if (this.tool.inputSchema) {
        Object.entries(this.tool.inputSchema).forEach(([paramKey, paramDef]) => {
          this.parameterMappings[paramKey] = {
            type: 'static',
            value: paramDef.default !== undefined ? paramDef.default : '',
          };
        });
      }
    }

    // Prepare version arrays before DOM build so renderBody can use them
    this.outputVersions = outputVersions ?? (this.output ? [this.output] : []);
    this.currentVersionIndex = currentVersionIndex ?? (this.outputVersions.length ? this.outputVersions.length - 1 : -1);

    this.renderBody();

    // Prepare state model and register (subclasses may override timing)
    this._registerWindow(!id);

    // Advanced drag (workspace-aware) — reuse old function
    setupDragging(this, this.header);

    // Initialize cost tracking
    this.initializeCostTracking();
  }

  initializeCostTracking() {
    // Load existing cost data
    this.updateCostDisplay();

    // Make cost display clickable for denomination switching
    const costDisplay = this.el.querySelector('.window-cost-display');
    if (costDisplay) {
      costDisplay.addEventListener('click', () => {
        this.cycleDenomination();
      });
    }

    // Listen for cost updates
    window.addEventListener('costUpdate', (event) => {
      if (event.detail.windowId === this.id) {
        this.updateCostDisplay();
      }
    });

    // Listen for denomination changes
    window.addEventListener('denominationChange', (event) => {
      this.updateCostDisplay(event.detail.denomination);
    });

    // Listen for cost resets
    window.addEventListener('costReset', (event) => {
      if (event.detail.windowId === this.id) {
        this.updateCostDisplay();
      }
    });
  }

  cycleDenomination() {
    const denominations = ['POINTS', 'MS2', 'USD', 'CULT'];
    const currentDenomination = localStorage.getItem('costDenom') || 'POINTS';
    const currentIndex = denominations.indexOf(currentDenomination);
    const nextIndex = (currentIndex + 1) % denominations.length;
    
    const newDenomination = denominations[nextIndex];
    localStorage.setItem('costDenom', newDenomination);
    
    // Update this window's display
    this.updateCostDisplay(newDenomination);
    
    // Dispatch global denomination change event
    window.dispatchEvent(new CustomEvent('denominationChange', {
      detail: { denomination: newDenomination }
    }));
  }

  updateCostDisplay(denomination = null) {
    // Import getWindowCost from state.js (already imported at top of file)
    
    // Get current denomination from localStorage or use provided one
    const currentDenomination = denomination || localStorage.getItem('costDenom') || 'POINTS';
    
    const costData = getWindowCost(this.id);
    if (!costData) {
      console.log(`[ToolWindow] No cost data found for ${this.id}`);
      return;
    }
    
    console.log(`[ToolWindow] Updating cost display for ${this.id}:`, costData);

    const costElement = this.el.querySelector('.window-cost-display .cost-amount');
    if (!costElement) return;

    const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
    const rates = getLatestExchangeRates() ?? { 
      POINTS_per_USD: 1 / USD_TO_POINTS_CONVERSION_RATE,
      MS2_per_USD: NaN,
      CULT_per_USD: NaN
    };
    
    // Convert total cost to current denomination
    let amount = 0;
    switch (currentDenomination) {
      case 'USD':
        amount = costData.totalCost.usd || 0;
        break;
      case 'POINTS':
        amount = (costData.totalCost.usd || 0) * rates.POINTS_per_USD;
        break;
      case 'MS2':
        amount = rates && !isNaN(rates.MS2_per_USD) ? (costData.totalCost.usd || 0) * rates.MS2_per_USD : 0;
        break;
      case 'CULT':
        amount = rates && !isNaN(rates.CULT_per_USD) ? (costData.totalCost.usd || 0) * rates.CULT_per_USD : 0;
        break;
    }

    // Format the amount
    let formattedAmount = '0';
    if (amount > 0) {
      switch (currentDenomination) {
        case 'USD':
          formattedAmount = `$${amount.toFixed(2)}`;
          break;
        case 'POINTS':
          formattedAmount = `${Math.round(amount)} POINTS`;
          break;
        case 'MS2':
          formattedAmount = `${amount.toFixed(2)} MS2`;
          break;
        case 'CULT':
          formattedAmount = `${Math.round(amount)} CULT`;
          break;
      }
    }

    costElement.textContent = formattedAmount;

    // Add tooltip with all denominations
    const tooltip = [
      `USD: $${(costData.totalCost.usd || 0).toFixed(2)}`,
      `POINTS: ${Math.round((costData.totalCost.usd || 0) * rates.POINTS_per_USD)}`,
      `MS2: ${rates && !isNaN(rates.MS2_per_USD) ? ((costData.totalCost.usd || 0) * rates.MS2_per_USD).toFixed(2) : 'N/A'}`,
      `CULT: ${rates && !isNaN(rates.CULT_per_USD) ? Math.round((costData.totalCost.usd || 0) * rates.CULT_per_USD) : 'N/A'}`
    ].join(' | ');

    const costDisplay = this.el.querySelector('.window-cost-display');
    if (costDisplay) {
      costDisplay.title = tooltip;
    }
  }
  serialize() {
    return {
      ...super.serialize(),
      type: 'tool',
      tool: this.tool,
      output: this.output,
      outputVersions: this.outputVersions,
      currentVersionIndex: this.currentVersionIndex,
      parameterMappings: this.parameterMappings,
    };
  }

  // ---------------------------------------------------------------------
  renderBody() {
    // Split params into required/optional for UI
    const params = Object.entries(this.tool.inputSchema || {}).reduce(
      (acc, [key, param]) => {
        (param.required ? acc.required : acc.optional).push([key, param]);
        return acc;
      },
      { required: [], optional: [] }
    );

    // ---- enforce prompt parameter ordering ----
    const orderPriority = k => (k === 'input_prompt' ? 0 : (k === 'input_negative_prompt' ? 1 : 2));
    params.required.sort((a, b) => orderPriority(a[0]) - orderPriority(b[0]));
    params.optional.sort((a, b) => orderPriority(a[0]) - orderPriority(b[0]));

    const requiredSection = createParameterSection(
      params.required,
      'required-params',
      this.parameterMappings,
      getToolWindows()
    );
    const optionalSection = createParameterSection(
      params.optional,
      'optional-params',
      this.parameterMappings,
      getToolWindows()
    );

    // Show-more button
    const showMoreBtn = document.createElement('button');
    showMoreBtn.textContent = 'show more';
    showMoreBtn.className = 'show-more-button';
    let expanded = false;
    showMoreBtn.addEventListener('click', () => {
      expanded = !expanded;
      optionalSection.style.display = expanded ? 'flex' : 'none';
      showMoreBtn.textContent = expanded ? 'show less' : 'show more';
      showMoreBtn.classList.toggle('active', expanded);
    });

    const anchorPoint = createAnchorPoint(this.tool, this.el);
    const inputAnchors = createInputAnchors(this.tool);

    this.body.append(requiredSection, showMoreBtn, optionalSection, anchorPoint, inputAnchors);

    if (this.output) {
      const resultContainer = document.createElement('div');
      resultContainer.className = 'result-container';
      this.body.appendChild(resultContainer);

      // 1) Button to load last output back into the UI
      const loadBtn = document.createElement('button');
      loadBtn.className = 'load-output-button';
      loadBtn.textContent = this.output.type === 'image' ? 'Load Image' : (this.output.type === 'text' ? 'Load Text' : 'Load Output');
      loadBtn.addEventListener('click', () => {
        import('../node/resultContent.js').then(m => m.renderResultContent(resultContainer, this.output));
        loadBtn.remove();
      });

      // 2) Standard execute button so users can re-run the node after reload
      const execBtn = this._createExecuteButton();

      this.body.append(loadBtn, execBtn);
    } else {
      // No prior output → just show execute button like before
      const execBtn = this._createExecuteButton();
      this.body.appendChild(execBtn);
    }

    // Re-bind text overlay helpers for prompt-like fields
    import('../node/overlays/textOverlay.js')
      .then(m => m.bindPromptFieldOverlays())
      .catch(() => {});

    // ----- Version selector -----
    const verSel = createVersionSelector(this);
    this.versionSelector = verSel;
    this.el.versionSelector = verSel; // legacy code expects this
    // insert before close button
    this.header.insertBefore(verSel, this.header.lastChild);
  }

  async onClose() {
    const { removeToolWindow, clearConnectionsForWindow, persistState, pushHistory } = await import('../state.js');
    pushHistory();
    clearConnectionsForWindow(this.id);
    removeToolWindow(this.id);
    persistState();
  }

  // ---------------------------------------------------------------------
  _createExecuteButton() {
    const btn = document.createElement('button');
    btn.textContent = 'Execute';
    btn.className = 'execute-button';

    btn.addEventListener('click', async () => {
      // Randomise seeds and persist state exactly like legacy implementation
      randomizeSeedInMappings(this.parameterMappings);
      (await import('../state.js')).persistState();
      await executeNodeAndDependencies(this.id);
    });

    return btn;
  }
}

// ---- helper copied from legacy ------------------------------
function randomizeSeedInMappings(mappings) {
  if (!mappings) return;
  Object.entries(mappings).forEach(([key, map]) => {
    if (map && map.type === 'static' && /seed/i.test(key)) {
      map.value = Math.floor(Math.random() * 1e9);
    }
  });
}

// ---------------- after class definition -----------------
ToolWindow.prototype.applyParameterMappingsToInputs = function () {
  this.el.querySelectorAll('.parameter-input').forEach(container => {
    const paramName = container.dataset.paramName;
    const inp = container.querySelector('input');
    const mapping = this.parameterMappings[paramName];
    if (inp && mapping && mapping.type === 'static') {
      inp.value = mapping.value ?? '';
    }
  });
};
