/**
 * Media Service Module
 * 
 * Provides platform-agnostic handling of media files with capabilities for:
 * - Downloading media from URLs or platform-specific sources
 * - Processing media (resizing, format conversion, etc.)
 * - Storing and retrieving media files
 * - Supporting operations like background removal, upscaling, etc.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);
const statAsync = promisify(fs.stat);
const existsAsync = promisify(fs.exists);
const execAsync = promisify(require('child_process').exec);
const Jimp = require('jimp');
const crypto = require('crypto');

// Default media paths
const DEFAULT_TEMP_DIR = path.join(process.cwd(), 'tmp');
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'storage', 'media');
const DEFAULT_CACHE_DIR = path.join(process.cwd(), 'storage', 'cache', 'thumbnails');

class MediaService {
  /**
   * Create a new MediaService instance
   * @param {Object} options - Configuration options
   * @param {string} options.tempDir - Directory for temporary media storage
   * @param {string} options.storageDir - Directory for persistent media storage
   * @param {Object} options.fetch - Fetch implementation (node-fetch or compatible)
   * @param {Object} options.logger - Logger implementation
   */
  constructor(options = {}) {
    this.tempDir = options.tempDir || DEFAULT_TEMP_DIR;
    this.storageDir = options.storageDir || DEFAULT_STORAGE_DIR;
    this.fetch = options.fetch || require('node-fetch');
    this.logger = options.logger || console;
    
    // Ensure directories exist
    this._ensureDirectoriesExist();
  }

  /**
   * Ensure required directories exist
   * @private
   */
  async _ensureDirectoriesExist() {
    try {
      await mkdirAsync(this.tempDir, { recursive: true });
      await mkdirAsync(this.storageDir, { recursive: true });
    } catch (error) {
      this.logger.error('Error creating media directories:', error);
    }
  }

  /**
   * Generate a unique filename
   * @param {string} userId - User ID
   * @param {string} extension - File extension
   * @returns {string} - Unique filename
   * @private
   */
  _generateFilename(userId, extension = 'jpg') {
    return `${userId}_${Date.now()}.${extension}`;
  }

  /**
   * Download media from URL to local file system
   * @param {string} url - URL of the media file
   * @param {string} userId - User ID
   * @param {Object} options - Download options
   * @param {boolean} options.temporary - Whether to store in temp directory
   * @param {string} options.extension - File extension
   * @returns {Promise<string>} - Path to downloaded file
   */
  async downloadFromUrl(url, userId, options = {}) {
    const { temporary = true, extension = this._getExtensionFromUrl(url) } = options;
    const filename = this._generateFilename(userId, extension);
    const targetDir = temporary ? this.tempDir : this.storageDir;
    const localPath = path.join(targetDir, filename);
    
    try {
      const response = await this.fetch(url);
      const buffer = await response.buffer();
      await writeFileAsync(localPath, buffer);
      
      return localPath;
    } catch (error) {
      this.logger.error('Error downloading media from URL:', error);
      throw new Error('Failed to download media file');
    }
  }

  /**
   * Get file extension from URL
   * @param {string} url - URL of the file
   * @returns {string} - File extension
   * @private
   */
  _getExtensionFromUrl(url) {
    const urlPath = new URL(url).pathname;
    const extension = path.extname(urlPath).slice(1).toLowerCase();
    return extension || 'jpg';
  }

  /**
   * Extract media URL from platform-specific message
   * @param {Object} message - Platform-specific message
   * @param {string} platform - Platform name (telegram, discord, etc.)
   * @returns {Promise<string>} - URL of the media
   */
  async getMediaUrl(message, platform) {
    switch (platform.toLowerCase()) {
      case 'telegram':
        return await this._getTelegramMediaUrl(message);
      case 'discord':
        return await this._getDiscordMediaUrl(message);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Extract media URL from Telegram message
   * @param {Object} message - Telegram message
   * @returns {Promise<string>} - URL of the media
   * @private
   */
  async _getTelegramMediaUrl(message) {
    let fileId;
    
    // Handle reply to message if present
    const targetMessage = message.reply_to_message || message;
    
    if (targetMessage.photo) {
      // Get the highest resolution photo
      fileId = targetMessage.photo[targetMessage.photo.length - 1].file_id;
    } else if (targetMessage.document) {
      fileId = targetMessage.document.file_id;
    } else if (targetMessage.file_id) {
      fileId = targetMessage.file_id;
    } else {
      return null;
    }

    try {
      // This requires access to the Telegram bot instance
      // We assume an injectable getTelegramFileUrl is provided
      if (!this.getTelegramFileUrl) {
        throw new Error('Telegram file URL retrieval not configured');
      }
      
      return await this.getTelegramFileUrl(fileId);
    } catch (error) {
      this.logger.error('Error fetching Telegram media URL:', error);
      return null;
    }
  }

  /**
   * Extract media URL from Discord message
   * @param {Object} message - Discord message
   * @returns {Promise<string>} - URL of the media
   * @private
   */
  async _getDiscordMediaUrl(message) {
    // Placeholder for Discord implementation
    // Will be implemented later as part of platform support
    return null;
  }

  /**
   * Get image dimensions and metadata
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<Object>} - Image metadata
   */
  async getImageMetadata(imagePath) {
    try {
      const image = await Jimp.read(imagePath);
      const { width, height } = image.bitmap;
      
      return {
        width,
        height,
        aspectRatio: width / height,
        format: image.getExtension() || 'unknown'
      };
    } catch (error) {
      this.logger.error('Error getting image metadata:', error);
      throw new Error('Failed to get image metadata');
    }
  }

  /**
   * Process an image (resize, convert format, etc.)
   * @param {string} inputPath - Path to the input image
   * @param {Object} options - Processing options
   * @param {number} options.width - Target width
   * @param {number} options.height - Target height
   * @param {string} options.format - Target format
   * @param {number} options.quality - Output quality (0-100)
   * @returns {Promise<string>} - Path to the processed image
   */
  async processImage(inputPath, options = {}) {
    const {
      width,
      height,
      format = 'jpg',
      quality = 90,
      userId = 'system'
    } = options;
    
    try {
      const image = await Jimp.read(inputPath);
      
      // Resize if dimensions provided
      if (width && height) {
        image.resize(width, height);
      }
      
      // Generate output filename
      const outputFilename = this._generateFilename(userId, format);
      const outputPath = path.join(this.tempDir, outputFilename);
      
      // Save with specified format and quality
      await image.quality(quality).writeAsync(outputPath);
      
      return outputPath;
    } catch (error) {
      this.logger.error('Error processing image:', error);
      throw new Error('Failed to process image');
    }
  }

  /**
   * Save media file to persistent storage
   * @param {string} filePath - Path to the media file
   * @param {string} userId - User ID
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - Saved file info
   */
  async saveMedia(filePath, userId, metadata = {}) {
    try {
      const filename = path.basename(filePath);
      const userDir = path.join(this.storageDir, userId);
      
      // Create user directory if it doesn't exist
      await mkdirAsync(userDir, { recursive: true });
      
      const destinationPath = path.join(userDir, filename);
      const fileBuffer = await readFileAsync(filePath);
      await writeFileAsync(destinationPath, fileBuffer);
      
      const stats = await statAsync(destinationPath);
      
      return {
        id: path.parse(filename).name,
        path: destinationPath,
        filename,
        size: stats.size,
        createdAt: Date.now(),
        metadata,
        userId
      };
    } catch (error) {
      this.logger.error('Error saving media:', error);
      throw new Error('Failed to save media file');
    }
  }

  /**
   * Delete a media file
   * @param {string} filePath - Path to the media file
   * @returns {Promise<boolean>} - Success status
   */
  async deleteMedia(filePath) {
    try {
      await unlinkAsync(filePath);
      return true;
    } catch (error) {
      this.logger.error('Error deleting media:', error);
      return false;
    }
  }

  /**
   * Register platform-specific media handlers
   * @param {Object} handlers - Platform handlers
   */
  registerPlatformHandlers(handlers) {
    if (handlers.telegram && handlers.telegram.getFileUrl) {
      this.getTelegramFileUrl = handlers.telegram.getFileUrl;
    }
    
    if (handlers.discord && handlers.discord.getFileUrl) {
      this.getDiscordFileUrl = handlers.discord.getFileUrl;
    }
  }

  /**
   * Resize an image to create a thumbnail
   * @param {string} imageUrl - URL or path of the image
   * @param {number} width - Target width
   * @param {number} height - Target height
   * @returns {Promise<Object>} - Thumbnail info (url, path, dimensions)
   */
  async resizeImage(imageUrl, width = 128, height = 128) {
    try {
      // Generate a unique ID for this thumbnail
      const thumbnailId = `thumb_${Date.now()}`;
      
      // First, we need to get the image
      let localPath;
      if (imageUrl.startsWith('http')) {
        // Download the image if it's a URL
        localPath = await this.downloadFromUrl(imageUrl, 'thumbnails');
      } else {
        // If it's already a local path, use it directly
        localPath = imageUrl;
      }
      
      // Process the image to create a thumbnail
      const image = await Jimp.read(localPath);
      
      // Resize to fit within the dimensions while maintaining aspect ratio
      image.scaleToFit(width, height);
      
      // Save thumbnail to temporary directory
      const thumbFilename = `${thumbnailId}.jpg`;
      const thumbPath = path.join(this.tempDir, thumbFilename);
      await image.quality(80).writeAsync(thumbPath);
      
      // If we downloaded the image, clean up the original
      if (imageUrl.startsWith('http') && localPath !== imageUrl) {
        await this.deleteMedia(localPath).catch(() => {});
      }
      
      // Convert path to URL format
      const thumbUrl = `/media/thumbnails/${thumbFilename}`;
      
      return {
        url: thumbUrl,
        path: thumbPath,
        width: image.bitmap.width,
        height: image.bitmap.height
      };
    } catch (error) {
      this.logger.error('Error creating image thumbnail:', error);
      // Return a placeholder on error
      return {
        url: '/assets/image-placeholder.png',
        error: 'Failed to create thumbnail'
      };
    }
  }

  /**
   * Extract a frame from a video to use as thumbnail
   * @param {string} videoUrl - URL or path of the video
   * @param {Object} options - Options for extracting the frame
   * @param {number} options.timeOffset - Time offset in seconds (default: 1)
   * @param {number} options.width - Width of thumbnail (default: 320)
   * @param {number} options.height - Height of thumbnail (default: 180)
   * @param {boolean} options.useCache - Whether to use cached thumbnails (default: true)
   * @returns {Promise<Object>} - Thumbnail info (url, path)
   */
  async extractVideoFrame(videoUrl, options = {}) {
    const {
      timeOffset = 1,
      width = 320,
      height = 180,
      useCache = true
    } = options;
    
    try {
      // Generate a unique hash based on videoUrl and options for caching
      const cacheKey = crypto
        .createHash('md5')
        .update(`${videoUrl}-${timeOffset}-${width}-${height}`)
        .digest('hex');
      
      // Ensure cache directory exists
      const cacheDir = path.join(DEFAULT_CACHE_DIR, 'video');
      await mkdirAsync(cacheDir, { recursive: true });
      
      // Check if a cached thumbnail exists
      const cachedThumbnailPath = path.join(cacheDir, `${cacheKey}.jpg`);
      const cachedThumbnailExists = await existsAsync(cachedThumbnailPath);
      
      // If cache is enabled and a cached thumbnail exists, use it
      if (useCache && cachedThumbnailExists) {
        this.logger.debug(`Using cached video thumbnail: ${cachedThumbnailPath}`);
        return {
          url: `/media/cache/thumbnails/video/${cacheKey}.jpg`,
          path: cachedThumbnailPath,
          width,
          height,
          cached: true
        };
      }
      
      // Generate a unique ID for this thumbnail
      const thumbnailId = `video_thumb_${Date.now()}`;
      
      // First, download the video if it's a URL
      let localVideoPath;
      if (videoUrl.startsWith('http')) {
        localVideoPath = await this.downloadFromUrl(videoUrl, 'thumbnails', {
          temporary: true,
          extension: this._getExtensionFromUrl(videoUrl)
        });
      } else {
        // If it's already a local path, use it directly
        localVideoPath = videoUrl;
      }
      
      // Check if ffmpeg is available
      try {
        await execAsync('ffmpeg -version');
      } catch (ffmpegError) {
        this.logger.error('ffmpeg not available:', ffmpegError);
        throw new Error('ffmpeg is required for video thumbnail extraction');
      }
      
      // Extract a frame from the video using ffmpeg
      const thumbFilename = `${thumbnailId}.jpg`;
      const thumbPath = path.join(this.tempDir, thumbFilename);
      
      // Use ffmpeg to extract a frame at the specified time offset and resize it
      const ffmpegCommand = `ffmpeg -y -i "${localVideoPath}" -ss ${timeOffset} -vframes 1 -vf scale=${width}:${height} -q:v 2 "${thumbPath}"`;
      
      await execAsync(ffmpegCommand);
      
      // Check if the thumbnail was successfully created
      const thumbExists = await existsAsync(thumbPath);
      if (!thumbExists) {
        throw new Error('Failed to extract video frame');
      }
      
      // Save to cache if caching is enabled
      if (useCache) {
        await fs.promises.copyFile(thumbPath, cachedThumbnailPath);
      }
      
      // If we downloaded the video, clean up the original
      if (videoUrl.startsWith('http') && localVideoPath !== videoUrl) {
        await this.deleteMedia(localVideoPath).catch(() => {});
      }
      
      // Convert path to URL format
      const thumbUrl = `/media/thumbnails/${thumbFilename}`;
      
      return {
        url: thumbUrl,
        path: thumbPath,
        cachedPath: useCache ? cachedThumbnailPath : null,
        width,
        height,
        cached: false
      };
    } catch (error) {
      this.logger.error('Error extracting video thumbnail:', error);
      
      // Return a placeholder on error
      return {
        url: '/assets/video-placeholder.png',
        error: 'Failed to extract video thumbnail',
        errorDetails: error.message
      };
    }
  }
}

module.exports = MediaService; 