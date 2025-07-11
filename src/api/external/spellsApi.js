const express = require('express');

/**
 * Initializes the external-facing Spells API routes.
 * This API is the public gateway for the web client to interact with spells.
 * It ensures that all requests are authenticated and authorized before forwarding
 * them to the internal data services.
 * @param {object} dependencies - Services and utilities.
 * @returns {express.Router}
 */
module.exports = function spellsApi(dependencies) {
    const { logger, internalApiClient } = dependencies;

    if (!internalApiClient) {
        logger.error('[external-spellsApi] Critical dependency failure: internalApiClient is missing!');
        // Return a router that always responds with a service unavailable error
        const router = express.Router();
        router.use((req, res) => {
            res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal API client is not available.' } });
        });
        return router;
    }

    const router = express.Router();

    // GET /spells - Get public spells or the user's owned spells
    router.get('/', async (req, res) => {
        // req.user is populated by authentication middleware
        if (!req.user || !req.user.masterAccountId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        const { masterAccountId } = req.user;
        const { public: fetchPublic } = req.query;

        try {
            let response;
            if (fetchPublic === 'true') {
                // Fetching for the marketplace
                logger.info(`[external-spellsApi] Fetching public spells for marketplace view.`);
                response = await internalApiClient.get('/internal/v1/data/spells');
            } else {
                // Fetching the user's owned spells
                logger.info(`[external-spellsApi] Fetching spells for owner: ${masterAccountId}`);
                response = await internalApiClient.get(`/internal/v1/data/spells`, { params: { ownedBy: masterAccountId } });
            }
            
            res.status(response.status).json(response.data);
        } catch (error) {
            const status = error.response?.status || 500;
            const message = error.response?.data?.error || 'An error occurred while fetching spells.';
            logger.error(`[external-spellsApi] GET /: Error fetching spells: ${error.message}`, error);
            res.status(status).json({ error: message });
        }
    });
    
    // GET /spells/:spellIdentifier - Get a single spell by slug or ID
    router.get('/:spellIdentifier', async (req, res) => {
        if (!req.user || !req.user.masterAccountId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        
        const { masterAccountId } = req.user;
        const { spellIdentifier } = req.params;
        
        try {
            // Pass the user's ID for permission checks in the internal API
            const response = await internalApiClient.get(`/internal/v1/data/spells/${spellIdentifier}`, {
                params: { masterAccountId }
            });
            res.status(response.status).json(response.data);
        } catch (error) {
            const status = error.response?.status || 500;
            const message = error.response?.data?.error || 'An error occurred while fetching the spell.';
            logger.error(`[external-spellsApi] GET /${spellIdentifier}: Error fetching spell: ${error.message}`, error);
            res.status(status).json({ error: message });
        }
    });

    // We will implement POST, PUT, DELETE later.

    logger.info('[external-spellsApi] External Spells API routes initialized.');
    return router;
}; 