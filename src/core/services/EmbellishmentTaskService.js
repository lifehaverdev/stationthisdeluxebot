// src/core/services/EmbellishmentTaskService.js
const notificationEvents = require('../events/notificationEvents');
const { ObjectId } = require('mongodb');

/**
 * EmbellishmentTaskService
 *
 * Orchestrates dataset embellishment tasks (captions, control images, etc.)
 * Features:
 * - N-at-a-time concurrency (default 2)
 * - Success-based progression (not setTimeout)
 * - Per-item retry support
 * - Spell metadata-driven result extraction
 */
function createEmbellishmentTaskService(deps) {
  const {
    logger = console,
    db,
    websocketService,
  } = deps;

  // spellsService is mutable so it can be injected after initialization
  let spellsService = deps.spellsService || null;

  if (!db?.embellishmentTasks || !db?.dataset || !db?.spells) {
    logger.warn('[EmbellishmentTaskService] Required DBs not provided – service disabled');
    return null;
  }

  const embellishmentTasksDb = db.embellishmentTasks;
  const datasetDb = db.dataset;
  const spellsDb = db.spells;
  const castsDb = db.casts;
  const generationOutputsDb = db.generationOutputs;

  const CONCURRENCY = Number(process.env.EMBELLISHMENT_CONCURRENCY || '2');
  const MAX_RETRIES = Number(process.env.EMBELLISHMENT_MAX_RETRIES || '3');
  const RETRY_DELAY_MS = Number(process.env.EMBELLISHMENT_RETRY_DELAY_MS || '2000');

  // Track active processing per task to manage concurrency
  const activeProcessing = new Map(); // taskId -> Set of itemIndexes

  /**
   * Extract result from generation output using spell's extraction config
   */
  function extractResult(generationOutput, extractionConfig) {
    if (!extractionConfig?.path) return null;
    if (!generationOutput) return null;

    const { path, valueType } = extractionConfig;

    // Helper to get first string from value (handles strings and arrays)
    const getFirstString = (val) => {
      if (typeof val === 'string') return val.trim();
      if (Array.isArray(val) && typeof val[0] === 'string') return val[0].trim();
      if (Array.isArray(val) && val[0]?.text) return val[0].text.trim();
      return null;
    };

    // DIRECT EXTRACTION for known caption formats
    if (path === 'text' && valueType === 'text') {
      const rp = generationOutput.responsePayload;

      // Format 1: responsePayload: { result: "caption text" }
      if (rp && typeof rp === 'object' && !Array.isArray(rp) && rp.result) {
        const result = getFirstString(rp.result);
        if (result) return result;
      }

      // Format 2: responsePayload: [{ type: 'text', data: { text: ['caption'] } }]
      if (Array.isArray(rp) && rp[0]?.data?.text) {
        const result = getFirstString(rp[0].data.text);
        if (result) return result;
      }

      // Format 3: responsePayload: [{ type: 'text', text: '...' }]
      if (Array.isArray(rp) && rp[0]?.text) {
        const result = getFirstString(rp[0].text);
        if (result) return result;
      }

      // Format 4: responsePayload: { text: '...' }
      if (rp && typeof rp === 'object' && !Array.isArray(rp) && rp.text) {
        const result = getFirstString(rp.text);
        if (result) return result;
      }
      // Also check outputs.text directly (WebSocket format)
      if (generationOutput.outputs?.text) {
        const result = getFirstString(generationOutput.outputs.text);
        if (result) return result;
      }
      // Check direct text field
      if (generationOutput.text) {
        const result = getFirstString(generationOutput.text);
        if (result) return result;
      }
    }

    // GENERIC PATH RESOLUTION for other extraction configs
    const resolvePath = (obj, pathStr) => {
      if (!obj) return null;
      const parts = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current = obj;
      for (const part of parts) {
        if (current == null) return null;
        current = current[part];
      }
      return current;
    };

    // Try multiple sources
    const responsePayload = generationOutput.responsePayload;
    const firstResponseItem = Array.isArray(responsePayload) ? responsePayload[0] : responsePayload;

    const sources = [
      generationOutput,
      generationOutput.outputs,
      generationOutput.outputs?.data,
      responsePayload,
      firstResponseItem,
      firstResponseItem?.data,
      generationOutput.result,
    ];

    for (const source of sources) {
      const value = resolvePath(source, path);
      if (value != null) {
        if (valueType === 'text') {
          const result = getFirstString(value);
          if (result) return result;
        }
        if (valueType === 'url' && typeof value === 'string') {
          return value;
        }
        if (valueType === 'url' && Array.isArray(value) && typeof value[0] === 'string') {
          return value[0];
        }
      }
    }

    logger.warn(`[extractResult] No value found for path="${path}" in generation output`);
    return null;
  }

  /**
   * Start an embellishment task
   */
  async function startTask(datasetId, spellSlug, ownerAccountId, parameterOverrides = {}) {
    // 1. Validate spell has embellishment metadata
    const embellishmentMeta = await spellsDb.getEmbellishmentMetadata(spellSlug);
    if (!embellishmentMeta) {
      throw new Error(`Spell "${spellSlug}" does not have embellishment capabilities`);
    }

    // 2. Validate dataset exists and user owns it
    const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) {
      throw new Error('Dataset not found');
    }
    if (dataset.ownerAccountId.toString() !== ownerAccountId) {
      throw new Error('You can only embellish your own datasets');
    }
    if (!dataset.images || dataset.images.length === 0) {
      throw new Error('Dataset contains no images');
    }

    // 3. Check for existing running tasks of same type
    const runningTasks = await embellishmentTasksDb.findRunningTasksForDataset(datasetId);
    const conflictingTask = runningTasks.find(t => t.type === embellishmentMeta.type);
    if (conflictingTask) {
      throw new Error(`An embellishment task of type "${embellishmentMeta.type}" is already running for this dataset`);
    }

    // 4. Create embellishment placeholder in dataset
    const embellishment = await datasetDb.addEmbellishment(datasetId, {
      type: embellishmentMeta.type,
      method: spellSlug,
      createdBy: ownerAccountId,
      config: parameterOverrides, // Store config for regeneration
      results: Array(dataset.images.length).fill(null),
    });

    // 5. Create embellishment task
    const items = dataset.images.map((_, index) => ({
      index,
      castId: null,
      generationOutputId: null,
      status: 'pending',
      retryCount: 0,
      error: null,
      completedAt: null,
    }));

    const task = await embellishmentTasksDb.createTask({
      datasetId,
      ownerAccountId,
      type: embellishmentMeta.type,
      spellSlug,
      parameterOverrides,
      totalItems: dataset.images.length,
      items,
    });

    // 6. Link task to embellishment
    await embellishmentTasksDb.setEmbellishmentId(task._id, embellishment._id);

    // 7. Start processing
    await embellishmentTasksDb.setStatus(task._id, 'running');

    // 8. Send WebSocket event
    emitProgress(task._id, datasetId, embellishmentMeta.type, ownerAccountId, 'started', {
      total: dataset.images.length,
      completed: 0,
      failed: 0,
    });

    // 9. Kick off initial batch
    processNextBatch(task._id, datasetId, spellSlug, ownerAccountId, parameterOverrides, dataset.images, embellishmentMeta);

    logger.info(`[EmbellishmentTaskService] Started task ${task._id} for dataset ${datasetId} (type: ${embellishmentMeta.type})`);

    return {
      taskId: task._id,
      embellishmentId: embellishment._id,
      type: embellishmentMeta.type,
      totalItems: dataset.images.length,
    };
  }

  /**
   * Process next batch of items (up to CONCURRENCY limit)
   */
  async function processNextBatch(taskId, datasetId, spellSlug, ownerAccountId, parameterOverrides, images, embellishmentMeta) {
    const taskIdStr = taskId.toString();

    // Get current active count for this task
    if (!activeProcessing.has(taskIdStr)) {
      activeProcessing.set(taskIdStr, new Set());
    }
    const activeSet = activeProcessing.get(taskIdStr);

    // Check task is still running
    const task = await embellishmentTasksDb.findById(taskId);
    if (!task || task.status !== 'running') {
      activeProcessing.delete(taskIdStr);
      return;
    }

    // Find pending items
    const pendingItems = task.items.filter(item =>
      item.status === 'pending' && !activeSet.has(item.index)
    );

    // Calculate how many we can start
    const slotsAvailable = CONCURRENCY - activeSet.size;
    const toProcess = pendingItems.slice(0, slotsAvailable);

    if (toProcess.length === 0) {
      // No more items to process - check if we're done
      if (activeSet.size === 0) {
        await finalizeTask(taskId, datasetId, ownerAccountId, embellishmentMeta.type);
      }
      return;
    }

    // Start processing each item
    for (const item of toProcess) {
      activeSet.add(item.index);
      processItem(taskId, datasetId, spellSlug, ownerAccountId, parameterOverrides, images, embellishmentMeta, item.index);
    }
  }

  /**
   * Process a single item
   */
  async function processItem(taskId, datasetId, spellSlug, ownerAccountId, parameterOverrides, images, embellishmentMeta, itemIndex) {
    const imageUrl = images[itemIndex];

    // Mark item as processing
    await embellishmentTasksDb.updateItem(taskId, itemIndex, { status: 'processing' });

    const context = {
      masterAccountId: ownerAccountId,
      platform: 'web-sandbox',
      parameterOverrides: {
        ...parameterOverrides,
        imageUrl,
      },
      embellishmentTask: {
        taskId: taskId.toString(),
        datasetId,
        itemIndex,
        type: embellishmentMeta.type,
        spellSlug,
      },
    };

    try {
      const result = await spellsService.castSpell(spellSlug, context, castsDb);
      const castId = result?.castId || context.castId || null;

      if (castId) {
        await embellishmentTasksDb.updateItem(taskId, itemIndex, {
          castId: new ObjectId(castId)
        });
      }

      logger.debug(`[EmbellishmentTaskService] Cast spell for task ${taskId} item ${itemIndex}, castId: ${castId}`);
    } catch (err) {
      logger.error(`[EmbellishmentTaskService] Failed to cast spell for item ${itemIndex}:`, err.message);
      await handleItemFailure(taskId, datasetId, ownerAccountId, itemIndex, err.message, images, embellishmentMeta, parameterOverrides, spellSlug);
    }
  }

  /**
   * Handle item completion from spell completion event
   */
  async function handleSpellCompletion(payload) {
    const embellishmentMeta = payload.embellishmentTask;
    if (!embellishmentMeta) return;

    const { taskId, datasetId, itemIndex, type, spellSlug } = embellishmentMeta;
    const ownerAccountId = payload.masterAccountId;
    const generationId = payload.finalGenerationId || (
      Array.isArray(payload.stepGenerationIds) && payload.stepGenerationIds.length
        ? payload.stepGenerationIds[payload.stepGenerationIds.length - 1]
        : null
    );

    logger.debug(`[EmbellishmentTaskService] handleSpellCompletion called for task ${taskId} item ${itemIndex}`);

    // Get spell extraction config
    const spellMeta = await spellsDb.getEmbellishmentMetadata(spellSlug);
    if (!spellMeta) {
      logger.error(`[EmbellishmentTaskService] Spell ${spellSlug} no longer has embellishment metadata`);
      return;
    }

    // Get generation output - try multiple sources
    let generationOutput = payload.finalGenerationRecord || payload.finalStepSnapshot;

    // If no responsePayload in the snapshot, fetch from DB
    if (!generationOutput?.responsePayload && generationId && generationOutputsDb) {
      logger.debug(`[EmbellishmentTaskService] No responsePayload in event, fetching gen ${generationId} from DB`);
      generationOutput = await generationOutputsDb.findGenerationById(generationId);
    }

    // Extract result
    const extractedValue = extractResult(generationOutput, spellMeta.resultExtraction);

    if (!extractedValue) {
      logger.warn(`[EmbellishmentTaskService] Failed to extract result for task ${taskId} item ${itemIndex}`);

      // Get task and dataset for retry
      const task = await embellishmentTasksDb.findById(taskId);
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });

      if (task && dataset) {
        await handleItemFailure(
          taskId, datasetId, ownerAccountId, itemIndex,
          'Failed to extract result from spell output',
          dataset.images, spellMeta, task.parameterOverrides, spellSlug
        );
      }
      return;
    }

    // Update task item
    await embellishmentTasksDb.completeItem(taskId, itemIndex, generationId);

    // Update dataset embellishment result
    const task = await embellishmentTasksDb.findById(taskId);
    if (task?.embellishmentId) {
      await datasetDb.updateEmbellishmentResult(datasetId, task.embellishmentId, itemIndex, {
        generationOutputId: generationId,
        value: extractedValue,
      });

      // For control type embellishments, extract and store the prompt from the first completed item
      // This ensures the training wizard can display the prompt without refetching generation outputs
      if (type === 'control' && generationOutput?.requestPayload) {
        const controlPrompt =
          generationOutput.requestPayload.input_prompt ||
          generationOutput.requestPayload.prompt ||
          generationOutput.requestPayload.input_text ||
          generationOutput.requestPayload.text ||
          null;

        if (controlPrompt) {
          // Check if prompt is already stored in config
          const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
          const embellishment = dataset?.embellishments?.find(
            e => e._id.toString() === task.embellishmentId.toString()
          );

          if (!embellishment?.config?.prompt) {
            logger.info(`[EmbellishmentTaskService] Storing control prompt in embellishment config: "${controlPrompt.substring(0, 50)}..."`);
            await datasetDb.updateEmbellishmentConfig(datasetId, task.embellishmentId, {
              prompt: controlPrompt
            });
          }
        }
      }
    }

    // Remove from active set
    const taskIdStr = taskId.toString();
    const activeSet = activeProcessing.get(taskIdStr);
    if (activeSet) {
      activeSet.delete(itemIndex);
    }

    // Emit progress
    const updatedTask = await embellishmentTasksDb.findById(taskId);
    emitProgress(taskId, datasetId, type, ownerAccountId, 'item_completed', {
      total: updatedTask.totalItems,
      completed: updatedTask.completedItems,
      failed: updatedTask.failedItems,
    }, { itemIndex, value: extractedValue });

    // Get dataset for next batch
    const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });

    // Process next batch
    processNextBatch(taskId, datasetId, spellSlug, ownerAccountId, updatedTask.parameterOverrides, dataset.images, spellMeta);
  }

  /**
   * Handle item failure with retry logic
   */
  async function handleItemFailure(taskId, datasetId, ownerAccountId, itemIndex, error, images, embellishmentMeta, parameterOverrides, spellSlug) {
    const task = await embellishmentTasksDb.findById(taskId);
    const item = task?.items[itemIndex];

    if (item && item.retryCount < MAX_RETRIES) {
      // Schedule retry
      logger.info(`[EmbellishmentTaskService] Scheduling retry ${item.retryCount + 1}/${MAX_RETRIES} for task ${taskId} item ${itemIndex}`);

      await embellishmentTasksDb.updateItem(taskId, itemIndex, {
        status: 'pending',
        retryCount: item.retryCount + 1,
      });

      // Remove from active set
      const taskIdStr = taskId.toString();
      const activeSet = activeProcessing.get(taskIdStr);
      if (activeSet) {
        activeSet.delete(itemIndex);
      }

      // Delay before retry
      setTimeout(() => {
        processNextBatch(taskId, datasetId, spellSlug, ownerAccountId, parameterOverrides, images, embellishmentMeta);
      }, RETRY_DELAY_MS);
    } else {
      // Max retries exceeded - fail item
      await embellishmentTasksDb.failItem(taskId, itemIndex, error);

      // Remove from active set
      const taskIdStr = taskId.toString();
      const activeSet = activeProcessing.get(taskIdStr);
      if (activeSet) {
        activeSet.delete(itemIndex);
      }

      // Emit progress
      const updatedTask = await embellishmentTasksDb.findById(taskId);
      emitProgress(taskId, datasetId, embellishmentMeta.type, ownerAccountId, 'item_failed', {
        total: updatedTask.totalItems,
        completed: updatedTask.completedItems,
        failed: updatedTask.failedItems,
      }, { itemIndex, error });

      // Process next batch
      processNextBatch(taskId, datasetId, spellSlug, ownerAccountId, parameterOverrides, images, embellishmentMeta);
    }
  }

  /**
   * Finalize task when all items are processed
   */
  async function finalizeTask(taskId, datasetId, ownerAccountId, type) {
    const task = await embellishmentTasksDb.findById(taskId);
    if (!task || task.status !== 'running') return;

    const hasFailures = task.failedItems > 0;
    const finalStatus = hasFailures ? 'failed' : 'completed';

    // Update task status
    await embellishmentTasksDb.setStatus(taskId, finalStatus);

    // Update embellishment status
    if (task.embellishmentId) {
      await datasetDb.setEmbellishmentStatus(datasetId, task.embellishmentId, finalStatus);
    }

    // Clean up active tracking
    activeProcessing.delete(taskId.toString());

    // Emit final progress
    emitProgress(taskId, datasetId, type, ownerAccountId, finalStatus, {
      total: task.totalItems,
      completed: task.completedItems,
      failed: task.failedItems,
    });

    logger.info(`[EmbellishmentTaskService] Task ${taskId} finalized with status: ${finalStatus}`);
  }

  /**
   * Cancel a running task
   */
  async function cancelTask(taskId, ownerAccountId) {
    const task = await embellishmentTasksDb.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    if (task.ownerAccountId.toString() !== ownerAccountId) {
      throw new Error('You can only cancel your own tasks');
    }

    // Atomically set status to cancelled only if running
    const updated = await embellishmentTasksDb.setStatusIfMatch(taskId, 'running', 'cancelled');
    if (!updated) {
      return { cancelled: false, reason: 'not-running' };
    }

    // Update embellishment status
    if (task.embellishmentId) {
      await datasetDb.setEmbellishmentStatus(task.datasetId, task.embellishmentId, 'failed', {
        error: 'Cancelled by user'
      });
    }

    // Clean up
    activeProcessing.delete(taskId.toString());

    // Emit cancellation event
    emitProgress(taskId, task.datasetId, task.type, ownerAccountId, 'cancelled', {
      total: task.totalItems,
      completed: task.completedItems,
      failed: task.failedItems,
    });

    logger.info(`[EmbellishmentTaskService] Task ${taskId} cancelled by user`);

    return { cancelled: true };
  }

  /**
   * Emit WebSocket progress event
   */
  function emitProgress(taskId, datasetId, type, ownerAccountId, status, progress, extra = {}) {
    if (!websocketService) return;

    try {
      websocketService.sendToUser(ownerAccountId, {
        type: 'embellishmentProgress',
        payload: {
          taskId: taskId.toString(),
          datasetId: datasetId.toString(),
          embellishmentType: type,
          status,
          progress,
          ...extra,
        },
      });
    } catch (err) {
      logger.warn('[EmbellishmentTaskService] Failed to emit WebSocket event:', err.message);
    }
  }

  /**
   * Get task progress
   */
  async function getTaskProgress(taskId) {
    const task = await embellishmentTasksDb.findById(taskId);
    if (!task) return null;

    return {
      taskId: task._id,
      datasetId: task.datasetId,
      type: task.type,
      status: task.status,
      progress: {
        total: task.totalItems,
        completed: task.completedItems,
        failed: task.failedItems,
      },
      items: task.items,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }


  /**
   * Set spellsService (for late injection after SpellsService is initialized)
   */
  function setSpellsService(service) {
    spellsService = service;
    logger.info('[EmbellishmentTaskService] SpellsService injected.');
  }

  /**
   * Regenerate a single item in an embellishment
   * @param {string} datasetId
   * @param {string} embellishmentId
   * @param {number} itemIndex
   * @param {string} ownerAccountId
   * @param {Object} overrideConfig - Optional config overrides (for legacy embellishments without stored config)
   */
  async function regenerateSingleItem(datasetId, embellishmentId, itemIndex, ownerAccountId, overrideConfig = null) {
    // 1. Get dataset and embellishment
    const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
    if (!dataset) {
      throw new Error('Dataset not found');
    }
    if (dataset.ownerAccountId.toString() !== ownerAccountId) {
      throw new Error('You can only regenerate your own embellishments');
    }

    const embellishment = (dataset.embellishments || []).find(
      e => e._id.toString() === embellishmentId
    );
    if (!embellishment) {
      throw new Error('Embellishment not found');
    }

    const spellSlug = embellishment.method;
    // Use override config if provided, otherwise fall back to stored config
    const parameterOverrides = overrideConfig || embellishment.config || {};

    // 2. Get spell metadata
    const embellishmentMeta = await spellsDb.getEmbellishmentMetadata(spellSlug);
    if (!embellishmentMeta) {
      throw new Error(`Spell "${spellSlug}" no longer has embellishment capabilities`);
    }

    // 3. Validate item index
    if (itemIndex < 0 || itemIndex >= dataset.images.length) {
      throw new Error('Invalid item index');
    }

    const imageUrl = dataset.images[itemIndex];

    // 4. Cast the spell for this single image
    const context = {
      masterAccountId: ownerAccountId,
      platform: 'web-sandbox',
      parameterOverrides: {
        ...parameterOverrides,
        imageUrl,
      },
      embellishmentRegenerate: {
        datasetId,
        embellishmentId,
        itemIndex,
        type: embellishmentMeta.type,
        spellSlug,
      },
    };

    try {
      const result = await spellsService.castSpell(spellSlug, context, castsDb);
      const castId = result?.castId || context.castId || null;

      logger.info(`[EmbellishmentTaskService] Regenerate cast for embellishment ${embellishmentId} item ${itemIndex}, castId: ${castId}`);

      return {
        success: true,
        castId,
        itemIndex,
        message: 'Regeneration started',
      };
    } catch (err) {
      logger.error(`[EmbellishmentTaskService] Failed to regenerate item ${itemIndex}:`, err.message);
      throw new Error(`Failed to start regeneration: ${err.message}`);
    }
  }

  /**
   * Handle regeneration completion from spell completion event
   */
  async function handleRegenerateCompletion(payload) {
    const regenerateMeta = payload.embellishmentRegenerate;
    if (!regenerateMeta) return;

    const { datasetId, embellishmentId, itemIndex, type, spellSlug } = regenerateMeta;
    const ownerAccountId = payload.masterAccountId;
    const generationId = payload.finalGenerationId || (
      Array.isArray(payload.stepGenerationIds) && payload.stepGenerationIds.length
        ? payload.stepGenerationIds[payload.stepGenerationIds.length - 1]
        : null
    );

    logger.debug(`[EmbellishmentTaskService] handleRegenerateCompletion for embellishment ${embellishmentId} item ${itemIndex}`);

    // Get spell extraction config
    const spellMeta = await spellsDb.getEmbellishmentMetadata(spellSlug);
    if (!spellMeta) {
      logger.error(`[EmbellishmentTaskService] Spell ${spellSlug} no longer has embellishment metadata`);
      return;
    }

    // Get generation output
    let generationOutput = payload.finalGenerationRecord || payload.finalStepSnapshot;
    if (!generationOutput?.responsePayload && generationId && generationOutputsDb) {
      generationOutput = await generationOutputsDb.findGenerationById(generationId);
    }

    // Extract result
    const extractedValue = extractResult(generationOutput, spellMeta.resultExtraction);

    if (!extractedValue) {
      logger.warn(`[EmbellishmentTaskService] Failed to extract result for regenerate item ${itemIndex}`);

      // Emit failure event
      if (websocketService) {
        websocketService.sendToUser(ownerAccountId, {
          type: 'embellishmentRegenerateResult',
          payload: {
            datasetId,
            embellishmentId,
            itemIndex,
            success: false,
            error: 'Failed to extract result from spell output',
          },
        });
      }
      return;
    }

    // Update dataset embellishment result
    await datasetDb.updateEmbellishmentResult(datasetId, embellishmentId, itemIndex, {
      generationOutputId: generationId,
      value: extractedValue,
    });

    // Emit success event
    if (websocketService) {
      websocketService.sendToUser(ownerAccountId, {
        type: 'embellishmentRegenerateResult',
        payload: {
          datasetId,
          embellishmentId,
          itemIndex,
          success: true,
          value: extractedValue,
        },
      });
    }

    logger.info(`[EmbellishmentTaskService] Regenerated item ${itemIndex} for embellishment ${embellishmentId}`);
  }

  // Listen for spell completions (also handle regenerate)
  notificationEvents.on('spellCompletion', async (payload = {}) => {
    try {
      if (payload.embellishmentTask) {
        await handleSpellCompletion(payload);
      }
      if (payload.embellishmentRegenerate) {
        await handleRegenerateCompletion(payload);
      }
    } catch (err) {
      logger.error('[EmbellishmentTaskService] Error handling spell completion:', err);
    }
  });

  logger.info('[EmbellishmentTaskService] Listener attached.');

  return {
    startTask,
    cancelTask,
    getTaskProgress,
    regenerateSingleItem,
    setSpellsService,
  };
}

module.exports = createEmbellishmentTaskService;
