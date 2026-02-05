const express = require('express');
const { createLogger } = require('../../../utils/logger');

/**
 * Creates the external LoRAs API router.
 * Proxies public LoRA discovery endpoints to the internal API.
 *
 * @param {Object} dependencies - Router dependencies
 * @returns {express.Router} Configured router
 */
function createLorasApi(dependencies) {
    const router = express.Router();
    const { internalApiClient } = dependencies;
    const logger = createLogger('LorasApi-External');

    if (!internalApiClient) {
        logger.error('[LorasApi-External] internalApiClient dependency missing');
        return router;
    }

    /**
     * @route GET /api/v1/loras/list
     * @description List and search LoRA models. Supports filtering by checkpoint, search query, etc.
     * @access Public
     * @query {string} [checkpoint] - Filter by base model (FLUX, SDXL, SD1.5, All)
     * @query {string} [q] - Search query (searches name, slug, triggerWords, description, tags)
     * @query {string} [filterType] - Filter type: popular, recent, type_category
     * @query {number} [limit=20] - Number of results to return
     * @query {number} [page=1] - Page number for pagination
     */
    router.get('/list', async (req, res) => {
        try {
            const { checkpoint, q, filterType, limit, page, category, tag } = req.query;

            const params = {};
            if (checkpoint) params.checkpoint = checkpoint;
            if (q) params.q = q;
            if (filterType) params.filterType = filterType;
            if (limit) params.limit = limit;
            if (page) params.page = page;
            if (category) params.category = category;
            if (tag) params.tag = tag;

            logger.info('[LorasApi-External] GET /list', { params });

            const response = await internalApiClient.get('/internal/v1/data/loras/list', { params });
            res.json(response.data);
        } catch (error) {
            logger.error('[LorasApi-External] /list error:', error.message);
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch LoRAs.' } });
        }
    });

    /**
     * @route GET /api/v1/loras/categories
     * @description Get distinct LoRA categories
     * @access Public
     */
    router.get('/categories', async (req, res) => {
        try {
            logger.info('[LorasApi-External] GET /categories');
            const response = await internalApiClient.get('/internal/v1/data/loras/categories');
            res.json(response.data);
        } catch (error) {
            logger.error('[LorasApi-External] /categories error:', error.message);
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch categories.' } });
        }
    });

    /**
     * @route GET /api/v1/loras/:loraIdentifier
     * @description Get detailed info for a specific LoRA by slug or ID
     * @access Public
     */
    router.get('/:loraIdentifier', async (req, res) => {
        try {
            const { loraIdentifier } = req.params;
            logger.info('[LorasApi-External] GET /:loraIdentifier', { loraIdentifier });

            const response = await internalApiClient.get(`/internal/v1/data/loras/${encodeURIComponent(loraIdentifier)}`);
            res.json(response.data);
        } catch (error) {
            logger.error('[LorasApi-External] /:loraIdentifier error:', error.message);
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch LoRA.' } });
        }
    });

    logger.info('[LorasApi-External] Router initialized');
    return router;
}

module.exports = createLorasApi;
