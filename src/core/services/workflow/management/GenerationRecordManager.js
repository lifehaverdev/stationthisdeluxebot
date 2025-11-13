/**
 * GenerationRecordManager - Manages generation record CRUD operations
 * 
 * Handles creation, updates, and retrieval of generation records.
 */

const { retryWithBackoff } = require('../utils/RetryHandler');

class GenerationRecordManager {
    constructor({ logger, internalApiClient }) {
        this.logger = logger;
        this.internalApiClient = internalApiClient;
    }

    /**
     * Creates a new generation record
     * @param {Object} generationParams - Generation record parameters
     * @returns {Promise<{generationId: string}>} - Generation ID from the API response
     */
    async createGenerationRecord(generationParams) {
        const genResponse = await this.internalApiClient.post('/internal/v1/data/generations', generationParams);
        const generationId = genResponse.data._id;
        this.logger.info(`[GenerationRecordManager] Created generation record ${generationId}`);
        return { generationId };
    }

    /**
     * Updates an existing generation record
     * @param {string} generationId - Generation ID
     * @param {Object} updatePayload - Fields to update
     * @returns {Promise<void>}
     */
    async updateGenerationRecord(generationId, updatePayload) {
        await this.internalApiClient.put(`/internal/v1/data/generations/${generationId}`, updatePayload);
        this.logger.info(`[GenerationRecordManager] Updated generation ${generationId}`);
    }

    /**
     * Gets a generation record by ID
     * @param {string} generationId - Generation ID
     * @returns {Promise<Object>} - Generation record
     */
    async getGenerationRecord(generationId) {
        const genResponse = await this.internalApiClient.get(`/internal/v1/data/generations/${generationId}`);
        return genResponse.data;
    }

    /**
     * Gets multiple generation records by IDs
     * @param {string[]} generationIds - Array of generation IDs
     * @returns {Promise<Object[]>} - Array of generation records
     */
    async getGenerationRecords(generationIds) {
        if (!generationIds || generationIds.length === 0) {
            return [];
        }

        try {
            const queryString = generationIds.map(id => `_id_in=${id}`).join('&');
            const genRes = await this.internalApiClient.get(`/internal/v1/data/generations?${queryString}`);
            let stepGens = genRes.data.generations || [];
            
            if (stepGens.length === 0) {
                // Possibly ObjectId mismatch; fetch each individually
                stepGens = [];
                for (const gid of generationIds) {
                    try {
                        const one = await this.getGenerationRecord(gid);
                        if (one) stepGens.push(one);
                    } catch (e) {
                        this.logger.warn(`[GenerationRecordManager] Failed to fetch generation ${gid} individually: ${e.message}`);
                    }
                }
            }
            
            return stepGens;
        } catch (err) {
            this.logger.warn(`[GenerationRecordManager] Failed to fetch generation records:`, err.message);
            return [];
        }
    }
}

module.exports = GenerationRecordManager;

