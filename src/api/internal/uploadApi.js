/**
 * API Service for File Uploads - Datasets Bucket
 * Uses the existing storage service but with datasets-specific bucket
 */
const express = require('express');
const { requireInternal } = require('../../platforms/web/middleware/auth');

function createUploadApi(dependencies) {
  const { logger, storageService } = dependencies;
  const router = express.Router();

  if (!storageService) {
    logger.warn('Upload API not initialized because StorageService is missing.');
    return router;
  }

  // POST /internal/v1/data/upload/image - Upload single image to datasets bucket
  router.post('/image', requireInternal, async (req, res) => {
    try {
      const { fileName, contentType, userId = 'web-upload-user' } = req.body;

      if (!fileName || !contentType) {
        return res.status(400).json({ 
          error: { code: 'BAD_REQUEST', message: 'fileName and contentType are required' } 
        });
      }

      // Validate image types
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(contentType)) {
        return res.status(400).json({ 
          error: { code: 'INVALID_TYPE', message: 'Invalid file type. Only JPG, PNG, WebP, and GIF are allowed.' } 
        });
      }

      // Generate signed URL for datasets bucket
      const { signedUrl, permanentUrl } = await storageService.generateSignedUploadUrl(userId, fileName, contentType);
      
      logger.info(`[UploadAPI] Generated signed URL for image: ${fileName}`);

      res.json({
        success: true,
        data: {
          signedUrl,
          permanentUrl,
          fileName,
          contentType
        }
      });
    } catch (error) {
      logger.error('Failed to generate upload URL:', error);
      res.status(500).json({ 
        error: { code: 'UPLOAD_ERROR', message: 'Failed to generate upload URL' } 
      });
    }
  });

  // POST /internal/v1/data/upload/images - Upload multiple images to datasets bucket
  router.post('/images', requireInternal, async (req, res) => {
    try {
      const { files, userId = 'web-upload-user' } = req.body;

      if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ 
          error: { code: 'BAD_REQUEST', message: 'files array is required' } 
        });
      }

      // Validate all files
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      const invalidFiles = files.filter(file => !allowedTypes.includes(file.contentType));
      
      if (invalidFiles.length > 0) {
        return res.status(400).json({ 
          error: { code: 'INVALID_TYPE', message: 'Some files have invalid types. Only JPG, PNG, WebP, and GIF are allowed.' } 
        });
      }

      // Generate signed URLs for all files
      const uploadPromises = files.map(async (file) => {
        const { signedUrl, permanentUrl } = await storageService.generateSignedUploadUrl(userId, file.fileName, file.contentType);
        return {
          fileName: file.fileName,
          contentType: file.contentType,
          signedUrl,
          permanentUrl
        };
      });

      const results = await Promise.all(uploadPromises);
      
      logger.info(`[UploadAPI] Generated ${results.length} signed URLs for batch upload`);

      res.json({
        success: true,
        data: {
          uploads: results,
          count: results.length
        }
      });
    } catch (error) {
      logger.error('Failed to generate batch upload URLs:', error);
      res.status(500).json({ 
        error: { code: 'UPLOAD_ERROR', message: 'Failed to generate upload URLs' } 
      });
    }
  });

  return router;
}

module.exports = createUploadApi;
