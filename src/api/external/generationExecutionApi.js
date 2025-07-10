const express = require('express');

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

            // Forward the request to the internal API, injecting the user
            const { toolId, inputs, sessionId, eventId, metadata } = req.body;
            // Always use masterAccountId if present, else userId
            const userForPayload = { ...user, masterAccountId: user.masterAccountId || user.userId };
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