/**
 * API Service for Datasets
 */
const express = require('express');
const { ObjectId } = require('../../core/services/db/BaseDB');

function createDatasetsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

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
      
      const datasets = await db.data.datasets.find(query)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .sort({ updatedAt: -1 })
        .toArray();
      
      const total = await db.data.datasets.countDocuments(query);
      
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
    const { masterAccountId, name, description, tags, visibility = 'private' } = req.body;
    
    logger.info(`[DatasetsAPI] POST / - Creating new dataset "${name}" for MAID ${masterAccountId}`);
    
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
        images: [],
        captionSets: [],
        usageCount: 0,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await db.data.datasets.insertOne(datasetData);
      const dataset = { _id: result.insertedId, ...datasetData };
      
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
      const dataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
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
    
    try {
      // Check if dataset exists and user owns it
      const existingDataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only update your own datasets' } });
      }
      
      const result = await db.data.datasets.updateOne(
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
      const existingDataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own datasets' } });
      }
      
      const result = await db.data.datasets.deleteOne({ _id: new ObjectId(datasetId) });
      
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
      const existingDataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
      if (!existingDataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      if (existingDataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only modify your own datasets' } });
      }
      
      const result = await db.data.datasets.updateOne(
        { _id: new ObjectId(datasetId) },
        { 
          $push: { images: { $each: imageUrls } },
          $set: { updatedAt: new Date() }
        }
      );
      
      if (result.matchedCount === 0) {
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
      const existingDataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
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
      
      const result = await db.data.datasets.updateOne(
        { _id: new ObjectId(datasetId) },
        { 
          $push: { images: { $each: validUrls } },
          $set: { updatedAt: new Date() }
        }
      );
      
      if (result.matchedCount === 0) {
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
      const dataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
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
        _id: new ObjectId(),
        method,
        captions,
        createdBy: dataset.ownerAccountId,
        createdAt: new Date()
      };
      
      await db.data.datasets.updateOne(
        { _id: new ObjectId(datasetId) },
        { 
          $push: { captionSets: captionSet },
          $set: { updatedAt: new Date() }
        }
      );
      
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
      const result = await db.data.datasets.deleteMany({
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