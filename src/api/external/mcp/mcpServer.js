/**
 * MCP Server for NOEMA
 *
 * Implements the Model Context Protocol server exposing:
 * - Tools: AI generation tools from ToolRegistry
 * - Resources: LoRA models for style customization
 * - Prompts: Preset generation templates
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { transformAllTools, filterToolsForMcp } = require('./toolTransformer');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('McpServer');

/**
 * Creates and configures the MCP server instance
 * @param {Object} dependencies - Server dependencies
 * @returns {McpServer} Configured MCP server
 */
function createMcpServer(dependencies) {
  const { toolRegistry, internalApiClient } = dependencies;

  const server = new McpServer({
    name: 'noema',
    version: '1.0.0'
  });

  // ============================================
  // TOOLS - AI Generation Capabilities
  // ============================================

  // Register each tool from the registry
  if (toolRegistry) {
    const allTools = toolRegistry.getAllTools();
    const publicTools = filterToolsForMcp(allTools);

    for (const tool of publicTools) {
      registerToolWithMcp(server, tool, internalApiClient);
    }

    logger.info(`[MCP] Registered ${publicTools.length} tools`);
  }

  // ============================================
  // RESOURCES - LoRA Models
  // ============================================

  // Register LoRA search resource template
  server.resource(
    'lora-search',
    'noema://lora/search',
    {
      description: 'Search for LoRA models by name, style, or concept',
      mimeType: 'application/json'
    },
    async (uri) => {
      // Parse search params from URI
      const url = new URL(uri, 'noema://');
      const query = url.searchParams.get('q') || '';
      const checkpoint = url.searchParams.get('checkpoint') || '';

      try {
        const response = await internalApiClient.get('/internal/v1/data/loras', {
          params: {
            q: query,
            checkpoint: checkpoint || undefined,
            limit: 20,
            includeHidden: false
          }
        });

        const loras = response.data.loras || response.data || [];

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              query,
              checkpoint: checkpoint || 'all',
              results: loras.map(lora => ({
                name: lora.name,
                slug: lora.slug,
                triggerWords: lora.triggerWords || [],
                checkpoint: lora.checkpoint,
                description: lora.description,
                defaultWeight: lora.defaultWeight || 1.0
              })),
              total: response.data.total || loras.length
            }, null, 2)
          }]
        };
      } catch (error) {
        logger.error('[MCP] LoRA search error:', error);
        throw error;
      }
    }
  );

  // ============================================
  // PROMPTS - Generation Templates
  // ============================================

  // Portrait generation prompt
  server.prompt(
    'portrait',
    {
      description: 'Generate a portrait image with recommended settings',
      arguments: [
        { name: 'subject', description: 'Who or what to portray', required: true },
        { name: 'style', description: 'Art style (photorealistic, anime, oil painting, etc.)', required: false }
      ]
    },
    async ({ subject, style }) => {
      const stylePrefix = style ? `${style} style, ` : '';
      const prompt = `${stylePrefix}portrait of ${subject}, detailed face, professional lighting, sharp focus, high quality`;

      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Generate a portrait with this prompt:\n\n${prompt}\n\nRecommended tools: flux-dev, sdxl-base (if using LoRAs)`
          }
        }]
      };
    }
  );

  // Landscape generation prompt
  server.prompt(
    'landscape',
    {
      description: 'Generate a landscape scene',
      arguments: [
        { name: 'scene', description: 'The scene to generate', required: true },
        { name: 'time', description: 'Time of day (dawn, noon, dusk, night)', required: false },
        { name: 'weather', description: 'Weather conditions', required: false }
      ]
    },
    async ({ scene, time, weather }) => {
      const parts = [scene];
      if (time) parts.push(`${time} lighting`);
      if (weather) parts.push(weather);
      parts.push('detailed, atmospheric, high quality, wide shot');

      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Generate a landscape with this prompt:\n\n${parts.join(', ')}\n\nRecommended tools: flux-dev, dall-e-3`
          }
        }]
      };
    }
  );

  // Style transfer prompt
  server.prompt(
    'style-transfer',
    {
      description: 'Apply an artistic style to a concept',
      arguments: [
        { name: 'subject', description: 'What to generate', required: true },
        { name: 'style', description: 'Artistic style to apply', required: true }
      ]
    },
    async ({ subject, style }) => {
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `To apply "${style}" style to "${subject}":\n\n1. Search for LoRAs: Use resource noema://lora/search?q=${encodeURIComponent(style)}\n2. Find a matching LoRA and note its trigger words\n3. Use a tool compatible with that LoRA's checkpoint\n4. Include the trigger word in your prompt: "${subject}, [TRIGGER_WORD]"`
          }
        }]
      };
    }
  );

  return server;
}

/**
 * Register a single tool with the MCP server
 */
function registerToolWithMcp(server, tool, internalApiClient) {
  // Build Zod schema from tool's inputSchema
  const schemaShape = {};

  if (tool.inputSchema) {
    for (const [key, input] of Object.entries(tool.inputSchema)) {
      let fieldSchema;

      // Map types to Zod schemas
      switch (input.type) {
        case 'string':
        case 'text':
        case 'textany':
        case 'image':
        case 'video':
        case 'audio':
        case 'file':
        case 'checkpoint':
          fieldSchema = z.string();
          break;
        case 'number':
        case 'numberslider':
          fieldSchema = z.number();
          if (input.min !== undefined) fieldSchema = fieldSchema.min(input.min);
          if (input.max !== undefined) fieldSchema = fieldSchema.max(input.max);
          break;
        case 'integer':
        case 'numbersliderint':
        case 'seed':
          fieldSchema = z.number().int();
          if (input.min !== undefined) fieldSchema = fieldSchema.min(input.min);
          if (input.max !== undefined) fieldSchema = fieldSchema.max(input.max);
          break;
        case 'boolean':
          fieldSchema = z.boolean();
          break;
        case 'enum':
          if (input.enum && input.enum.length > 0) {
            fieldSchema = z.enum(input.enum);
          } else {
            fieldSchema = z.string();
          }
          break;
        default:
          fieldSchema = z.string();
      }

      // Add description
      if (input.description) {
        fieldSchema = fieldSchema.describe(input.description);
      }

      // Make optional if not required
      if (!input.required) {
        fieldSchema = fieldSchema.optional();
      }

      schemaShape[key] = fieldSchema;
    }
  }

  // Build tool description
  const description = buildToolDescription(tool);

  // Register the tool
  server.tool(
    tool.toolId,
    description,
    { parameters: z.object(schemaShape) },
    async (args, context) => {
      logger.info(`[MCP] Tool call: ${tool.toolId}`, { args: Object.keys(args || {}) });

      // Check for API key in context
      const apiKey = context?.apiKey;
      if (!apiKey) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'UNAUTHORIZED',
              message: 'API key required. Include X-API-Key header in your MCP request.'
            })
          }],
          isError: true
        };
      }

      try {
        // Execute via internal API
        const response = await internalApiClient.post(
          '/internal/v1/generation/cast',
          {
            toolId: tool.toolId,
            parameters: args,
            deliveryMode: 'async'
          },
          {
            headers: {
              'X-Forwarded-API-Key': apiKey
            }
          }
        );

        const result = response.data;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              generationId: result.generationId,
              status: result.status || 'pending',
              message: 'Generation started. Poll for results.',
              pollUrl: `https://noema.art/api/v1/generation/status/${result.generationId}`
            })
          }]
        };
      } catch (error) {
        logger.error(`[MCP] Tool execution error for ${tool.toolId}:`, error.message);

        const errorResponse = error.response?.data || { message: error.message };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: errorResponse.error?.code || 'EXECUTION_ERROR',
              message: errorResponse.error?.message || error.message
            })
          }],
          isError: true
        };
      }
    }
  );
}

/**
 * Builds a comprehensive description for agents
 */
function buildToolDescription(tool) {
  const parts = [tool.description || `Tool: ${tool.displayName}`];

  if (tool.category) {
    parts.push(`Category: ${tool.category}`);
  }

  if (tool.deliveryMode === 'async' || tool.deliveryMode === 'webhook') {
    parts.push('Async: Poll /api/v1/generation/status/{id} for results.');
  }

  if (tool.metadata?.baseModel) {
    parts.push(`Base model: ${tool.metadata.baseModel}`);
  }

  return parts.join(' | ');
}

module.exports = { createMcpServer };
