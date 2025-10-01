const express = require('express');
const { requireInternal } = require('../../../platforms/web/middleware/auth'); // path adjusted one level deeper

/**
 * Creates an Express router for storage-related endpoints.
 * @param {object} services - The core services object.
 * @param {object} services.storageService - The storage service instance.
 * @param {object} services.logger - The logger instance.
 * @returns {express.Router} The configured Express router.
 */
function createStorageApi(services) {
  const router = express.Router();
  const { storageService, logger } = services;

  if (!storageService) {
    logger.warn('Storage API not initialized because StorageService is missing.');
    return router;
  }

  // This endpoint is internal-only and expects the calling service
  // to provide all necessary data, including the userId.
  router.post('/upload-url', requireInternal, async (req, res) => {
    const { fileName, contentType, userId, bucketName } = req.body;

    if (!fileName || !contentType || !userId) {
      return res.status(400).json({ error: 'fileName, contentType, and userId are required.' });
    }

    try {
      const { signedUrl, permanentUrl } = await storageService.generateSignedUploadUrl(userId, fileName, contentType, bucketName);
      res.json({ signedUrl, permanentUrl });
    } catch (error) {
      logger.error(`Failed to generate upload URL for user ${userId}:`, error);
      res.status(500).json({ error: 'Could not generate upload URL.' });
    }
  });

  return router;
}

module.exports = { createStorageApi }; 