const express = require('express');
const { ToolRegistry } = require('../../core/tools/ToolRegistry'); // Adjust path as needed
const { createLogger } = require('../../utils/logger'); // Adjust path as needed
// const { authenticateInternalKey } = require('../middleware/authMiddleware'); // Assuming a middleware for internal auth
// const { validateObjectId } = require('../middleware/validationMiddleware'); // Assuming validation middleware

const logger = createLogger('ToolDefinitionApi');

/**
 * Creates an Express router for tool definition related internal API endpoints.
 * @param {object} services - An object containing required services, e.g., { toolRegistry }.
 * @returns {express.Router}
 */
function createToolDefinitionApiRouter(services) {
  const router = express.Router();
  const toolRegistry = services.toolRegistry || ToolRegistry.getInstance();

  // Middleware for all routes in this router if needed (e.g. specific auth)
  // router.use(authenticateInternalKey); // Example: ensure only internal services can call

  /**
   * GET /internal/v1/data/tools
   * Returns a list of all available tools.
   */
  router.get('/', (req, res) => {
    logger.info('[ToolDefinitionApi] GET / - Request received to list all tools');
    try {
      const allTools = toolRegistry.getAllTools();
      // We are now returning the full tool object for the documentation page.
      res.status(200).json(allTools);
    } catch (error) {
      logger.error(`[ToolDefinitionApi] GET / - Error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred while listing tools.',
        },
      });
    }
  });

  /**
   * GET /internal/v1/data/tools/:toolId
   * Returns the definition for a specific tool.
   */
  router.get('/:toolId', (req, res) => {
    const { toolId } = req.params;
    logger.info(`[ToolDefinitionApi] GET /${toolId} - Request received`);

    try {
      const tool = toolRegistry.getToolById(toolId);

      if (!tool) {
        logger.warn(`[ToolDefinitionApi] GET /${toolId} - Tool not found`);
        return res.status(404).json({
          error: {
            code: 'TOOL_NOT_FOUND',
            message: `Tool with ID '${toolId}' not found.`,
          },
        });
      }

      // Return the full tool object
      res.status(200).json(tool);
    } catch (error) {
      logger.error(`[ToolDefinitionApi] GET /${toolId} - Error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred while retrieving the tool definition.',
        },
      });
    }
  });

  /**
   * GET /internal/v1/data/tools/:toolId/input-schema
   * Returns the inputSchema for a specific tool.
   */
  router.get(
    '/:toolId/input-schema',
    // validateObjectId('toolId', 'params'), // Optional: if toolId is an ObjectId, not a string like 'fluxgeneral'
    (req, res) => {
      const { toolId } = req.params;
      logger.info(`[ToolDefinitionApi] GET /${toolId}/input-schema - Request received`);

      try {
        const tool = toolRegistry.getToolById(toolId);

        if (!tool) {
          logger.warn(`[ToolDefinitionApi] GET /${toolId}/input-schema - Tool not found`);
          return res.status(404).json({
            error: {
              code: 'TOOL_NOT_FOUND',
              message: `Tool with ID '${toolId}' not found.`,
            },
          });
        }

        if (!tool.inputSchema) {
          logger.warn(`[ToolDefinitionApi] GET /${toolId}/input-schema - Input schema not found for tool`);
          return res.status(404).json({
            error: {
              code: 'INPUT_SCHEMA_NOT_FOUND',
              message: `Input schema not found for tool with ID '${toolId}'.`,
            },
          });
        }

        logger.info(`[ToolDefinitionApi] GET /${toolId}/input-schema - Returning input schema`);
        res.status(200).json(tool.inputSchema);

      } catch (error) {
        logger.error(`[ToolDefinitionApi] GET /${toolId}/input-schema - Error: ${error.message}`, error);
        res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred while retrieving the tool input schema.',
          },
        });
      }
    }
  );

  logger.info('[ToolDefinitionApi] Tool Definition API routes initialized.');
  return router;
}

module.exports = { createToolDefinitionApiRouter }; 