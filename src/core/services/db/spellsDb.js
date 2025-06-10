const { BaseDB, ObjectId } = require('./BaseDB');
const { v4: uuidv4 } = require('uuid'); // For spellId, though we might use slug mainly
const { slugify } = require('../../../utils/stringUtils'); // Assuming a slugify utility exists

/**
 * @class SpellsDB
 *
 * Manages "Spells," which are user-created, multi-step workflows (tool chains).
 * This collection is designed to be a central registry, supporting a public "Spell Store,"
 * private user spells, and future monetization.
 *
 * The schema is heavily inspired by LoRAModelsDB to support similar features like
 * ownership, permissions, discovery, and marketplace functionality.
 *
 * {
 *   _id: ObjectId,
 *   slug: string,             // Globally unique, generated from name (e.g., "epic-landscape-vfx-ab12cd")
 *   name: string,             // User-facing display name
 *   description: string,      // A brief explanation of what the spell does
 *   creatorId: ObjectId,      // FK to Users._id - the original author
 *   ownedBy: ObjectId,        // FK to Users._id - the current owner (can be transferred)
 *   
 *   steps: [
 *     {
 *       stepId: number,
 *       toolId: string,
 *       parameters: Object,
 *       outputMappings: Object
 *     }
 *   ],
 *   
 *   // Discovery & Usage
 *   tags: [string],
 *   usageCount: number,
 *   rating: { avg: number, count: number },
 *
 *   // Visibility and Access Control
 *   visibility: "public" | "private" | "unlisted",
 *   permissionType: "public" | "private" | "licensed",
 *
 *   // Marketplace
 *   monetization?: {
 *     priceUSD: number,
 *     forSale: boolean,
 *     licenseTerms?: string
 *   },

 *   // Moderation
 *   moderation?: {
 *     status: "pending_review" | "approved" | "rejected",
 *     flagged: boolean,
 *     issues?: [string],
 *     reviewedBy?: ObjectId,
 *     reviewedAt?: Date
 *   },
 *
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */
class SpellsDB extends BaseDB {
  constructor(logger) {
    super('spells');
    this.logger = logger || console;
  }

  /**
   * Creates a new Spell.
   * @param {Object} spellData - The core data for the spell. Must include name and creatorId.
   * @returns {Promise<Object|null>} The created spell document or null on error.
   */
  async createSpell(spellData) {
    const now = new Date();
    
    if (!spellData.name || !spellData.creatorId) {
        this.logger.error('[SpellsDB] createSpell called without required fields (name, creatorId).');
        throw new Error('Spell name and creatorId are required.');
    }

    // Generate a unique slug from the name.
    const baseSlug = slugify(spellData.name);
    const uniqueSlug = `${baseSlug}-${new ObjectId().toHexString().substring(0, 6)}`;

    const dataToInsert = {
      ...spellData,
      slug: uniqueSlug,
      creatorId: new ObjectId(spellData.creatorId),
      ownedBy: new ObjectId(spellData.creatorId), // Owner defaults to creator
      description: spellData.description || '',
      steps: spellData.steps || [],
      tags: spellData.tags || [],
      usageCount: 0,
      rating: { avg: 0, count: 0 },
      visibility: spellData.visibility || 'private', // Default to private
      permissionType: spellData.permissionType || 'private', // Default to private access
      createdAt: now,
      updatedAt: now,
    };
    
    this.logger.info(`[SpellsDB] Creating new spell: "${dataToInsert.name}" (Slug: ${dataToInsert.slug}) by User ${dataToInsert.creatorId}`);
    const result = await this.insertOne(dataToInsert);
    return result.insertedId ? { _id: result.insertedId, ...dataToInsert } : null;
  }

  async findById(spellId) {
    return this.findOne({ _id: new ObjectId(spellId) });
  }

  async findBySlug(slug) {
    return this.findOne({ slug });
  }

  /**
   * Finds all spells owned by a specific user.
   * @param {string|ObjectId} userId - The ID of the user.
   * @param {Object} options - Find options (e.g., sort, limit).
   * @returns {Promise<Array>} A list of the user's spells.
   */
  async findSpellsByOwner(userId, options = {}) {
    return this.findMany({ ownedBy: new ObjectId(userId) }, options);
  }

  /**
   * Finds spells owned by a user where the slug starts with a given string.
   * @param {string|ObjectId} userId - The ID of the user.
   * @param {string} partialSlug - The beginning of the slug to match.
   * @returns {Promise<Array>} A list of matching spells.
   */
  async findSpellsByOwnerAndPartialSlug(userId, partialSlug) {
    // Escape special regex characters in the user input to prevent injection
    const escapedSlug = partialSlug.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const query = {
        ownedBy: new ObjectId(userId),
        slug: { $regex: `^${escapedSlug}`, $options: 'i' } // Case-insensitive starts-with
    };
    return this.findMany(query);
  }

  /**
   * Finds all publicly visible spells.
   * @param {Object} filter - Additional filter criteria.
   * @param {Object} options - Find options (e.g., sort, limit).
   * @returns {Promise<Array>} A list of public spells.
   */
  async findPublicSpells(filter = {}, options = {}) {
    return this.findMany({ visibility: 'public', 'moderation.status': 'approved', ...filter }, options);
  }

  /**
   * Updates a spell document.
   * @param {string|ObjectId} spellId - The ID of the spell to update.
   * @param {Object} updateData - The fields to set or update.
   * @returns {Promise<Object>} The update result from MongoDB.
   */
  async updateSpell(spellId, updateData) {
    const dataToSet = {
        ...updateData,
        updatedAt: new Date(),
    };
    // Ensure ObjectIds are correctly formatted if passed as strings
    if (dataToSet.ownedBy) dataToSet.ownedBy = new ObjectId(dataToSet.ownedBy);
    if (dataToSet.creatorId) dataToSet.creatorId = new ObjectId(dataToSet.creatorId);

    return this.updateOne({ _id: new ObjectId(spellId) }, { $set: dataToSet });
  }
  
  /**
   * Deletes a spell.
   * @param {string|ObjectId} spellId - The ID of the spell to delete.
   * @param {string|ObjectId} userId - The ID of the user attempting the deletion (must be owner).
   * @returns {Promise<Object>} The deletion result from MongoDB.
   */
  async deleteSpell(spellId, userId) {
      // Ensure only the owner can delete the spell
      return this.deleteOne({ _id: new ObjectId(spellId), ownedBy: new ObjectId(userId) });
  }

  async incrementUsage(spellId) {
    return this.updateOne({ _id: new ObjectId(spellId) }, { $inc: { usageCount: 1 } });
  }

  async transferOwnership(spellId, newOwnerId) {
    return this.updateSpell(spellId, { ownedBy: new ObjectId(newOwnerId) });
  }

  // Methods for managing steps within a spell
  
  async addStep(spellId, stepData) {
      const newStep = {
          stepId: new Date().getTime(), // Simple unique ID for the step
          ...stepData
      };
      return this.updateOne(
          { _id: new ObjectId(spellId) },
          { 
              $push: { steps: newStep },
              $set: { updatedAt: new Date() }
          }
      );
  }

  /**
   * Updates a specific step's parameterOverrides within a spell using arrayFilters.
   * @param {string} spellId - The ID of the spell to update.
   * @param {number} stepId - The ID of the step to update.
   * @param {object} parameterOverrides - The new parameter overrides to set.
   * @param {string} masterAccountId - The ID of the user account, for ownership verification.
   * @returns {Promise<object|null>} The updated spell document or null if not found/permission denied.
   */
  async updateStep(spellId, stepId, parameterOverrides, masterAccountId) {
    this.logger.info(`[SpellsDB] Attempting to update step ${stepId} for spell ${spellId} by user ${masterAccountId}`);
    const spell = await this.findById(spellId);

    if (!spell) {
        this.logger.warn(`[SpellsDB] Spell not found with ID: ${spellId}`);
        return null;
    }

    // Permission check: Only the creator can edit the spell.
    if (spell.creatorId.toString() !== masterAccountId) {
        this.logger.warn(`[SpellsDB] Permission denied: User ${masterAccountId} is not the creator of spell ${spellId}.`);
        return null; 
    }

    const result = await this.updateOne(
        { _id: new ObjectId(spellId) },
        { 
            $set: { 
                'steps.$[step].parameterOverrides': parameterOverrides,
                updatedAt: new Date()
            }
        },
        { 
            arrayFilters: [ { 'step.stepId': stepId } ] 
        }
    );

    if (result.modifiedCount > 0) {
        this.logger.info(`[SpellsDB] Successfully updated step ${stepId} in spell ${spellId}`);
        return this.findById(spellId); // Return the updated document
    } else {
        const stepExists = spell.steps.some(s => s.stepId === stepId);
        if (!stepExists) {
            this.logger.warn(`[SpellsDB] Update failed because step not found with ID: ${stepId} in spell ${spellId}`);
        } else {
             this.logger.warn(`[SpellsDB] Update failed for step ${stepId} in spell ${spellId} (modifiedCount: 0). Maybe data was identical?`);
        }
        return null;
    }
  }

  async removeStep(spellId, stepId) {
      return this.updateOne(
          { _id: new ObjectId(spellId) },
          {
              $pull: { steps: { stepId: stepId } },
              $set: { updatedAt: new Date() }
          }
      );
  }
}

module.exports = SpellsDB; 