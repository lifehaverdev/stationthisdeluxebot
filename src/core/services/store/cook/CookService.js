/**
 * CookService
 *
 * In-process domain service for cook record operations.
 * Replaces internalApiClient calls to PUT /internal/v1/data/cook/cooks/:cookId.
 *
 * Mirrors the PUT /cooks/:cookId handler in cookApi.js.
 */

const CooksDB = require('../../db/cooksDb');
const { ObjectId } = require('mongodb');
const { createLogger } = require('../../../../utils/logger');

class CookService {
  constructor({ cooksDb, logger } = {}) {
    this.cooksDb = cooksDb || new CooksDB(createLogger('CooksDB'));
    this.logger = logger || createLogger('CookService');
  }

  /**
   * Update a cook record — mirrors PUT /internal/v1/data/cook/cooks/:cookId logic.
   *
   * @param {string} cookId
   * @param {object} options
   * @param {string} [options.generationId] - Generation to add to generationIds array
   * @param {number} [options.costDeltaUsd] - Cost increment to add to cumulative costUsd
   * @param {string} [options.status] - New status ('completed', 'paused', 'stopped', etc.)
   * @returns {Promise<void>}
   */
  async updateCook(cookId, { generationId, costDeltaUsd, status } = {}) {
    if (!cookId || !ObjectId.isValid(cookId)) {
      throw new Error(`[CookService] Invalid cookId: ${cookId}`);
    }

    const idFilter = { _id: new ObjectId(cookId) };
    const update = {};

    if (generationId) {
      const genIdObj = ObjectId.isValid(generationId) ? new ObjectId(generationId) : generationId;
      update.$push = { generationIds: genIdObj };
    }

    if (costDeltaUsd !== undefined && costDeltaUsd !== null && typeof costDeltaUsd === 'number') {
      update.$inc = { costUsd: costDeltaUsd, generatedCount: 1 };
    } else if (generationId) {
      // Increment count even when no cost provided
      update.$inc = { generatedCount: 1 };
    }

    if (status) {
      update.$set = { status, completedAt: status === 'completed' ? new Date() : undefined };
    }
    if (!update.$set) update.$set = {};
    update.$set.updatedAt = new Date();

    await this.cooksDb.updateOne(idFilter, update);
    this.logger.info(`[CookService] Updated cook ${cookId}: generationId=${generationId}, costDelta=${costDeltaUsd}, status=${status}`);
  }
}

const cookService = new CookService();

module.exports = { CookService, cookService };
