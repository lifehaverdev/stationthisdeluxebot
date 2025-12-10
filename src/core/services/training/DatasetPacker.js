const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class DatasetPacker {
  constructor({ logger } = {}) {
    this.logger = logger || console;
  }

  async pack({ jobId, dataset, datasetDir, outputDir }) {
    if (!jobId) {
      throw new Error('DatasetPacker.pack requires a jobId');
    }
    if (!datasetDir) {
      throw new Error('DatasetPacker.pack requires datasetDir');
    }

    const absDatasetDir = path.resolve(datasetDir);
    const exists = await this.pathExists(absDatasetDir);
    if (!exists) {
      throw new Error(`Dataset directory not found: ${absDatasetDir}`);
    }

    const transferDir = outputDir || path.join('/tmp/training', jobId, 'transfer');
    await fsp.mkdir(transferDir, { recursive: true });

    const manifest = await this.buildManifest(dataset, absDatasetDir);
    const manifestPath = path.join(transferDir, 'dataset_manifest.json');

    const archivePath = path.join(transferDir, 'dataset.tar.gz');
    await this.createTarball(absDatasetDir, archivePath);
    const stats = await fsp.stat(archivePath);
    const sha256 = await this.computeSha256(archivePath);

    manifest.archive = {
      filename: path.basename(archivePath),
      sizeBytes: stats.size,
      sha256
    };

    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    this.logger.info(`[DatasetPacker] Packed dataset for job ${jobId} (${manifest.imageCount} images)`);

    return {
      archivePath,
      manifestPath,
      manifest
    };
  }

  async buildManifest(dataset = {}, datasetDir) {
    const files = await fsp.readdir(datasetDir);
    const images = files.filter((file) => this.isImageFile(file)).sort();

    const manifest = {
      datasetId: dataset?._id ? String(dataset._id) : null,
      name: dataset?.name || path.basename(datasetDir),
      description: dataset?.description || null,
      imageCount: images.length,
      createdAt: new Date().toISOString(),
      source: 'stationthis-local-pack',
      files: {
        datasetDir: datasetDir,
        images,
        datasetInfo: files.find((file) => file === 'dataset_info.json') ? 'dataset_info.json' : null
      },
      tags: dataset?.tags || []
    };

    if (dataset?.captionSets?.length) {
      manifest.captionSetCount = dataset.captionSets.length;
    }

    return manifest;
  }

  isImageFile(file) {
    return /(\.png|\.jpg|\.jpeg|\.webp)$/i.test(file);
  }

  async createTarball(sourceDir, archivePath) {
    await fsp.mkdir(path.dirname(archivePath), { recursive: true });
    return new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-czf', archivePath, '-C', sourceDir, '.']);
      tar.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tar exited with code ${code}`));
        }
      });
      tar.on('error', reject);
    });
  }

  async computeSha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async pathExists(p) {
    try {
      await fsp.access(p);
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = DatasetPacker;
