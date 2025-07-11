const express = require('express');

/**
 * Creates an external-facing Express router for Spells.
 * This router proxies requests to the internal spells API, handling user authentication.
 * @param {Object} dependencies - Dependencies including internalApiClient and dualAuth middleware.
 * @returns {express.Router}
 */
function createSpellsApi(dependencies) {
    const router = express.Router();
    const { internalApiClient, logger, dualAuth } = dependencies;

    // --- PUBLIC: Marketplace/Discovery Endpoint ---
    router.get('/marketplace', async (req, res) => {
        try {
            const response = await internalApiClient.get('/internal/v1/data/spells/public');
            let publicSpells = response.data;
            publicSpells = publicSpells.map(spell => ({
                spellId: spell.spellId,
                name: spell.name,
                description: spell.description,
                uses: spell.uses || 0,
                author: spell.author || null,
                tags: spell.tags || [],
                createdAt: spell.createdAt,
            }));
            publicSpells.sort((a, b) => (b.uses || 0) - (a.uses || 0));
            res.status(200).json(publicSpells);
        } catch (error) {
            logger.error('Failed to fetch public spells for marketplace:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to fetch public spells.' } });
        }
    });

    // --- PROTECTED: All other spells endpoints ---
    router.use(dualAuth);

    // GET /spells - List user's spells
    router.get('/', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const response = await internalApiClient.get(`/internal/v1/data/spells?ownedBy=${user.userId}`);
            res.status(200).json(response.data);
        } catch (error) {
            logger.error('Failed to fetch user spells:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to fetch user spells.' } });
        }
    });

    // POST /spells - Create a new spell
    router.post('/', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const payload = { ...req.body, creatorId: user.userId, ownedBy: user.userId };
            const response = await internalApiClient.post('/internal/v1/data/spells', payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error('Failed to create spell:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to create spell.' } });
        }
    });

    // PUT /spells/:spellId - Update a spell
    router.put('/:spellId', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const { spellId } = req.params;
            const payload = { ...req.body, ownedBy: user.userId };
            const response = await internalApiClient.put(`/internal/v1/data/spells/${spellId}`, payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error('Failed to update spell:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to update spell.' } });
        }
    });

    // DELETE /spells/:spellId - Delete a spell
    router.delete('/:spellId', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const { spellId } = req.params;
            const response = await internalApiClient.delete(`/internal/v1/data/spells/${spellId}?ownedBy=${user.userId}`);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error('Failed to delete spell:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to delete spell.' } });
        }
    });

    // ... add other protected endpoints as needed ...

    return router;
}

module.exports = createSpellsApi; 