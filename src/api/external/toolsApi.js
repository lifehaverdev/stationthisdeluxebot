const express = require('express');
const internalApiClient = require('../../utils/internalApiClient');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('ExternalToolsApi');

/**
 * Creates a router for exposing tool registry functionalities to the external API.
 * It acts as a secure proxy to the internal tool definition API.
 *
 * @param {Object} dependencies - Dependencies passed from the parent initializer.
 * @returns {express.Router} - An Express router.
 */
function createToolsApiRouter(dependencies) {
  const router = express.Router();

  /**
   * GET /tools
   * Lists all available tools from the ToolRegistry.
   * This is the public-facing endpoint that returns simplified tool info.
   */
  router.get('/', async (req, res) => {
    try {
      // Get the full tool list from internal API
      const response = await internalApiClient.get('/internal/v1/data/tools');
      const allTools = response.data;

      // For the public endpoint, return simplified tool info
      const simplifiedTools = allTools.map(tool => ({
        displayName: tool.displayName,
        description: tool.description?.split('\\n')[0] || `A tool for ${tool.displayName}.`
      }));

      res.status(200).json(simplifiedTools);
    } catch (error) {
      logger.error('Failed to proxy request to list tools:', error);
      res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'The server was unable to process your request.' } });
    }
  });

  /**
   * GET /tools/:toolId
   * Gets the definition of a specific tool by its ID.
   * This is the public-facing endpoint that returns simplified tool info.
   */
  router.get('/:toolId', async (req, res) => {
    const { toolId } = req.params;
    try {
      const response = await internalApiClient.get(`/internal/v1/data/tools/${toolId}`);
      const tool = response.data;

      // For the public endpoint, return simplified tool info
      const simplifiedTool = {
        displayName: tool.displayName,
        description: tool.description?.split('\\n')[0] || `A tool for ${tool.displayName}.`
      };

      res.status(200).json(simplifiedTool);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Tool with ID '${toolId}' not found.` } });
      }
      logger.error(`Failed to proxy request for tool '${toolId}':`, error);
      res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'The server was unable to process your request.' } });
    }
  });

  /**
   * GET /tools/registry
   * Lists all tools with full registry information.
   * This is the internal endpoint that returns complete tool definitions.
   */
  router.get('/registry', async (req, res) => {
    try {
      const response = await internalApiClient.get('/internal/v1/data/tools');
      res.status(200).json(response.data);
    } catch (error) {
      logger.error('Failed to fetch full registry data:', error);
      res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'The server was unable to process your request.' } });
    }
  });

  /**
   * GET /tools/registry/:toolId
   * Gets the complete registry information for a specific tool.
   * This is the internal endpoint that returns the complete tool definition.
   */
  router.get('/registry/:toolId', async (req, res) => {
    const { toolId } = req.params;
    try {
      const response = await internalApiClient.get(`/internal/v1/data/tools/${toolId}`);
      res.status(200).json(response.data);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Tool with ID '${toolId}' not found.` } });
      }
      logger.error(`Failed to fetch registry data for tool '${toolId}':`, error);
      res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'The server was unable to process your request.' } });
    }
  });

  return router;
}

module.exports = { createToolsApiRouter }; 