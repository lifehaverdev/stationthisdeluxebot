/**
 * DatasetDownloader
 *
 * Downloads a dataset from the database/R2 to a local directory for training.
 *
 * Flow:
 * 1. Fetch dataset by ID (images URLs + caption sets)
 * 2. Create local temp directory
 * 3. Download each image, naming consistently (001.jpg, 002.png, etc.)
 * 4. Get the default caption set (or first available)
 * 5. Write corresponding .txt files (001.txt, 002.txt, etc.)
 * 6. Return the local directory path
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { ObjectId } = require('mongodb');

class DatasetDownloader {
  constructor({ logger, datasetDb } = {}) {
    this.logger = logger || console;
    this.datasetDb = datasetDb;
  }

  /**
   * Download a dataset to a local directory
   *
   * @param {string} datasetId - MongoDB ObjectId of the dataset
   * @param {string} jobId - Training job ID (used for temp directory naming)
   * @param {Object} options - Optional settings
   * @param {string} options.baseDir - Base directory for downloads (default: /tmp/training)
   * @returns {Object} { datasetDir, imageCount, captionCount }
   */
  async download(datasetId, jobId, options = {}) {
    const baseDir = options.baseDir || '/tmp/training';
    const datasetDir = path.join(baseDir, jobId, 'dataset');

    this.logger.info(`[DatasetDownloader] Downloading dataset ${datasetId} to ${datasetDir}`);

    // Fetch dataset from database
    const dataset = await this.datasetDb.findOne({
      _id: new ObjectId(datasetId)
    });

    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    if (!dataset.images || dataset.images.length === 0) {
      throw new Error(`Dataset ${datasetId} has no images`);
    }

    // Create directory
    await fsp.mkdir(datasetDir, { recursive: true });

    // Download images
    const imageResults = await this._downloadImages(dataset.images, datasetDir);

    // Write captions
    const captionCount = await this._writeCaptions(dataset, imageResults, datasetDir);

    // Write .ready marker file to signal download is complete
    const readyMarker = path.join(datasetDir, '.ready');
    await fsp.writeFile(readyMarker, JSON.stringify({
      completedAt: new Date().toISOString(),
      imageCount: imageResults.length,
      captionCount,
    }), 'utf-8');

    this.logger.info(`[DatasetDownloader] Downloaded ${imageResults.length} images, ${captionCount} captions to ${datasetDir}`);

    return {
      datasetDir,
      imageCount: imageResults.length,
      captionCount,
      dataset: {
        _id: dataset._id,
        name: dataset.name,
      }
    };
  }

  /**
   * Download all images to the dataset directory
   * @private
   */
  async _downloadImages(imageUrls, datasetDir) {
    const results = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const ext = this._getExtension(url);
      const filename = `${String(i + 1).padStart(3, '0')}${ext}`;
      const filepath = path.join(datasetDir, filename);

      try {
        await this._downloadFile(url, filepath);
        results.push({ index: i, filename, filepath, url });

        if ((i + 1) % 10 === 0 || i === imageUrls.length - 1) {
          this.logger.info(`[DatasetDownloader] Downloaded ${i + 1}/${imageUrls.length} images`);
        }
      } catch (err) {
        this.logger.error(`[DatasetDownloader] Failed to download image ${i}: ${err.message}`);
        throw new Error(`Failed to download image ${i + 1}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Write caption .txt files alongside images
   * @private
   */
  async _writeCaptions(dataset, imageResults, datasetDir) {
    // Find the default caption set, or the first completed one
    const captionSets = dataset.captionSets || [];

    let captionSet = captionSets.find(cs => cs.isDefault && cs.status === 'completed');
    if (!captionSet) {
      captionSet = captionSets.find(cs => cs.status === 'completed');
    }
    if (!captionSet) {
      captionSet = captionSets[0]; // Fall back to first available
    }

    if (!captionSet || !captionSet.captions || captionSet.captions.length === 0) {
      this.logger.warn(`[DatasetDownloader] No captions found for dataset, training will proceed without captions`);
      return 0;
    }

    this.logger.info(`[DatasetDownloader] Using caption set: ${captionSet.method || 'unknown'} (${captionSet.captions.length} captions)`);

    let writtenCount = 0;

    for (const img of imageResults) {
      const caption = captionSet.captions[img.index];

      if (caption && caption.trim()) {
        // Caption filename matches image filename but with .txt extension
        const captionFilename = img.filename.replace(/\.[^.]+$/, '.txt');
        const captionPath = path.join(datasetDir, captionFilename);

        await fsp.writeFile(captionPath, caption.trim(), 'utf-8');
        writtenCount++;
      }
    }

    return writtenCount;
  }

  /**
   * Download a single file
   * @private
   */
  _downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const file = fs.createWriteStream(filepath);

      const request = protocol.get(url, { timeout: 30000 }, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(filepath);
          return this._downloadFile(response.headers.location, filepath).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(filepath);
          return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(filepath, () => {}); // Delete partial file
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        fs.unlink(filepath, () => {});
        reject(new Error(`Timeout downloading ${url}`));
      });

      file.on('error', (err) => {
        file.close();
        fs.unlink(filepath, () => {});
        reject(err);
      });
    });
  }

  /**
   * Get file extension from URL
   * @private
   */
  _getExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname).toLowerCase();

      // Default to .jpg if no extension or unrecognized
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        return ext;
      }
      return '.jpg';
    } catch {
      return '.jpg';
    }
  }

  /**
   * Clean up a downloaded dataset directory
   *
   * @param {string} datasetDir - Directory to clean up
   */
  async cleanup(datasetDir) {
    try {
      await fsp.rm(datasetDir, { recursive: true, force: true });
      this.logger.info(`[DatasetDownloader] Cleaned up ${datasetDir}`);
    } catch (err) {
      this.logger.warn(`[DatasetDownloader] Failed to cleanup ${datasetDir}: ${err.message}`);
    }
  }
}

module.exports = DatasetDownloader;
