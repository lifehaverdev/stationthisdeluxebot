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
      // Get live counts
      const toolCount = await getToolCount(toolRegistry);
      const loraCount = await getLoraCount(internalApiClient);

      const agentCard = {
        // Required ERC-8004 fields
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: 'NOEMA',
        description: buildDescription(toolCount, loraCount),
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
          }
          // Future: A2A endpoint
          // {
          //   name: 'A2A',
          //   endpoint: 'https://noema.art/api/v1/a2a',
          //   version: '1.0'
          // }
        ],

        // Payment support
        x402Support: process.env.X402_ENABLED === 'true',

        // On-chain registrations (populated after registration)
        registrations: ERC8004_CONFIG.agentId ? [{
          agentId: ERC8004_CONFIG.agentId,
          agentRegistry: ERC8004_CONFIG.agentRegistry
        }] : [],

        // Trust mechanisms we support
        supportedTrust: ['reputation'],

        // Extended metadata (not part of core spec, but useful)
        metadata: {
          generatedAt: new Date().toISOString(),
          toolCount,
          loraCount,
          categories: [
            'text-to-image',
            'image-to-image',
            'text-to-video',
            'image-to-video',
            'upscale',
            'image-to-text'
          ],
          pricing: {
            model: 'credits',
            documentation: 'https://noema.art/pricing',
            x402Endpoint: process.env.X402_ENABLED === 'true'
              ? 'https://noema.art/api/v1/x402/generate'
              : null
          },
          documentation: {
            api: 'https://noema.art/docs',
            tools: 'https://noema.art/api/v1/tools/registry',
            loras: 'https://noema.art/api/v1/loras/list'
          }
        }
      };

      // Cache for 5 minutes (counts don't change that often)
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Content-Type', 'application/json');
      res.json(agentCard);

      logger.info('[AgentCard] Served agent card', { toolCount, loraCount });

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
 * Get count of public tools
 */
async function getToolCount(toolRegistry) {
  if (!toolRegistry) return 0;

  try {
    const allTools = toolRegistry.getAllTools();
    const publicTools = filterToolsForMcp(allTools);
    return publicTools.length;
  } catch (error) {
    logger.error('[AgentCard] Error counting tools:', error);
    return 0;
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
    `${loraCount}+ LoRA models for style customization.`,
    'Supports MCP protocol for tool discovery and execution.',
    'Pay-per-request via x402 micropayments or prepaid credits.'
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
