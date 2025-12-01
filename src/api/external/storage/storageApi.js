const express = require('express');

/**
 * Creates a router for public-facing storage operations.
 * This acts as a secure proxy to the internal storage service.
 * @param {object} services - The core services object.
 * @param {object} services.logger - The logger instance.
 * @returns {express.Router}
 */
function createPublicStorageApi(services) {
  const { internalApiClient, logger } = services;
  if (!internalApiClient) {
    throw new Error('[storageApi-external] internalApiClient dependency missing');
  }
  const router = express.Router();

  router.post('/upload-url', async (req, res) => {
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required.' });
    }

    try {
      const response = await internalApiClient.post('/internal/v1/data/storage/upload-url', {
        fileName,
        contentType,
        userId: 'unauthenticated-web-user',
      });
      res.json(response.data);
    } catch (error) {
      logger.error('Error proxying to internal storage service:', error);
      res.status(500).json({ error: 'Could not process upload request.' });
    }
  });

  // New preferred route for presigned uploads (alias for upload-url)
  router.post('/uploads/sign', async (req, res) => {
    const { fileName, contentType, bucketName } = req.body;
    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required.' });
    }
    try {
      const response = await internalApiClient.post('/internal/v1/data/storage/upload-url', {
        fileName,
        contentType,
        userId: 'web-upload-user',
        bucketName: bucketName || 'datasets'
      });
      res.json(response.data);
    } catch (error) {
      logger.error('Error proxying uploads/sign:', error);
      res.status(500).json({ error: 'Could not process upload request.' });
    }
  });

  return router;
}

module.exports = { createPublicStorageApi }; 
