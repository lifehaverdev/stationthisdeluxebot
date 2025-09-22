const express = require('express');
const { createLogger } = require('../../../utils/logger');

// External Generation Execution API
function createGenerationExecutionApi(dependencies) {
    const { logger, internalApiClient } = dependencies;
    const router = express.Router();

    // POST /execute - Proxy to internal generation execution, inject user from API key auth
    router.post('/execute', async (req, res) => {
        try {
            // The user is injected by apiKeyAuth middleware
            const user = req.user;
            if (!user || (!user.masterAccountId && !user.userId)) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User context missing or invalid.' } });
            }

            const { toolId, inputs, sessionId, eventId, metadata } = req.body;
            
            // If toolId starts with 'spell:', treat it as a spell execution
            if (toolId && toolId.startsWith('spell:')) {
                // This block is a placeholder for a more robust implementation.
                // Ideally, this logic lives in a service, not the API route handler.
                // For now, we'll put a simple version here.
                logger.info(`[ExternalGenerationExecutionApi] Detected spell execution for: ${toolId}`);
                
                // This is a simplified proxy. The SpellsService is not directly available here.
                // We will need to create a new internal endpoint to handle this.
                // Let's create `/internal/v1/spells/cast`
                
                const spellSlug = toolId.substring('spell:'.length);
                const spellPayload = {
                    slug: spellSlug,
                    context: {
                        masterAccountId: user.masterAccountId || user.userId,
                        platform: 'web-sandbox',
                        parameterOverrides: inputs,
                        // Pass other relevant context if available
                    }
                };

                // Updated path to match internal API routing (/internal/v1/data/spells/cast)
                const internalResponse = await internalApiClient.post('/internal/v1/data/spells/cast', spellPayload);
                return res.status(internalResponse.status).json(internalResponse.data);
            }

            // Always use masterAccountId if present, else userId
            // Ensure browser-originated requests are tagged with the correct platform for notifications
            const userForPayload = {
                ...user,
                platform: user.platform || 'web-sandbox',
                masterAccountId: user.masterAccountId || user.userId
            };
            const payload = { toolId, inputs, user: userForPayload, sessionId, eventId, metadata };

            // Proxy to internal endpoint
            const internalResponse = await internalApiClient.post('/internal/v1/data/execute', payload);
            return res.status(internalResponse.status).json(internalResponse.data);
        } catch (error) {
            logger.error('[ExternalGenerationExecutionApi] Proxy error:', error.message, error.response?.data);
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to execute generation.' } });
        }
    });

    return router;
}

module.exports = createGenerationExecutionApi; 