/**
 * DatasetService — in-process domain service for dataset operations.
 *
 * Replaces internalApiClient calls to /internal/v1/data/datasets/* and
 * /internal/v1/data/embellishment-* with direct DB + service calls.
 *
 * Phase 6e of service-layer-migration.
 */
const { ObjectId } = require('mongodb');
const { sha256Hex } = require('../../../utils/hash');

class DatasetService {
  /**
   * @param {Object} deps
   * @param {import('../../db/datasetDb')} deps.datasetDb
   * @param {Object} deps.generationOutputsDb  - for control-embellishment enrichment
   * @param {Object} deps.spellsDb             - for findEmbellishmentSpells
   * @param {Object} deps.spellsService        - for castSpell (caption-via-spell)
   * @param {Object} deps.embellishmentTaskService
   * @param {Object} deps.webSocketService     - optional, for WS events
   * @param {Object} deps.logger
   */
  constructor({ datasetDb, generationOutputsDb, spellsDb, castsDb, spellsService, embellishmentTaskService, webSocketService, logger }) {
    this.datasetDb = datasetDb;
    this.generationOutputsDb = generationOutputsDb;
    this.spellsDb = spellsDb;
    this.castsDb = castsDb || null;
    this.spellsService = spellsService;
    this.embellishmentTaskService = embellishmentTaskService;
    this.webSocketService = webSocketService;
    this.logger = logger || console;

    // Timer state for caption-via-spell cancellation
    this._activeCaptionTimers = new Map();
  }

  // --- Caption timer helpers ---

  _registerCaptionTimer(datasetId, timer) {
    const key = String(datasetId);
    if (!this._activeCaptionTimers.has(key)) this._activeCaptionTimers.set(key, new Set());
    this._activeCaptionTimers.get(key).add(timer);
  }

  _unregisterCaptionTimer(datasetId, timer) {
    const key = String(datasetId);
    const timers = this._activeCaptionTimers.get(key);
    if (!timers) return;
    timers.delete(timer);
    if (!timers.size) this._activeCaptionTimers.delete(key);
  }

  _clearCaptionTimers(datasetId) {
    const key = String(datasetId);
    const timers = this._activeCaptionTimers.get(key);
    if (timers) {
      timers.forEach(t => clearTimeout(t));
      this._activeCaptionTimers.delete(key);
    }
  }

  // --- Core CRUD ---

  /**
   * List datasets for an owner, with optional search/filter/pagination.
   * @returns {{ datasets, pagination: { page, limit, total, pages } }}
   */
  async listByOwner(ownerId, { page = 1, limit = 20, search, filter } = {}) {
    const query = { ownerAccountId: new ObjectId(ownerId) };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }
    if (filter) query.visibility = filter;

    const datasets = await this.datasetDb.findMany(query, {
      skip: (page - 1) * limit,
      limit: parseInt(limit),
      sort: { updatedAt: -1 },
    });
    const total = await this.datasetDb.count(query);
    return {
      datasets,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get a dataset by ID, with control-embellishment enrichment.
   * @returns {Object|null} dataset document (throws on invalid id)
   */
  async getById(datasetId) {
    const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) return null;

    // Enrich control embellishments with extracted prompts if config.prompt is empty
    if (dataset.embellishments && this.generationOutputsDb) {
      for (const emb of dataset.embellishments) {
        if (emb.type === 'control' && !emb.config?.prompt && emb.results?.length > 0) {
          const firstResultWithGen = emb.results.find(r => r?.generationOutputId);
          if (firstResultWithGen) {
            try {
              const genIdRaw = firstResultWithGen.generationOutputId;
              const genId = typeof genIdRaw === 'string' ? new ObjectId(genIdRaw) : genIdRaw;
              const genOutput = await this.generationOutputsDb.findGenerationById(genId);
              if (genOutput?.requestPayload) {
                const extractedPrompt =
                  genOutput.requestPayload.input_prompt ||
                  genOutput.requestPayload.prompt ||
                  genOutput.requestPayload.input_text ||
                  genOutput.requestPayload.text ||
                  null;
                if (extractedPrompt) {
                  emb.config = emb.config || {};
                  emb.config.prompt = extractedPrompt;
                }
              }
            } catch (err) {
              this.logger.warn(`[DatasetService] Failed to extract prompt for embellishment: ${err.message}`);
            }
          }
        }
      }
    }

    return dataset;
  }

  /**
   * Create a new dataset.
   * @returns {Object} created dataset document
   */
  async create({ masterAccountId, name, description, tags, visibility = 'private', images = [] }) {
    const dataset = await this.datasetDb.createDataset({
      name,
      description: description || '',
      ownerAccountId: new ObjectId(masterAccountId),
      tags: tags || [],
      visibility,
      images: images || [],
    });
    if (!dataset) throw new Error('Failed to create dataset');
    return dataset;
  }

  /**
   * Add images to a dataset (ownership-checked).
   * @returns {{ addedCount: number }}
   */
  async addImages(datasetId, imageUrls, masterAccountId) {
    const existing = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!existing) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (existing.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only modify your own datasets'), { status: 403 });
    }
    await this.datasetDb.addImages(datasetId, imageUrls);
    return { addedCount: imageUrls.length };
  }

  /**
   * Update dataset metadata (ownership-checked).
   * @returns {{ datasetId, updated: boolean }}
   */
  async update(datasetId, masterAccountId, updateData) {
    const existing = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!existing) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (existing.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only update your own datasets'), { status: 403 });
    }
    const result = await this.datasetDb.updateOne(
      { _id: new ObjectId(datasetId) },
      { $set: { ...updateData, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    return { datasetId, updated: true };
  }

  /**
   * Delete a dataset (ownership-checked).
   * @returns {{ deleted: boolean }}
   */
  async delete(datasetId, masterAccountId) {
    const existing = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!existing) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (existing.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only delete your own datasets'), { status: 403 });
    }
    const result = await this.datasetDb.deleteOne({ _id: new ObjectId(datasetId) });
    if (result.deletedCount === 0) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    return { deleted: true };
  }

  // --- Caption operations ---

  /**
   * Start asynchronous caption generation via a spell.
   * Schedules one cast per image with configurable stagger.
   * @returns {{ datasetId, castMap, message }}
   */
  async captionViaSpell(datasetId, { spellSlug, masterAccountId, parameterOverrides = {} }) {
    const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only caption your own datasets'), { status: 403 });
    }
    if (!dataset.images || dataset.images.length === 0) {
      throw Object.assign(new Error('Dataset contains no images'), { status: 400, code: 'NO_IMAGES' });
    }
    if (!this.spellsService) {
      throw Object.assign(new Error('Spell service unavailable'), { status: 503 });
    }

    const imagesHash = sha256Hex(JSON.stringify(dataset.images));
    const castMap = Array(dataset.images.length).fill(null);
    const intervalMs = Number(process.env.CAPTION_CAST_INTERVAL_MS || '30000');

    // Create partial caption set scaffold
    let activeCaptionSetId = null;
    try {
      const partial = await this.datasetDb.addCaptionSet(datasetId, {
        method: spellSlug,
        hash: imagesHash,
        captions: Array(dataset.images.length).fill(null),
        createdBy: new ObjectId(masterAccountId),
        status: 'in_progress',
      });
      activeCaptionSetId = partial?._id || null;
    } catch (err) {
      this.logger.warn('[DatasetService] Failed to initialize caption set scaffold:', err.message);
    }

    const scheduleCast = (idx) => {
      const imageUrl = dataset.images[idx];
      const timer = setTimeout(async () => {
        try {
          const current = await this.datasetDb.findOne(
            { _id: new ObjectId(datasetId) },
            { projection: { captionTask: 1 } }
          );
          if (!current?.captionTask || current.captionTask.status !== 'running') return;
        } catch (statusErr) {
          this.logger.warn(`[DatasetService] Failed to verify caption task status before casting idx ${idx}:`, statusErr.message);
        }

        const context = {
          masterAccountId,
          platform: 'web-sandbox',
          parameterOverrides: { ...parameterOverrides, imageUrl },
          captionTask: { datasetId, imageIndex: idx, totalImages: dataset.images.length, spellSlug },
        };
        try {
          const result = await this.spellsService.castSpell(spellSlug, context, this.castsDb);
          const castId = result?.castId || context.castId || null;
          castMap[idx] = castId;
          await this.datasetDb.updateOne(
            { _id: new ObjectId(datasetId) },
            { $set: { [`captionTask.castMap.${idx}`]: castId } }
          );
        } catch (castErr) {
          this.logger.error(`[DatasetService] Failed casting spell for image ${idx}:`, castErr.message);
        } finally {
          this._unregisterCaptionTimer(datasetId, timer);
        }
      }, idx * intervalMs);
      this._registerCaptionTimer(datasetId, timer);
    };

    dataset.images.forEach((_, idx) => scheduleCast(idx));

    // Emit initial WS event
    try {
      if (this.webSocketService) {
        this.webSocketService.sendToUser(masterAccountId, {
          type: 'captionProgress',
          payload: { datasetId, status: 'started', castMap, imagesHash },
        });
      }
    } catch (wsErr) {
      this.logger.warn('[DatasetService] Failed to emit WS start event:', wsErr.message);
    }

    // Persist captionTask state
    await this.datasetDb.updateOne(
      { _id: new ObjectId(datasetId) },
      {
        $set: {
          captionTask: {
            spellSlug,
            masterAccountId,
            status: 'running',
            startedAt: new Date(),
            imagesHash,
            castMap,
            captions: Array(dataset.images.length).fill(null),
            activeCaptionSetId,
          },
        },
      }
    );

    return { datasetId, castMap, message: 'Caption generation started' };
  }

  /**
   * List caption sets for a dataset (legacy + embellishment-type captions unified).
   * @returns {Array}
   */
  async listCaptions(datasetId) {
    const dataset = await this.datasetDb.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { captionSets: 1, embellishments: 1 } }
    );
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });

    const allCaptions = [...(dataset.captionSets || [])];
    const captionEmbellishments = (dataset.embellishments || []).filter(e => e.type === 'caption');
    for (const emb of captionEmbellishments) {
      allCaptions.push({
        _id: emb._id,
        method: emb.method || 'embellishment',
        status: emb.status,
        createdBy: emb.createdBy,
        createdAt: emb.createdAt,
        completedAt: emb.completedAt,
        captions: (emb.results || []).map(r => r?.value || ''),
        isEmbellishment: true,
        embellishmentId: emb._id,
      });
    }
    return allCaptions;
  }

  /**
   * Cancel an in-progress caption task.
   * @returns {{ cancelled: boolean, reason?: string }}
   */
  async cancelCaptionTask(datasetId, masterAccountId) {
    const dataset = await this.datasetDb.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { ownerAccountId: 1, captionTask: 1 } }
    );
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only cancel your own caption tasks'), { status: 403 });
    }

    const isRunning = dataset.captionTask && dataset.captionTask.status === 'running';
    this._clearCaptionTimers(datasetId);

    if (!isRunning) return { cancelled: false, reason: 'not-running' };

    await this.datasetDb.updateOne(
      { _id: dataset._id },
      { $unset: { captionTask: '' }, $set: { updatedAt: new Date() } }
    );

    try {
      if (this.webSocketService) {
        this.webSocketService.sendToUser(masterAccountId, {
          type: 'captionProgress',
          payload: { datasetId, status: 'cancelled' },
        });
      }
    } catch (wsErr) {
      this.logger.warn('[DatasetService] Failed to emit caption cancel event:', wsErr.message);
    }

    return { cancelled: true };
  }

  /**
   * Delete a caption set or embellishment-type caption (ownership-checked).
   */
  async deleteCaption(datasetId, captionId, masterAccountId) {
    const dataset = await this.datasetDb.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { ownerAccountId: 1, captionSets: 1, embellishments: 1 } }
    );
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only modify your own datasets'), { status: 403 });
    }

    const captionSets = dataset.captionSets || [];
    const target = captionSets.find(cs => cs._id.toString() === captionId);
    if (target) {
      const fallback = captionSets.find(cs => cs._id.toString() !== captionId);
      await this.datasetDb.removeCaptionSet(datasetId, captionId);
      if (target.isDefault && fallback) {
        await this.datasetDb.setDefaultCaptionSet(datasetId, fallback._id.toString());
      }
      return {
        deleted: true,
        reassignedDefault: Boolean(target.isDefault && fallback),
        fallbackCaptionSetId: target.isDefault && fallback ? fallback._id.toString() : null,
      };
    }

    const embellishments = dataset.embellishments || [];
    const embTarget = embellishments.find(e => e._id.toString() === captionId && e.type === 'caption');
    if (embTarget) {
      await this.datasetDb.removeEmbellishment(datasetId, captionId);
      return { deleted: true, isEmbellishment: true };
    }

    throw Object.assign(new Error('Caption set not found'), { status: 404 });
  }

  /**
   * Set a caption set as the default (ownership-checked).
   */
  async setDefaultCaption(datasetId, captionId, masterAccountId) {
    const dataset = await this.datasetDb.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { ownerAccountId: 1, captionSets: 1 } }
    );
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only modify your own datasets'), { status: 403 });
    }
    const target = (dataset.captionSets || []).find(cs => cs._id.toString() === captionId);
    if (!target) throw Object.assign(new Error('Caption set not found'), { status: 404 });

    await this.datasetDb.setDefaultCaptionSet(datasetId, captionId);
    return { captionSetId: captionId };
  }

  /**
   * Update a single caption entry in a caption set (ownership-checked).
   */
  async updateCaptionEntry(datasetId, captionSetId, index, text, masterAccountId) {
    const entryIndex = parseInt(index, 10);
    const dataset = await this.datasetDb.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { ownerAccountId: 1, captionSets: 1 } }
    );
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only edit your own captions'), { status: 403 });
    }
    const captionSet = (dataset.captionSets || []).find(cs => cs._id.toString() === captionSetId);
    if (!captionSet) throw Object.assign(new Error('Caption set not found'), { status: 404 });

    await this.datasetDb.updateCaptionInSet(datasetId, captionSetId, entryIndex, text);
    return { updated: true, index: entryIndex };
  }

  // --- Embellishment operations ---

  /**
   * Create a manual (empty) embellishment for a dataset (ownership-checked).
   */
  async createManualEmbellishment(datasetId, masterAccountId, type = 'caption') {
    const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only add embellishments to your own datasets'), { status: 403 });
    }
    if (!dataset.images || dataset.images.length === 0) {
      throw Object.assign(new Error('Dataset has no images'), { status: 400 });
    }

    const embellishment = await this.datasetDb.addEmbellishment(datasetId, {
      type,
      method: 'manual',
      status: 'completed',
      createdBy: masterAccountId,
      results: dataset.images.map(() => ({ value: null, generationOutputId: null })),
    });

    return { embellishmentId: embellishment._id, type, method: 'manual', totalItems: dataset.images.length };
  }

  /**
   * List embellishments for a dataset, optionally filtered by type.
   */
  async listEmbellishments(datasetId, type = null) {
    return this.datasetDb.getEmbellishments(datasetId, type || null);
  }

  /**
   * Delete an embellishment (ownership-checked).
   */
  async deleteEmbellishment(datasetId, embellishmentId, masterAccountId) {
    const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only delete your own embellishments'), { status: 403 });
    }
    await this.datasetDb.removeEmbellishment(datasetId, embellishmentId);
    return { deleted: true };
  }

  /**
   * Update a single embellishment result (ownership-checked).
   */
  async updateEmbellishmentResult(datasetId, embellishmentId, index, value, masterAccountId) {
    const resultIndex = parseInt(index, 10);
    const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only edit your own embellishments'), { status: 403 });
    }
    await this.datasetDb.updateEmbellishmentResult(datasetId, embellishmentId, resultIndex, {
      value: value ?? null,
      generationOutputId: null,
    });
    return { updated: true, index: resultIndex };
  }

  /**
   * Bulk update embellishment results (ownership-checked).
   */
  async bulkUpdateEmbellishmentResults(datasetId, embellishmentId, results, masterAccountId) {
    const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
    if (dataset.ownerAccountId.toString() !== masterAccountId) {
      throw Object.assign(new Error('You can only edit your own embellishments'), { status: 403 });
    }
    for (let i = 0; i < results.length; i++) {
      if (results[i] !== undefined) {
        await this.datasetDb.updateEmbellishmentResult(datasetId, embellishmentId, i, {
          value: results[i]?.value ?? results[i] ?? null,
          generationOutputId: null,
        });
      }
    }
    return { updated: true, count: results.length };
  }

  /**
   * Regenerate a single embellishment item via embellishmentTaskService.
   */
  async regenerateEmbellishmentItem(datasetId, embellishmentId, index, masterAccountId, config = null) {
    return this.embellishmentTaskService.regenerateSingleItem(
      datasetId,
      embellishmentId,
      parseInt(index, 10),
      masterAccountId,
      config
    );
  }

  /**
   * Start an embellishment task via a spell.
   */
  async startEmbellishment(datasetId, { spellSlug, masterAccountId, parameterOverrides = {} }) {
    const result = await this.embellishmentTaskService.startTask(
      datasetId,
      spellSlug,
      masterAccountId,
      parameterOverrides
    );
    return {
      taskId: result.taskId,
      embellishmentId: result.embellishmentId,
      type: result.type,
      totalItems: result.totalItems,
      message: 'Embellishment task started',
    };
  }

  /**
   * Cancel a running embellishment task.
   */
  async cancelEmbellishmentTask(taskId, masterAccountId) {
    return this.embellishmentTaskService.cancelTask(taskId, masterAccountId);
  }

  /**
   * List spells with embellishment capabilities.
   */
  async listEmbellishmentSpells(type = null) {
    const spells = await this.spellsDb.findEmbellishmentSpells(type || null);
    return spells.map(spell => ({
      slug: spell.slug,
      name: spell.name,
      description: spell.description,
      embellishment: spell.embellishment,
    }));
  }
}

module.exports = { DatasetService };
