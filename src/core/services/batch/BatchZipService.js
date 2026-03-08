const archiver = require('archiver');
const { PassThrough } = require('stream');
const { createLogger } = require('../../../utils/logger');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

class BatchZipService {
  constructor() {
    this.logger = createLogger('BatchZipService');
    this.storageService = null;
  }

  setStorageService(storageService) {
    this.storageService = storageService;
  }

  /**
   * Build a zip of all completed outputs for a batch cook and upload to R2.
   * @param {object} params
   * @param {string} params.batchId     - the collectionId / cookId
   * @param {Array}  params.outputs     - [{ resultUrl, pieceIndex }]
   * @returns {Promise<{ zipUrl: string, expiresAt: Date }>}
   */
  async buildZip({ batchId, outputs }) {
    if (!this.storageService) {
      throw new Error('BatchZipService: storageService not configured');
    }

    const completed = outputs.filter(o => o.resultUrl);
    const total = outputs.length;
    const zipFileName = `batch_${completed.length}_of_${total}_${batchId}.zip`;

    this.logger.info(`[BatchZip] Building zip for ${batchId}: ${completed.length}/${total} images`);

    const zipStream = await this._buildZipStream(completed);
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const uploadResult = await this.storageService.uploadFromStream(
      zipStream,
      `exports/${zipFileName}`,
      'application/zip',
      'exports'
    );
    const zipUrl = uploadResult?.permanentUrl || uploadResult;

    this.logger.info(`[BatchZip] Uploaded zip for ${batchId}: ${zipUrl}`);
    return { zipUrl, expiresAt };
  }

  /**
   * Build a zip stream from an array of output objects with resultUrl.
   * Returns a PassThrough stream that the archiver pipes into.
   */
  async _buildZipStream(outputs) {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const passThrough = new PassThrough();

    archive.on('error', (err) => {
      this.logger.error('[BatchZip] archiver error:', err);
      passThrough.destroy(err);
    });

    archive.pipe(passThrough);

    // Append each image by fetching it and streaming into the archive
    for (const output of outputs) {
      const idx = output.pieceIndex != null ? output.pieceIndex : outputs.indexOf(output);
      const ext = (output.resultUrl.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      const name = `${String(idx + 1).padStart(4, '0')}.${ext}`;

      try {
        const response = await fetch(output.resultUrl);
        if (!response.ok) {
          this.logger.warn(`[BatchZip] Failed to fetch ${output.resultUrl}: ${response.status}`);
          continue;
        }
        archive.append(response.body, { name });
      } catch (err) {
        this.logger.warn(`[BatchZip] Could not fetch image for ${name}:`, err.message);
      }
    }

    archive.finalize();
    return passThrough;
  }
}

module.exports = new BatchZipService();
