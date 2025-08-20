const express = require('express');
const path = require('path');
const { ObjectId } = require('../../../core/services/db/BaseDB');
const LoRAModelsDB = require('../../../core/services/db/loRAModelDb');
const LoRAPermissionsDB = require('../../../core/services/db/loRAPermissionsDb');
const { extractCivitaiModelId, extractCivitaiModelVersionId } = require('../../../utils/loraImportService');
const axios = require('axios');
// comfyConfig removed, not yet used

/**
 * Generic Model Import API
 * POST /models/checkpoint/import
 * POST /models/lora/import  (delegates to existing logic but sets private + grants owner)
 */
module.exports = function createModelImportApi(deps = {}) {
  const {
    comfyService, // optional, for triggering remote fetch or upload
    logger = console,
  } = deps;

  const router = express.Router();
  const loRAModelsDb = new LoRAModelsDB(logger);
  const loRAPermissionsDb = new LoRAPermissionsDB(logger);

  // --- CHECKPOINT IMPORT ---------------------------------------------------
  // Body: { url, userId }
  router.post('/checkpoint/import', async (req, res) => {
    const { url, userId } = req.body;
    const resolvedUserId = userId || (req.user && req.user.userId);
    if (!url || !resolvedUserId) return res.status(400).json({ error: 'url and userId required' });
    try {
      const MAID = new ObjectId(resolvedUserId);
      // Determine download source
      let downloadUrl = url;
      let filename = path.basename(url.split('?')[0]);

      if (url.includes('civitai.com')) {
        try {
          const modelId = extractCivitaiModelId(url);
          const versionId = extractCivitaiModelVersionId(url);
          if (!modelId) throw new Error('Could not extract Civitai modelId');
          const apiUrl = `https://civitai.com/api/v1/models/${modelId}`;
          const resp = await axios.get(apiUrl);
          const modelJson = resp.data;

          // Diagnostic logging of the model record returned by Civitai
          logger.info(`[modelImportApi] Fetched Civitai metadata (modelId=${modelId}) type=${modelJson.type}`);

          const version = versionId ? modelJson.modelVersions.find(v=>v.id.toString()===versionId) : modelJson.modelVersions[0];
          if (!version) throw new Error('No model version data');

          logger.debug(`[modelImportApi] Using version id ${version.id}. Available files:`);
          version.files.forEach(f=>{
            logger.debug(`  - name=${f.name} | type=${f.type} | format=${f.metadata?.format || f.format} | size=${f.sizeKB || f.size || '?'}KB`);
          });

          // --- NEW: Auto-route LoRA pages to LoRA import flow -----------------
          const modelTypeStr = (modelJson.type || '').toString().toLowerCase();
          if (modelTypeStr.includes('lora') || modelTypeStr.includes('lycoris')) {
            logger.info(`[modelImportApi] Detected LoRA model on Civitai page (modelId=${modelId}). Delegating to /internal/v1/data/loras/import`);
            req.body.userId = resolvedUserId;
            return res.redirect(307, `/internal/v1/data/loras/import`);
          }
          // --------------------------------------------------------------------

          // Prefer files whose *name* OR downloadUrl includes .ckpt/.safetensors
          const fileObj = version.files.find(f=>((f.name && /\.(safetensors|ckpt)$/i.test(f.name)) || (f.downloadUrl && /\.(safetensors|ckpt)$/i.test(f.downloadUrl))));
          if (!fileObj) throw new Error('No .ckpt or .safetensors file found');
          downloadUrl = fileObj.downloadUrl;
          filename = fileObj.name || path.basename(downloadUrl);
          logger.info(`[modelImportApi] Resolved Civitai download ${downloadUrl}`);
        } catch(err){
          logger.warn(`[modelImportApi] Failed to resolve Civitai checkpoint file: ${err.message}`);
          return res.status(400).json({ error:'Unable to resolve checkpoint file from Civitai URL', details: err.message });
        }
      }

      if (!/\.(safetensors|ckpt)$/i.test(filename)) {
        return res.status(400).json({ error: 'Only .safetensors or .ckpt files supported' });
      }
      const destPath = `checkpoints/users/${resolvedUserId}/${filename}`;

      // Determine service implementation
      const _comfySvc = comfyService || deps.comfyUIService;
      if (_comfySvc && typeof _comfySvc.fetchRemoteFile === 'function') {
        try {
          const fetchResp = await _comfySvc.fetchRemoteFile(downloadUrl, destPath);
          logger.info(`[modelImportApi] comfyService.fetchRemoteFile OK -> ${JSON.stringify(fetchResp)}`);
        } catch (err) {
          logger.error('[modelImportApi] comfyService.fetchRemoteFile ERROR:', err.message);
          return res.status(500).json({ error: 'Comfy fetch failed', details: err.message });
        }
      } else {
        // Fallback: direct call to ComfyDeploy REST API
        const apiKey = process.env.COMFY_DEPLOY_API_KEY;
        if (!apiKey) {
          logger.warn('[modelImportApi] No comfyService and COMFY_DEPLOY_API_KEY not set; leaving fetch to background process.');
        } else {
          const comfyDeployUrl = 'https://api.comfydeploy.com/api/volume/model';
          let payload;
          if (url.includes('civitai.com')) {
            payload = {
              source: 'civitai',
              folderPath: path.dirname(destPath),
              filename,
              civitai: {
                url: url
              }
            };
          } else {
            payload = {
              source: 'link',
              folderPath: path.dirname(destPath),
              filename,
              // ComfyDeploy "link" source expects camelCase downloadLink param
              downloadLink: downloadUrl,
            };
          }
          logger.info(`[modelImportApi] POSTing to ComfyDeploy: ${comfyDeployUrl} payload=${JSON.stringify(payload)}`);
          try {
            const cdResp = await axios.post(comfyDeployUrl, payload, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            });
            logger.info(`[modelImportApi] ComfyDeploy response status=${cdResp.status}`);
            if (cdResp.status !== 200 && cdResp.status !== 201) {
              return res.status(500).json({ error: 'ComfyDeploy import failed', details: cdResp.data });
            }
          } catch (err) {
            logger.error('[modelImportApi] ComfyDeploy API error:', err.response?.data || err.message);
            return res.status(500).json({ error: 'ComfyDeploy import failed', details: err.response?.data || err.message });
          }
        }
      }

      return res.status(201).json({
        message: 'Checkpoint import queued',
        model: {
          category: 'checkpoint',
          path: destPath,
          owner: resolvedUserId,
          visibility: 'private',
        },
      });
    } catch (err) {
      logger.error('[modelImportApi] checkpoint import error', err);
      res.status(500).json({ error: 'import failed', details: err.message });
    }
  });

  // --- LORA IMPORT ---------------------------------------------------------
  // Delegates to existing logic but ensures private + permission grant
  router.post('/lora/import', async (req, res) => {
    const { url, userId } = req.body;
    const resolvedUserId = userId || (req.user && req.user.userId);
    if (!url || !resolvedUserId) return res.status(400).json({ error: 'url and userId required' });
    req.body.userId = resolvedUserId;
    try {
      // Delegate by issuing an internal redirect to the existing endpoint.
      // This keeps behaviour identical while allowing front-end to hit the new path.
      res.redirect(307, `/internal/v1/data/loras/import`); // 307 = preserve method + body
    } catch (e) {
      res.status(500).json({ error: 'not implemented yet', details: e.message });
    }
  });

  return router;
}; 