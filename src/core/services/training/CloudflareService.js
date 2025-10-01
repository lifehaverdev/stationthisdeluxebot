/**
 * Cloudflare Service
 * 
 * Handles model upload/download to Cloudflare R2 using existing StorageService
 */

const path = require('path');
const fs = require('fs').promises;

class CloudflareService {
  constructor({ logger, storageService }) {
    this.logger = logger;
    this.storageService = storageService;
  }

  /**
   * Download dataset from Cloudflare R2
   * @param {Object} dataset - Dataset object from database
   * @param {string} jobId - Training job ID
   * @returns {Promise<string>} Local path to downloaded dataset
   */
  async downloadDataset(dataset, jobId) {
    try {
      this.logger.info(`Downloading dataset ${dataset._id} for job ${jobId}`);
      
      const localDir = `/tmp/training/${jobId}/dataset`;
      await fs.mkdir(localDir, { recursive: true });
      
      // Download all images in the dataset
      const downloadPromises = dataset.images.map(async (imageUrl, index) => {
        const filename = `image_${index.toString().padStart(3, '0')}.jpg`;
        const localPath = path.join(localDir, filename);
        
        try {
          await this.storageService.downloadFile(imageUrl, localPath);
          this.logger.debug(`Downloaded image ${index + 1}/${dataset.images.length}`);
          return localPath;
        } catch (error) {
          this.logger.warn(`Failed to download image ${imageUrl}:`, error);
          return null;
        }
      });
      
      const downloadedPaths = await Promise.all(downloadPromises);
      const validPaths = downloadedPaths.filter(path => path !== null);
      
      if (validPaths.length === 0) {
        throw new Error('No images could be downloaded from dataset');
      }
      
      this.logger.info(`Downloaded ${validPaths.length}/${dataset.images.length} images for job ${jobId}`);
      
      // Create dataset info file
      const datasetInfo = {
        name: dataset.name,
        description: dataset.description,
        images: validPaths,
        captions: this.extractCaptions(dataset),
        triggerWords: this.extractTriggerWords(dataset)
      };
      
      const infoPath = path.join(localDir, 'dataset_info.json');
      await fs.writeFile(infoPath, JSON.stringify(datasetInfo, null, 2));
      
      return localDir;
      
    } catch (error) {
      this.logger.error(`Failed to download dataset for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Upload trained model to Cloudflare R2
   * @param {string} modelPath - Local path to trained model file
   * @param {string} jobId - Training job ID
   * @returns {Promise<string>} Cloudflare R2 URL for the model
   */
  async uploadModel(modelPath, jobId) {
    try {
      this.logger.info(`Uploading model for job ${jobId}`);
      
      // Generate unique filename
      const timestamp = Date.now();
      const filename = `lora-model-${jobId}-${timestamp}.safetensors`;
      const r2Path = `models/${filename}`;
      
      // Upload to R2
      const modelUrl = await this.storageService.uploadFile(modelPath, r2Path, {
        contentType: 'application/octet-stream',
        metadata: {
          jobId: jobId,
          type: 'lora-model',
          uploadedAt: new Date().toISOString()
        }
      });
      
      this.logger.info(`Model uploaded successfully: ${modelUrl}`);
      return modelUrl;
      
    } catch (error) {
      this.logger.error(`Failed to upload model for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Upload preview images to Cloudflare R2
   * @param {Array<string>} imagePaths - Local paths to preview images
   * @param {string} jobId - Training job ID
   * @returns {Promise<Array<string>>} Cloudflare R2 URLs for preview images
   */
  async uploadPreviewImages(imagePaths, jobId) {
    try {
      this.logger.info(`Uploading ${imagePaths.length} preview images for job ${jobId}`);
      
      const uploadPromises = imagePaths.map(async (imagePath, index) => {
        const filename = `preview-${jobId}-${index}.jpg`;
        const r2Path = `previews/${filename}`;
        
        try {
          const imageUrl = await this.storageService.uploadFile(imagePath, r2Path, {
            contentType: 'image/jpeg',
            metadata: {
              jobId: jobId,
              type: 'preview-image',
              index: index,
              uploadedAt: new Date().toISOString()
            }
          });
          
          return imageUrl;
        } catch (error) {
          this.logger.warn(`Failed to upload preview image ${index}:`, error);
          return null;
        }
      });
      
      const uploadedUrls = await Promise.all(uploadPromises);
      const validUrls = uploadedUrls.filter(url => url !== null);
      
      this.logger.info(`Uploaded ${validUrls.length}/${imagePaths.length} preview images`);
      return validUrls;
      
    } catch (error) {
      this.logger.error(`Failed to upload preview images for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Extract captions from dataset
   * @param {Object} dataset - Dataset object
   * @returns {Array<string>} Array of captions
   */
  extractCaptions(dataset) {
    if (!dataset.captionSets || dataset.captionSets.length === 0) {
      return [];
    }
    
    // Use the first available caption set
    const captionSet = dataset.captionSets[0];
    return captionSet.captions || [];
  }

  /**
   * Extract trigger words from dataset
   * @param {Object} dataset - Dataset object
   * @returns {Array<string>} Array of trigger words
   */
  extractTriggerWords(dataset) {
    const triggerWords = [];
    
    // Add dataset name as trigger word
    if (dataset.name) {
      triggerWords.push(dataset.name);
    }
    
    // Add tags as trigger words
    if (dataset.tags && Array.isArray(dataset.tags)) {
      triggerWords.push(...dataset.tags);
    }
    
    // Add captions as potential trigger words (first few words)
    const captions = this.extractCaptions(dataset);
    if (captions.length > 0) {
      const firstCaption = captions[0];
      if (firstCaption) {
        const words = firstCaption.split(' ').slice(0, 3); // First 3 words
        triggerWords.push(...words);
      }
    }
    
    // Remove duplicates and empty strings
    return [...new Set(triggerWords)].filter(word => word && word.trim().length > 0);
  }

  /**
   * Clean up local training files
   * @param {string} jobId - Training job ID
   */
  async cleanupJobFiles(jobId) {
    try {
      const jobDir = `/tmp/training/${jobId}`;
      await fs.rm(jobDir, { recursive: true, force: true });
      this.logger.info(`Cleaned up local files for job ${jobId}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup files for job ${jobId}:`, error);
    }
  }

  /**
   * Get model URL from R2 path
   * @param {string} r2Path - R2 object path
   * @returns {string} Public URL for the model
   */
  getModelUrl(r2Path) {
    return this.storageService.getPublicUrl(r2Path);
  }

  /**
   * Check if model exists in R2
   * @param {string} r2Path - R2 object path
   * @returns {Promise<boolean>} True if model exists
   */
  async modelExists(r2Path) {
    try {
      return await this.storageService.fileExists(r2Path);
    } catch (error) {
      this.logger.warn(`Failed to check if model exists at ${r2Path}:`, error);
      return false;
    }
  }
}

module.exports = CloudflareService;
