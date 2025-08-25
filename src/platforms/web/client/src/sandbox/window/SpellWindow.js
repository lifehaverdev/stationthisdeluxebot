// src/platforms/web/client/src/sandbox/window/SpellWindow.js
import ToolWindow from './ToolWindow.js';
import { addToolWindow, persistState, pushHistory } from '../state.js';
// Detailed UI helpers will be migrated later; use basic header for now.
import { createInputAnchors } from '../node/anchors.js';
import { createParameterSection } from '../node/parameterInputs.js';
import { setupDragging } from '../node/drag.js';
import { executeSpell } from '../node/spellWindow.js';
import { getToolWindows } from '../state.js';

export default class SpellWindow extends ToolWindow {
  constructor({ spell, position, id = null, output = null, parameterMappings = null }) {
    // Basic ToolWindow initialisation (without state registration yet)
    const spellSlug = spell.slug || spell._id;
    super({ tool: { displayName: spell.name, toolId: `spell-${spellSlug}` }, position, id, output, parameterMappings }, { register: false });
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
        // Only remove an existing model if one is already present (e.g. during re-hydration).
        if (mod.getToolWindow(this.id)) {
          mod.removeToolWindow(this.id);
        }

        // Register once fully formed
        this._registerWithState({
          id: this.id,
          spell,
          isSpell: true,
          tool: { displayName: spell.name, toolId: `spell-${spellSlug}` },
          element: this.el,
          workspaceX: position.x,
          workspaceY: position.y,
          output: this.output,
          outputVersions: this.output ? [this.output] : [],
          currentVersionIndex: this.output ? 0 : -1,
          parameterMappings: this.parameterMappings
        }, !id);

        // Re-render body now that model is in place
        this.body.innerHTML = '';
        this.renderBody();
    });

    
  }

  renderBody() {
    if (!this.spell) return; // first pass before constructor sets spell
    // Override to use exposedInputs mapping from original spellWindow.js
    const paramMappings = this.parameterMappings;
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

    // Execute Spell button
    const execBtn = document.createElement('button');
    execBtn.textContent = 'Cast Spell';
    execBtn.className = 'execute-button';
    execBtn.addEventListener('click', () => executeSpell(this.id));
    this.body.appendChild(execBtn);

    import('../node/overlays/textOverlay.js').then(m=>m.bindPromptFieldOverlays()).catch(()=>{});
  }
}
