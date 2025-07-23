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
      // This endpoint runs on the server, so it can securely call the internal API.
      // The path does not need the /internal prefix because the apiClient's
      // baseURL already points to the host, and the app mounts the internal router at /internal.
      const response = await internalApiClient.post('/internal/v1/data/storage/upload-url', {
        fileName,
        contentType,
        // Since the user is not authenticated on the web yet, we use a placeholder.
        // The internal service requires a userId for namespacing the upload path.
        userId: 'unauthenticated-web-user', 
      });

      // Proxy the successful response (containing signedUrl and permanentUrl) back to the client.
      res.json(response.data);
    } catch (error) {
      logger.error('Error proxying to internal storage service:', error);
      res.status(500).json({ error: 'Could not process upload request.' });
    }
  });

  return router;
}

module.exports = { createPublicStorageApi }; 