/**
 * Tool Transformer
 *
 * Converts NOEMA ToolDefinition format to MCP tool format.
 * Uses commandName as the primary identifier, mirroring how Telegram
 * dynamic commands work - ensuring consistency across platforms.
 */

/**
 * Maps NOEMA input types to JSON Schema types
 * @param {string} noemaType - NOEMA input type
 * @returns {string} JSON Schema type
 */
function mapTypeToJsonSchema(noemaType) {
  const typeMap = {
    'string': 'string',
    'text': 'string',
    'textany': 'string',
    'number': 'number',
    'numberslider': 'number',
    'numbersliderint': 'integer',
    'integer': 'integer',
    'boolean': 'boolean',
    'enum': 'string',
    'image': 'string',  // URL or base64
    'video': 'string',  // URL
    'audio': 'string',  // URL
    'file': 'string',   // URL
    'seed': 'integer',
    'checkpoint': 'string'
  };
  return typeMap[noemaType] || 'string';
}

/**
 * Gets a human-readable name for a tool to use in MCP.
 * Priority: commandName (without /) > displayName > toolId
 * @param {Object} tool - NOEMA ToolDefinition
 * @returns {string} Human-readable tool name
 */
function getHumanReadableName(tool) {
  // Prefer commandName without the leading slash (e.g., "/make" -> "make")
  if (tool.commandName) {
    return tool.commandName.replace(/^\//, '');
  }
  // Fall back to displayName, sanitized for use as identifier
  if (tool.displayName) {
    // Convert to lowercase, replace spaces with hyphens
    return tool.displayName.toLowerCase().replace(/\s+/g, '-');
  }
  // Last resort: use toolId
  return tool.toolId;
}

/**
 * Transforms a NOEMA ToolDefinition to MCP tool format
 * @param {Object} tool - NOEMA ToolDefinition
 * @returns {Object} MCP tool definition
 */
function transformToolToMcp(tool) {
  const properties = {};
  const required = [];

  // Transform inputSchema
  if (tool.inputSchema) {
    for (const [key, input] of Object.entries(tool.inputSchema)) {
      const prop = {
        type: mapTypeToJsonSchema(input.type),
        description: input.description || `The ${input.name} parameter`
      };

      // Handle enums
      if (input.type === 'enum' && input.enum) {
        prop.enum = input.enum;
      }

      // Handle defaults
      if (input.default !== undefined) {
        prop.default = input.default;
      }

      // Handle numeric constraints
      if (input.min !== undefined) prop.minimum = input.min;
      if (input.max !== undefined) prop.maximum = input.max;

      properties[key] = prop;

      if (input.required) {
        required.push(key);
      }
    }
  }

  // Use human-readable name instead of hash-based toolId
  const mcpName = getHumanReadableName(tool);

  return {
    name: mcpName,
    description: buildToolDescription(tool),
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    },
    // Include toolId in metadata for debugging/reference
    _toolId: tool.toolId
  };
}

/**
 * Builds a comprehensive description for agents
 * @param {Object} tool - NOEMA ToolDefinition
 * @returns {string} Agent-friendly description
 */
function buildToolDescription(tool) {
  const parts = [tool.description];

  // Add category hint
  if (tool.category) {
    parts.push(`Category: ${tool.category}`);
  }

  // Add delivery mode hint
  if (tool.deliveryMode === 'async' || tool.deliveryMode === 'webhook') {
    parts.push('Note: This tool runs asynchronously. Poll /api/v1/generation/status/{id} for results.');
  }

  // Add base model hint for LoRA compatibility
  if (tool.metadata?.baseModel) {
    parts.push(`Base model: ${tool.metadata.baseModel} (use LoRAs compatible with this checkpoint)`);
  }

  // Add cost hint
  if (tool.costingModel) {
    if (tool.costingModel.rateSource === 'static' && tool.metadata?.costTable) {
      parts.push('Pricing: Variable based on model/size/quality selection');
    } else if (tool.costingModel.rate) {
      parts.push(`Pricing: ${tool.costingModel.rate} credits per ${tool.costingModel.unit}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Filters tools for MCP exposure
 * @param {Array} tools - Array of NOEMA ToolDefinitions
 * @returns {Array} Filtered tools suitable for MCP
 */
function filterToolsForMcp(tools) {
  return tools.filter(tool => {
    // Exclude internal and hidden tools
    if (tool.visibility === 'internal' || tool.visibility === 'hidden') {
      return false;
    }
    // Must have a toolId
    if (!tool.toolId) {
      return false;
    }
    return true;
  });
}

/**
 * Transforms all NOEMA tools to MCP format
 * @param {Array} tools - Array of NOEMA ToolDefinitions
 * @returns {Array} Array of MCP tool definitions
 */
function transformAllTools(tools) {
  const filtered = filterToolsForMcp(tools);
  return filtered.map(transformToolToMcp);
}

module.exports = {
  transformToolToMcp,
  transformAllTools,
  filterToolsForMcp,
  mapTypeToJsonSchema
};
