const express = require('express');

/**
 * Creates an external-facing Express router for Spells.
 * This router proxies requests to the internal spells API, handling user authentication.
 * @param {Object} dependencies - Dependencies including internalApiClient.
 * @returns {express.Router}
 */
function createSpellsApi(dependencies) {
    const router = express.Router();
    const { internalApiClient, logger } = dependencies;

    // Middleware to extract masterAccountId and add it to the request for downstream use.
    const getMasterAccountId = (req, res, next) => {
        // The authenticateUserOrApiKey middleware should place user info on req.user
        if (!req.user || !req.user.masterAccountId) {
            logger.warn('[spellsApiExternal] User or masterAccountId not found on request object.');
            return res.status(401).json({ error: 'Authentication details not found.' });
        }
        req.masterAccountId = req.user.masterAccountId;
        next();
    };
    
    // Use this middleware for all routes in this router
    router.use(getMasterAccountId);

    // GET /spells - Get public spells or spells owned by the logged-in user
    router.get('/', async (req, res, next) => {
        try {
            // Forward query params (like `public=true` or `search=...`) to the internal API.
            // Add `ownedBy` if the user is requesting their own spells.
            const queryParams = { ...req.query };
            if (!queryParams.public) {
                queryParams.ownedBy = req.masterAccountId;
            }

            const response = await internalApiClient.get('/internal/v1/data/spells', { params: queryParams });
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    // GET /spells/:identifier - Get a single spell by slug or ID
    router.get('/:identifier', async (req, res, next) => {
        try {
            const { identifier } = req.params;
            const response = await internalApiClient.get(`/internal/v1/data/spells/${identifier}`, {
                params: { masterAccountId: req.masterAccountId } // Pass for permission checks
            });
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    // POST /spells - Create a new spell
    router.post('/', async (req, res, next) => {
        try {
            const payload = {
                ...req.body,
                creatorId: req.masterAccountId // Ensure creatorId is the authenticated user
            };
            const response = await internalApiClient.post('/internal/v1/data/spells', payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            next(error);
        }
    });

    // PUT /spells/:spellId - Update a spell
    router.put('/:spellId', async (req, res, next) => {
        try {
            const { spellId } = req.params;
            const payload = {
                ...req.body,
                masterAccountId: req.masterAccountId // For ownership verification
            };
            const response = await internalApiClient.put(`/internal/v1/data/spells/${spellId}`, payload);
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    // DELETE /spells/:spellId - Delete a spell
    router.delete('/:spellId', async (req, res, next) => {
        try {
            const { spellId } = req.params;
            // The internal API expects masterAccountId in the body for delete
            const payload = { masterAccountId: req.masterAccountId };
            const response = await internalApiClient.delete(`/internal/v1/data/spells/${spellId}`, { data: payload });
            res.status(response.status).send();
        } catch (error) {
            next(error);
        }
    });
    
    // POST /spells/:spellId/steps - Add a step
    router.post('/:spellId/steps', async (req, res, next) => {
        try {
            const { spellId } = req.params;
            const payload = { ...req.body, masterAccountId: req.masterAccountId };
            const response = await internalApiClient.post(`/internal/v1/data/spells/${spellId}/steps`, payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            next(error);
        }
    });

    // DELETE /spells/:spellId/steps/:stepId - Remove a step
    router.delete('/:spellId/steps/:stepId', async (req, res, next) => {
        try {
            const { spellId, stepId } = req.params;
            const payload = { masterAccountId: req.masterAccountId };
            const response = await internalApiClient.delete(`/internal/v1/data/spells/${spellId}/steps/${stepId}`, { data: payload });
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    // PUT /spells/:spellId/steps/:stepId/parameters - Update step parameters
    router.put('/:spellId/steps/:stepId/parameters', async (req, res, next) => {
        try {
            const { spellId, stepId } = req.params;
            const payload = { ...req.body, masterAccountId: req.masterAccountId };
            const response = await internalApiClient.put(`/internal/v1/data/spells/${spellId}/steps/${stepId}/parameters`, payload);
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });
    
    // Placeholder for import/copy
    router.post('/import', async (req, res, next) => {
        // TODO: Implement the internal logic for importing/copying a spell first
        res.status(501).json({ message: 'Not implemented' });
    });

    return router;
}

module.exports = createSpellsApi; 