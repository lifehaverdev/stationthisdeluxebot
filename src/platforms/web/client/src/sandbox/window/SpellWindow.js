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
  constructor({ spell, position, id = null, output = null, parameterMappings = null, outputVersions = null, currentVersionIndex = null }) {
    const spellSlug = spell.slug || spell._id;
    const initMappings = parameterMappings ? JSON.parse(JSON.stringify(parameterMappings)) : {};
    super({ tool: { displayName: spell.name, toolId: `spell-${spellSlug}` }, position, id, output, parameterMappings: initMappings, outputVersions, currentVersionIndex }, { register: false });
    // Tag root element for easy lookup by websocket handlers
    this.el.classList.add('spell-window');
    this.el.dataset.spellId = spell._id || spell.slug || '';

    this.isSpell = true;
    this.spell = spell;

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
        } else {
          // Register in global state via BaseWindow helper
          this._registerWindow(!id);
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
      isSpell: true,
    };
  }

  renderBody() {
    if (!this.spell) return; // safety guard for initial placeholder call
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

    const verSel = createVersionSelector(this);
    this.versionSelector = verSel;
    this.el.versionSelector = verSel;
    this.header.insertBefore(verSel, this.header.lastChild);

    // Execute Spell button
    const execBtn = document.createElement('button');
    execBtn.textContent = 'Cast Spell';
    execBtn.className = 'execute-button';
    execBtn.addEventListener('click', () => executeSpell(this.id));
    this.body.appendChild(execBtn);

    import('../node/overlays/textOverlay.js').then(m=>m.bindPromptFieldOverlays()).catch(()=>{});
  }
}

// Helper for older callers
export function createSpellWindow(spell, position, id = null, output = null, parameterMappings = null, outputVersions = null, currentVersionIndex = null) {
  // Check if a window for this spell already exists to avoid duplicates
  const spellId=spell._id||spell.slug||'';
  const existing=document.querySelector(`.spell-window[data-spell-id="${spellId}"]`);
  if(existing){
     existing.remove();
  }

  const win = new SpellWindow({ spell, position, id, output, parameterMappings, outputVersions, currentVersionIndex });
  win.mount();
  return win.el;
}
