const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class LoRAModelsDB
 *
 * This class manages LoRA model metadata. A LoRA model is a trained or imported fine-tune
 * that can be applied during prompt-based generation using <lora:slug:weight> syntax.
 *
 * Updated to support:
 * - Marketplace and access control (ownership, price, licensing)
 * - Grouping into collections
 * - Provenance tracking
 *
 * {
 *   _id: ObjectId,
 *   slug: string,
 *   name: string,
 *   triggerWords: [string],
 *   cognates: [
 *     {
 *       word: string,
 *       replaceWith: string
 *     }
 *   ],
 *   replaceWith: string,
 *   defaultWeight: number,
 *   modelType: string,
 *   strength: string,
 *   checkpoint: string,
 *   trainedFrom: {
 *     trainingId: ObjectId,
 *     captionSetId: string,
 *     tool: string,
 *     steps: number
 *   },
 *   tags: [ { tag: string, source: "user" | "admin", score: number } ],
 *   description: string,
 *   examplePrompts: [string],
 *   previewImages: [string],
 *   usageCount: number,
 *   rating: { avg: number, count: number },
 *
 *   // Visibility and access control
 *   visibility: "public" | "private" | "unlisted",
 *   permissionType: "public" | "private" | "licensed", // determines access logic
 *   accessControl?: [ObjectId],                        // optional fast-permission cache
 *
 *   // Ownership
 *   createdBy: ObjectId,
 *   ownedBy: ObjectId,                                  // can diverge from createdBy
 *   collectionId?: ObjectId,                            // FK to model collection
 *
 *   // Marketplace
 *   monetization?: {
 *     priceUSD: number,
 *     forSale: boolean,
 *     rental?: { expiresAfterHours: number },
 *     licenseTerms?: string
 *   },
 *
 *   importedFrom?: {
 *     source: string,
 *     url: string,
 *     originalAuthor?: string,
 *     importedAt: Date
 *   },
 *   publishedTo?: {
 *     huggingfaceRepo: string,
 *     uploadedAt: Date
 *   },
 *   moderation?: {
 *     flagged: boolean,
 *     issues?: [string],
 *     reviewedBy?: string,
 *     reviewedAt?: Date
 *   },
 *   createdAt: Date
 * }
 */

class LoRAModelsDB extends BaseDB {
  constructor(logger) {
    super('loraModels');
    this.logger = logger || console;
  }

  async createLoRAModel(modelData) {
    const now = new Date();
    const dataToInsert = {
      createdAt: now,
      usageCount: 0,
      permissionType: 'public',           // default is free access
      ownedBy: modelData.createdBy,       // default to creator unless set explicitly
      ...modelData,
    };
    const result = await this.insertOne(dataToInsert);
    return result.insertedId ? { _id: result.insertedId, ...dataToInsert } : null;
  }

  async findById(modelId) {
    return this.findOne({ _id: new ObjectId(modelId) });
  }

  async findBySlug(slug) {
    return this.findOne({ slug });
  }

  async incrementUsage(slug) {
    return this.updateOne({ slug }, { $inc: { usageCount: 1 } });
  }

  async updateModel(modelId, updateData) {
    return this.updateOne({ _id: new ObjectId(modelId) }, { $set: updateData });
  }

  async findPublicModels(filter = {}, options = {}) {
    return this.findMany({ visibility: 'public', ...filter }, options);
  }

  async findModelsByUser(userId, options = {}) {
    return this.findMany({ createdBy: new ObjectId(userId) }, options);
  }

  async transferOwnership(modelId, newOwnerId) {
    return this.updateOne(
      { _id: new ObjectId(modelId) },
      {
        $set: {
          ownedBy: new ObjectId(newOwnerId),
          updatedAt: new Date()
        }
      }
    );
  }

  async assignToCollection(modelId, collectionId) {
    return this.updateOne(
      { _id: new ObjectId(modelId) },
      {
        $set: {
          collectionId: new ObjectId(collectionId),
          updatedAt: new Date()
        }
      }
    );
  }

  async flagModel(modelId, issues = []) {
    return this.updateOne(
      { _id: new ObjectId(modelId) },
      {
        $set: {
          'moderation.flagged': true,
          'moderation.issues': issues,
          'moderation.reviewedAt': new Date()
        }
      }
    );
  }

  async setMonetization(modelId, monetizationData) {
    return this.updateOne(
      { _id: new ObjectId(modelId) },
      {
        $set: {
          monetization: monetizationData,
          updatedAt: new Date()
        }
      }
    );
  }

  async addUserToAccessList(modelId, userId) {
    return this.updateOne(
      { _id: new ObjectId(modelId) },
      { $addToSet: { accessControl: new ObjectId(userId) } }
    );
  }
  async addCognate(modelId, cognate) {
    return this.updateOne(
      { _id: new ObjectId(modelId) },
      { $addToSet: { cognates: cognate } }
    );
  }
}

module.exports = LoRAModelsDB;
