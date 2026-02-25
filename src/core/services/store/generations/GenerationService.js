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
