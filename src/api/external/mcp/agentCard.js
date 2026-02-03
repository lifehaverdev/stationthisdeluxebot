/**
 * ERC-8004 Agent Card Generator
 *
 * Dynamically generates the agent-card.json for ERC-8004 registry.
 * Returns live tool counts, LoRA counts, and service endpoints.
 */

const express = require('express');
const { filterToolsForMcp } = require('./toolTransformer');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('AgentCard');

// ERC-8004 registration details
const ERC8004_CONFIG = {
  agentId: 22883,
  agentRegistry: 'eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // Ethereum mainnet
};

/**
 * Creates the agent card router
 * @param {Object} dependencies - Router dependencies
 * @returns {express.Router}
 */
function createAgentCardRouter(dependencies) {
  const { toolRegistry, internalApiClient } = dependencies;
  const router = express.Router();

  /**
   * GET /.well-known/agent-card.json
   * Returns the ERC-8004 agent registration file
   */
  router.get('/', async (req, res) => {
    try {
      // Get live tool data
      const { tools, categories } = getToolData(toolRegistry);
      const loraCount = await getLoraCount(internalApiClient);

      const agentCard = {
        // Required ERC-8004 fields
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: 'NOEMA',
        description: buildDescription(tools.length, loraCount),
        image: 'https://noema.art/images/noema-logo.png',
        active: true,

        // Services array - what capabilities we offer
        services: [
          {
            name: 'web',
            endpoint: 'https://noema.art'
          },
          {
            name: 'MCP',
            endpoint: 'https://noema.art/api/v1/mcp',
            version: '2025-11-25'
          },
          {
            name: 'x402',
            endpoint: 'https://noema.art/api/v1/x402/generate',
            version: '1.0'
          }
        ],

        // Payment support
        x402Support: true,

        // On-chain registrations
        registrations: ERC8004_CONFIG.agentId ? [{
          agentId: ERC8004_CONFIG.agentId,
          agentRegistry: ERC8004_CONFIG.agentRegistry
        }] : [],

        // Trust mechanisms we support
        supportedTrust: ['reputation'],

        // Extended metadata (not part of core spec, but useful for agents)
        metadata: {
          generatedAt: new Date().toISOString(),
          toolCount: tools.length,
          loraCount,
          categories,
          tools: tools.map(t => ({
            id: t.toolId,
            name: t.displayName,
            category: t.category
          })),

          // Platform capabilities
          capabilities: {
            generation: 'Single image/video generation with LoRA style triggers',
            spells: 'Reusable multi-step workflows - discover, cast, or author your own',
            collections: 'Batch generation with review, curation, and export',
            training: 'Train custom LoRA models for characters, styles, concepts'
          },

          // MCP protocol methods
          mcpMethods: {
            discovery: ['tools/list', 'resources/list', 'resources/read', 'prompts/list', 'spells/list', 'spells/get'],
            execution: ['tools/call', 'spells/cast', 'spells/create', 'spells/status'],
            collections: ['collections/list', 'collections/get', 'collections/create', 'collections/update', 'collections/delete', 'collections/cook/start', 'collections/cook/pause', 'collections/cook/resume', 'collections/cook/stop', 'collections/review', 'collections/export'],
            training: ['trainings/list', 'trainings/get', 'trainings/create', 'trainings/calculate-cost', 'trainings/delete', 'trainings/retry']
          },

          pricing: {
            model: 'credits',
            x402: 'USDC on Base',
            documentation: 'https://noema.art/pricing',
            x402Endpoint: 'https://noema.art/api/v1/x402/generate'
          },
          documentation: {
            api: 'https://noema.art/docs',
            tools: 'https://noema.art/api/v1/tools/registry',
            loras: 'https://noema.art/api/v1/loras/list',
            spells: 'https://noema.art/api/v1/spells/public'
          },
          skills: {
            claude: 'https://noema.art/.well-known/ai-skill.md',
            openai: 'https://noema.art/.well-known/openai-skill.md',
            openapi: 'https://noema.art/.well-known/openapi.json',
            plugin: 'https://noema.art/.well-known/ai-plugin.json'
          }
        }
      };

      // Cache for 5 minutes (counts don't change that often)
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Content-Type', 'application/json');
      res.json(agentCard);

      logger.info('[AgentCard] Served agent card', { toolCount: tools.length, loraCount });

    } catch (error) {
      logger.error('[AgentCard] Error generating agent card:', error);
      res.status(500).json({
        error: 'Failed to generate agent card',
        message: error.message
      });
    }
  });

  return router;
}

/**
 * Get live tool data from registry
 * @returns {{ tools: Array, categories: string[] }}
 */
function getToolData(toolRegistry) {
  if (!toolRegistry) return { tools: [], categories: [] };

  try {
    const allTools = toolRegistry.getAllTools();
    const publicTools = filterToolsForMcp(allTools);

    // Extract unique categories from live tools
    const categorySet = new Set();
    publicTools.forEach(tool => {
      if (tool.category) {
        categorySet.add(tool.category);
      }
    });

    return {
      tools: publicTools,
      categories: Array.from(categorySet).sort()
    };
  } catch (error) {
    logger.error('[AgentCard] Error getting tool data:', error);
    return { tools: [], categories: [] };
  }
}

/**
 * Get count of available LoRAs
 */
async function getLoraCount(internalApiClient) {
  if (!internalApiClient) return 0;

  try {
    const response = await internalApiClient.get('/internal/v1/data/loras/list', {
      params: { limit: 1, page: 1 }
    });
    return response.data.pagination?.totalLoras || 0;
  } catch (error) {
    logger.error('[AgentCard] Error counting LoRAs:', error);
    return 0;
  }
}

/**
 * Build agent description with live stats
 */
function buildDescription(toolCount, loraCount) {
  const parts = [
    'NOEMA is an AI generation platform for autonomous agents.',
    `Offers ${toolCount} generation tools including DALL-E, FLUX, Stable Diffusion, and LTX Video.`,
    `${loraCount}+ LoRA models for style customization with trigger words.`,
    'Reusable Spell workflows for complex multi-step generation.',
    'Collections for batch generation with curation and export.',
    'Custom LoRA training to teach new characters and styles.',
    'Full MCP protocol support. Pay via x402 micropayments (USDC on Base) or prepaid credits.'
  ];
  return parts.join(' ');
}

/**
 * Update ERC-8004 registration config after on-chain registration
 * Call this after successfully registering on-chain
 */
function setAgentRegistration(agentId, agentRegistry) {
  ERC8004_CONFIG.agentId = agentId;
  if (agentRegistry) {
    ERC8004_CONFIG.agentRegistry = agentRegistry;
  }
  logger.info('[AgentCard] Registration config updated', { agentId, agentRegistry });
}

module.exports = {
  createAgentCardRouter,
  setAgentRegistration,
  ERC8004_CONFIG
};
