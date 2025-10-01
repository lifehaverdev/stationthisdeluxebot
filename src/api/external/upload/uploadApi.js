const express = require('express');

/**
 * Creates a router for public-facing upload operations.
 * This acts as a secure proxy to the internal upload service.
 * @param {object} services - The core services object.
 * @param {object} services.logger - The logger instance.
 * @returns {express.Router}
 */
function createPublicUploadApi(services) {
  const { internalApiClient, logger } = services;
  if (!internalApiClient) {
    throw new Error('[uploadApi-external] internalApiClient dependency missing');
  }
  const router = express.Router();

  // POST /api/v1/upload/image - Upload single image to datasets bucket
  router.post('/image', async (req, res) => {
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required.' });
    }

    try {
      const response = await internalApiClient.post('/internal/v1/data/upload/image', {
        fileName,
        contentType,
        userId: 'web-upload-user',
      });
      res.json(response.data);
    } catch (error) {
      logger.error('Error proxying to internal upload service:', error);
      res.status(500).json({ error: 'Could not process upload request.' });
    }
  });

  // POST /api/v1/upload/images - Upload multiple images to datasets bucket
  router.post('/images', async (req, res) => {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required.' });
    }

    try {
      const response = await internalApiClient.post('/internal/v1/data/upload/images', {
        files,
        userId: 'web-upload-user',
      });
      res.json(response.data);
    } catch (error) {
      logger.error('Error proxying batch upload to internal service:', error);
      res.status(500).json({ error: 'Could not process batch upload request.' });
    }
  });

  return router;
}

module.exports = { createPublicUploadApi };
