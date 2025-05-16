// Require ToolDefinition JSDoc types for clarity, though they might be globally available
// /** @typedef {import('./ToolDefinition').ToolDefinition} ToolDefinition */

class ToolRegistry {
  /** @private @type {ToolRegistry} */
  static instance;
  /** @private @type {Map<string, ToolDefinition>} */
  tools = new Map();

  /** @private */
  constructor() {} // Singleton

  /** @public @static */
  static getInstance() {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * @public
   * @param {ToolDefinition} tool 
   */
  registerTool(tool) {
    if (this.tools.has(tool.toolId)) {
      console.warn(`ToolRegistry: Tool with ID ${tool.toolId} is being overwritten.`);
    }
    this.tools.set(tool.toolId, tool);
  }

  /**
   * @public
   * @param {string} toolId
   * @returns {ToolDefinition | undefined}
   */
  getToolById(toolId) {
    return this.tools.get(toolId);
  }

  /**
   * @public
   * @returns {ToolDefinition[]}
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * @public
   * @param {string} commandName 
   * @returns {ToolDefinition | undefined}
   */
  findByCommand(commandName) {
    for (const tool of this.tools.values()) {
      if (tool.commandName === commandName) {
        return tool;
      }
    }
    return undefined;
  }

  /**
   * @public
   * @returns {{ isValid: boolean; errors: Array<{ toolId: string | 'unknown', message: string }> }}
   */
  validate() {
    const errors = [];
    this.tools.forEach(tool => {
      const toolId = tool.toolId || 'unknown';

      if (!tool.toolId) errors.push({ toolId: 'unknown', message: 'Missing toolId' });
      if (!tool.service) errors.push({ toolId, message: 'Missing service' });
      if (!tool.displayName) errors.push({ toolId, message: 'Missing displayName' });
      if (!tool.inputSchema) {
        errors.push({ toolId, message: 'Missing inputSchema' });
      } else {
        for (const key in tool.inputSchema) {
          const input = tool.inputSchema[key];
          if (!input.name) errors.push({ toolId, message: `Input field '${key}' is missing a name property.` });
          if (input.name !== key) errors.push({ toolId, message: `Input field key '${key}' does not match its name property '${input.name}'.` });
          if (!input.type) errors.push({ toolId, message: `Input field '${input.name}' is missing a type property.` });
          const allowedTypes = ['string', 'number', 'image', 'video', 'audio', 'file', 'boolean'];
          if (input.type && !allowedTypes.includes(input.type)) {
            errors.push({ toolId, message: `Input field '${input.name}' has an invalid type '${input.type}'. Allowed types: ${allowedTypes.join(', ')}` });
          }
          if (input.required === undefined || typeof input.required !== 'boolean') {
             errors.push({ toolId, message: `Input field '${input.name}' is missing a valid boolean 'required' property.` });
          }
        }
      }
      if (tool.costingModel) {
        if (typeof tool.costingModel.rate !== 'number') {
          errors.push({ toolId, message: 'CostingModel rate must be a number.' });
        }
        const allowedUnits = ['second', 'token', 'request'];
        if (!allowedUnits.includes(tool.costingModel.unit)) {
          errors.push({ toolId, message: `CostingModel unit '${tool.costingModel.unit}' is invalid. Allowed units: ${allowedUnits.join(', ')}` });
        }
        const allowedRateSources = ['static', 'machine', 'api'];
        if (!allowedRateSources.includes(tool.costingModel.rateSource)) {
          errors.push({ toolId, message: `CostingModel rateSource '${tool.costingModel.rateSource}' is invalid. Allowed sources: ${allowedRateSources.join(', ')}` });
        }
      }
      if (tool.category && !['text-to-image', 'img2img', 'upscale', 'inpaint', 'video', 'interrogate'].includes(tool.category)) {
          errors.push({ toolId, message: `Invalid category: ${tool.category}` });
      }
      if (tool.visibility && !['public', 'internal', 'hidden'].includes(tool.visibility)) {
          errors.push({ toolId, message: `Invalid visibility: ${tool.visibility}` });
      }
      if (tool.humanDefaults && typeof tool.humanDefaults !== 'object') {
          errors.push({ toolId, message: 'humanDefaults should be an object' });
      }
      if (tool.webhookStrategy) {
          if (!tool.webhookStrategy.expectedStatusField) errors.push({ toolId, message: 'WebhookConfig missing expectedStatusField'});
          if (!tool.webhookStrategy.successValue) errors.push({ toolId, message: 'WebhookConfig missing successValue'});
          if (typeof tool.webhookStrategy.durationTracking !== 'boolean') errors.push({ toolId, message: 'WebhookConfig durationTracking must be boolean'});
      }
      if (tool.platformHints) {
          const allowedPrimaryInputs = ['text', 'image', 'video', 'audio', 'file'];
          if (!tool.platformHints.primaryInput || !allowedPrimaryInputs.includes(tool.platformHints.primaryInput)) {
              errors.push({ toolId, message: `PlatformHints primaryInput '${tool.platformHints.primaryInput}' is invalid or missing.` });
          }
          if (typeof tool.platformHints.supportsFileCaption !== 'boolean') errors.push({ toolId, message: 'PlatformHints supportsFileCaption must be boolean'});
          if (typeof tool.platformHints.supportsReplyWithCommand !== 'boolean') errors.push({ toolId, message: 'PlatformHints supportsReplyWithCommand must be boolean'});
      }
    });
    return { isValid: errors.length === 0, errors };
  }
}

module.exports = { ToolRegistry }; 