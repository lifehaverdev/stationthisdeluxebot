const { BaseDB, ObjectId } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue'); // ADD: for distinct queries

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

  /**
   * Creates a LoRA model record from an imported source.
   * @param {Object} modelData - The base data for the LoRA model.
   * @param {string} masterAccountId - The ID of the user who initiated the import.
   * @param {Object} importDetails - Details about the import source.
   * @param {string} importDetails.source - e.g., 'civitai', 'huggingface'.
   * @param {string} importDetails.url - The original URL of the model.
   * @param {string} [importDetails.originalAuthor] - The original author, if known.
   * @param {string} [importDetails.modelFileUrl] - The direct download URL for the model file.
   * @returns {Promise<Object|null>} The created LoRA model document or null on error.
   */
  async createImportedLoRAModel(modelData, masterAccountId, importDetails) {
    const now = new Date();
    
    // Improved slug generation
    let slugBase = (modelData.name || 'imported-lora')
      .toString() // Ensure it's a string
      .toLowerCase()
      // Replace characters that are not alphanumeric or whitespace with a space.
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim() // Trim leading/trailing spaces that might have been created
      // Replace sequences of whitespace characters with a single hyphen
      .replace(/\s+/g, '-');

    // Fallback if slugBase becomes empty after sanitization
    if (!slugBase) {
      slugBase = 'imported-lora';
    }

    const uniqueSlug = `${slugBase}-${new ObjectId().toHexString().substring(0, 6)}`;

    const dataToInsert = {
      ...modelData, // Includes name, description, triggerWords, baseModel (as checkpoint), tags from import service
      slug: uniqueSlug, 
      permissionType: 'public', // Stays public, access controlled by visibility & moderation
      visibility: 'unlisted', // MODIFICATION: Initial visibility is unlisted
      usageCount: 0,
      createdBy: new ObjectId(masterAccountId),
      // ownedBy could be a system ID or the importer. For now, let's make it same as createdBy.
      ownedBy: new ObjectId(masterAccountId),
      importedFrom: {
        source: importDetails.source,
        url: importDetails.url,
        originalAuthor: importDetails.originalAuthor || null,
        modelFileUrl: importDetails.modelFileUrl || null, // Store the direct download URL
        importedAt: now
      },
      // --- BEGIN ADDITION: Moderation status for admin review ---
      moderation: {
        status: 'pending_review',
        flagged: true, // Indicates it needs admin attention
        requestedBy: new ObjectId(masterAccountId),
        requestedAt: now,
        issues: [], // Initialize empty issues array
      },
      // --- END ADDITION: Moderation status for admin review ---
      createdAt: now,
      updatedAt: now,
    };

    // Ensure required fields for the schema are present, even if null from importData
    dataToInsert.triggerWords = dataToInsert.triggerWords || [];
    dataToInsert.tags = dataToInsert.tags || [];
    dataToInsert.cognates = dataToInsert.cognates || [];
    dataToInsert.defaultWeight = dataToInsert.defaultWeight || 1.0;

    // Create a cognate for very long trigger words
    const LONG_TRIGGER_THRESHOLD = 50; // characters
    if (
      dataToInsert.triggerWords &&
      dataToInsert.triggerWords.length === 1 &&
      dataToInsert.triggerWords[0].length > LONG_TRIGGER_THRESHOLD
    ) {
      const longTrigger = dataToInsert.triggerWords[0];
      const cognateWord = slugBase; // Use the clean slug as the shortcut word

      dataToInsert.cognates.push({
        word: cognateWord,
        replaceWith: longTrigger
      });

      this.logger.info(`[LoRAModelDb] Created a cognate '${cognateWord}' for a long trigger word for LoRA: ${dataToInsert.name}`);
    }

    this.logger.info(`[LoRAModelDb] Creating imported LoRA: ${dataToInsert.name} (Slug: ${dataToInsert.slug}) by MAID ${masterAccountId}`);
    const result = await this.insertOne(dataToInsert);
    return result.insertedId ? { _id: result.insertedId, ...dataToInsert } : null;
  }

  /**
   * Creates a LoRA model record from a completed training job.
   * @param {Object} trainingResult - Output from launch-training.js
   * @param {string} trainingResult.modelName - Name of the trained model
   * @param {string} trainingResult.triggerWord - Trigger word for the model
   * @param {number} trainingResult.steps - Total training steps
   * @param {string} [trainingResult.hfRepoId] - HuggingFace repo (e.g., "ms2stationthis/modelname")
   * @param {string} [trainingResult.r2ModelUrl] - Cloudflare R2 URL for the model file
   * @param {string[]} [trainingResult.sampleImageUrls] - URLs to sample images
   * @param {string} [trainingResult.description] - Model description (from captions/OpenAI)
   * @param {string} trainingResult.baseModel - Base model used (e.g., "black-forest-labs/FLUX.1-dev")
   * @param {string} [trainingResult.trainingId] - ID of the training session record
   * @param {string} [trainingResult.datasetId] - ID of the dataset used
   * @param {number} [trainingResult.trainingDuration] - Duration in seconds
   * @param {number} [trainingResult.finalLoss] - Final loss value
   * @param {string} masterAccountId - The ID of the user who initiated the training.
   * @returns {Promise<Object|null>} The created LoRA model document or null on error.
   */
  async createTrainedLoRAModel(trainingResult, masterAccountId) {
    const now = new Date();

    const {
      modelName,
      triggerWord,
      steps,
      hfRepoId,
      r2ModelUrl,
      sampleImageUrls = [],
      description,
      baseModel,
      trainingId,
      datasetId,
      trainingDuration,
      finalLoss
    } = trainingResult;

    if (!modelName || !triggerWord) {
      this.logger.error('[LoRAModelDb] createTrainedLoRAModel requires modelName and triggerWord');
      return null;
    }

    if (!hfRepoId && !r2ModelUrl) {
      this.logger.error('[LoRAModelDb] createTrainedLoRAModel requires either hfRepoId or r2ModelUrl');
      return null;
    }

    // Generate slug from model name
    let slugBase = modelName
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .replace(/\s+/g, '-');

    if (!slugBase) {
      slugBase = 'trained-lora';
    }

    const uniqueSlug = `${slugBase}-${new ObjectId().toHexString().substring(0, 6)}`;

    // Map base model to checkpoint enum
    let checkpoint = 'FLUX'; // Default for our training
    if (baseModel) {
      const lowerBase = baseModel.toLowerCase();
      // Check KONTEXT first since it also contains 'flux' in full name (FLUX.1-Kontext-dev)
      if (lowerBase.includes('kontext')) checkpoint = 'KONTEXT';
      else if (lowerBase.includes('flux')) checkpoint = 'FLUX';
      else if (lowerBase.includes('sdxl')) checkpoint = 'SDXL';
      else if (lowerBase.includes('sd1.5') || lowerBase.includes('sd 1.5')) checkpoint = 'SD1.5';
      else if (lowerBase.includes('sd3') || lowerBase.includes('sd 3')) checkpoint = 'SD3';
    }

    // Build preview images from samples
    let previewImages = [];
    if (sampleImageUrls && sampleImageUrls.length > 0) {
      previewImages = sampleImageUrls;
    } else if (hfRepoId) {
      // Default HuggingFace sample URLs if not provided
      previewImages = [
        `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_000.jpg`,
        `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_001.jpg`,
        `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_002.jpg`,
        `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_003.jpg`
      ];
    }

    // Build publishedTo based on upload destination
    const publishedTo = {};
    if (hfRepoId) {
      publishedTo.huggingfaceRepo = hfRepoId;
      publishedTo.huggingfaceUrl = `https://huggingface.co/${hfRepoId}`;
      publishedTo.modelFileUrl = `https://huggingface.co/${hfRepoId}/resolve/main/${modelName}.safetensors`;
    }
    if (r2ModelUrl) {
      publishedTo.cloudflareUrl = r2ModelUrl;
      publishedTo.modelFileUrl = r2ModelUrl;
    }
    publishedTo.uploadedAt = now;

    const dataToInsert = {
      name: modelName,
      description: description || `Trained LoRA model with trigger word: ${triggerWord}`,
      triggerWords: [triggerWord],
      checkpoint,
      tags: [
        { tag: 'trained', source: 'training' },
        { tag: checkpoint.toLowerCase(), source: 'training' }
      ],
      previewImages,
      defaultWeight: 1.0,
      slug: uniqueSlug,
      permissionType: 'public',
      visibility: 'public', // Auto-visible since it's our own training
      usageCount: 0,
      createdBy: new ObjectId(masterAccountId),
      ownedBy: new ObjectId(masterAccountId),

      // Training provenance
      trainedFrom: {
        trainingId: trainingId ? new ObjectId(trainingId) : null,
        datasetId: datasetId ? new ObjectId(datasetId) : null,
        tool: 'ai-toolkit',
        steps: steps || 0,
        baseModel: baseModel || 'black-forest-labs/FLUX.1-dev',
        duration: trainingDuration || null,
        finalLoss: finalLoss || null,
        trainedAt: now
      },

      // Where the model file lives
      publishedTo,

      // Auto-approved moderation (trusted source - our own training)
      moderation: {
        status: 'approved',
        flagged: false,
        requestedBy: new ObjectId(masterAccountId),
        requestedAt: now,
        reviewedBy: 'AUTO_APPROVED_TRAINING',
        reviewedAt: now,
        issues: []
      },

      cognates: [],
      createdAt: now,
      updatedAt: now
    };

    this.logger.info(`[LoRAModelDb] Creating trained LoRA: ${dataToInsert.name} (Slug: ${dataToInsert.slug}) by MAID ${masterAccountId}`);
    this.logger.info(`[LoRAModelDb] Published to: ${hfRepoId ? `HuggingFace ${hfRepoId}` : `R2 ${r2ModelUrl}`}`);

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

  async listCategories() {
     // Returns distinct category values existing in collection, excluding null/undefined
    return this.monitorOperation(async () => {
      const client = await getCachedClient();
      const collection = client.db(this.dbName).collection(this.collectionName);
      let categories = await collection.distinct('category');
      categories = categories.filter(c => !!c);

      // Fallback: derive from tag list (e.g., 'character', 'style', etc.)
      if (categories.length === 0) {
        const tagCats = await collection.distinct('tags.tag');
        categories = tagCats.filter(t => !!t).map(t => t.toLowerCase());
      }

      const uniq = Array.from(new Set(categories))
        .map(t => t.toLowerCase())
        .sort();
      this.logger.info(`[LoRAModelDb] listCategories -> ${JSON.stringify(uniq)}`);
      return uniq;
    }, 'distinct');
  }
}

module.exports = LoRAModelsDB;
