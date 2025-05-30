const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class LoRAPermissionsDB
 * 
 * This class manages individual user access to specific LoRA models.
 * Each document represents access granted to a user for a specific LoRA.
 * 
 * {
 *   _id: ObjectId,
 *   loraId: ObjectId,         // FK to LoRAModels._id
 *   userId: ObjectId,         // FK to Users._id
 *   licenseType: string,      // "purchase" | "rental" | "subscription" | "staff_grant"
 *   priceCents: number,       // USD price in cents (e.g., 499 = $4.99)
 *   grantedBy: ObjectId,      // Admin or seller
 *   grantedAt: Date,
 *   expiresAt?: Date,
 *   revoked?: boolean,
 *   revokedAt?: Date
 * }
 */
class LoRAPermissionsDB extends BaseDB {
  constructor(logger) {
    super('lora_permissions');
    this.logger = logger || console;
  }

  async grantAccess({
    loraId,
    userId,
    licenseType = 'purchase',
    priceCents = 0,
    grantedBy,
    expiresAt = null,
  }) {
    const permission = {
      loraId: new ObjectId(loraId),
      userId: new ObjectId(userId),
      licenseType,
      priceCents,
      grantedBy: new ObjectId(grantedBy),
      grantedAt: new Date(),
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    };
    const result = await this.insertOne(permission);
    return result.insertedId;
  }

  async hasAccess(userId, loraId) {
    return this.findOne({
      loraId: new ObjectId(loraId),
      userId: new ObjectId(userId),
      revoked: { $ne: true },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    });
  }

  async revokeAccess(userId, loraId) {
    return this.updateOne(
      { userId: new ObjectId(userId), loraId: new ObjectId(loraId) },
      { $set: { revoked: true, revokedAt: new Date() } }
    );
  }

  async listUsersWithAccess(loraId) {
    return this.findMany({
      loraId: new ObjectId(loraId),
      revoked: { $ne: true },
    });
  }

  async listAccessibleLoRAs(userId) {
    return this.findMany({
      userId: new ObjectId(userId),
      revoked: { $ne: true },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    });
  }
}

module.exports = LoRAPermissionsDB;
