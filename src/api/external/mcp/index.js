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
const {
  createX402ExecutionService,
  X402PricingService,
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
  NETWORKS
} = require('../../../core/services/x402');
const { encodePaymentRequiredHeader } = require('@x402/core/http');

const logger = createLogger('McpRouter');

/**
 * Creates the MCP API router
 * @param {Object} dependencies - Router dependencies
 * @returns {express.Router} Configured router
 */
function createMcpRouter(dependencies) {
  const {
    toolRegistry, internalApiClient, loraService, trainingService,
    x402PaymentLogDb, receiverAddress, network: x402Network
  } = dependencies;

  if (!toolRegistry) {
    logger.error('[MCP] toolRegistry dependency missing');
    return null;
  }

  if (!internalApiClient) {
    logger.error('[MCP] internalApiClient dependency missing');
    return null;
  }

  const router = express.Router();

  // Initialize x402 services if configured
  const x402Enabled = !!(receiverAddress && x402Network);
  let x402ExecutionService = null;
  let x402PricingService = null;
  let usdcAddress = null;

  if (x402Enabled) {
    x402ExecutionService = createX402ExecutionService({ x402PaymentLogDb });
    x402PricingService = new X402PricingService({ toolRegistry });
    usdcAddress = x402Network === NETWORKS.BASE_SEPOLIA
      ? BASE_SEPOLIA_USDC_ADDRESS
      : BASE_USDC_ADDRESS;
    logger.info('[MCP] x402 payment support enabled', { network: x402Network });
  }

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

    logger.info(`[MCP] ${method}`, { id, hasApiKey: !!apiKey, hasX402: !!req.x402?.verified });

    try {
      const result = await handleMethod(method, params, {
        apiKey, toolRegistry, internalApiClient, loraService, baseUrl,
        x402: req.x402, x402ExecutionService, x402PricingService,
        x402Enabled, receiverAddress, x402Network, usdcAddress
      });
      res.json({ jsonrpc: '2.0', result, id });
    } catch (error) {
      logger.error(`[MCP] Error in ${method}:`, error.message);
      const errorResponse = {
        code: error.code || -32603,
        message: error.message || 'Internal error'
      };
      // Include payment data for -32002 (payment required) errors
      if (error.data) {
        errorResponse.data = error.data;
      }
      res.json({ jsonrpc: '2.0', error: errorResponse, id });
    }
  });

  logger.info('[MCP] Router initialized');
  return router;
}

/**
 * Handle MCP JSON-RPC methods
 */
async function handleMethod(method, params, context) {
  const {
    apiKey, toolRegistry, internalApiClient, loraService, baseUrl,
    x402, x402ExecutionService, x402PricingService,
    x402Enabled, receiverAddress, x402Network, usdcAddress
  } = context;

  switch (method) {
    // ============================================
    // Lifecycle
    // ============================================
    case 'initialize': {
      logger.info('[MCP] 🤖 Agent connected', {
        clientInfo: params?.clientInfo?.name || 'unknown',
        protocolVersion: params?.protocolVersion || 'unknown',
        x402Enabled
      });
      const initResult = {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'noema', version: '1.0.0' },
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        },
        authentication: {
          methods: ['x-api-key'],
          discovery: 'Discovery methods (tools/list, spells/list, resources/list) are public'
        }
      };
      if (x402Enabled) {
        initResult.authentication.methods.push('x402');
        initResult.authentication.x402 = {
          network: x402Network,
          asset: usdcAddress,
          protocol: 'x402v2'
        };
      }
      return initResult;
    }

    case 'initialized':
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
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

    case 'tools/call': {
      // Tri-path auth: API key > x402 payment > payment required
      if (apiKey) {
        return await executeToolCall(params, apiKey, internalApiClient, baseUrl, toolRegistry);
      }
      if (x402 && x402.verified && x402ExecutionService) {
        return await executeToolCallX402(params, x402, {
          x402ExecutionService, x402PricingService, internalApiClient, baseUrl, toolRegistry
        });
      }
      if (x402Enabled && x402PricingService) {
        throw buildPaymentRequiredError(params, x402PricingService, {
          receiverAddress, x402Network, usdcAddress, baseUrl, toolRegistry
        });
      }
      const noAuthErr = new Error('Authentication required. Include X-API-Key header or X-PAYMENT header for x402.');
      noAuthErr.code = -32001;
      throw noAuthErr;
    }

    // ============================================
    // Resources (LoRAs)
    // ============================================
    case 'resources/list':
      return await listResources(params, loraService);

    case 'resources/read':
      return await readResource(params, loraService);

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

    case 'spells/cast': {
      // Validate required parameters
      const spellIdentifier = params.slug || params.spellId;
      if (!spellIdentifier) {
        const err = new Error('Missing required parameter: slug or spellId');
        err.code = -32602;
        throw err;
      }

      // Tri-path auth: API key > x402 payment > payment required
      if (apiKey) {
        const userInfo = await resolveUserFromApiKey(apiKey, internalApiClient);
        const castParams = {
          slug: spellIdentifier,
          context: {
            ...(params.context || params.parameters || {}),
            masterAccountId: userInfo.masterAccountId,
            platform: 'mcp'
          }
        };
        logger.info('[MCP] spells/cast (apiKey)', { slug: spellIdentifier, masterAccountId: userInfo.masterAccountId });
        return await forwardToApi('POST', '/api/v1/spells/cast', castParams, apiKey, internalApiClient);
      }
      if (x402 && x402.verified && x402ExecutionService) {
        return await executeSpellCastX402(params, spellIdentifier, x402, {
          x402ExecutionService, x402PricingService, internalApiClient, baseUrl
        });
      }
      if (x402Enabled && x402PricingService) {
        // Use a generic spell cost for the payment required response
        throw buildPaymentRequiredError(
          { name: `spell:${spellIdentifier}` }, x402PricingService,
          { receiverAddress, x402Network, usdcAddress, baseUrl, toolRegistry }
        );
      }
      const noAuthErr = new Error('Authentication required. Include X-API-Key header or X-PAYMENT header for x402.');
      noAuthErr.code = -32001;
      throw noAuthErr;
    }

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
    case 'trainings/list': {
      requireApiKey(apiKey);
      // Resolve user to get owner ID for trainings list
      const trainingsUserInfo = await resolveUserFromApiKey(apiKey, internalApiClient);
      try {
        const trainings = trainingService
          ? await trainingService.listByOwner(trainingsUserInfo.masterAccountId)
          : [];
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ trainings }, null, 2)
          }]
        };
      } catch (error) {
        const msg = error.message;
        logger.error('[MCP] trainings/list error:', msg);
        const err = new Error(msg);
        err.code = error.status === 404 ? -32004 : -32603;
        throw err;
      }
    }

    case 'trainings/get': {
      requireApiKey(apiKey);
      try {
        const training = trainingService
          ? await trainingService.getById(params.id)
          : null;
        if (!training) {
          const err = new Error('Training not found.');
          err.code = -32004;
          throw err;
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(training, null, 2)
          }]
        };
      } catch (error) {
        const msg = error.message;
        logger.error('[MCP] trainings/get error:', msg);
        const err = new Error(msg);
        err.code = error.status === 404 || error.code === -32004 ? -32004 : -32603;
        throw err;
      }
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
async function listResources(params, loraService) {
  const cursor = params?.cursor;
  const limit = 50;
  const page = cursor ? Math.floor(parseInt(cursor, 10) / limit) + 1 : 1;

  try {
    if (!loraService) return { resources: [] };
    const result = await loraService.listLoras({ limit, page });

    const loras = result.loras || [];
    const total = result.pagination?.totalLoras || loras.length;

    const resources = loras.map(lora => ({
      uri: `noema://lora/${lora.slug || lora._id}`,
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
async function readResource(params, loraService) {
  const { uri } = params;

  if (!loraService) throw new Error('loraService unavailable');

  // Handle search URI
  if (uri.startsWith('noema://lora/search')) {
    const url = new URL(uri);
    const query = url.searchParams.get('q') || '';
    const checkpoint = url.searchParams.get('checkpoint') || '';

    const result = await loraService.listLoras({ q: query || undefined, checkpoint: checkpoint || undefined, limit: 20 });
    const loras = result.loras || [];

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
  const lora = await loraService.getById(slug);
  if (!lora) throw new Error(`LoRA not found: ${slug}`);

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

/**
 * Execute a tool call via x402 payment (no account required)
 */
async function executeToolCallX402(params, x402, services) {
  const { x402ExecutionService, x402PricingService, internalApiClient, baseUrl, toolRegistry } = services;
  const { name, arguments: args } = params;

  const resolvedToolId = resolveToolName(name, toolRegistry);
  logger.info(`[MCP x402] 💰 Tool call with payment: "${name}" → toolId="${resolvedToolId}"`, {
    payer: x402.payer,
    paymentAmount: x402.amount
  });

  // Calculate cost
  let quote;
  try {
    quote = x402PricingService.calculateToolCost(resolvedToolId, args || {});
    logger.info(`[MCP x402] Quoted $${quote.totalCostUsd} for ${resolvedToolId}`, {
      baseCostUsd: quote.baseCostUsd, markupUsd: quote.markupUsd
    });
  } catch (error) {
    logger.error('[MCP x402] Pricing error', { error: error.message, toolId: resolvedToolId });
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to calculate cost' }) }], isError: true };
  }

  // Validate payment covers cost
  const validation = await x402ExecutionService.validatePaymentForExecution(x402, quote.totalCostUsd);
  if (!validation.valid) {
    logger.warn(`[MCP x402] Payment validation failed`, { errorCode: validation.errorCode, required: validation.requiredUsd, provided: validation.providedUsd });
    const err = new Error(
      validation.errorCode === 'INSUFFICIENT_PAYMENT'
        ? `Payment of $${validation.providedUsd} is less than required $${validation.requiredUsd}`
        : validation.error || 'Payment validation failed'
    );
    err.code = -32002;
    throw err;
  }

  // Record payment as verified
  let signatureHash;
  try {
    const record = await x402ExecutionService.recordPaymentVerified(x402, {
      toolId: resolvedToolId,
      costUsd: quote.totalCostUsd
    });
    signatureHash = record.signatureHash;
  } catch (error) {
    logger.error('[MCP x402] Failed to record payment', { error: error.message });
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to record payment' }) }], isError: true };
  }

  // Execute via internal API with synthetic user
  let executionResult;
  try {
    const response = await internalApiClient.post('/internal/v1/data/execute', {
      toolId: resolvedToolId,
      inputs: args || {},
      user: {
        masterAccountId: `x402:${x402.payer}`,
        platform: 'x402',
        isX402: true,
        payerAddress: x402.payer
      },
      metadata: {
        x402: true,
        payer: x402.payer,
        signatureHash
      }
    });
    executionResult = response.data;
  } catch (error) {
    // Execution failed - don't settle
    logger.error('[MCP x402] Execution failed', { error: error.message, toolId: resolvedToolId });
    if (x402ExecutionService.x402PaymentLogDb) {
      await x402ExecutionService.x402PaymentLogDb.recordFailed(signatureHash, `Execution failed: ${error.message}`);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Generation failed. Payment was not charged.', details: error.response?.data || error.message }) }],
      isError: true
    };
  }

  // Execution succeeded - settle payment
  logger.info('[MCP x402] ✅ Tool executed, settling payment', { signatureHash, toolId: resolvedToolId, payer: x402.payer });
  const settlement = await x402ExecutionService.settlePayment(x402, signatureHash);

  const generationId = executionResult.generationId || executionResult._id;

  if (settlement.success) {
    logger.info(`[MCP x402] 💸 Payment settled! $${quote.totalCostUsd} USDC from ${x402.payer}`, {
      transaction: settlement.transaction, network: settlement.network, toolId: resolvedToolId, generationId
    });
  } else {
    logger.error(`[MCP x402] ⚠️ Settlement failed after successful execution`, {
      error: settlement.error, signatureHash, toolId: resolvedToolId, payer: x402.payer
    });
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        generationId,
        status: executionResult.status || 'pending',
        pollUrl: `${baseUrl || 'https://noema.art'}/api/v1/generation/status/${generationId}`,
        x402: {
          settled: settlement.success,
          transaction: settlement.transaction,
          network: settlement.network,
          payer: x402.payer,
          costUsd: quote.totalCostUsd,
          ...(settlement.error && { settlementError: settlement.error })
        }
      })
    }]
  };
}

/**
 * Execute a spell cast via x402 payment (no account required)
 */
async function executeSpellCastX402(params, spellIdentifier, x402, services) {
  const { x402ExecutionService, x402PricingService, internalApiClient, baseUrl } = services;

  // Calculate cost (use generic spell pricing)
  let quote;
  try {
    quote = x402PricingService.calculateToolCost(`spell:${spellIdentifier}`, params.context || params.parameters || {});
  } catch {
    // Fallback to minimum charge if spell-specific pricing not available
    quote = { totalCostUsd: 0.01, baseCostUsd: 0.01, markupUsd: 0 };
  }

  // Validate payment covers cost
  const validation = await x402ExecutionService.validatePaymentForExecution(x402, quote.totalCostUsd);
  if (!validation.valid) {
    const err = new Error(
      validation.errorCode === 'INSUFFICIENT_PAYMENT'
        ? `Payment of $${validation.providedUsd} is less than required $${validation.requiredUsd}`
        : validation.error || 'Payment validation failed'
    );
    err.code = -32002;
    throw err;
  }

  // Record payment
  let signatureHash;
  try {
    const record = await x402ExecutionService.recordPaymentVerified(x402, {
      toolId: `spell:${spellIdentifier}`,
      costUsd: quote.totalCostUsd
    });
    signatureHash = record.signatureHash;
  } catch (error) {
    logger.error('[MCP x402] Failed to record spell payment', { error: error.message });
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to record payment' }) }], isError: true };
  }

  // Execute spell with synthetic x402 user
  let castResult;
  try {
    const castParams = {
      slug: spellIdentifier,
      context: {
        ...(params.context || params.parameters || {}),
        masterAccountId: `x402:${x402.payer}`,
        platform: 'x402',
        isX402: true,
        payerAddress: x402.payer
      }
    };
    logger.info(`[MCP x402] 💰 Spell cast with payment: "${spellIdentifier}"`, {
      payer: x402.payer, costUsd: quote.totalCostUsd
    });

    const internalPath = '/internal/v1/data/spells/cast';
    const response = await internalApiClient.post(internalPath, castParams);
    castResult = response.data;
  } catch (error) {
    logger.error('[MCP x402] Spell cast failed', { error: error.message, slug: spellIdentifier });
    if (x402ExecutionService.x402PaymentLogDb) {
      await x402ExecutionService.x402PaymentLogDb.recordFailed(signatureHash, `Spell cast failed: ${error.message}`);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Spell cast failed. Payment was not charged.', details: error.response?.data || error.message }) }],
      isError: true
    };
  }

  // Settle payment
  logger.info('[MCP x402] ✅ Spell cast succeeded, settling payment', { signatureHash, slug: spellIdentifier, payer: x402.payer });
  const settlement = await x402ExecutionService.settlePayment(x402, signatureHash);

  if (settlement.success) {
    logger.info(`[MCP x402] 💸 Spell payment settled! $${quote.totalCostUsd} USDC from ${x402.payer}`, {
      transaction: settlement.transaction, network: settlement.network, slug: spellIdentifier
    });
  } else {
    logger.error(`[MCP x402] ⚠️ Spell settlement failed after successful cast`, {
      error: settlement.error, signatureHash, slug: spellIdentifier, payer: x402.payer
    });
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...castResult,
        x402: {
          settled: settlement.success,
          transaction: settlement.transaction,
          network: settlement.network,
          payer: x402.payer,
          costUsd: quote.totalCostUsd,
          ...(settlement.error && { settlementError: settlement.error })
        }
      }, null, 2)
    }]
  };
}

/**
 * Build a -32002 error with embedded PaymentRequired data
 */
function buildPaymentRequiredError(params, pricingService, config) {
  const { receiverAddress, x402Network, usdcAddress, baseUrl, toolRegistry } = config;
  const toolName = params.name || 'unknown';

  let paymentRequired;
  try {
    const resolvedToolId = toolName.startsWith('spell:')
      ? toolName
      : (toolRegistry ? resolveToolName(toolName, toolRegistry) : toolName);
    paymentRequired = pricingService.generatePaymentRequired(resolvedToolId, params.arguments || {}, {
      receiverAddress,
      network: x402Network,
      usdcAddress,
      resourceUrl: `${baseUrl || 'https://noema.art'}/api/v1/mcp`
    });
  } catch {
    // Fallback if tool not found in pricing - return generic payment info
    const { MINIMUM_CHARGE_USD } = require('../../../core/services/x402/X402PricingService');
    const minAmountAtomic = String(Math.ceil(MINIMUM_CHARGE_USD * 1e6));
    paymentRequired = {
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: x402Network,
        asset: usdcAddress,
        amount: minAmountAtomic,
        payTo: receiverAddress,
        maxTimeoutSeconds: 300,
        extra: {}
      }]
    };
  }

  const headerValue = encodePaymentRequiredHeader(paymentRequired);

  logger.info(`[MCP x402] 🔒 Payment required for "${toolName}"`, {
    amount: paymentRequired.accepts?.[0]?.amount,
    network: x402Network,
    payTo: receiverAddress
  });

  const err = new Error('Payment required. Include X-PAYMENT header with x402 payment.');
  err.code = -32002;
  err.data = {
    paymentRequired,
    paymentRequiredHeader: headerValue
  };
  return err;
}

module.exports = { createMcpRouter };
