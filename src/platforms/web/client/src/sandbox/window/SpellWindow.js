// src/platforms/web/client/src/sandbox/window/SpellWindow.js
import ToolWindow from './ToolWindow.js';
// state utils imported dynamically when needed
// Detailed UI helpers will be migrated later; use basic header for now.
import { createInputAnchors } from '../node/anchors.js';
import { createParameterSection } from '../node/parameterInputs.js';
import { setupDragging } from '../node/drag.js';
import { executeSpell } from '../logic/spellExecution.js';
import { getToolWindows } from '../state.js';
import createVersionSelector from './versionSelector.js';

export default class SpellWindow extends ToolWindow {
  constructor({ spell, position, id = null, output = null, parameterMappings = null, outputVersions = null, currentVersionIndex = null, totalCost = null, costVersions = null }) {
    const spellSlug = spell.slug || spell._id;
    const initMappings = parameterMappings ? JSON.parse(JSON.stringify(parameterMappings)) : {};
    super({ tool: { displayName: spell.name, toolId: `spell-${spellSlug}` }, position, id, output, parameterMappings: initMappings, outputVersions, currentVersionIndex }, { register: false });
    // Tag root element for easy lookup by websocket handlers
    this.el.classList.add('spell-window');
    this.el.dataset.spellId = spell._id || spell.slug || '';

    this.isSpell = true;
    this.spell = spell;
    
    // Track accessibility state
    this.isAccessible = null; // null = unknown, true = accessible, false = inaccessible
    this.accessError = null; // Store error message if inaccessible
    
    // Initialize cost tracking properties
    this.totalCost = totalCost || { usd: 0, points: 0, ms2: 0, cult: 0 };
    this.costVersions = costVersions || [];
    
    // Note: Cost tracking initialization moved to after window registration

    // Lazy-load full metadata if exposedInputs missing (e.g., restored from slim snapshot)
    if (!this.spell.exposedInputs) {
      this.loadSpellMetadata();
    }

    // enable drag after mount
    setupDragging(this, this.header);

    // Remove placeholder model added by ToolWindow parent so we can replace with full spell model
    import('../state.js').then(mod=>{
        // Ensure we don’t accidentally delete the freshly mounted element.
        // If a placeholder from ToolWindow exists, overwrite it instead of removing DOM.
        const existing = mod.getToolWindow(this.id);
        if (existing) {
          Object.assign(existing, { ...this.serialize(), element: this.el });
          mod.persistState();
          // Initialize cost tracking display after window is registered
          this.initializeCostTracking();
          
          // Debug: Log cost tracking initialization
          console.log(`[SpellWindow] Cost tracking initialized for ${this.id}`, {
            totalCost: this.totalCost,
            costVersions: this.costVersions
          });
        } else {
          // Register in global state via BaseWindow helper
          this._registerWindow(!id);
          // Initialize cost tracking display after window is registered
          this.initializeCostTracking();
          
          // Debug: Log cost tracking initialization
          console.log(`[SpellWindow] Cost tracking initialized for ${this.id}`, {
            totalCost: this.totalCost,
            costVersions: this.costVersions
          });
        }

        // Re-render body now that model is in place
        this.body.innerHTML = '';
        try {
          this.renderBody();
        } catch(err){
          console.error('[SpellWindow] renderBody error', err);
        }
    });

    
  }

  /**
   * Load spell metadata from API
   * Handles permission errors gracefully
   */
  async loadSpellMetadata() {
    try {
      const id = this.spell._id || this.spell.slug;
      if (!id) {
        this.isAccessible = false;
        this.accessError = 'Spell ID is missing';
        this.renderLockedState();
        return;
      }
      
      const res = await fetch(`/api/v1/spells/registry/${encodeURIComponent(id)}`);
      
      // Handle 403 errors gracefully (private spell without permission)
      if (res.status === 403) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || 'You do not have permission to view this spell.';
        console.warn(`[SpellWindow] Permission denied for spell ${id}:`, errorMsg);
        
        this.isAccessible = false;
        this.accessError = errorMsg;
        this.renderLockedState();
        return;
      }
      
      // Handle other errors
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `Failed to load spell details (${res.status})`;
        console.warn(`[SpellWindow] Failed to fetch metadata for spell ${id}:`, errorMsg);
        
        this.isAccessible = false;
        this.accessError = errorMsg;
        this.renderErrorState();
        return;
      }
      
      // Success - merge metadata and rerender
      const full = await res.json();
      Object.assign(this.spell, full);
      this.isAccessible = true;
      this.accessError = null;
      
      // Rerender inputs section
      this.body.innerHTML = '';
      this.renderBody();
    } catch (e) {
      console.warn('[SpellWindow] metadata fetch failed', e);
      this.isAccessible = false;
      this.accessError = 'Unable to load spell details. Please try again.';
      this.renderErrorState();
    }
  }

  /**
   * Render locked/private spell state
   */
  renderLockedState() {
    const spellId = this.spell._id || this.spell.slug || 'unknown';
    const spellName = this.spell.name || 'Unknown Spell';
    
    this.el.classList.add('spell-locked');
    this.body.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #999; min-height: 120px; display: flex; flex-direction: column; justify-content: center;">
        <div style="font-size: 38px; margin-bottom: 12px; opacity: 0.7;">🔒</div>
        <div style="font-weight: bold; margin-bottom: 8px; color: #666; font-size: 19px;">Private Spell</div>
        <div style="font-size: 17px; margin-bottom: 4px; color: #888;">${this.accessError || 'You do not have permission to view this spell.'}</div>
        <div style="font-size: 14px; margin-top: 12px; color: #999; font-family: monospace;">${spellName}</div>
        <div style="font-size: 13px; margin-top: 4px; color: #aaa; font-family: monospace;">ID: ${spellId}</div>
      </div>
    `;
    
    // Disable execute button if it exists
    const execBtn = this.el.querySelector('.execute-button');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.style.opacity = '0.5';
      execBtn.style.cursor = 'not-allowed';
    }
  }

  /**
   * Render error state (non-permission errors)
   */
  renderErrorState() {
    const spellId = this.spell._id || this.spell.slug || 'unknown';
    
    this.el.classList.add('spell-error');
    this.body.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #999; min-height: 120px; display: flex; flex-direction: column; justify-content: center;">
        <div style="font-size: 38px; margin-bottom: 12px; opacity: 0.7;">⚠️</div>
        <div style="font-weight: bold; margin-bottom: 8px; color: #666; font-size: 19px;">Failed to Load Spell</div>
        <div style="font-size: 17px; margin-bottom: 4px; color: #888;">${this.accessError || 'Unable to load spell details.'}</div>
        <div style="font-size: 13px; margin-top: 12px; color: #aaa; font-family: monospace;">ID: ${spellId}</div>
      </div>
    `;
    
    // Disable execute button if it exists
    const execBtn = this.el.querySelector('.execute-button');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.style.opacity = '0.5';
      execBtn.style.cursor = 'not-allowed';
    }
  }

  // Persist spell-specific data
  serialize() {
    return {
      ...super.serialize(),
      type: 'spell',
      spell: this.spell,
      output: this.output,
      outputVersions: this.outputVersions,
      currentVersionIndex: this.currentVersionIndex,
      parameterMappings: this.parameterMappings,
      totalCost: this.totalCost,
      costVersions: this.costVersions,
      isSpell: true,
      isAccessible: this.isAccessible, // Include accessibility state
    };
  }

  renderBody() {
    if (!this.spell) return; // safety guard for initial placeholder call
    
    // Don't render if spell is inaccessible
    if (this.isAccessible === false) {
      if (this.accessError && this.accessError.includes('permission')) {
        this.renderLockedState();
      } else {
        this.renderErrorState();
      }
      return;
    }
    // Override to use exposedInputs mapping from original spellWindow.js
    const paramMappings = this.parameterMappings || (this.parameterMappings = {});
    const spellInputSchemaForUI = {};
    if (this.spell.exposedInputs) {
      this.spell.exposedInputs.forEach(input => {
        // basic schema copy (improve later)
        spellInputSchemaForUI[`${input.nodeId}_${input.paramKey}`] = {
          name: input.paramKey,
          type: 'string',
          required: true
        };
        if (!paramMappings[`${input.nodeId}_${input.paramKey}`]) {
          paramMappings[`${input.nodeId}_${input.paramKey}`] = { type: 'static', value: '' };
        }
      });
    }

    // Split into required / optional arrays (future-proof)
    const entries = Object.entries(spellInputSchemaForUI).reduce((acc,[k,d])=>{
        (d.required ? acc.required : acc.optional).push([k,d]);
        return acc;
    },{required:[],optional:[]});

    const showMoreBtn = document.createElement('button');
    showMoreBtn.textContent = 'show more';
    showMoreBtn.className = 'show-more-button';
    let expanded=false;
    showMoreBtn.addEventListener('click',()=>{
        expanded=!expanded;
        optionalSection.style.display = expanded? 'flex':'none';
        showMoreBtn.textContent = expanded? 'show less':'show more';
        showMoreBtn.classList.toggle('active',expanded);
    });

    const inputAnchors = createInputAnchors({ inputSchema: spellInputSchemaForUI });

    const requiredSection = createParameterSection(entries.required,'required-params',paramMappings,getToolWindows());
    const optionalSection = createParameterSection(entries.optional,'optional-params',paramMappings,getToolWindows());

    this.body.append(requiredSection, showMoreBtn, optionalSection, inputAnchors);

    // Output rendering (like ToolWindow)
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

      // 2) Standard execute button so users can re-run the spell after reload
      const execBtn = document.createElement('button');
      execBtn.textContent = 'Cast Spell';
      execBtn.className = 'execute-button';
      execBtn.addEventListener('click', () => executeSpell(this.id));

      this.body.append(loadBtn, execBtn);
    } else {
      // No prior output → just show execute button like before
      const execBtn = document.createElement('button');
      execBtn.textContent = 'Cast Spell';
      execBtn.className = 'execute-button';
      execBtn.addEventListener('click', () => executeSpell(this.id));
      this.body.appendChild(execBtn);
    }

    const verSel = createVersionSelector(this);
    this.versionSelector = verSel;
    this.el.versionSelector = verSel;
    this.header.insertBefore(verSel, this.header.lastChild);

    import('../node/overlays/textOverlay.js').then(m=>m.bindPromptFieldOverlays()).catch(()=>{});
  }
}

// Helper for older callers
export function createSpellWindow(spell, position, id = null, output = null, parameterMappings = null, outputVersions = null, currentVersionIndex = null, totalCost = null, costVersions = null) {
  // Check if a window for this spell already exists to avoid duplicates
  const spellId=spell._id||spell.slug||'';
  const existing=document.querySelector(`.spell-window[data-spell-id="${spellId}"]`);
  if(existing){
     existing.remove();
  }

  const win = new SpellWindow({ spell, position, id, output, parameterMappings, outputVersions, currentVersionIndex, totalCost, costVersions });
  win.mount();
  return win.el;
}
