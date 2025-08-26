// src/platforms/web/client/src/sandbox/window/ToolWindow.js
// FIRST ITERATION — thin wrapper around existing createToolWindow logic so we can
// progressively migrate functionality from the huge node/toolWindow.js file.
// This file does **not** replace the old implementation yet; we will wire it in
// after validating parity.

import BaseWindow from './BaseWindow.js';
import { getToolWindows, addToolWindow, persistState, pushHistory } from '../state.js';
import { executeNodeAndDependencies } from '../node/toolWindow.js';
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

      const loadBtn = document.createElement('button');
      loadBtn.className = 'execute-button';
      loadBtn.textContent = this.output.type === 'image' ? 'Load Image' : (this.output.type === 'text' ? 'Load Text' : 'Load Output');
      loadBtn.onclick = () => {
        import('../node/resultContent.js').then(m => m.renderResultContent(resultContainer, this.output));
        loadBtn.remove();
      };
      this.body.appendChild(loadBtn);
    } else {
      const execBtn = this._createExecuteButton();
      execBtn.textContent = 'Execute';
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
