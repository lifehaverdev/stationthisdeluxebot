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
import { setupDragging } from '../node/drag.js'; // still need advanced drag
import { renderAllConnections } from '../connections/index.js';
import { renderResultContent } from '../node/resultContent.js';
// createVersionSelector adapted from legacy

function createVersionSelector(windowInstance) {
  const { outputVersions } = windowInstance;

  const container = document.createElement('div');
  container.className = 'version-selector';
  container.style.position = 'relative';
  container.style.marginLeft = '4px';

  const btn = document.createElement('button');
  btn.className = 'version-button';

  const dropdown = document.createElement('div');
  dropdown.className = 'version-dropdown';
  Object.assign(dropdown.style, {
    position: 'absolute', top: '100%', left: '0', background: '#fff', border: '1px solid #ccc', display: 'none',
    minWidth: '80px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', padding: '4px 0', zIndex: 1000,
  });

  function refresh() {
    dropdown.innerHTML = '';
    const versions = windowInstance.outputVersions || [];
    versions.forEach((vObj, idx) => {
      const item = document.createElement('div');
      item.className = 'version-item';
      item.textContent = vObj && vObj._pending ? `v${idx + 1}*` : `v${idx + 1}`;
      Object.assign(item.style, { padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', color: '#000' });
      item.addEventListener('click', () => {
        windowInstance.currentVersionIndex = idx;
        if (vObj && vObj.params) {
          windowInstance.parameterMappings = JSON.parse(JSON.stringify(vObj.params));
          // refresh inputs
          windowInstance.applyParameterMappingsToInputs();
        }
        if (vObj && vObj.output) {
          windowInstance.setOutput(vObj.output);
        }
        dropdown.style.display = 'none';
        refresh();
      });
      dropdown.appendChild(item);
    });

    if (versions.length) {
      const curIdx = windowInstance.currentVersionIndex >= 0 ? windowInstance.currentVersionIndex : versions.length - 1;
      const curObj = versions[curIdx];
      btn.textContent = curObj && curObj._pending ? `v${curIdx + 1}*` : `v${curIdx + 1}`;
      btn.style.display = 'inline-block';
    } else {
      btn.style.display = 'none';
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });
  btn.refreshDropdown = refresh;

  container.append(btn, dropdown);
  refresh();
  return container;
}

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
  constructor({ tool, position, id = null, output = null, parameterMappings = null, outputVersions = null, currentVersionIndex = null }, { register = true } = {}) {
    const windowId = id || generateWindowId();
    super({ id: windowId, title: tool.displayName, position, classes: [], icon: '' });

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
    if (register) {
      this._registerWithState({
        id: windowId,
        tool,
        element: this.el,
        workspaceX: position.x,
        workspaceY: position.y,
        output: this.output,
        outputVersions: this.outputVersions,
        currentVersionIndex: this.currentVersionIndex,
        parameterMappings: this.parameterMappings,
      }, !id);
    }

    // Advanced drag (workspace-aware) — reuse old function
    setupDragging(this, this.header);
  }

  _registerWithState(modelData, pushHist = true) {
    this.model = addToolWindow(modelData);
    this.outputVersions = this.model.outputVersions;
    this.currentVersionIndex = this.model.currentVersionIndex;

    if (pushHist) {
      persistState();
      pushHistory();
    }
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
