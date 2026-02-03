/**
 * MCP API Router
 *
 * Implements MCP protocol over HTTP with JSON-RPC.
 * Handles both discovery (public) and execution (authenticated) endpoints.
 */

const express = require('express');
const { randomUUID } = require('crypto');
const { filterToolsForMcp, transformToolToMcp } = require('./toolTransformer');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('McpRouter');

/**
 * Creates the MCP API router
 * @param {Object} dependencies - Router dependencies
 * @returns {express.Router} Configured router
 */
function createMcpRouter(dependencies) {
  const { toolRegistry, internalApiClient } = dependencies;

  if (!toolRegistry) {
    logger.error('[MCP] toolRegistry dependency missing');
    return null;
  }

  if (!internalApiClient) {
    logger.error('[MCP] internalApiClient dependency missing');
    return null;
  }

  const router = express.Router();

  // Server info for initialization
  const serverInfo = {
    name: 'noema',
    version: '1.0.0',
    protocolVersion: '2025-11-25'
  };

  const serverCapabilities = {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false }
  };

  /**
   * GET /mcp - Server discovery info
   */
  router.get('/', (req, res) => {
    const allTools = toolRegistry.getAllTools();
    const publicTools = filterToolsForMcp(allTools);

    res.json({
      ...serverInfo,
      capabilities: serverCapabilities,
      description: `NOEMA AI Generation Platform - ${publicTools.length} generation tools, LoRA model library, prompt templates`,
      endpoints: {
        mcp: 'https://noema.art/api/v1/mcp',
        documentation: 'https://noema.art/docs',
        tools: 'https://noema.art/api/v1/tools/registry',
        loras: 'https://noema.art/api/v1/loras/list'
      },
      authentication: {
        required: 'Tool execution requires X-API-Key header',
        discovery: 'Tool and resource listing is public'
      }
    });
  });

  /**
   * POST /mcp - JSON-RPC endpoint
   */
  router.post('/', async (req, res) => {
    const message = req.body;

    if (!message || !message.jsonrpc || message.jsonrpc !== '2.0') {
      return res.json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request: Not a valid JSON-RPC 2.0 message' },
        id: message?.id || null
      });
    }

    const { method, params, id } = message;
    const apiKey = req.headers['x-api-key'];

    logger.info(`[MCP] ${method}`, { id, hasApiKey: !!apiKey });

    try {
      const result = await handleMethod(method, params, { apiKey, toolRegistry, internalApiClient });
      res.json({ jsonrpc: '2.0', result, id });
    } catch (error) {
      logger.error(`[MCP] Error in ${method}:`, error.message);
      res.json({
        jsonrpc: '2.0',
        error: {
          code: error.code || -32603,
          message: error.message || 'Internal error'
        },
        id
      });
    }
  });

  logger.info('[MCP] Router initialized');
  return router;
}

/**
 * Handle MCP JSON-RPC methods
 */
async function handleMethod(method, params, context) {
  const { apiKey, toolRegistry, internalApiClient } = context;

  switch (method) {
    // ============================================
    // Lifecycle
    // ============================================
    case 'initialize':
      return {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'noema', version: '1.0.0' },
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        }
      };

    case 'initialized':
      return {};

    case 'ping':
      return {};

    // ============================================
    // Tools
    // ============================================
    case 'tools/list':
      const allTools = toolRegistry.getAllTools();
      const publicTools = filterToolsForMcp(allTools);
      const mcpTools = publicTools.map(transformToolToMcp);
      return { tools: mcpTools };

    case 'tools/call':
      if (!apiKey) {
        const error = new Error('API key required. Include X-API-Key header.');
        error.code = -32001;
        throw error;
      }
      return await executeToolCall(params, apiKey, internalApiClient);

    // ============================================
    // Resources (LoRAs)
    // ============================================
    case 'resources/list':
      return await listResources(params, internalApiClient);

    case 'resources/read':
      return await readResource(params, internalApiClient);

    case 'resources/templates/list':
      return {
        resourceTemplates: [{
          uriTemplate: 'noema://lora/search?q={query}&checkpoint={checkpoint}',
          name: 'Search LoRAs',
          description: 'Search for LoRA models. Params: q (search query), checkpoint (FLUX|SDXL|SD1.5)',
          mimeType: 'application/json'
        }]
      };

    // ============================================
    // Prompts
    // ============================================
    case 'prompts/list':
      return {
        prompts: [
          {
            name: 'portrait',
            description: 'Generate a portrait image with recommended settings',
            arguments: [
              { name: 'subject', description: 'Who or what to portray', required: true },
              { name: 'style', description: 'Art style', required: false }
            ]
          },
          {
            name: 'landscape',
            description: 'Generate a landscape scene',
            arguments: [
              { name: 'scene', description: 'The scene to generate', required: true },
              { name: 'time', description: 'Time of day', required: false }
            ]
          },
          {
            name: 'style-transfer',
            description: 'Apply an artistic style using LoRAs',
            arguments: [
              { name: 'subject', description: 'What to generate', required: true },
              { name: 'style', description: 'Style to apply', required: true }
            ]
          }
        ]
      };

    case 'prompts/get':
      return getPrompt(params);

    default:
      const error = new Error(`Method not found: ${method}`);
      error.code = -32601;
      throw error;
  }
}

/**
 * Execute a tool call
 */
async function executeToolCall(params, apiKey, internalApiClient) {
  const { name, arguments: args } = params;

  try {
    const response = await internalApiClient.post(
      '/internal/v1/generation/cast',
      {
        toolId: name,
        parameters: args || {},
        deliveryMode: 'async'
      },
      {
        headers: { 'X-Forwarded-API-Key': apiKey }
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
          pollUrl: `https://noema.art/api/v1/generation/status/${result.generationId}`
        })
      }]
    };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
      isError: true
    };
  }
}

/**
 * List LoRA resources
 */
async function listResources(params, internalApiClient) {
  const cursor = params?.cursor;
  const limit = 50;
  const page = cursor ? Math.floor(parseInt(cursor, 10) / limit) + 1 : 1;

  try {
    const response = await internalApiClient.get('/internal/v1/data/loras/list', {
      params: { limit, page }
    });

    const loras = response.data.loras || [];
    const total = response.data.pagination?.totalLoras || loras.length;

    const resources = loras.map(lora => ({
      uri: `noema://lora/${lora.slug || lora.id}`,
      name: lora.name,
      description: `${lora.description || ''} | Triggers: ${(lora.triggerWords || []).join(', ')} | Checkpoint: ${lora.checkpoint}`,
      mimeType: 'application/json'
    }));

    const offset = (page - 1) * limit;
    const nextOffset = offset + loras.length;
    const nextCursor = nextOffset < total ? String(nextOffset) : undefined;

    return { resources, nextCursor };
  } catch (error) {
    logger.error('[MCP] resources/list error:', error.message);
    return { resources: [] };
  }
}

/**
 * Read a specific LoRA resource
 */
async function readResource(params, internalApiClient) {
  const { uri } = params;

  // Handle search URI
  if (uri.startsWith('noema://lora/search')) {
    const url = new URL(uri);
    const query = url.searchParams.get('q') || '';
    const checkpoint = url.searchParams.get('checkpoint') || '';

    const response = await internalApiClient.get('/internal/v1/data/loras/list', {
      params: { q: query, checkpoint: checkpoint || undefined, limit: 20 }
    });

    const loras = response.data.loras || [];

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          query,
          checkpoint: checkpoint || 'all',
          results: loras.map(l => ({
            name: l.name,
            slug: l.slug,
            triggerWords: l.triggerWords || [],
            checkpoint: l.checkpoint,
            defaultWeight: l.defaultWeight || 1.0
          }))
        }, null, 2)
      }]
    };
  }

  // Handle specific LoRA URI
  const match = uri.match(/^noema:\/\/lora\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const slug = match[1];
  const response = await internalApiClient.get(`/internal/v1/data/loras/${slug}`);
  const lora = response.data;

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        name: lora.name,
        slug: lora.slug,
        description: lora.description,
        triggerWords: lora.triggerWords || [],
        checkpoint: lora.checkpoint,
        defaultWeight: lora.defaultWeight || 1.0,
        tags: lora.tags || []
      }, null, 2)
    }]
  };
}

/**
 * Get a prompt template
 */
function getPrompt(params) {
  const { name, arguments: args } = params;

  const templates = {
    portrait: (a) => {
      const style = a?.style ? `${a.style} style, ` : '';
      const prompt = `${style}portrait of ${a?.subject || 'subject'}, detailed face, professional lighting, sharp focus`;
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: `Generate with prompt:\n\n${prompt}\n\nRecommended: flux-dev or sdxl-base` }
        }]
      };
    },
    landscape: (a) => {
      const parts = [a?.scene || 'landscape'];
      if (a?.time) parts.push(`${a.time} lighting`);
      parts.push('detailed, atmospheric, wide shot');
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: `Generate with prompt:\n\n${parts.join(', ')}\n\nRecommended: flux-dev or dall-e-3` }
        }]
      };
    },
    'style-transfer': (a) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `To apply "${a?.style}" to "${a?.subject}":\n1. Search LoRAs: noema://lora/search?q=${encodeURIComponent(a?.style || '')}\n2. Use trigger word in prompt with compatible tool`
        }
      }]
    })
  };

  const template = templates[name];
  if (!template) {
    const error = new Error(`Unknown prompt: ${name}`);
    error.code = -32602;
    throw error;
  }

  return template(args || {});
}

module.exports = { createMcpRouter };
