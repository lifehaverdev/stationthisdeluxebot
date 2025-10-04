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

  /**
   * Attempt to extract caption string from generation record payload.
   * Supports various schema variants.
   */
  function extractCaption(gen) {
    const payload = gen.responsePayload || {};
    if (typeof payload === 'string') return payload;
    if (payload.caption) return payload.caption;
    if (payload.text) return payload.text;
    if (Array.isArray(payload.captions) && payload.captions[0]) return payload.captions[0];
    // OpenAI choice style
    if (Array.isArray(payload.choices) && payload.choices[0]?.message?.content) {
      return payload.choices[0].message.content;
    }
    return null;
  }

  notificationEvents.on('generationUpdated', async (gen) => {
    try {
      if (gen.status !== 'completed') return;
      const castId = gen.metadata?.castId;
      if (!castId) return;

      // Find dataset containing running captionTask with this castId
      const dataset = await datasetDb.findOne({
        'captionTask.status': 'running',
        'captionTask.castMap': { $elemMatch: { $eq: castId } },
      });
      if (!dataset) return; // Not part of a caption task

      const { captionTask } = dataset;
      const imageIndex = Object.entries(captionTask.castMap).find(([idx, cid]) => cid === castId)?.[0];
      if (imageIndex === undefined) return;

      const caption = extractCaption(gen);
      if (!caption) {
        logger.warn(`[CaptionTaskService] Could not extract caption for cast ${castId}`);
        captionTask.captions[imageIndex] = '';// mark failed as empty string
      } else {
        captionTask.captions[imageIndex] = caption;
      }

      logger.debug({ phase:'caption-task', idx:imageIndex, castId, status:'update', hasCaption:!!caption });

      // Emit progress via websocket
      if (websocketService) {
        websocketService.sendToUser(captionTask.masterAccountId, {
          type: 'captionProgress',
          payload: {
            datasetId: dataset._id.toString(),
            imageIndex: Number(imageIndex),
            castId,
            status: 'completed',
            caption,
          },
        });
      }

      // Check if all captions complete
      const allDone = captionTask.captions.every((c) => c !== null);
      if (allDone) {
        logger.debug({ phase:'caption-task', status:'all-done', datasetId: dataset._id.toString() });
        // Persist caption set
        const captionSet = {
          method: captionTask.spellSlug,
          hash: captionTask.imagesHash,
          captions: captionTask.captions,
          createdBy: new ObjectId(captionTask.masterAccountId),
          createdAt: new Date(),
        };
        await datasetDb.addCaptionSet(dataset._id, captionSet);
        captionTask.status = 'completed';
        captionTask.castMap = {};
      }

      // Save updated captionTask (and possibly completed status)
      await datasetDb.updateOne({ _id: dataset._id }, {
        $set: { captionTask },
      });

      if (allDone && websocketService) {
        websocketService.sendToUser(captionTask.masterAccountId, {
          type: 'captionProgress',
          payload: {
            datasetId: dataset._id.toString(),
            status: 'completed',
          },
        });
      }
    } catch (err) {
      logger.error('[CaptionTaskService] Error processing generationUpdated event:', err);
    }
  });

  logger.info('[CaptionTaskService] Listener attached.');
}

module.exports = createCaptionTaskService;
