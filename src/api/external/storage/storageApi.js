const express = require('express');

/**
 * Creates a router for public-facing storage operations.
 * This acts as a secure proxy to the internal storage service.
 * @param {object} services - The core services object.
 * @param {object} services.logger - The logger instance.
 * @returns {express.Router}
 */
function createPublicStorageApi(services) {
  const { internalApiClient, logger, storageService } = services;
  if (!internalApiClient) {
    throw new Error('[storageApi-external] internalApiClient dependency missing');
  }
  const router = express.Router();

  // POST /api/v1/storage/upload — server-side proxy upload, bypasses CORS on R2.
  // Accepts raw file bytes. Headers: Content-Type (file mime), X-File-Name (original name).
  // Returns { permanentUrl }.
  router.post('/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
      if (!storageService) {
        return res.status(503).json({ error: 'Storage service unavailable' });
      }
      const contentType = req.get('X-Content-Type') || req.get('Content-Type') || 'application/octet-stream';
      const rawName = req.get('X-File-Name') || `upload-${Date.now()}`;
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `uploads/${Date.now()}-${safeName}`;

      const { Readable } = require('stream');
      const stream = Readable.from(req.body);
      const { permanentUrl } = await storageService.uploadFromStream(stream, key, contentType);
      return res.json({ permanentUrl });
    } catch (err) {
      logger.error('[storageApi] proxy upload error:', err.message);
      return res.status(500).json({ error: 'Upload failed' });
    }
  });

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
