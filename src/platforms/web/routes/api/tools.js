const express = require('express');
const router = express.Router();

// This function receives all the services, including the internal API client
const createToolsApiRoutes = (services) => {
  const internalApiClient = services.internal.client;

  /**
   * @swagger
   * /api/v1/tools:
   *   get:
   *     summary: Get a list of all available public tools
   *     description: Fetches the list of all registered tools from the internal registry and returns a simplified version for public display.
   *     responses:
   *       200:
   *         description: A list of tools.
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   displayName:
   *                     type: string
   *                   description:
   *                     type: string
   */
  router.get('/', async (req, res, next) => {
    try {
      // Use the internal API client to call the internal registry endpoint
      const response = await internalApiClient.get('/internal/registry/tools');
      const allTools = response.data;

      // We only want to expose a clean, simple list for the frontend
      const simplifiedTools = allTools.map(tool => ({
        displayName: tool.displayName,
        description: tool.description?.split('\\n')[0] || `A tool for ${tool.displayName}.`
      }));

      res.status(200).json(simplifiedTools);
    } catch (error) {
      services.logger.error('[Tools API] Failed to fetch tools from internal registry:', error);
      // Pass the error to the Express error handler
      next(error);
    }
  });

  return router;
};

module.exports = createToolsApiRoutes; 