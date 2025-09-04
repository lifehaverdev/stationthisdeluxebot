const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class DatasetDB
 *
 * Stores immutable or versioned collections of media (images) plus optional captions/metadata.
 * These datasets are later consumed by training jobs. One dataset can fuel many trainings.
 *
 * SCHEMA (Mongo):
 * {
 *   _id: ObjectId,
 *   name: string,
 *   description?: string,
 *   ownerAccountId: ObjectId,           // user who created the dataset
 *   createdAt: Date,
 *   updatedAt: Date,
 *
 *   // Core media
 *   images: [string],                   // Array of storage URLs (gridfs://, s3://, http://)
 *   normalizationImages?: [string],     // Optional extra images for style transfer / color matching
 *
 *   // Caption sets can be produced by multiple captioners (manual, BLIP, etc.)
 *   captionSets: [{
 *     _id: ObjectId,                    // subdocument id
 *     method: 'manual'|'blip'|'clip'|'sd-captioner'|string,
 *     captions: [string],               // length === images.length assumed
 *     createdBy: ObjectId,              // account that generated this set
 *     createdAt: Date
 *   }],
 *
 *   // Tags & stats
 *   tags?: [string],
 *   sizeBytes?: number,
 *   usageCount: number,                 // times used across trainings
 *
 *   // Visibility & licensing
 *   visibility: 'public' | 'private' | 'unlisted',
 *   accessControl?: [ObjectId],         // fast allow-list for private datasets
 *   monetization?: {
 *     priceUSD?: number,
 *     licenseTerms?: string,
 *     forSale?: boolean
 *   },
 *
 *   // Linkage
 *   trainingIds?: [ObjectId],           // jobs that consume this dataset (Fk TrainingDB)
 *   publishedTo?: {
 *     hfRepo?: string,                  // e.g. huggingface repo slug
 *     datasetUrl?: string,
 *     publishedAt?: Date
 *   },
 *
 *   status: 'draft' | 'ready' | 'locked' | 'archived'
 * }
 */
class DatasetDB extends BaseDB {
  constructor(logger) {
    super('datasets');
    this.logger = logger || console;
  }

  async createDataset(data) {
    const now = new Date();
    const payload = {
      createdAt: now,
      updatedAt: now,
      visibility: 'private',
      usageCount: 0,
      images: [],
      captionSets: [],
      status: 'draft',
      ...data,
    };
    const result = await this.insertOne(payload);
    return result.insertedId ? { _id: result.insertedId, ...payload } : null;
  }

  async addImages(datasetId, imageUrls = []) {
    if (!imageUrls.length) return null;
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $push: { images: { $each: imageUrls } }, $set: { updatedAt: new Date() } }
    );
  }

  async addCaptionSet(datasetId, captionSet) {
    const enriched = { _id: new ObjectId(), createdAt: new Date(), ...captionSet };
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $push: { captionSets: enriched }, $set: { updatedAt: new Date() } }
    );
  }

  async linkTraining(datasetId, trainingId) {
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $addToSet: { trainingIds: new ObjectId(trainingId) } }
    );
  }

  async setStatus(datasetId, status) {
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $set: { status, updatedAt: new Date() } }
    );
  }
}

module.exports = DatasetDB;
