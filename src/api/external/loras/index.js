const express = require('express');
const { createLogger } = require('../../../utils/logger');

/**
 * Creates the external LoRAs API router.
 * Uses LoraService directly instead of proxying to the internal API.
 *
 * @param {Object} dependencies - Router dependencies
 * @returns {express.Router} Configured router
 */
function createLorasApi(dependencies) {
    const router = express.Router();
    const { loraService } = dependencies;
    const logger = createLogger('LorasApi-External');

    if (!loraService) {
        logger.error('[LorasApi-External] loraService dependency missing');
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
            const { checkpoint, q, filterType, sort, limit, page, category, tag } = req.query;
            logger.debug('[LorasApi-External] GET /list', { params: req.query });

            const result = await loraService.listLoras({ checkpoint, q, filterType, sort, limit, page, category, tag });
            res.json(result);
        } catch (error) {
            logger.error('[LorasApi-External] /list error:', error.message);
            const status = error.statusCode || 500;
            res.status(status).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch LoRAs.' } });
        }
    });

    /**
     * @route GET /api/v1/loras/categories
     * @description Get distinct LoRA categories
     * @access Public
     */
    router.get('/categories', async (req, res) => {
        try {
            logger.debug('[LorasApi-External] GET /categories');
            const categories = await loraService.getCategories();
            res.json({ categories });
        } catch (error) {
            logger.error('[LorasApi-External] /categories error:', error.message);
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
            const { userId, isAdmin } = req.query;
            logger.debug('[LorasApi-External] GET /:loraIdentifier', { loraIdentifier });

            const lora = await loraService.getById(loraIdentifier, { userId, isAdmin: isAdmin === 'true' });
            if (!lora) {
                return res.status(404).json({ error: 'LoRA not found.' });
            }
            res.json({ lora });
        } catch (error) {
            logger.error('[LorasApi-External] /:loraIdentifier error:', error.message);
            const status = error.statusCode || 500;
            res.status(status).json({ error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to fetch LoRA.' } });
        }
    });

    logger.info('[LorasApi-External] Router initialized');
    return router;
}

module.exports = createLorasApi;
