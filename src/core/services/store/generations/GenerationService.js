// src/core/services/store/generations/GenerationService.js

const GenerationOutputsDB = require('../../db/generationOutputsDb');
const { ObjectId } = require('../../db/BaseDB');
const { Decimal128 } = require('mongodb');
const notificationEvents = require('../../../events/notificationEvents');
const { createLogger } = require('../../../../utils/logger');

class GenerationService {
  constructor(db, logger) {
    this.db = db || new GenerationOutputsDB(createLogger('GenerationOutputsDB'));
    this.logger = logger || createLogger('GenerationService');
  }

  /**
   * Create a new generation record.
   * Mirrors the coercion logic from the internal generationOutputsApi POST handler.
   * @param {Object} params - All fields required by GenerationOutputsDB.createGenerationOutput
   * @returns {Promise<Object>} the created record with _id
   */
  async create(params) {
    const { masterAccountId, initiatingEventId, spellId, castId, cookId, ...rest } = params;
    const dataToCreate = {
      ...rest,
      masterAccountId: masterAccountId instanceof ObjectId ? masterAccountId : new ObjectId(masterAccountId),
      initiatingEventId: initiatingEventId instanceof ObjectId ? initiatingEventId : new ObjectId(initiatingEventId),
      ...(spellId && { spellId: spellId instanceof ObjectId ? spellId : new ObjectId(spellId) }),
      ...(castId && { castId: castId instanceof ObjectId ? castId : new ObjectId(castId) }),
      ...(cookId && { cookId: cookId instanceof ObjectId ? cookId : new ObjectId(cookId) }),
    };
    const created = await this.db.createGenerationOutput(dataToCreate);
    if (!created) throw new Error('Failed to create generation record');
    this.logger.debug(`[GenerationService] Created generation record ${created._id}`);
    return created;
  }

  /**
   * Fetch multiple generation records by an array of IDs.
   * Falls back to individual fetches if batch returns nothing (ObjectId mismatch safety).
   * @param {string[]|ObjectId[]} ids
   * @returns {Promise<Object[]>}
   */
  async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const oids = ids.map(id => (id instanceof ObjectId ? id : new ObjectId(id.toString())));
    try {
      const results = await this.db.findGenerations({ _id: { $in: oids } });
      if (results && results.length > 0) return results;
      // Fallback: fetch individually (ObjectId mismatch safety)
      const items = [];
      for (const oid of oids) {
        try {
          const one = await this.db.findGenerationById(oid);
          if (one) items.push(one);
        } catch (e) {
          this.logger.warn(`[GenerationService] findByIds: failed to fetch ${oid}: ${e.message}`);
        }
      }
      return items;
    } catch (err) {
      this.logger.warn(`[GenerationService] findByIds batch failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Find a generation by ComfyDeploy run_id stored in metadata.
   */
  async findByRunId(run_id) {
    const results = await this.db.findGenerations({ 'metadata.run_id': run_id });
    return results?.[0] || null;
  }

  /**
   * Find a generation by its MongoDB _id.
   * @param {string|ObjectId} id
   */
  async findById(id) {
    const oid = id instanceof ObjectId ? id : new ObjectId(id.toString());
    return this.db.findGenerationById(oid);
  }

  /**
   * Update a generation record.
   * Handles Decimal128 coercion for costUsd.
   * Emits 'generationUpdated' if the record just became terminal and is pending notification.
   *
   * @param {string|ObjectId} id
   * @param {object} data
   * @returns {Promise<object>} the updated record
   */
  async update(id, data) {
    const oid = id instanceof ObjectId ? id : new ObjectId(id.toString());
    const payload = { ...data };

    if (payload.costUsd !== undefined) {
      payload.costUsd = payload.costUsd === null
        ? Decimal128.fromString('0')
        : Decimal128.fromString(payload.costUsd.toString());
    }

    await this.db.updateGenerationOutput(oid, payload);

    const updated = await this.db.findGenerationById(oid);
    if (!updated) return null;

    this._maybeEmitUpdated(updated, payload.status);
    return updated;
  }

  /**
   * Mark a generation as completed with final outputs and cost.
   */
  async markCompleted(id, { outputs, costUsd, responseTimestamp, durationMs } = {}) {
    return this.update(id, {
      status: 'completed',
      responsePayload: outputs || null,
      responseTimestamp: responseTimestamp || new Date().toISOString(),
      costUsd: costUsd ?? null,
      ...(durationMs != null ? { durationMs } : {}),
    });
  }

  /**
   * Mark a generation as failed.
   */
  async markFailed(id, { reason, responseTimestamp } = {}) {
    return this.update(id, {
      status: 'failed',
      statusReason: reason || 'Unknown error',
      responseTimestamp: responseTimestamp || new Date().toISOString(),
    });
  }

  /**
   * Mark a generation as payment_failed (non-terminal for notifications).
   */
  async markPaymentFailed(id, reason) {
    const oid = id instanceof ObjectId ? id : new ObjectId(id.toString());
    await this.db.updateGenerationOutput(oid, {
      status: 'payment_failed',
      statusReason: reason || 'Spend failed post-generation.',
    });
  }

  /**
   * Record points accounting after a successful spend.
   * Does not emit events — this is a supplementary update.
   */
  async recordPointsAccounting(id, { pointsSpent, contributorRewardPoints, protocolNetPoints, rewardBreakdown }) {
    const oid = id instanceof ObjectId ? id : new ObjectId(id.toString());
    await this.db.updateGenerationOutput(oid, {
      pointsSpent,
      contributorRewardPoints,
      protocolNetPoints,
      rewardBreakdown,
    });
  }

  // ---

  _maybeEmitUpdated(record, newStatus) {
    const statusJustBecameTerminal = newStatus === 'completed' || newStatus === 'failed';
    if (!statusJustBecameTerminal) return;

    const isNotificationReady =
      record.deliveryStatus === 'pending' &&
      ['completed', 'failed'].includes(record.status) &&
      record.notificationPlatform !== 'none';

    if (!isNotificationReady) return;

    const isSpellStep = record.metadata?.isSpell || record.metadata?.spell;
    const toEmit = isSpellStep ? { ...record, deliveryStrategy: 'spell_step' } : record;
    notificationEvents.emit('generationUpdated', toEmit);
  }
}

// Singleton for production use — callers that can't receive injection import this
const defaultService = new GenerationService();

module.exports = { GenerationService, generationService: defaultService };
