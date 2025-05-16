/**
 * Media Service
 * 
 * Handles operations related to media files (images, audio, video)
 * including uploading, retrieving, updating, and deleting.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../utils/logger');
const config = require('../config');
const { DatabaseService } = require('./databaseService');

const logger = createLogger('MediaService');

/**
 * Service for managing media files
 */
class MediaService {
  constructor() {
    this.db = new DatabaseService();
    this.storagePath = config.STORAGE_PATH || path.join(process.cwd(), 'storage');
    
    // Ensure storage directories exist
    this.ensureStorageDirectories();
  }
  
  /**
   * Ensure storage directories exist for each media type
   * @private
   */
  ensureStorageDirectories() {
    const mediaTypes = ['images', 'audio', 'videos'];
    
    try {
      // Ensure main storage directory exists
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
      
      // Ensure media type directories exist
      mediaTypes.forEach(type => {
        const typePath = path.join(this.storagePath, type);
        if (!fs.existsSync(typePath)) {
          fs.mkdirSync(typePath, { recursive: true });
        }
      });
    } catch (error) {
      logger.error('Failed to create storage directories', { error });
      throw new Error('Failed to initialize storage directories');
    }
  }
  
  /**
   * Get media files for a specific user and media type
   * @param {string} userId - User ID
   * @param {string} mediaType - Type of media (image, audio, video)
   * @param {object} options - Query options (pagination, sorting)
   * @returns {Promise<Array>} List of media files
   */
  async getUserMedia(userId, mediaType, options = {}) {
    try {
      // Set defaults for pagination
      const limit = options.limit || 10;
      const offset = options.offset || 0;
      const sortBy = options.sortBy || 'createdAt';
      const sortOrder = options.sortOrder || 'desc';
      
      // Query media files from database
      const query = {
        userId,
        mediaType
      };
      
      const mediaFiles = await this.db.find('media', query, {
        limit,
        offset,
        sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
      });
      
      return mediaFiles;
    } catch (error) {
      logger.error('Error retrieving user media', { userId, mediaType, error });
      throw new Error('Failed to retrieve media files');
    }
  }
  
  /**
   * Get a specific media file by ID
   * @param {string} userId - User ID
   * @param {string} mediaId - Media ID
   * @returns {Promise<object|null>} Media file or null if not found
   */
  async getMediaById(userId, mediaId) {
    try {
      // Query the media file from database
      const media = await this.db.findOne('media', { id: mediaId, userId });
      
      return media;
    } catch (error) {
      logger.error('Error retrieving media by ID', { userId, mediaId, error });
      throw new Error('Failed to retrieve media file');
    }
  }
  
  /**
   * Upload a new media file
   * @param {string} userId - User ID
   * @param {object} fileInfo - File information object
   * @param {Buffer|string} fileData - File data buffer or path to file
   * @returns {Promise<object>} Created media file object
   */
  async uploadMedia(userId, fileInfo, fileData) {
    try {
      const { fileName, mimeType, fileSize, mediaType } = fileInfo;
      
      // Generate unique ID and storage path
      const mediaId = uuidv4();
      const userStoragePath = path.join(this.storagePath, this.getMediaTypeFolder(mediaType), userId);
      
      // Ensure user storage directory exists
      if (!fs.existsSync(userStoragePath)) {
        fs.mkdirSync(userStoragePath, { recursive: true });
      }
      
      // Create file path
      const filePath = path.join(userStoragePath, `${mediaId}-${fileName}`);
      
      // Save file
      if (Buffer.isBuffer(fileData)) {
        fs.writeFileSync(filePath, fileData);
      } else if (typeof fileData === 'string') {
        // Copy file from source path
        fs.copyFileSync(fileData, filePath);
      } else {
        throw new Error('Invalid file data');
      }
      
      // Create media record
      const media = {
        id: mediaId,
        name: fileName,
        mediaType,
        mimeType,
        fileSize,
        userId,
        path: filePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Save to database
      await this.db.insertOne('media', media);
      
      return media;
    } catch (error) {
      logger.error('Error uploading media', { userId, error });
      throw new Error('Failed to upload media file');
    }
  }
  
  /**
   * Update a media file's metadata
   * @param {string} userId - User ID
   * @param {string} mediaId - Media ID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated media file
   */
  async updateMedia(userId, mediaId, updates) {
    try {
      // Get the existing media
      const media = await this.getMediaById(userId, mediaId);
      
      if (!media) {
        throw new Error('Media not found');
      }
      
      // Only allow updating certain fields
      const allowedUpdates = ['name', 'tags'];
      const sanitizedUpdates = {};
      
      Object.keys(updates).forEach(key => {
        if (allowedUpdates.includes(key)) {
          sanitizedUpdates[key] = updates[key];
        }
      });
      
      sanitizedUpdates.updatedAt = new Date().toISOString();
      
      // Update in database
      await this.db.updateOne(
        'media',
        { id: mediaId, userId },
        { $set: sanitizedUpdates }
      );
      
      // Get updated record
      return await this.getMediaById(userId, mediaId);
    } catch (error) {
      logger.error('Error updating media', { userId, mediaId, error });
      throw new Error('Failed to update media file');
    }
  }
  
  /**
   * Delete a media file
   * @param {string} userId - User ID
   * @param {string} mediaId - Media ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteMedia(userId, mediaId) {
    try {
      // Get the media file
      const media = await this.getMediaById(userId, mediaId);
      
      if (!media) {
        throw new Error('Media not found');
      }
      
      // Delete the physical file
      if (fs.existsSync(media.path)) {
        fs.unlinkSync(media.path);
      }
      
      // Delete from database
      await this.db.deleteOne('media', { id: mediaId, userId });
      
      return true;
    } catch (error) {
      logger.error('Error deleting media', { userId, mediaId, error });
      throw new Error('Failed to delete media file');
    }
  }
  
  /**
   * Get the storage folder name based on media type
   * @param {string} mediaType - Media type (image, audio, video)
   * @returns {string} Folder name
   * @private
   */
  getMediaTypeFolder(mediaType) {
    const mapping = {
      'image': 'images',
      'audio': 'audio',
      'video': 'videos'
    };
    
    return mapping[mediaType] || mediaType + 's';
  }
}

module.exports = {
  MediaService
}; 