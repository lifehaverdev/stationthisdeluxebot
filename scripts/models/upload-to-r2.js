#!/usr/bin/env node
/**
 * upload-to-r2.js - Stream models from HuggingFace to R2
 *
 * Streams large model files directly from HuggingFace to R2 without
 * storing them locally. Uses chunked transfer for memory efficiency.
 *
 * Usage: node scripts/models/upload-to-r2.js [--model <name>] [--all]
 *
 * Examples:
 *   node scripts/models/upload-to-r2.js --all           # Upload all models
 *   node scripts/models/upload-to-r2.js --model clip_l  # Upload just clip_l
 */
require('dotenv').config();

const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const https = require('https');
const http = require('http');

// Models to upload, organized by type
const MODELS = {
  'flux-schnell': {
    source: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/flux1-schnell.safetensors',
    destination: 'unet/flux1-schnell.safetensors',
    size: '23GB',
    requiresAuth: true
  },
  'flux-vae': {
    source: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors',
    destination: 'vae/ae.safetensors',
    size: '320MB',
    requiresAuth: true
  },
  't5xxl': {
    source: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors',
    destination: 'clip/t5xxl_fp16.safetensors',
    size: '9.2GB',
    requiresAuth: false
  },
  'clip_l': {
    source: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors',
    destination: 'clip/clip_l.safetensors',
    size: '235MB',
    requiresAuth: false
  },
  'b0throps': {
    source: 'https://huggingface.co/ms2stationthis/b0throps/resolve/main/b0throps.safetensors',
    destination: 'loras/b0throps.safetensors',
    size: '328MB',
    requiresAuth: false
  }
};

const BUCKET_NAME = process.env.R2_MODELS_BUCKET || 'models';

class ModelUploader {
  constructor() {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    this.hfToken = process.env.HF_TOKEN;
  }

  async uploadModel(name, config) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Uploading: ${name} (${config.size})`);
    console.log(`  Source: ${config.source}`);
    console.log(`  Dest:   ${BUCKET_NAME}/${config.destination}`);
    console.log('='.repeat(60));

    const startTime = Date.now();

    try {
      // Get readable stream from HuggingFace
      const stream = await this._getSourceStream(config.source, config.requiresAuth);

      // Upload to R2 with multipart
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: BUCKET_NAME,
          Key: config.destination,
          Body: stream,
          ContentType: 'application/octet-stream',
        },
        // 100MB parts for large files
        partSize: 100 * 1024 * 1024,
        // Upload 4 parts concurrently
        queueSize: 4,
      });

      // Progress tracking
      let lastPercent = 0;
      upload.on('httpUploadProgress', (progress) => {
        if (progress.total) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          if (percent >= lastPercent + 5) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const mbLoaded = (progress.loaded / 1024 / 1024).toFixed(1);
            const mbTotal = (progress.total / 1024 / 1024).toFixed(1);
            console.log(`  [${elapsed}s] ${percent}% - ${mbLoaded}MB / ${mbTotal}MB`);
            lastPercent = percent;
          }
        }
      });

      await upload.done();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✓ ${name} uploaded in ${duration}s`);

      return { success: true, duration };
    } catch (err) {
      console.error(`✗ ${name} failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  _getSourceStream(url, requiresAuth) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const headers = {
        'User-Agent': 'stationthis-model-uploader/1.0'
      };

      if (requiresAuth && this.hfToken) {
        headers['Authorization'] = `Bearer ${this.hfToken}`;
      }

      const request = protocol.get(url, { headers }, (response) => {
        // Handle redirects (HuggingFace uses them)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`  Following redirect to ${response.headers.location.substring(0, 80)}...`);
          this._getSourceStream(response.headers.location, false)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const contentLength = response.headers['content-length'];
        if (contentLength) {
          console.log(`  Content-Length: ${(parseInt(contentLength) / 1024 / 1024 / 1024).toFixed(2)}GB`);
        }

        resolve(response);
      });

      request.on('error', reject);
    });
  }

  async uploadAll() {
    console.log('Starting upload of all models to R2...');
    console.log(`Bucket: ${BUCKET_NAME}`);
    console.log(`Models: ${Object.keys(MODELS).join(', ')}`);

    const results = {};
    const startTime = Date.now();

    for (const [name, config] of Object.entries(MODELS)) {
      results[name] = await this.uploadModel(name, config);
    }

    const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('UPLOAD COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total time: ${totalDuration} minutes`);

    for (const [name, result] of Object.entries(results)) {
      const status = result.success ? '✓' : '✗';
      const detail = result.success ? `${result.duration}s` : result.error;
      console.log(`  ${status} ${name}: ${detail}`);
    }

    const failed = Object.values(results).filter(r => !r.success).length;
    if (failed > 0) {
      console.log(`\n${failed} upload(s) failed.`);
      process.exit(1);
    }
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    console.error('Error: R2 credentials not configured.');
    console.error('Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  const uploader = new ModelUploader();

  if (args.includes('--all') || args.length === 0) {
    await uploader.uploadAll();
  } else if (args.includes('--model')) {
    const modelIdx = args.indexOf('--model');
    const modelName = args[modelIdx + 1];

    if (!modelName || !MODELS[modelName]) {
      console.error(`Unknown model: ${modelName}`);
      console.error(`Available: ${Object.keys(MODELS).join(', ')}`);
      process.exit(1);
    }

    const result = await uploader.uploadModel(modelName, MODELS[modelName]);
    if (!result.success) process.exit(1);
  } else if (args.includes('--list')) {
    console.log('Available models:');
    for (const [name, config] of Object.entries(MODELS)) {
      console.log(`  ${name} (${config.size}) -> ${config.destination}`);
    }
  } else {
    console.log('Usage: node scripts/models/upload-to-r2.js [--all] [--model <name>] [--list]');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
