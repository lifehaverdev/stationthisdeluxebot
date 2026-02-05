const express = require('express');
const { createLogger } = require('../../../utils/logger');

// External Generation Execution API
function createGenerationExecutionApi(dependencies) {
    const { logger, internalApiClient } = dependencies;
    const router = express.Router();

    /**
     * Shared handler for generation execution
     * Used by both /execute and /cast routes
     */
    async function executeGenerationHandler(req, res) {
        try {
            // The user is injected by auth middleware
            const user = req.user;
            if (!user || (!user.masterAccountId && !user.userId)) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User context missing or invalid.' } });
            }

            // Support both 'inputs' and 'parameters' for backward compatibility with docs
            const { toolId, inputs, parameters, sessionId, eventId, metadata } = req.body;
            const finalInputs = inputs || parameters || {};

            // If toolId starts with 'spell:', treat it as a spell execution
            if (toolId && toolId.startsWith('spell:')) {
                logger.info(`[ExternalGenerationExecutionApi] Detected spell execution for: ${toolId}`);

                const spellSlug = toolId.substring('spell:'.length);
                const spellPayload = {
                    slug: spellSlug,
                    context: {
                        masterAccountId: user.masterAccountId || user.userId,
                        platform: 'web-sandbox',
                        parameterOverrides: finalInputs,
                    }
                };

                const internalResponse = await internalApiClient.post('/internal/v1/data/spells/cast', spellPayload);
                return res.status(internalResponse.status).json(internalResponse.data);
            }

            // Ensure browser-originated requests are tagged with the correct platform for notifications
            const userForPayload = {
                ...user,
                platform: user.platform || 'web-sandbox',
                masterAccountId: user.masterAccountId || user.userId
            };
            const payload = { toolId, inputs: finalInputs, user: userForPayload, sessionId, eventId, metadata };

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
    }

    // POST /execute - Primary endpoint
    router.post('/execute', executeGenerationHandler);

    // POST /cast - Alias for /execute (matches documentation)
    router.post('/cast', executeGenerationHandler);

    // GET /status/:generationId - Check generation status
    router.get('/status/:generationId', async (req, res) => {
        try {
            const { generationId } = req.params;
            const response = await internalApiClient.get(`/internal/v1/data/generations/${generationId}`);

            // Transform to documented response format
            const gen = response.data;
            const result = {
                generationId: gen._id,
                status: gen.status,
                progress: gen.status === 'completed' ? 100 : (gen.status === 'processing' ? 50 : 0),
            };

            // Add result data if completed
            if (gen.status === 'completed' && gen.responsePayload) {
                result.result = {};
                // Extract image/video URLs from responsePayload
                if (Array.isArray(gen.responsePayload)) {
                    for (const output of gen.responsePayload) {
                        if (output.data?.images?.[0]?.url) {
                            result.result.image = output.data.images[0].url;
                        }
                        if (output.data?.video?.url) {
                            result.result.video = output.data.video.url;
                        }
                    }
                }
            }

            // Add error if failed
            if (gen.status === 'failed' && gen.metadata?.error) {
                result.error = gen.metadata.error.message || 'Generation failed';
            }

            // Add cost info if available
            if (gen.costUsd || gen.pointsSpent) {
                result.cost = {
                    amount: gen.costUsd || 0,
                    pointsDeducted: gen.pointsSpent || 0
                };
            }

            // Add duration if available
            if (gen.durationMs) {
                result.duration = gen.durationMs;
            }

            return res.json(result);
        } catch (error) {
            logger.error('[ExternalGenerationExecutionApi] Status error:', error.message);
            if (error.response?.status === 404) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Generation not found.' } });
            }
            return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get generation status.' } });
        }
    });

    return router;
}

module.exports = createGenerationExecutionApi; 