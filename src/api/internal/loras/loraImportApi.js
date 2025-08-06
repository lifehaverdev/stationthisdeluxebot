const express = require('express');
const router = express.Router();
const LoRAModelsDB = require('../../../core/services/db/loRAModelDb');
const { extractCivitaiModelId, extractCivitaiModelVersionId, fetchCivitaiMetadata, extractHFRepoId, fetchHuggingFaceMetadata } = require('../../../utils/loraImportService');
const { ObjectId } = require('../../../core/services/db/BaseDB');

// TODO: Proper dependency injection for DB services and logger
const logger = console; // Placeholder logger
const loRAModelsDb = new LoRAModelsDB(logger);

const SUPPORTED_CHECKPOINTS = ['SDXL', 'SD1.5', 'FLUX', 'SD3'];
const DISALLOWED_DOWNLOAD_HOSTS = ['r2.dev']; // Added for URL policy

/**
 * Maps an external base model string to our internal checkpoint enum.
 * @param {string} baseModelString - e.g., "SDXL 1.0", "SD 1.5", "FLUX.1-dev"
 * @returns {string|null} Our internal checkpoint string (e.g., "SDXL", "SD1.5", "FLUX") or null if not mappable/supported.
 */
function mapBaseModelToCheckpoint(baseModelString) {
  if (!baseModelString || typeof baseModelString !== 'string') return null;
  const lowerBaseModel = baseModelString.toLowerCase();

  if (lowerBaseModel.includes('sdxl')) return 'SDXL';
  if (lowerBaseModel.includes('sd 3') || lowerBaseModel.includes('sd3')) return 'SD3'; // Order matters, SD3 before SD1.5
  if (lowerBaseModel.includes('sd 1.5') || lowerBaseModel.includes('sd1.5')) return 'SD1.5';
  if (lowerBaseModel.includes('flux')) return 'FLUX'; // Covers FLUX.1-dev, FLUX.1-schnell
  // Add other specific mappings as needed

  // Fallback for direct matches if the external API uses our exact terms
  const upperBaseModel = baseModelString.toUpperCase();
  if (SUPPORTED_CHECKPOINTS.includes(upperBaseModel)) return upperBaseModel;
  
  logger.warn(`[LoraImportApi] Could not map baseModelString "${baseModelString}" to a supported checkpoint.`);
  return null;
}


router.post('/import-from-url', async (req, res) => {
  const { loraUrl, masterAccountId } = req.body;

  if (!loraUrl || !masterAccountId) {
    return res.status(400).json({ error: 'Missing loraUrl or masterAccountId.' });
  }

  logger.info(`[LoraImportApi] Received import request for URL: ${loraUrl} by MAID: ${masterAccountId}`);

  let source = null;
  let extractedMetadata = null;
  let importDetails = {
    url: loraUrl,
    source: null,
    originalAuthor: null,
    modelFileUrl: null
  };

  try {
    if (loraUrl.includes('civitai.com')) {
      source = 'civitai';
      importDetails.source = source;
      const modelId = extractCivitaiModelId(loraUrl);
      const modelVersionId = extractCivitaiModelVersionId(loraUrl);
      if (!modelId) {
        return res.status(400).json({ error: 'Invalid Civitai URL or could not extract model ID.' });
      }
      extractedMetadata = await fetchCivitaiMetadata(modelId, modelVersionId);
      if (extractedMetadata) {
        importDetails.originalAuthor = extractedMetadata.originalAuthor;
        importDetails.modelFileUrl = extractedMetadata.downloadUrl; // Crucial for comfyui-deploy
      }
    } else if (loraUrl.includes('huggingface.co')) {
      source = 'huggingface';
      importDetails.source = source;
      const repoId = extractHFRepoId(loraUrl);
      if (!repoId) {
        return res.status(400).json({ error: 'Invalid Hugging Face URL or could not extract repository ID.' });
      }
      extractedMetadata = await fetchHuggingFaceMetadata(repoId);
       if (extractedMetadata) {
        importDetails.originalAuthor = extractedMetadata.originalAuthor;
        importDetails.modelFileUrl = extractedMetadata.downloadUrl; // Crucial for comfyui-deploy
      }
    } else {
      return res.status(400).json({ error: 'Unsupported URL source. Only Civitai and Hugging Face are supported.' });
    }

    if (!extractedMetadata) {
      return res.status(404).json({ error: `Could not fetch or parse metadata from ${source}.` });
    }

    // Validate base model and map to checkpoint
    const checkpoint = mapBaseModelToCheckpoint(extractedMetadata.baseModel);
    if (!checkpoint || !SUPPORTED_CHECKPOINTS.includes(checkpoint)) {
      return res.status(400).json({
        error: `Unsupported or undetermined base model type: ${extractedMetadata.baseModel || 'Not specified'}. Supported: ${SUPPORTED_CHECKPOINTS.join(', ')}`
      });
    }
    extractedMetadata.checkpoint = checkpoint; // Standardize to our schema field

    if (!importDetails.modelFileUrl) {
        logger.error(`[LoraImportApi] Critical: Model file download URL could not be determined from ${source} for ${loraUrl}.`);
        return res.status(400).json({ error: 'Could not determine the direct download URL for the model file.'});
    }

    // --- BEGIN ADDITION: URL Policy Check ---
    try {
        const downloadHost = new URL(importDetails.modelFileUrl).hostname;
        if (DISALLOWED_DOWNLOAD_HOSTS.some(disallowedHost => downloadHost.includes(disallowedHost))) {
            logger.warn(`[LoraImportApi] Rejected import from ${loraUrl} due to disallowed download host: ${downloadHost}`);
            return res.status(400).json({ error: `Downloads from the host '${downloadHost}' are not permitted.` });
        }
    } catch (urlParseError) {
        logger.warn(`[LoraImportApi] Invalid download URL format for ${importDetails.modelFileUrl}: ${urlParseError.message}`);
        return res.status(400).json({ error: 'Invalid model file download URL format.' });
    }
    // --- END ADDITION: URL Policy Check ---

    // TODO: Check for existing LoRA by source URL or other unique identifiers to prevent duplicates
    // const existingLora = await loRAModelsDb.findOne({ 'importedFrom.url': loraUrl });
    // if (existingLora) {
    //   logger.info(`[LoraImportApi] LoRA from URL ${loraUrl} already exists with slug: ${existingLora.slug}`);
    //   return res.status(409).json({ error: 'This LoRA has already been imported.', lora: existingLora });
    // }

    // --- ComfyUI Deploy Interaction Placeholder ---
    logger.info(`[LoraImportApi] TODO: Initiate ComfyUI deployment for model file: ${importDetails.modelFileUrl}`);
    // This is where you would call your comfyui-deploy API.
    // Example (conceptual):
    // const deployPayload = {
    //   model_url: importDetails.modelFileUrl,
    //   model_name: extractedMetadata.name, // Or a generated slug
    //   checkpoint_type: checkpoint, // To help comfyui-deploy place it correctly
    //   // ... any other params comfyui-deploy needs ...
    // };
    // try {
    //   // const deployResponse = await axios.post('YOUR_COMFYUI_DEPLOY_API_ENDPOINT/add-lora', deployPayload);
    //   // if (deployResponse.status !== 200 && deployResponse.status !== 201) { // Check for successful status
    //   //   throw new Error(`ComfyUI deployment failed with status ${deployResponse.status}: ${deployResponse.data?.error || 'Unknown error'}`);
    //   // }
    //   // logger.info(`[LoraImportApi] ComfyUI deployment initiated successfully for ${extractedMetadata.name}.`);
    //   // Artificial delay and success for testing without actual deployment API
    //   await new Promise(resolve => setTimeout(resolve, 2000)); 
    //   const isDeploySuccessful = Math.random() > 0.1; // 90% success for testing
    //   if (!isDeploySuccessful) throw new Error('Simulated ComfyUI deployment failure.');

    // } catch (deployError) {
    //   logger.error(`[LoraImportApi] ComfyUI deployment error for ${extractedMetadata.name} from ${importDetails.modelFileUrl}:`, deployError.message);
    //   return res.status(500).json({ error: 'Failed to deploy LoRA to ComfyUI.', details: deployError.message });
    // }
    // --- End ComfyUI Deploy Interaction Placeholder ---
    // For now, we'll simulate success of deployment and proceed to DB insert
    // MODIFICATION: Deployment to ComfyUI is deferred until admin approval.
    // We will now save the LoRA with a 'pending_review' status.

    const newLoraModel = await loRAModelsDb.createImportedLoRAModel(
      { 
        name: extractedMetadata.name,
        description: extractedMetadata.description,
        triggerWords: extractedMetadata.triggerWords,
        checkpoint: extractedMetadata.checkpoint, // This is our mapped internal value
        tags: extractedMetadata.tags,
        // defaultWeight might come from metadata if available, or use schema default
      },
      masterAccountId,
      importDetails
    );

    if (!newLoraModel) {
      // This might happen if DB insertion fails for some reason not caught by try/catch (e.g. validation layer if any)
      logger.error(`[LoraImportApi] Failed to save imported LoRA model to DB for URL: ${loraUrl}`);
      return res.status(500).json({ error: 'Failed to save LoRA model to database after fetching metadata.' });
    }

    logger.info(`[LoraImportApi] Successfully submitted LoRA for review: ${newLoraModel.name} (Slug: ${newLoraModel.slug}) from URL: ${loraUrl}`);
    // MODIFICATION: Changed response message and status code to reflect pending review status.
    res.status(202).json({ message: 'LoRA submitted successfully for admin review!', lora: { slug: newLoraModel.slug, name: newLoraModel.name } });

  } catch (error) {
    logger.error(`[LoraImportApi] General error during LoRA import for URL ${loraUrl}:`, error.message, error.stack);
    res.status(500).json({ error: 'An unexpected error occurred during the LoRA import process.', details: error.message });
  }
});

module.exports = router; 