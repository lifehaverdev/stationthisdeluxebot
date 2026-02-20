const notificationEvents = require('../events/notificationEvents');
const { ObjectId } = require('mongodb');

/**
 * CaptionTaskService – listens for generation completion events and assembles
 * caption sets for datasets captioned via spell.
 * No polling – purely event-driven.
 *
 * @param {Object} deps – { logger, db, websocketService }
 */
function createCaptionTaskService(deps) {
  const { logger = console, db, websocketService } = deps;
  if (!db || !db.dataset) {
    logger.warn('[CaptionTaskService] datasetDb not provided – service disabled');
    return;
  }
  const datasetDb = db.dataset;
  const generationOutputsDb = db.generationOutputs;
  const CAPTION_EXTRACTION_RETRIES = Number(process.env.CAPTION_EXTRACTION_RETRIES || '3');
  const CAPTION_EXTRACTION_RETRY_DELAY_MS = Number(process.env.CAPTION_EXTRACTION_RETRY_DELAY_MS || '1500');
  const pendingExtractionRetries = new Map(); // castId -> timeout

  const CAPTION_PREVIEW_LIMIT = 200;
  const MAX_LOGGED_KEYS = 8;

  const previewText = (value) => {
    if (typeof value !== 'string') return null;
    if (value.length <= CAPTION_PREVIEW_LIMIT) return value;
    return `${value.slice(0, CAPTION_PREVIEW_LIMIT)}...`;
  };

  const summarizeKeys = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return Object.keys(obj).slice(0, MAX_LOGGED_KEYS);
  };

  const summarizeGenerationRecord = (record) => {
    if (!record || typeof record !== 'object') return null;
    return {
      id: (record._id && record._id.toString ? record._id.toString() : record._id) || null,
      status: record.status || null,
      deliveryStatus: record.deliveryStatus || null,
      hasOutputs: Boolean(record.outputs),
      outputKeys: summarizeKeys(record.outputs),
      hasResponsePayload: Boolean(record.responsePayload),
      responsePayloadKeys: summarizeKeys(record.responsePayload),
      textLength: typeof record.text === 'string' ? record.text.length : null,
      resultType: record.result ? (Array.isArray(record.result) ? 'array' : typeof record.result) : null,
    };
  };

  /**
   * Attempt to extract caption string from generation record payload.
   * Supports various schema variants.
   */
  function extractCaption(gen, debugInfo = null, sourceTag = 'record') {
    const pickText = (val) => {
      if (!val) return null;
      if (typeof val === 'string') return val.trim();
      if (Array.isArray(val)) {
        for (const entry of val) {
          const text = pickText(entry);
          if (text) return text;
        }
      }
      if (typeof val === 'object') {
        if (typeof val.text === 'string') return val.text.trim();
        if (Array.isArray(val.text)) {
          const text = pickText(val.text);
          if (text) return text;
        }
        if (typeof val.caption === 'string') return val.caption.trim();
        if (Array.isArray(val.captions) && val.captions[0]) {
          return pickText(val.captions[0]);
        }
        if (typeof val.result === 'string') return val.result.trim();
        if (Array.isArray(val.result)) {
          const text = pickText(val.result);
          if (text) return text;
        }
        if (Array.isArray(val.outputs)) {
          const text = pickText(val.outputs);
          if (text) return text;
        }
        if (val.outputs && typeof val.outputs === 'object') {
          const text = pickText(Object.values(val.outputs));
          if (text) return text;
        }
        if (Array.isArray(val.choices) && val.choices[0]?.message?.content) {
          return val.choices[0].message.content.trim();
        }
      }
      return null;
    };

    const traceAttempt = (field, value, extracted) => {
      if (!debugInfo) return;
      debugInfo.attempts.push({
        source: sourceTag,
        field,
        hasValue: value !== undefined && value !== null,
        valueType: Array.isArray(value) ? 'array' : typeof value,
        extractedPreview: extracted ? previewText(extracted) : null,
      });
    };

    const trySource = (field, value) => {
      const text = pickText(value);
      traceAttempt(field, value, text);
      return text;
    };

    return (
      trySource('outputs', gen?.outputs) ||
      trySource('responsePayload.outputs', gen?.responsePayload?.outputs) ||
      trySource('responsePayload.data', gen?.responsePayload?.data) ||
      trySource('responsePayload.result', gen?.responsePayload?.result) ||
      trySource('responsePayload', gen?.responsePayload) ||
      trySource('outputs.result', gen?.outputs?.result) ||
      trySource('text', gen?.text) ||
      trySource('result', gen?.result) ||
      null
    );
  }

  async function fetchGenerationRecord(generationId) {
    if (!generationId || !generationOutputsDb) return null;
    try {
      const record = await generationOutputsDb.findGenerationById(generationId);
      return record || null;
    } catch (err) {
      logger.warn('[CaptionTaskService] Failed fetching generation record:', err.message);
      return null;
    }
  }

  async function failCaptionTask(datasetId, masterAccountId, reason = 'extraction_failed') {
    if (!datasetId) return;
    let activeCaptionSetId = null;
    try {
      const dataset = await datasetDb.findOne(
        { _id: new ObjectId(datasetId) },
        { projection: { captionTask: 1 } }
      );
      activeCaptionSetId = dataset?.captionTask?.activeCaptionSetId || null;
    } catch (lookupErr) {
      logger.warn('[CaptionTaskService] Failed to lookup caption task while failing:', lookupErr.message);
    }

    try {
      await datasetDb.updateOne(
        { _id: new ObjectId(datasetId) },
        { $set: { 'captionTask.status': 'failed', 'captionTask.error': reason, updatedAt: new Date() } }
      );
    } catch (err) {
      logger.error('[CaptionTaskService] Failed updating caption task status to failed:', err.message);
    }
    if (activeCaptionSetId) {
      try {
        await datasetDb.setCaptionSetStatus(datasetId, activeCaptionSetId, 'failed', { error: reason });
      } catch (setErr) {
        logger.warn('[CaptionTaskService] Failed marking caption set failed:', setErr.message);
      }
    }
    if (websocketService) {
      try {
        websocketService.sendToUser(masterAccountId, {
          type: 'captionProgress',
          payload: {
            datasetId: datasetId.toString(),
            status: 'failed',
            error: reason,
          },
        });
      } catch (wsErr) {
        logger.warn('[CaptionTaskService] Failed to emit caption failure event:', wsErr.message);
      }
    }
  }

  function scheduleRetry(ctx) {
    const { castId } = ctx;
    const timer = setTimeout(() => {
      pendingExtractionRetries.delete(castId);
      processCaptionExtraction(ctx);
    }, CAPTION_EXTRACTION_RETRY_DELAY_MS);
    pendingExtractionRetries.set(castId, timer);
  }

  async function processCaptionExtraction(ctx) {
    const { datasetId, masterAccountId, imageIndex, castId, attempt, generationId, gen, finalStepSnapshot } = ctx;
    const extractionDebug = { attempts: [] };
    let caption = null;
    let inspectedRecord = null;

    const tryRecord = (record, label) => {
      if (!record || typeof record !== 'object') return null;
      const text = extractCaption(record, extractionDebug, label);
      if (text) {
        inspectedRecord = record;
        return text;
      }
      if (!inspectedRecord) {
        inspectedRecord = record;
      }
      return null;
    };

    caption = tryRecord(finalStepSnapshot, 'finalStepSnapshot') || tryRecord(gen, 'eventRecord');

    if (!caption) {
      const freshRecord = await fetchGenerationRecord(generationId);
      if (freshRecord) {
        caption = tryRecord(freshRecord, 'generationRecord');
      }
    }

    if (!caption) {
      if (attempt < CAPTION_EXTRACTION_RETRIES) {
        const nextAttempt = attempt + 1;
        const logDetails = {
          datasetId,
          imageIndex,
          castId,
          generationId,
          attempt: nextAttempt,
          inspectedSources: extractionDebug.attempts,
          latestRecordSnapshot: summarizeGenerationRecord(inspectedRecord || gen || finalStepSnapshot || null),
        };
        logger.warn(`[CaptionTaskService] Caption missing for cast ${castId} (attempt ${nextAttempt}/${CAPTION_EXTRACTION_RETRIES}). Retrying in ${CAPTION_EXTRACTION_RETRY_DELAY_MS}ms. details=${JSON.stringify(logDetails)}`);
        scheduleRetry({ ...ctx, attempt: nextAttempt, gen: null });
      } else {
        logger.error(`[CaptionTaskService] Caption extraction failed for cast ${castId} after ${CAPTION_EXTRACTION_RETRIES} attempts. Marking task failed.`);
        pendingExtractionRetries.delete(castId);
        await failCaptionTask(datasetId, masterAccountId);
      }
      return;
    }

    pendingExtractionRetries.delete(castId);

    const dataset = await datasetDb.findOne(
      { _id: new ObjectId(datasetId) },
      { projection: { captionTask: 1 } }
    );
    if (!dataset || !dataset.captionTask || dataset.captionTask.status !== 'running') {
      return;
    }
    const captionTask = dataset.captionTask;
    captionTask.captions[imageIndex] = caption;
    const activeCaptionSetId = captionTask.activeCaptionSetId
      ? captionTask.activeCaptionSetId.toString()
      : null;

    if (activeCaptionSetId) {
      try {
        await datasetDb.updateCaptionInSet(datasetId, activeCaptionSetId, imageIndex, caption);
      } catch (setErr) {
        logger.warn('[CaptionTaskService] Failed updating in-progress caption set entry:', setErr.message);
      }
    }

    logger.debug({ phase: 'caption-task', idx: imageIndex, castId, status: 'update', hasCaption: true });

    if (websocketService) {
      websocketService.sendToUser(captionTask.masterAccountId, {
        type: 'captionProgress',
        payload: {
          datasetId: datasetId.toString(),
          imageIndex,
          castId,
          status: 'completed',
          caption,
        },
      });
    }

    const allDone = captionTask.captions.every((c) => c !== null);
    if (allDone) {
      logger.debug({ phase: 'caption-task', status: 'all-done', datasetId: datasetId.toString() });
      if (activeCaptionSetId) {
        try {
          await datasetDb.setCaptionSetStatus(datasetId, activeCaptionSetId, 'completed');
        } catch (capErr) {
          logger.warn('[CaptionTaskService] Failed marking caption set completed:', capErr.message);
        }
      } else {
        const captionSet = {
          method: captionTask.spellSlug,
          hash: captionTask.imagesHash,
          captions: captionTask.captions,
          createdBy: new ObjectId(captionTask.masterAccountId),
          createdAt: new Date(),
        };
        await datasetDb.addCaptionSet(datasetId, captionSet);
      }
      captionTask.status = 'completed';
      captionTask.castMap = {};
      captionTask.activeCaptionSetId = null;
    }

    await datasetDb.updateOne({ _id: dataset._id }, {
      $set: { captionTask },
    });

    if (allDone && websocketService) {
      websocketService.sendToUser(captionTask.masterAccountId, {
        type: 'captionProgress',
        payload: {
          datasetId: datasetId.toString(),
          status: 'completed',
        },
      });
    }
  }

  notificationEvents.on('spellCompletion', async (payload = {}) => {
    try {
      const captionMeta = payload.captionTask;
      if (!captionMeta) {
        logger.debug('[CaptionTaskService] spellCompletion event missing captionTask metadata – skipping.');
        return;
      }
      if (!captionMeta.datasetId) {
        logger.warn('[CaptionTaskService] captionTask metadata missing datasetId. Cannot map caption output.');
        return;
      }

      const datasetId = captionMeta.datasetId;
      const imageIndex = Number(captionMeta.imageIndex ?? 0);
      const masterAccountId = payload.masterAccountId || captionMeta.masterAccountId;
      const finalGenerationId = payload.finalGenerationId || (
        Array.isArray(payload.stepGenerationIds) && payload.stepGenerationIds.length
          ? payload.stepGenerationIds[payload.stepGenerationIds.length - 1]
          : null
      );

      const finalGenerationRecord = payload.finalGenerationRecord || null;
      const finalStepSnapshot = payload.finalStepSnapshot || null;

      logger.debug('[CaptionTaskService] Received spellCompletion for caption task.', {
        datasetId,
        imageIndex,
        castId: payload.castId || null,
        finalGenerationId,
        hasEventGenerationRecord: Boolean(finalGenerationRecord),
        hasFinalStepSnapshot: Boolean(finalStepSnapshot),
      });

      await processCaptionExtraction({
        datasetId,
        masterAccountId,
        imageIndex,
        castId: payload.castId || null,
        attempt: 0,
        generationId: finalGenerationId,
        gen: finalGenerationRecord,
        finalStepSnapshot,
      });
    } catch (err) {
      logger.error('[CaptionTaskService] Error processing spellCompletion event:', err);
    }
  });

  logger.debug('[CaptionTaskService] Listener attached.');
}

module.exports = createCaptionTaskService;
