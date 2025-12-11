/**
 * API Service for Datasets
 */
const express = require('express');
const { ObjectId } = require('../../core/services/db/BaseDB');

function createDatasetsApi(dependencies) {
  const { logger, db, spellsService } = dependencies;
  const router = express.Router();

  // Get the dataset service
  const datasetDb = db.dataset;
  if (!datasetDb) {
    logger.error('[DatasetsAPI] DatasetDB service not available');
    return router;
  }

  // Track scheduled caption timers so we can cancel them if needed
  const activeCaptionTimers = new Map(); // datasetId -> Set<Timeout>
  const registerCaptionTimer = (datasetId, timer) => {
    if (!datasetId || !timer) return;
    const key = String(datasetId);
    if (!activeCaptionTimers.has(key)) {
      activeCaptionTimers.set(key, new Set());
    }
    activeCaptionTimers.get(key).add(timer);
  };
  const unregisterCaptionTimer = (datasetId, timer) => {
    if (!datasetId || !timer) return;
    const key = String(datasetId);
    const timers = activeCaptionTimers.get(key);
    if (!timers) return;
    timers.delete(timer);
    if (!timers.size) {
      activeCaptionTimers.delete(key);
    }
  };
  const clearCaptionTimers = (datasetId) => {
    if (!datasetId) return;
    const key = String(datasetId);
    const timers = activeCaptionTimers.get(key);
    if (timers) {
      timers.forEach((timer) => clearTimeout(timer));
      activeCaptionTimers.delete(key);
    }
  };

  // GET /internal/v1/data/datasets/owner/:masterAccountId - List datasets by owner
  router.get('/owner/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { page = 1, limit = 20, search, filter } = req.query;
    
    logger.info(`[DatasetsAPI] GET /owner/${masterAccountId} - Fetching datasets for user`);
    
    try {
      const query = { ownerAccountId: new ObjectId(masterAccountId) };
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ];
      }
      
      if (filter) {
        query.visibility = filter;
      }
      
      const datasets = await datasetDb.findMany(query, {
        skip: (page - 1) * limit,
        limit: parseInt(limit),
        sort: { updatedAt: -1 }
      });
      
      const total = await datasetDb.count(query);
      
      res.json({
        success: true,
        data: {
          datasets,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to fetch datasets:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch datasets' } });
    }
  });

  // POST /internal/v1/data/datasets - Create a new dataset
  router.post('/', async (req, res, next) => {
    const { masterAccountId, name, description, tags, visibility = 'private', images = [] } = req.body;
    
    logger.info(`[DatasetsAPI] POST / - Creating new dataset "${name}" for MAID ${masterAccountId} with ${images.length} images`);
    
    if (!masterAccountId || !name) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId and name are required' } });
    }
    
    try {
      const datasetData = {
        name,
        description: description || '',
        ownerAccountId: new ObjectId(masterAccountId),
        tags: tags || [],
        visibility,
        images: images || []
      };
      
      const dataset = await datasetDb.createDataset(datasetData);
      
      if (!dataset) {
        throw new Error('Failed to create dataset');
      }
      
      res.status(201).json({ success: true, data: dataset });
    } catch (error) {
      logger.error('Failed to create dataset:', error);
      res.status(500).json({ error: { code: 'CREATE_ERROR', message: 'Failed to create dataset' } });
    }
  });

  // GET /internal/v1/data/datasets/:datasetId - Get a specific dataset by ID
  router.get('/:datasetId', async (req, res, next) => {
    const { datasetId } = req.params;
    
    logger.info(`[DatasetsAPI] GET /${datasetId} - Fetching dataset by ID`);
    
    try {
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ success: true, data: dataset });
    } catch (error) {
      if (error.message && error.message.toLowerCase().includes('objectid')) {
        logger.warn(`[DatasetsAPI] Invalid datasetId format: ${datasetId}`);
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid datasetId format' } });
      }
      logger.error('Failed to fetch dataset:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch dataset' } });
    }
  });

  // PUT /internal/v1/data/datasets/:datasetId - Update dataset
  router.put('/:datasetId', async (req, res, next) => {
    const { datasetId } = req.params;
    const { masterAccountId, ...updateData } = req.body;
    
    logger.info(`[DatasetsAPI] PUT /${datasetId} - Updating dataset`);
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    if (!updateData || Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No fields provided to update' } });
    }
    
    try {
      // Check if dataset exists and user owns it
      const existingDataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only update your own datasets' } });
      }
      
      const result = await datasetDb.updateOne(
        { _id: new ObjectId(datasetId) },
        { $set: { ...updateData, updatedAt: new Date() } }
      );
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ success: true, data: { datasetId, updated: true } });
    } catch (error) {
      logger.error('Failed to update dataset:', error);
      res.status(500).json({ error: { code: 'UPDATE_ERROR', message: 'Failed to update dataset' } });
    }
  });

  // DELETE /internal/v1/data/datasets/:datasetId - Delete dataset
  router.delete('/:datasetId', async (req, res, next) => {
    const { datasetId } = req.params;
    const { masterAccountId } = req.body;
    
    logger.info(`[DatasetsAPI] DELETE /${datasetId} - Deleting dataset`);
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    
    try {
      // Check if dataset exists and user owns it
      const existingDataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own datasets' } });
      }
      
      const result = await datasetDb.deleteOne({ _id: new ObjectId(datasetId) });
      
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ success: true, message: 'Dataset deleted successfully' });
    } catch (error) {
      logger.error('Failed to delete dataset:', error);
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: 'Failed to delete dataset' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/images - Add images to dataset
  router.post('/:datasetId/images', async (req, res, next) => {
    const { datasetId } = req.params;
    const { masterAccountId, imageUrls } = req.body;
    
    logger.info(`[DatasetsAPI] POST /${datasetId}/images - Adding ${imageUrls?.length || 0} images to dataset`);
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'imageUrls array is required' } });
    }
    
    try {
      // Check if dataset exists and user owns it
      const existingDataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only modify your own datasets' } });
      }
      
      const result = await datasetDb.addImages(datasetId, imageUrls);
      
      if (!result) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ success: true, data: { addedCount: imageUrls.length } });
    } catch (error) {
      logger.error('Failed to add images to dataset:', error);
      res.status(500).json({ error: { code: 'ADD_IMAGES_ERROR', message: 'Failed to add images' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/upload-images - Upload and add images to dataset
  router.post('/:datasetId/upload-images', async (req, res, next) => {
    const { datasetId } = req.params;
    const { masterAccountId, imageUrls } = req.body;
    
    logger.info(`[DatasetsAPI] POST /${datasetId}/upload-images - Uploading and adding ${imageUrls?.length || 0} images to dataset`);
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'imageUrls array is required' } });
    }
    
    try {
      // Check if dataset exists and user owns it
      const existingDataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only modify your own datasets' } });
      }
      
      // Validate that all URLs are accessible (basic validation)
      const validUrls = imageUrls.filter(url => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      });
      
      if (validUrls.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_URLS', message: 'No valid image URLs provided' } });
      }
      
      const result = await datasetDb.addImages(datasetId, validUrls);
      
      if (!result) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ 
        success: true, 
        data: { 
          addedCount: validUrls.length,
          invalidCount: imageUrls.length - validUrls.length
        } 
      });
    } catch (error) {
      logger.error('Failed to upload and add images to dataset:', error);
      res.status(500).json({ error: { code: 'UPLOAD_IMAGES_ERROR', message: 'Failed to upload and add images' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/caption-via-spell - Generate captions via arbitrary spell
  router.post('/:datasetId/caption-via-spell', async (req, res) => {
    const { datasetId } = req.params;
    const { spellSlug, masterAccountId, parameterOverrides = {} } = req.body;

    logger.info(`[DatasetsAPI] POST /${datasetId}/caption-via-spell - spell=${spellSlug}`);

    if (!spellSlug) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'spellSlug is required' } });
    }
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      // Check dataset ownership & assets
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only caption your own datasets' } });
      }
      if (!dataset.images || dataset.images.length === 0) {
        return res.status(400).json({ error: { code: 'NO_IMAGES', message: 'Dataset contains no images' } });
      }

      // Ensure spellsService exists
      if (!spellsService) {
        logger.error('[DatasetsAPI] spellsService not available – cannot cast spell');
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Spell service unavailable' } });
      }

      const castsDb = db.casts;

      const { sha256Hex } = require('../../core/utils/hash');
      const imagesHash = sha256Hex(JSON.stringify(dataset.images));

      // Initialize castMap with nulls; will be filled asynchronously
      const castMap = Array(dataset.images.length).fill(null);

      const intervalMs = Number(process.env.CAPTION_CAST_INTERVAL_MS || '30000');

      // Create or reuse an in-progress caption set so captions are written as soon as they're ready
      let activeCaptionSetId = null;
      try {
        const partialCaptionSet = await datasetDb.addCaptionSet(datasetId, {
          method: spellSlug,
          hash: imagesHash,
          captions: Array(dataset.images.length).fill(null),
          createdBy: new ObjectId(masterAccountId),
          status: 'in_progress',
        });
        activeCaptionSetId = partialCaptionSet?._id || null;
      } catch (captionSetErr) {
        logger.warn('[DatasetsAPI] Failed to initialize caption set scaffold:', captionSetErr.message);
      }

      const scheduleCast = (idx) => {
        const imageUrl = dataset.images[idx];
        const timer = setTimeout(async () => {
          try {
            const current = await datasetDb.findOne(
              { _id: new ObjectId(datasetId) },
              { projection: { captionTask: 1 } }
            );
            if (!current?.captionTask || current.captionTask.status !== 'running') {
              logger.info(`[DatasetsAPI] Caption task for dataset ${datasetId} no longer running. Skipping idx ${idx}.`);
              return;
            }
          } catch (statusErr) {
            logger.warn(`[DatasetsAPI] Failed to verify caption task status before casting idx ${idx}:`, statusErr.message);
          }
          // Use 'web-sandbox' so NotificationDispatcher emits WebSocket updates
          const context = {
            masterAccountId,
            platform: 'web-sandbox',
            parameterOverrides: { ...parameterOverrides, imageUrl },
            captionTask: {
              datasetId,
              imageIndex: idx,
              totalImages: dataset.images.length,
              spellSlug,
            },
          };
          try {
            const result = await spellsService.castSpell(spellSlug, context, castsDb);
            const castId = result?.castId || context.castId || null;
            castMap[idx] = castId;
            // Persist individual castId back to captionTask.castMap[idx]
            await datasetDb.updateOne(
              { _id: new ObjectId(datasetId) },
              { $set: { [`captionTask.castMap.${idx}`]: castId } }
            );
          } catch (castErr) {
            logger.error(`[DatasetsAPI] Failed casting spell for image ${idx}:`, castErr.message);
          } finally {
            unregisterCaptionTimer(datasetId, timer);
          }
        }, idx * intervalMs); // stagger by env-config interval
        registerCaptionTimer(datasetId, timer);
      };

      dataset.images.forEach((_, idx) => scheduleCast(idx));

      // Emit initial websocket event for progress 0
      try {
        const websocketService = require('../../core/services/websocket/server');
        websocketService.sendToUser(masterAccountId, {
          type: 'captionProgress',
          payload: {
            datasetId,
            status: 'started',
            castMap,
            imagesHash,
          },
        });
      } catch (wsErr) {
        logger.warn('[DatasetsAPI] Failed to emit websocket start event:', wsErr.message);
      }

      // Store captionTask in dataset document for progress tracking
      const captionTask = {
        spellSlug,
        masterAccountId,
        status: 'running',
        startedAt: new Date(),
        imagesHash,
        castMap,
        captions: Array(dataset.images.length).fill(null),
        activeCaptionSetId,
      };

      await datasetDb.updateOne({ _id: new ObjectId(datasetId) }, { $set: { captionTask } });

      res.status(202).json({ success: true, data: { datasetId, castMap, message: 'Caption generation started' } });
    } catch (error) {
      logger.error('Caption-via-spell error:', error);
      res.status(500).json({ error: { code: 'CAPTION_SPELL_ERROR', message: 'Failed to start caption generation via spell' } });
    }
  });

  // GET /internal/v1/data/datasets/:datasetId/captions – list caption sets for dataset
  router.get('/:datasetId/captions', async (req, res) => {
    const { datasetId } = req.params;
    try {
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) }, {
        projection: { captionSets: 1 },
      });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      res.json({ success: true, data: dataset.captionSets || [] });
    } catch (err) {
      logger.error('[DatasetsAPI] Failed fetching caption sets:', err);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Could not fetch caption sets' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/caption-task/cancel – cancel in-progress caption generation
  router.post('/:datasetId/caption-task/cancel', async (req, res) => {
    const { datasetId } = req.params;
    const { masterAccountId } = req.body || {};

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) }, {
        projection: { ownerAccountId: 1, captionTask: 1 },
      });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only cancel your own caption tasks' } });
      }
      const isRunning = dataset.captionTask && dataset.captionTask.status === 'running';
      clearCaptionTimers(datasetId);
      if (!isRunning) {
        return res.json({ success: true, data: { cancelled: false, reason: 'not-running' } });
      }

      await datasetDb.updateOne({ _id: dataset._id }, {
        $unset: { captionTask: '' },
        $set: { updatedAt: new Date() },
      });

      try {
        const websocketService = require('../../core/services/websocket/server');
        websocketService.sendToUser(masterAccountId, {
          type: 'captionProgress',
          payload: {
            datasetId,
            status: 'cancelled',
          },
        });
      } catch (wsErr) {
        logger.warn('[DatasetsAPI] Failed to emit caption cancel event via websocket:', wsErr.message);
      }

      res.json({ success: true, data: { cancelled: true } });
    } catch (err) {
      logger.error('[DatasetsAPI] Failed cancelling caption task:', err);
      res.status(500).json({ error: { code: 'CANCEL_ERROR', message: 'Failed to cancel caption task' } });
    }
  });

  // DELETE /internal/v1/data/datasets/:datasetId/captions/:captionId – remove caption set
  router.delete('/:datasetId/captions/:captionId', async (req, res) => {
    const { datasetId, captionId } = req.params;
    const { masterAccountId } = req.body || {};

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) }, { projection: { ownerAccountId: 1, captionSets: 1 } });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only modify your own datasets' } });
      }

      const captionSets = dataset.captionSets || [];
      const target = captionSets.find((cs) => cs._id.toString() === captionId);
      if (!target) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Caption set not found' } });
      }

      const fallback = captionSets.find((cs) => cs._id.toString() !== captionId);
      await datasetDb.removeCaptionSet(datasetId, captionId);

      if (target.isDefault && fallback) {
        await datasetDb.setDefaultCaptionSet(datasetId, fallback._id.toString());
      }

      res.json({
        success: true,
        data: {
          deleted: true,
          reassignedDefault: Boolean(target.isDefault && fallback),
          fallbackCaptionSetId: target.isDefault && fallback ? fallback._id.toString() : null,
        },
      });
    } catch (err) {
      logger.error('[DatasetsAPI] Failed deleting caption set:', err);
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: 'Failed to delete caption set' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/captions/:captionId/default – set default caption set
  router.post('/:datasetId/captions/:captionId/default', async (req, res) => {
    const { datasetId, captionId } = req.params;
    const { masterAccountId } = req.body || {};

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) }, { projection: { ownerAccountId: 1, captionSets: 1 } });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only modify your own datasets' } });
      }

      const captionSets = dataset.captionSets || [];
      const target = captionSets.find((cs) => cs._id.toString() === captionId);
      if (!target) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Caption set not found' } });
      }

      await datasetDb.setDefaultCaptionSet(datasetId, captionId);
      res.json({ success: true, data: { captionSetId: captionId } });
    } catch (err) {
      logger.error('[DatasetsAPI] Failed setting default caption set:', err);
      res.status(500).json({ error: { code: 'UPDATE_ERROR', message: 'Failed to set default caption set' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/generate-captions - Generate captions for dataset
  router.post('/:datasetId/generate-captions', async (req, res, next) => {
    const { datasetId } = req.params;
    const { masterAccountId, method = 'blip' } = req.body;
    
    logger.info(`[DatasetsAPI] POST /${datasetId}/generate-captions - Generating captions using ${method}`);
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    
    try {
      // Check if dataset exists and user owns it
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only modify your own datasets' } });
      }
      
      if (!dataset.images || dataset.images.length === 0) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Dataset has no images to caption' } });
      }
      
      // Generate captions using specified method
      const captions = await generateCaptions(dataset.images, method);
      
      // Add caption set to dataset
      const captionSet = {
        method,
        captions,
        createdBy: dataset.ownerAccountId
      };
      
      await datasetDb.addCaptionSet(datasetId, captionSet);
      
      res.json({ success: true, data: { captionSet, generatedCount: captions.length } });
    } catch (error) {
      logger.error('Failed to generate captions:', error);
      res.status(500).json({ error: { code: 'CAPTION_ERROR', message: 'Failed to generate captions' } });
    }
  });

  // POST /internal/v1/data/datasets/batch-delete - Batch delete datasets
  router.post('/batch-delete', async (req, res, next) => {
    const { ids, masterAccountId } = req.body;
    
    logger.info(`[DatasetsAPI] POST /batch-delete - Deleting ${ids?.length || 0} datasets`);
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'IDs array is required' } });
    }
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    
    try {
      const result = await datasetDb.deleteMany({
        _id: { $in: ids.map(id => new ObjectId(id)) },
        ownerAccountId: new ObjectId(masterAccountId)
      });
      
      res.json({
        success: true,
        data: {
          deletedCount: result.deletedCount,
          message: `Deleted ${result.deletedCount} dataset(s)`
        }
      });
    } catch (error) {
      logger.error('Failed to batch delete datasets:', error);
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: 'Failed to delete datasets' } });
    }
  });

  return router;
}

// Helper function for caption generation
async function generateCaptions(imageUrls, method) {
  // This is a placeholder implementation
  // In a real implementation, this would call an AI service to generate captions
  const captions = imageUrls.map((url, index) => ({
    imageUrl: url,
    caption: `Generated caption for image ${index + 1} using ${method}`,
    confidence: 0.85
  }));
  
  return captions;
}

module.exports = createDatasetsApi;
