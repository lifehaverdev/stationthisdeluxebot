'use strict';

/**
 * ModelService — in-process domain service for ComfyUI model discovery and checkpoint import.
 * Replaces internalApiClient calls to /internal/v1/data/models/* in external API routes.
 * Phase 6g of service-layer-migration.
 *
 * Note: This service wraps ComfyUI/ComfyDeploy concerns, not MongoDB.
 * listModels() delegates to ModelDiscoveryService with the same filtering
 * that previously lived in the internal modelsApi route handler.
 * importCheckpoint() handles Civitai URL resolution + ComfyDeploy fetch trigger.
 */

const path = require('path');
const axios = require('axios');
const { extractCivitaiModelId, extractCivitaiModelVersionId } = require('../../../../utils/loraImportService');

class ModelService {
  /**
   * @param {Object} deps
   * @param {import('../../comfydeploy/modelDiscoveryService')} deps.modelDiscoveryService
   * @param {Object} [deps.comfyUIService] - for fetchRemoteFile fallback
   * @param {Object} deps.logger
   */
  constructor({ modelDiscoveryService, comfyUIService, logger }) {
    this.discovery = modelDiscoveryService;
    this.comfyUIService = comfyUIService || null;
    this.logger = logger || console;
  }

  /**
   * List ComfyUI models with optional category filtering, private checkpoint filtering,
   * and civitai tag stripping. Mirrors the logic in the internal modelsApi GET / handler.
   *
   * @param {Object} opts
   * @param {string} [opts.category] - checkpoint | upscale | embedding | vae | controlnet | clipseg
   * @param {string} [opts.userId] - for private checkpoint visibility
   * @param {boolean} [opts.includeCivitaiTags] - default false
   * @returns {Promise<Array>} filtered model list
   */
  async listModels({ category, userId, includeCivitaiTags = false } = {}) {
    const modelsRaw = await this.discovery.listModels({ category, includeWorkflowEnums: false });
    let models = modelsRaw;

    // Strip civitai-sourced tags unless caller explicitly requests them
    if (!includeCivitaiTags) {
      models = models.map(m => {
        if (!Array.isArray(m.tags)) return m;
        const clean = m.tags.filter(t => {
          if (typeof t === 'string') return true;
          return (t.source || '').toLowerCase() !== 'civitai';
        });
        return { ...m, tags: clean };
      });
    }

    // Filter private checkpoints: only show the requesting user's own private checkpoints
    const viewerId = (userId || '').toString().toLowerCase();
    if (viewerId) {
      models = models.filter(m => {
        const p = (m.path || m.save_path || '').toString().toLowerCase();
        if (!p.includes('checkpoints/users/')) return true; // public
        return p.includes(`checkpoints/users/${viewerId}/`); // own privates only
      });
    } else {
      models = models.filter(m => {
        const p = (m.path || m.save_path || '').toString().toLowerCase();
        return !p.includes('checkpoints/users/');
      });
    }

    // Category-specific path filter + dedup (for well-known categories)
    if (category) {
      const cat = category.toLowerCase();
      const pathMap = {
        checkpoint: 'checkpoints/',
        upscale: 'upscale_models/',
        embedding: 'embeddings/',
        vae: 'vae/',
        controlnet: 'controlnet/',
        clipseg: 'clipseg/',
      };
      if (pathMap[cat]) {
        models = models.filter(m => {
          const p = (m.path || m.save_path || '').toString().toLowerCase();
          if (!p.includes(pathMap[cat])) return false;
          return /\.(safetensors|ckpt)$/i.test(p);
        });
        // Deduplicate by path
        const seen = new Set();
        models = models.filter(m => {
          const p = m.path || m.save_path;
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });
      }
    }

    return models;
  }

  /**
   * Import a checkpoint from a URL (Civitai or direct link).
   * Resolves the download URL, validates the file type, and triggers a ComfyDeploy fetch.
   *
   * If the Civitai URL turns out to be a LoRA, throws an error with code 'IS_LORA'
   * so the caller can redirect to the LoRA import flow.
   *
   * @param {Object} opts
   * @param {string} opts.url - source URL (Civitai page or direct .safetensors/.ckpt link)
   * @param {string} opts.userId - owner's masterAccountId
   * @returns {Promise<{ category: string, path: string, owner: string, visibility: string }>}
   */
  async importCheckpoint({ url, userId }) {
    if (!url || !userId) {
      const e = new Error('url and userId are required');
      e.status = 400;
      throw e;
    }

    let downloadUrl = url;
    let filename = path.basename(url.split('?')[0]);

    if (url.includes('civitai.com')) {
      const modelId = extractCivitaiModelId(url);
      const versionId = extractCivitaiModelVersionId(url);
      if (!modelId) {
        const e = new Error('Could not extract Civitai modelId from URL');
        e.status = 400;
        throw e;
      }

      let modelJson;
      try {
        const resp = await axios.get(`https://civitai.com/api/v1/models/${modelId}`);
        modelJson = resp.data;
      } catch (err) {
        this.logger.error(`[ModelService] Civitai API fetch failed for modelId=${modelId}:`, err.message);
        const e = new Error('Unable to fetch model metadata from Civitai');
        e.status = 502;
        throw e;
      }

      this.logger.info(`[ModelService] Fetched Civitai metadata (modelId=${modelId}) type=${modelJson.type}`);

      // If it's a LoRA, signal the caller to redirect
      const modelTypeStr = (modelJson.type || '').toString().toLowerCase();
      if (modelTypeStr.includes('lora') || modelTypeStr.includes('lycoris')) {
        const e = new Error('URL points to a LoRA — use the LoRA import endpoint instead');
        e.status = 400;
        e.code = 'IS_LORA';
        throw e;
      }

      const version = versionId
        ? modelJson.modelVersions.find(v => v.id.toString() === versionId)
        : modelJson.modelVersions[0];
      if (!version) {
        const e = new Error('No model version data found in Civitai response');
        e.status = 400;
        throw e;
      }

      const fileObj = version.files.find(
        f => (f.name && /\.(safetensors|ckpt)$/i.test(f.name)) ||
             (f.downloadUrl && /\.(safetensors|ckpt)$/i.test(f.downloadUrl))
      );
      if (!fileObj) {
        const e = new Error('No .ckpt or .safetensors file found in this Civitai version');
        e.status = 400;
        throw e;
      }

      downloadUrl = fileObj.downloadUrl;
      filename = fileObj.name || path.basename(downloadUrl);
      this.logger.info(`[ModelService] Resolved Civitai download: ${downloadUrl}`);
    }

    if (!/\.(safetensors|ckpt)$/i.test(filename)) {
      const e = new Error('Only .safetensors or .ckpt files are supported');
      e.status = 400;
      throw e;
    }

    const destPath = `checkpoints/users/${userId}/${filename}`;

    // Trigger fetch via comfyUIService if available, otherwise call ComfyDeploy REST API directly
    if (this.comfyUIService && typeof this.comfyUIService.fetchRemoteFile === 'function') {
      await this.comfyUIService.fetchRemoteFile(downloadUrl, destPath);
      this.logger.info(`[ModelService] comfyUIService.fetchRemoteFile queued -> ${destPath}`);
    } else {
      const apiKey = process.env.COMFY_DEPLOY_API_KEY;
      if (!apiKey) {
        this.logger.warn('[ModelService] No comfyUIService and COMFY_DEPLOY_API_KEY not set; fetch not triggered.');
      } else {
        const comfyDeployUrl = 'https://api.comfydeploy.com/api/volume/model';
        const payload = url.includes('civitai.com')
          ? { source: 'civitai', folderPath: path.dirname(destPath), filename, civitai: { url } }
          : { source: 'link', folderPath: path.dirname(destPath), filename, downloadLink: downloadUrl };

        this.logger.info(`[ModelService] POSTing to ComfyDeploy for checkpoint import`);
        try {
          const cdResp = await axios.post(comfyDeployUrl, payload, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          });
          if (cdResp.status !== 200 && cdResp.status !== 201) {
            const e = new Error('ComfyDeploy import failed');
            e.status = 500;
            throw e;
          }
        } catch (err) {
          this.logger.error('[ModelService] ComfyDeploy API error:', err.response?.data || err.message);
          const e = new Error('ComfyDeploy import failed');
          e.status = 500;
          e.details = err.response?.data || err.message;
          throw e;
        }
      }
    }

    return {
      category: 'checkpoint',
      path: destPath,
      owner: userId,
      visibility: 'private',
    };
  }
}

module.exports = { ModelService };
