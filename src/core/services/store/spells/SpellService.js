// src/core/services/store/spells/SpellService.js

const CastsDB = require('../../db/castsDb');
const SpellsDB = require('../../db/spellsDb');
const { ObjectId } = require('../../db/BaseDB');
const { createLogger } = require('../../../../utils/logger');

class SpellService {
  constructor({ castsDb, spellsDb, logger } = {}) {
    this.castsDb = castsDb || new CastsDB(createLogger('CastsDB'));
    this.spellsDb = spellsDb || new SpellsDB(createLogger('SpellsDB'));
    this.logger = logger || createLogger('SpellService');
  }

  _toOid(id) {
    if (!id) throw new Error('id is required');
    return id instanceof ObjectId ? id : new ObjectId(id.toString());
  }

  // ─── Cast management ────────────────────────────────────────────────────────

  /**
   * Get a cast record by ID.
   * @param {string|ObjectId} castId
   * @returns {Promise<object|null>}
   */
  async getCast(castId) {
    const cast = await this.castsDb.findOne({ _id: this._toOid(castId) });
    return cast || null;
  }

  /**
   * Create a cast record.
   * @param {{ spellId: string, initiatorAccountId: string, metadata?: object }} params
   * @returns {Promise<object>} the new cast document
   */
  async createCast({ spellId, initiatorAccountId, metadata = {} }) {
    if (!spellId) throw new Error('spellId is required');
    if (!initiatorAccountId) throw new Error('initiatorAccountId is required');
    return this.castsDb.createCast({ spellId, initiatorAccountId, metadata });
  }

  /**
   * Update a cast record. Mirrors the PUT /spells/casts/:castId handler exactly:
   *   - generationId: appended to stepGenerationIds ($addToSet to prevent duplicates)
   *   - costDeltaUsd: accumulated into costUsd ($inc)
   *   - status: set, with completedAt timestamp when status === 'completed'
   *   - failureReason / failedAt: set on failure
   *
   * @param {string|ObjectId} castId
   * @param {{ generationId?: string, status?: string, costDeltaUsd?: number|string,
   *            failureReason?: string, failedAt?: Date }} params
   * @returns {Promise<void>}
   */
  async updateCast(castId, { generationId, status, costDeltaUsd, failureReason, failedAt } = {}) {
    const oid = this._toOid(castId);
    const update = { $set: { updatedAt: new Date() } };

    if (generationId) {
      if (!ObjectId.isValid(generationId)) throw new Error(`Invalid generationId: ${generationId}`);
      update.$addToSet = { stepGenerationIds: new ObjectId(generationId) };
    }

    if (costDeltaUsd !== undefined && costDeltaUsd !== null) {
      const numeric = typeof costDeltaUsd === 'string' ? parseFloat(costDeltaUsd) : costDeltaUsd;
      if (typeof numeric === 'number' && !isNaN(numeric) && numeric !== 0) {
        update.$inc = { costUsd: numeric };
      }
    }

    if (status) {
      update.$set.status = status;
      if (status === 'completed') {
        update.$set.completedAt = new Date();
      }
    }

    if (failureReason) update.$set.failureReason = failureReason;
    if (failedAt) update.$set.failedAt = failedAt;

    await this.castsDb.updateOne({ _id: oid }, update);
  }

  // ─── Spell queries ──────────────────────────────────────────────────────────

  /**
   * @param {string|ObjectId} id
   */
  async findById(id) {
    return this.spellsDb.findById(id);
  }

  /**
   * @param {string} slug
   */
  async findBySlug(slug) {
    return this.spellsDb.findBySlug(slug);
  }

  /**
   * @param {string} publicSlug
   */
  async findByPublicSlug(publicSlug) {
    return this.spellsDb.findByPublicSlug(publicSlug);
  }

  /**
   * @param {object} filter
   * @param {object} options
   */
  async findPublicSpells(filter = {}, options = {}) {
    return this.spellsDb.findPublicSpells(filter, options);
  }

  /**
   * @param {string|ObjectId} ownedBy
   * @param {object} options
   */
  async findByOwner(ownedBy, options = {}) {
    return this.spellsDb.findSpellsByOwner(ownedBy, options);
  }
}

// Singleton for production use
const spellService = new SpellService();

module.exports = { SpellService, spellService };
