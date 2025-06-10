const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class SpellPermissionsDB
 * 
 * This class manages individual user access to specific, non-public Spells.
 * Each document represents access granted to a user for a specific Spell.
 * This is crucial for the Spell Store's licensed/purchased content.
 * 
 * {
 *   _id: ObjectId,
 *   spellId: ObjectId,        // FK to Spells._id
 *   userId: ObjectId,         // FK to Users._id
 *   licenseType: string,      // "purchase" | "staff_grant" | etc.
 *   priceCents: number,       // Price paid in USD cents
 *   grantedBy: ObjectId,      // Admin or seller ID
 *   grantedAt: Date,
 *   revoked?: boolean,
 *   revokedAt?: Date
 * }
 */
class SpellPermissionsDB extends BaseDB {
  constructor(logger) {
    super('spell_permissions');
    this.logger = logger || console;
  }

  /**
   * Grants a user access to a specific spell.
   * @param {Object} details - The permission details.
   * @param {string|ObjectId} details.spellId - The ID of the spell.
   * @param {string|ObjectId} details.userId - The ID of the user being granted access.
   * @param {string} details.licenseType - The type of license (e.g., 'purchase').
   * @param {number} details.priceCents - The price paid.
   * @param {string|ObjectId} details.grantedBy - The ID of the user/admin granting access.
   * @returns {Promise<ObjectId>} The ID of the new permission document.
   */
  async grantAccess({
    spellId,
    userId,
    licenseType = 'purchase',
    priceCents = 0,
    grantedBy,
  }) {
    const permission = {
      spellId: new ObjectId(spellId),
      userId: new ObjectId(userId),
      licenseType,
      priceCents,
      grantedBy: new ObjectId(grantedBy),
      grantedAt: new Date(),
    };
    this.logger.info(`[SpellPermissionsDB] Granting '${licenseType}' access for Spell ${spellId} to User ${userId}.`);
    const result = await this.insertOne(permission);
    return result.insertedId;
  }

  /**
   * Checks if a user has access to a specific spell.
   * @param {string|ObjectId} userId - The user's ID.
   * @param {string|ObjectId} spellId - The spell's ID.
   * @returns {Promise<Object|null>} The permission document if access is valid, otherwise null.
   */
  async hasAccess(userId, spellId) {
    return this.findOne({
      spellId: new ObjectId(spellId),
      userId: new ObjectId(userId),
      revoked: { $ne: true },
    });
  }

  /**
   * Revokes a user's access to a spell.
   * @param {string|ObjectId} userId - The user's ID.
   * @param {string|ObjectId} spellId - The spell's ID.
   * @returns {Promise<Object>} The update result from MongoDB.
   */
  async revokeAccess(userId, spellId) {
    this.logger.warn(`[SpellPermissionsDB] Revoking access for Spell ${spellId} from User ${userId}.`);
    return this.updateOne(
      { userId: new ObjectId(userId), spellId: new ObjectId(spellId) },
      { $set: { revoked: true, revokedAt: new Date() } }
    );
  }

  /**
   * Lists all users who have been granted access to a specific spell.
   * @param {string|ObjectId} spellId - The spell's ID.
   * @returns {Promise<Array>} An array of permission documents.
   */
  async listUsersWithAccess(spellId) {
    return this.findMany({
      spellId: new ObjectId(spellId),
      revoked: { $ne: true },
    });
  }

  /**
   * Lists all spells a specific user has been granted access to.
   * @param {string|ObjectId} userId - The user's ID.
   * @returns {Promise<Array>} An array of permission documents.
   */
  async listAccessibleSpells(userId) {
    return this.findMany({
      userId: new ObjectId(userId),
      revoked: { $ne: true },
    });
  }
}

module.exports = SpellPermissionsDB; 