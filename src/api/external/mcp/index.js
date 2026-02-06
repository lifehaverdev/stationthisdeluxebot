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
      description: `NOEMA AI Generation Platform - ${publicTools.length} generation tools, LoRA model library, spell workflows, collection management, and LoRA training`,
      endpoints: {
        mcp: 'https://noema.art/api/v1/mcp',
        documentation: 'https://noema.art/docs',
        tools: 'https://noema.art/api/v1/tools/registry',
        loras: 'https://noema.art/api/v1/loras/list',
        spells: 'https://noema.art/api/v1/spells/marketplace',
        collections: 'https://noema.art/api/v1/collections',
        trainings: 'https://noema.art/api/v1/trainings'
      },
      methods: {
        discovery: ['tools/list', 'resources/list', 'resources/read', 'prompts/list', 'spells/list'],
        execution: ['tools/call', 'spells/cast', 'spells/status'],
        collections: ['collections/list', 'collections/get', 'collections/create', 'collections/update', 'collections/delete', 'collections/cook/start', 'collections/cook/pause', 'collections/cook/resume', 'collections/cook/stop', 'collections/export'],
        trainings: ['trainings/list', 'trainings/get', 'trainings/create', 'trainings/calculate-cost', 'trainings/delete', 'trainings/retry']
      },
      authentication: {
        required: 'Execution methods require X-API-Key header',
        discovery: 'Discovery methods (tools/list, spells/list, resources/list) are public'
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

    // Construct base URL from request for dynamic pollUrl generation
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'noema.art';
    const baseUrl = `${protocol}://${host}`;

    logger.info(`[MCP] ${method}`, { id, hasApiKey: !!apiKey });

    try {
      const result = await handleMethod(method, params, { apiKey, toolRegistry, internalApiClient, baseUrl });
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
  const { apiKey, toolRegistry, internalApiClient, baseUrl } = context;

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
      return await executeToolCall(params, apiKey, internalApiClient, baseUrl, toolRegistry);

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

    // ============================================
    // Spells (forwarded to external API)
    // ============================================
    case 'spells/list':
      // Use /spells/public path which maps to /internal/v1/data/spells/public
      return await forwardToApi('GET', '/api/v1/spells/public', params, null, internalApiClient);

    case 'spells/get':
      // Public spells don't require auth - use public endpoint
      // Accepts either 'slug' or 'spellId' parameter
      const spellSlug = params.slug || params.spellId;
      return await forwardToApi('GET', `/api/v1/spells/public/${spellSlug}`, null, apiKey, internalApiClient);

    case 'spells/cast':
      requireApiKey(apiKey);
      // Validate required parameters
      const spellIdentifier = params.slug || params.spellId;
      if (!spellIdentifier) {
        const err = new Error('Missing required parameter: slug or spellId');
        err.code = -32602;
        throw err;
      }
      // Resolve user from API key to get masterAccountId
      const userInfo = await resolveUserFromApiKey(apiKey, internalApiClient);
      // Transform params to match internal API expectations
      // Support both 'context' and 'parameters' for flexibility
      const castParams = {
        slug: spellIdentifier,
        context: {
          ...(params.context || params.parameters || {}),
          masterAccountId: userInfo.masterAccountId,
          platform: 'mcp'
        }
      };
      logger.info('[MCP] spells/cast', { slug: spellIdentifier, masterAccountId: userInfo.masterAccountId });
      return await forwardToApi('POST', '/api/v1/spells/cast', castParams, apiKey, internalApiClient);

    case 'spells/status':
      requireApiKey(apiKey);
      if (!params.castId) {
        const err = new Error('Missing required parameter: castId');
        err.code = -32602;
        throw err;
      }
      return await forwardToApi('GET', `/api/v1/spells/casts/${params.castId}`, null, apiKey, internalApiClient);

    case 'spells/create':
      requireApiKey(apiKey);
      // Resolve user to get creatorId
      const creatorInfo = await resolveUserFromApiKey(apiKey, internalApiClient);
      const createSpellParams = {
        name: params.name,
        description: params.description || '',
        creatorId: creatorInfo.masterAccountId,
        steps: params.steps || [],
        connections: params.connections || [],
        exposedInputs: params.exposedInputs || [],
        visibility: params.visibility || 'private',
        tags: params.tags || []
      };
      return await forwardToApi('POST', '/api/v1/spells', createSpellParams, apiKey, internalApiClient);

    // ============================================
    // Collections (forwarded to external API)
    // ============================================
    case 'collections/list':
      requireApiKey(apiKey);
      return await forwardToApi('GET', '/api/v1/collections', params, apiKey, internalApiClient);

    case 'collections/get':
      requireApiKey(apiKey);
      return await forwardToApi('GET', `/api/v1/collections/${params.id}`, null, apiKey, internalApiClient);

    case 'collections/create':
      requireApiKey(apiKey);
      // Resolve user to inject userId required by collections API
      const collectionUserInfo = await resolveUserFromApiKey(apiKey, internalApiClient);
      const collectionParams = {
        ...params,
        userId: collectionUserInfo.masterAccountId
      };
      return await forwardToApi('POST', '/api/v1/collections', collectionParams, apiKey, internalApiClient);

    case 'collections/update':
      requireApiKey(apiKey);
      return await forwardToApi('PUT', `/api/v1/collections/${params.id}`, params, apiKey, internalApiClient);

    case 'collections/delete':
      requireApiKey(apiKey);
      return await forwardToApi('DELETE', `/api/v1/collections/${params.id}`, null, apiKey, internalApiClient);

    case 'collections/cook/start':
      requireApiKey(apiKey);
      return await forwardToApi('POST', `/api/v1/collections/${params.id}/cook/start`, params, apiKey, internalApiClient);

    case 'collections/cook/pause':
      requireApiKey(apiKey);
      return await forwardToApi('POST', `/api/v1/collections/${params.id}/cook/pause`, null, apiKey, internalApiClient);

    case 'collections/cook/resume':
      requireApiKey(apiKey);
      return await forwardToApi('POST', `/api/v1/collections/${params.id}/cook/resume`, null, apiKey, internalApiClient);

    case 'collections/cook/stop':
      requireApiKey(apiKey);
      return await forwardToApi('POST', `/api/v1/collections/${params.id}/cook/stop`, null, apiKey, internalApiClient);

    case 'collections/review':
      requireApiKey(apiKey);
      return await forwardToApi('PUT', `/api/v1/collections/${params.collectionId}/pieces/${params.pieceId}/review`, params, apiKey, internalApiClient);

    case 'collections/export':
      requireApiKey(apiKey);
      return await forwardToApi('POST', `/api/v1/collections/${params.id}/export`, params, apiKey, internalApiClient);

    // ============================================
    // Trainings (forwarded to internal API with user resolution)
    // ============================================
    case 'trainings/list':
      requireApiKey(apiKey);
      // Resolve user to get owner ID for trainings list
      const trainingsUserInfo = await resolveUserFromApiKey(apiKey, internalApiClient);
      try {
        const trainingsResponse = await internalApiClient.get(
          `/internal/v1/data/trainings/owner/${encodeURIComponent(trainingsUserInfo.masterAccountId)}`
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ trainings: trainingsResponse.data }, null, 2)
          }]
        };
      } catch (error) {
        const msg = error.response?.data?.error?.message || error.message;
        logger.error('[MCP] trainings/list error:', msg);
        const err = new Error(msg);
        err.code = error.response?.status === 404 ? -32004 : -32603;
        throw err;
      }

    case 'trainings/get':
      requireApiKey(apiKey);
      try {
        const trainingResponse = await internalApiClient.get(
          `/internal/v1/data/trainings/${encodeURIComponent(params.id)}`
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(trainingResponse.data, null, 2)
          }]
        };
      } catch (error) {
        const msg = error.response?.data?.error?.message || error.message;
        logger.error('[MCP] trainings/get error:', msg);
        const err = new Error(msg);
        err.code = error.response?.status === 404 ? -32004 : -32603;
        throw err;
      }

    case 'trainings/create':
      requireApiKey(apiKey);
      return await forwardToApi('POST', '/api/v1/trainings', params, apiKey, internalApiClient);

    case 'trainings/calculate-cost':
      return await forwardToApi('POST', '/api/v1/trainings/calculate-cost', params, apiKey, internalApiClient);

    case 'trainings/delete':
      requireApiKey(apiKey);
      return await forwardToApi('DELETE', `/api/v1/trainings/${params.id}`, null, apiKey, internalApiClient);

    case 'trainings/retry':
      requireApiKey(apiKey);
      return await forwardToApi('POST', `/api/v1/trainings/${params.id}/retry`, null, apiKey, internalApiClient);

    default:
      const error = new Error(`Method not found: ${method}`);
      error.code = -32601;
      throw error;
  }
}

/**
 * Helper to require API key
 */
function requireApiKey(apiKey) {
  if (!apiKey) {
    const err = new Error('API key required. Include X-API-Key header.');
    err.code = -32001;
    throw err;
  }
}

/**
 * Resolve user info from API key
 */
async function resolveUserFromApiKey(apiKey, internalApiClient) {
  try {
    const response = await internalApiClient.post('/internal/v1/data/auth/validate-key', { apiKey });
    // Response contains { user: { masterAccountId, ... }, apiKey: { ... } }
    if (!response.data?.user?.masterAccountId) {
      throw new Error('User not found');
    }
    return {
      masterAccountId: response.data.user.masterAccountId.toString(),
      user: response.data.user
    };
  } catch (error) {
    logger.error('[MCP] Failed to resolve user from API key:', error.message);
    const err = new Error('Invalid API key or unable to resolve user.');
    err.code = -32001;
    throw err;
  }
}

/**
 * Forward MCP request to external API
 */
async function forwardToApi(method, path, params, apiKey, internalApiClient) {
  try {
    const headers = apiKey ? { 'X-Forwarded-API-Key': apiKey } : {};
    let response;

    // Convert external path to internal path
    const internalPath = path.replace('/api/v1/', '/internal/v1/data/');

    if (method === 'GET') {
      response = await internalApiClient.get(internalPath, { params, headers });
    } else if (method === 'POST') {
      response = await internalApiClient.post(internalPath, params || {}, { headers });
    } else if (method === 'PUT') {
      response = await internalApiClient.put(internalPath, params || {}, { headers });
    } else if (method === 'DELETE') {
      response = await internalApiClient.delete(internalPath, { headers });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.error?.message || error.response?.data?.message || error.message;

    // Map HTTP status to MCP error codes
    let code = -32603; // Internal error
    if (status === 401) code = -32001;
    if (status === 402) code = -32002;
    if (status === 404) code = -32004;
    if (status === 400) code = -32602;

    const err = new Error(msg);
    err.code = code;
    throw err;
  }
}

/**
 * Resolve a tool name to its toolId using the registry.
 * Uses the same lookup pattern as Telegram dynamic commands.
 * Priority: commandName > displayName > toolId
 *
 * @param {string} name - The tool name (e.g., "make", "/make", or raw toolId)
 * @param {Object} toolRegistry - The tool registry instance
 * @returns {string} The resolved toolId
 */
function resolveToolName(name, toolRegistry) {
  if (!name || !toolRegistry) return name;

  // 1. Try by commandName first (this is how tools are exposed in tools/list)
  const commandName = name.startsWith('/') ? name : `/${name}`;
  const byCommand = toolRegistry.findByCommand(commandName);
  if (byCommand) {
    logger.info(`[MCP] Resolved "${name}" to toolId "${byCommand.toolId}" via commandName "${byCommand.commandName}"`);
    return byCommand.toolId;
  }

  // 2. Try exact match by toolId (for clients using raw IDs)
  const exactMatch = toolRegistry.getToolById(name);
  if (exactMatch) {
    return name;
  }

  // 3. Try by displayName (case-insensitive)
  const allTools = toolRegistry.getAllTools();
  const lowerName = name.toLowerCase();
  const byDisplayName = allTools.find(t =>
    t.displayName && t.displayName.toLowerCase() === lowerName
  );
  if (byDisplayName) {
    logger.info(`[MCP] Resolved "${name}" to toolId "${byDisplayName.toolId}" via displayName "${byDisplayName.displayName}"`);
    return byDisplayName.toolId;
  }

  // No match found
  logger.warn(`[MCP] Could not resolve tool "${name}". Available commands: ${allTools.slice(0, 5).map(t => t.commandName || t.displayName).join(', ')}...`);
  return name;
}

/**
 * Execute a tool call
 */
async function executeToolCall(params, apiKey, internalApiClient, baseUrl, toolRegistry) {
  const { name, arguments: args } = params;

  try {
    // Resolve tool alias to actual toolId
    const resolvedToolId = resolveToolName(name, toolRegistry);
    logger.info(`[MCP] tools/call: name="${name}" resolved to toolId="${resolvedToolId}"`);

    // First resolve user from API key
    const userInfo = await resolveUserFromApiKey(apiKey, internalApiClient);

    // Execute via internal API with proper payload format
    const response = await internalApiClient.post(
      '/internal/v1/data/execute',
      {
        toolId: resolvedToolId,
        inputs: args || {},
        user: {
          masterAccountId: userInfo.masterAccountId,
          platform: 'mcp'
        }
      }
    );

    const result = response.data;
    const generationId = result.generationId || result._id;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          generationId,
          status: result.status || 'pending',
          pollUrl: `${baseUrl || 'https://noema.art'}/api/v1/generation/status/${generationId}`
        })
      }]
    };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    logger.error(`[MCP] executeToolCall error for ${name}:`, msg);
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
