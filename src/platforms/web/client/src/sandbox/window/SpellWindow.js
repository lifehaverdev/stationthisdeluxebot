// src/platforms/web/client/src/sandbox/window/SpellWindow.js
import ToolWindow from './ToolWindow.js';
import { addToolWindow, persistState, pushHistory } from '../state.js';
import { createSpellWindowHeader, createShowMoreButtonForSpell } from '../node/spellWindow.js';
import { createInputAnchors } from '../node/anchors.js';
import { createParameterSection } from '../node/parameterInputs.js';
import { setupDragging } from '../node/drag.js';

export default class SpellWindow extends ToolWindow {
  constructor({ spell, position, id = null, output = null, parameterMappings = null }) {
    super({ tool: { displayName: spell.name, toolId: `spell-${spell.slug}` }, position, id, output, parameterMappings });
    // mark as spell
    this.isSpell = true;
    this.spell = spell;
  }

  renderBody() {
    // Override to use exposedInputs mapping from original spellWindow.js
    const paramMappings = this.parameterMappings;
    const spellInputSchemaForUI = {};
    if (this.spell.exposedInputs) {
      this.spell.exposedInputs.forEach(input => {
        spellInputSchemaForUI[`${input.nodeId}_${input.paramKey}`] = { name: input.paramKey, type: 'string', required: false };
        if (!paramMappings[`${input.nodeId}_${input.paramKey}`]) {
          paramMappings[`${input.nodeId}_${input.paramKey}`] = { type: 'static', value: '' };
        }
      });
    }
    const paramsSection = createParameterSection(Object.entries(spellInputSchemaForUI), 'required-params', paramMappings);
    const inputAnchors = createInputAnchors({ inputSchema: spellInputSchemaForUI });

    this.body.append(paramsSection, inputAnchors);
  }
}
