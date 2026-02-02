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
 *   // KONTEXT concept training - control images (optional)
 *   controlImages?: [{
 *     generationOutputId: ObjectId,    // FK to generationOutputs._id (spell result)
 *     sourceFilename: string,          // Filename of corresponding result image (e.g., '001.jpg')
 *     url: string,                     // Control image URL
 *     addedAt: Date
 *   }],
 *   controlGenerationConfig?: {
 *     spellSlug: string,               // Spell used to generate controls
 *     conceptDescription: string,      // User's description of the concept
 *     status: 'in_progress' | 'completed' | 'failed',
 *     generatedAt: Date,
 *     error?: string
 *   },
 *
 *   // Unified embellishments (captions, control images, videos, etc.)
 *   embellishments?: [{
 *     _id: ObjectId,
 *     type: string,                   // 'caption' | 'control_image' | 'video' | 'audio' | ...
 *     method: string,                 // spellSlug used
 *     status: 'in_progress' | 'completed' | 'failed',
 *     createdBy: ObjectId,
 *     createdAt: Date,
 *     completedAt?: Date,
 *     results: [{                     // Parallel array to dataset.images
 *       generationOutputId: ObjectId, // FK to generationOutputs
 *       value: string | null,         // Text (captions) or URL (images/video/audio)
 *       definition?: string           // Optional metadata
 *     }]
 *   }],
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
    const enriched = {
      _id: new ObjectId(),
      createdAt: new Date(),
      status: captionSet?.status || 'completed',
      ...captionSet,
    };
    await this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $push: { captionSets: enriched }, $set: { updatedAt: new Date() } }
    );
    return enriched;
  }

  async updateCaptionInSet(datasetId, captionSetId, imageIndex, caption) {
    if (imageIndex === undefined || imageIndex === null) return null;
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $set: {
          [`captionSets.$[target].captions.${imageIndex}`]: caption,
          updatedAt: new Date(),
        },
      },
      {
        arrayFilters: [{ 'target._id': new ObjectId(captionSetId) }],
      }
    );
  }

  async setCaptionSetStatus(datasetId, captionSetId, status, extra = {}) {
    const setPayload = {
      'captionSets.$[target].status': status,
      updatedAt: new Date(),
    };

    if (status === 'completed') {
      setPayload['captionSets.$[target].completedAt'] = new Date();
    } else if (extra.completedAt !== undefined) {
      setPayload['captionSets.$[target].completedAt'] = extra.completedAt;
    }

    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || key === 'completedAt') continue;
      setPayload[`captionSets.$[target].${key}`] = value;
    }

    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $set: setPayload },
      {
        arrayFilters: [{ 'target._id': new ObjectId(captionSetId) }],
      }
    );
  }

  async removeCaptionSet(datasetId, captionSetId) {
    if (!datasetId || !captionSetId) return null;
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $pull: { captionSets: { _id: new ObjectId(captionSetId) } },
        $set: { updatedAt: new Date() }
      }
    );
  }

  async setDefaultCaptionSet(datasetId, captionSetId) {
    if (!datasetId) return null;
    const dsId = new ObjectId(datasetId);
    const timestamp = new Date();

    if (!captionSetId) {
      return this.updateOne(
        { _id: dsId },
        { $set: { 'captionSets.$[].isDefault': false, updatedAt: timestamp } }
      );
    }

    const capId = new ObjectId(captionSetId);
    return this.updateOne(
      { _id: dsId },
      {
        $set: {
          'captionSets.$[selected].isDefault': true,
          'captionSets.$[others].isDefault': false,
          updatedAt: timestamp,
        },
      },
      {
        arrayFilters: [
          { 'selected._id': capId },
          { 'others._id': { $ne: capId } },
        ],
      }
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

  /**
   * Add control images for KONTEXT concept training
   * @param {ObjectId|string} datasetId
   * @param {Array<{generationOutputId: ObjectId, sourceFilename: string, url: string}>} controlImages
   */
  async addControlImages(datasetId, controlImages = []) {
    if (!controlImages.length) return { modifiedCount: 0 };

    const enriched = controlImages.map(img => ({
      ...img,
      generationOutputId: new ObjectId(img.generationOutputId),
      addedAt: new Date()
    }));

    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $set: { controlImages: enriched, updatedAt: new Date() }
      }
    );
  }

  /**
   * Set control generation configuration
   * @param {ObjectId|string} datasetId
   * @param {Object} config - { spellSlug, conceptDescription, status, generatedAt }
   */
  async setControlGenerationConfig(datasetId, config) {
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $set: {
          controlGenerationConfig: {
            ...config,
            generatedAt: config.generatedAt || new Date()
          },
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Clear control images and config from dataset
   * @param {ObjectId|string} datasetId
   */
  async clearControlImages(datasetId) {
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $set: { controlImages: [], updatedAt: new Date() },
        $unset: { controlGenerationConfig: '' }
      }
    );
  }

  /**
   * Add a new embellishment entry (in_progress initially)
   * @param {string} datasetId
   * @param {Object} embellishment - { type, method, createdBy, results }
   * @returns {Object} The created embellishment subdocument
   */
  async addEmbellishment(datasetId, embellishment) {
    const enriched = {
      _id: new ObjectId(),
      status: 'in_progress',
      createdAt: new Date(),
      results: [],
      ...embellishment,
      createdBy: new ObjectId(embellishment.createdBy),
    };

    await this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $push: { embellishments: enriched },
        $set: { updatedAt: new Date() }
      }
    );
    return enriched;
  }

  /**
   * Update a result in an embellishment's results array
   * @param {string} datasetId
   * @param {string} embellishmentId
   * @param {number} resultIndex - Index in results array (matches image index)
   * @param {Object} result - { generationOutputId, value, definition }
   */
  async updateEmbellishmentResult(datasetId, embellishmentId, resultIndex, result) {
    const enriched = {
      ...result,
      generationOutputId: result.generationOutputId ? new ObjectId(result.generationOutputId) : null,
    };

    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $set: {
          [`embellishments.$[emb].results.${resultIndex}`]: enriched,
          updatedAt: new Date(),
        },
      },
      {
        arrayFilters: [{ 'emb._id': new ObjectId(embellishmentId) }],
      }
    );
  }

  /**
   * Set embellishment status
   * @param {string} datasetId
   * @param {string} embellishmentId
   * @param {string} status - 'in_progress' | 'completed' | 'failed'
   * @param {Object} extra - Additional fields (e.g., completedAt, error)
   */
  async setEmbellishmentStatus(datasetId, embellishmentId, status, extra = {}) {
    const setPayload = {
      'embellishments.$[emb].status': status,
      updatedAt: new Date(),
    };

    if (status === 'completed') {
      setPayload['embellishments.$[emb].completedAt'] = new Date();
    }

    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        setPayload[`embellishments.$[emb].${key}`] = value;
      }
    }

    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      { $set: setPayload },
      { arrayFilters: [{ 'emb._id': new ObjectId(embellishmentId) }] }
    );
  }

  /**
   * Remove an embellishment
   * @param {string} datasetId
   * @param {string} embellishmentId
   */
  async removeEmbellishment(datasetId, embellishmentId) {
    return this.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $pull: { embellishments: { _id: new ObjectId(embellishmentId) } },
        $set: { updatedAt: new Date() }
      }
    );
  }

  /**
   * Get embellishments for a dataset, optionally filtered by type
   * @param {string} datasetId
   * @param {string} type - Optional type filter
   */
  async getEmbellishments(datasetId, type = null) {
    const dataset = await this.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { embellishments: 1 } }
    );

    if (!dataset || !dataset.embellishments) return [];

    if (type) {
      return dataset.embellishments.filter(e => e.type === type);
    }
    return dataset.embellishments;
  }
}

module.exports = DatasetDB;
