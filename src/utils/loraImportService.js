/**
 * LoRA Import Service
 * 
 * Handles fetching and parsing metadata for LoRA models from external sources like Civitai and Hugging Face.
 */

const axios = require('axios'); // For making HTTP requests
// const { LoRAModelsDB } = require('../core/services/db/loRAModelDb'); // May not be needed directly here, but for schema reference

const logger = console; // Placeholder, will be replaced by proper logger injection

/**
 * Basic HTML stripping utility.
 * @param {string} htmlString The HTML string.
 * @returns {string} The text content without HTML tags.
 */
function stripHtml(htmlString) {
  if (!htmlString || typeof htmlString !== 'string') return '';
  return htmlString.replace(/<[^>]*>?/gm, '');
}

/**
 * Extracts the Civitai model ID from a Civitai URL.
 * @param {string} civitaiUrl - e.g., https://civitai.com/models/123/my-lora or https://civitai.com/models/123
 * @returns {string|null} The model ID or null if not found.
 */
function extractCivitaiModelId(civitaiUrl) {
  if (!civitaiUrl || typeof civitaiUrl !== 'string') return null;
  const match = civitaiUrl.match(/civitai\.com\/models\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extracts the Civitai model version ID from a Civitai URL.
 * @param {string} civitaiUrl - e.g., https://civitai.com/models/123/my-lora?modelVersionId=456
 * @returns {string|null} The model version ID or null if not found.
 */
function extractCivitaiModelVersionId(civitaiUrl) {
  if (!civitaiUrl || typeof civitaiUrl !== 'string') return null;
  const match = civitaiUrl.match(/[?&]modelVersionId=(\d+)/);
  return match ? match[1] : null;
}

/**
 * Fetches metadata for a LoRA model from Civitai.
 * @param {string} modelId - The Civitai model ID.
 * @param {string|null} modelVersionId - The specific model version ID to fetch, or null for the latest.
 * @returns {Promise<Object|null>} An object with extracted metadata or null on error.
 */
async function fetchCivitaiMetadata(modelId, modelVersionId = null) {
  if (!modelId) return null;
  const apiUrl = `https://civitai.com/api/v1/models/${modelId}`;
  logger.info(`[LoraImportService] Fetching Civitai metadata from: ${apiUrl}`);
  try {
    const response = await axios.get(apiUrl);
    const data = response.data;

    if (!data || data.type !== 'LORA') { 
      logger.warn(`[LoraImportService] Civitai model ${modelId} is not of type LORA or data is invalid.`);
      return null;
    }

    // Determine the specific model version to use
    let versionData = data.modelVersions?.[0]; // Default to the first (latest) version
    if (modelVersionId && data.modelVersions?.length) {
      const foundVersion = data.modelVersions.find(v => v.id.toString() === modelVersionId.toString());
      if (foundVersion) {
        versionData = foundVersion;
      } else {
        logger.warn(`[LoraImportService] Civitai modelVersionId ${modelVersionId} not found for model ${modelId}. Defaulting to latest.`);
      }
    }

    if (!versionData) {
      logger.warn(`[LoraImportService] No version data found for Civitai model ${modelId}.`);
      return null;
    }

    const fileData = versionData.files?.[0]; // Assuming one primary file per version for LoRAs

    const metadata = {
      name: data.name || versionData.name,
      description: stripHtml(versionData.description || data.description || ''), // Prefer version description
      baseModel: versionData.baseModel, // e.g., "SD 1.5", "SDXL 1.0", "Flux.1 D"
      triggerWords: versionData.trainedWords || [],
      previewImageUrl: versionData.images?.[0]?.url || null, 
      downloadUrl: fileData?.downloadUrl || null,
      modelFilename: fileData?.name || null, // e.g., some_lora.safetensors
      civitaiPageUrl: modelVersionId ? `https://civitai.com/models/${modelId}?modelVersionId=${modelVersionId}` : `https://civitai.com/models/${modelId}`,
      originalAuthor: data.creator?.username || null,
      tags: data.tags?.map(tag => ({ tag: tag, source: "civitai" })) || [],
    };

    // Fallback for trigger words from description if trainedWords is empty and description seems to list them
    if (metadata.triggerWords.length === 0 && metadata.description) {
        const descLowerCase = metadata.description.toLowerCase();
        const triggerMatch = descLowerCase.match(/(?:trigger words?|activation(?: terms?)|tag words?)\s*:\s*([^\n.]+)/i);
        if (triggerMatch && triggerMatch[1]) {
            metadata.triggerWords = triggerMatch[1].split(',').map(tw => tw.trim()).filter(tw => tw.length > 0);
            logger.info(`[LoraImportService] Extracted trigger words from description for ${modelId}: ${metadata.triggerWords.join(', ')}`);
        }
    }
    // Ensure modelFilename has an extension, default to .safetensors if missing and it's a common LoRA file
    if (metadata.modelFilename && !metadata.modelFilename.includes('.') && fileData?.type === 'Model' && fileData?.format === 'SafeTensor') {
        metadata.modelFilename += '.safetensors';
    }

    logger.info(`[LoraImportService] Successfully fetched and mapped Civitai metadata for model ID: ${modelId}, VersionID: ${versionData.id}`);
    return metadata;
  } catch (error) {
    logger.error(`[LoraImportService] Error fetching Civitai metadata for model ID ${modelId}:`, error.message, error.response?.data);
    return null;
  }
}

/**
 * Extracts the Hugging Face repository ID from a URL.
 * @param {string} hfUrl - e.g., https://huggingface.co/username/model-name
 * @returns {string|null} The repo ID (username/model-name) or null.
 */
function extractHFRepoId(hfUrl) {
  if (!hfUrl || typeof hfUrl !== 'string') return null;
  // Matches URLs like huggingface.co/user/repo or huggingface.co/user/repo/tree/main etc.
  const match = hfUrl.match(/huggingface\.co\/([^/]+\/[^/]+)/);
  return match ? match[1].replace(/\/tree\/.*/, '') : null; // Remove /tree/... part if present
}

/**
 * Fetches metadata for a LoRA model from Hugging Face.
 * This is a placeholder and will need significant refinement based on common LoRA repo structures.
 * @param {string} repoId - The Hugging Face repository ID (e.g., "username/model-name").
 * @returns {Promise<Object|null>} An object with extracted metadata or null on error.
 */
async function fetchHuggingFaceMetadata(repoId) {
  if (!repoId) return null;
  const apiUrl = `https://huggingface.co/api/models/${repoId}`;
  logger.info(`[LoraImportService] Fetching Hugging Face metadata from: ${apiUrl}`);

  try {
    const response = await axios.get(apiUrl);
    const data = response.data;

    if (!data || !data.modelId) {
      logger.warn(`[LoraImportService] Invalid or incomplete data from Hugging Face API for repo: ${repoId}`);
      return null;
    }

    const cardData = data.cardData || {}; // Parsed YAML frontmatter from README
    const siblings = data.siblings || []; // List of files in the repo

    let description = cardData.description || '';
    if (!description && data.readme) { // Fallback to raw readme and try to find a description section
        const readmeContent = data.readme; // Raw README content
        const descMatch = readmeContent.match(/## Model description\\s*([^#]+)/i) || readmeContent.match(/## Description\\s*([^#]+)/i);
        if (descMatch && descMatch[1]) {
            description = stripHtml(descMatch[1].trim());
        }
    }
    if (!description) {
        // If still no description, try a generic part of the README if it exists
        const readmeContent = data.readme || '';
        description = stripHtml(readmeContent.substring(0, 500).trim()); // First 500 chars as a basic fallback
    }

    let baseModel = cardData.base_model || cardData.baseModel; // Common keys in cardData
    if (!baseModel && data.config?.architectures?.length > 0) {
        // Sometimes base model info is in config.json -> _name_or_path of an architecture
        // This is a heuristic and might need refinement
        if (data.config.architectures[0].includes('stable-diffusion')) baseModel = 'Stable Diffusion';
        // Add more heuristics for SDXL, FLUX based on typical HF model structures if needed
    }
    // If baseModel is a repo ID like 'stabilityai/stable-diffusion-xl-base-1.0', try to simplify it
    if (baseModel && typeof baseModel === 'string') {
        if (baseModel.toLowerCase().includes('flux')) baseModel = 'FLUX';
        else if (baseModel.toLowerCase().includes('sdxl') || baseModel.toLowerCase().includes('stable-diffusion-xl')) baseModel = 'SDXL';
        else if (baseModel.toLowerCase().includes('sd-turbo') || baseModel.toLowerCase().includes('stable-diffusion-turbo')) baseModel = 'SDXL'; // Often SDXL based
        else if (baseModel.toLowerCase().includes('sd_xl')) baseModel = 'SDXL';
        else if (baseModel.toLowerCase().includes('sd1.5') || baseModel.toLowerCase().includes('stable-diffusion-1.5') || baseModel.toLowerCase().includes('v1-5')) baseModel = 'SD1.5';
        else if (baseModel.toLowerCase().includes('sd 1.5')) baseModel = 'SD1.5';
        else if (baseModel.toLowerCase().includes('stable-diffusion')) baseModel = 'Stable Diffusion'; // Generic SD, might need more info
    }
    // Check example page: black-forest-labs/FLUX.1-dev
    if (data.cardData?.model_tree?.[data.modelId]?.base_model === 'black-forest-labs/FLUX.1-dev') { // from your example
        baseModel = 'FLUX';
    }
    if (!baseModel && cardData?.tags?.includes('flux')) baseModel = 'FLUX';
    if (!baseModel && cardData?.tags?.includes('sdxl')) baseModel = 'SDXL';
    if (!baseModel && cardData?.tags?.includes('stable-diffusion')) baseModel = 'SD1.5'; // A guess
    
    let triggerWords = cardData.trigger_words || cardData.triggerWords || cardData.invocation || cardData.trained_words || [];
    if (!Array.isArray(triggerWords)) triggerWords = typeof triggerWords === 'string' ? [triggerWords] : [];

    if (triggerWords.length === 0 && data.readme) {
        const readmeContent = data.readme;
        const triggerMatch = readmeContent.match(/## Trigger words?\\s*([^#]+)/i);
        if (triggerMatch && triggerMatch[1]) {
            triggerWords = triggerMatch[1].split('`').map(tw => tw.trim()).filter(tw => tw && tw.length > 1 && !tw.startsWith('##'));
            if(triggerWords.length === 0) { // try splitting by comma if no backticks found
                 triggerWords = triggerMatch[1].split(',').map(tw => tw.trim()).filter(tw => tw && tw.length > 0 && !tw.startsWith('##'));
            }
        }
    }

    let previewImageUrl = cardData.thumbnail || cardData.heroImage || cardData.preview_image_url || null;
    if (!previewImageUrl && data.readme) {
        const readmeContent = data.readme;
        const imgMatch = readmeContent.match(/!\[.*?\]\(([^)]+\.(?:png|jpg|jpeg|gif|webp)).*?\)/i);
        if (imgMatch && imgMatch[1]) {
            if (imgMatch[1].startsWith('http')) {
                previewImageUrl = imgMatch[1];
            } else { // Relative path, construct full URL
                previewImageUrl = `https://huggingface.co/${repoId}/resolve/main/${imgMatch[1].startsWith('./') ? imgMatch[1].substring(2) : imgMatch[1]}`;
            }
        }
    }
    // Fallback to finding any image file in the repo if no explicit preview
    if(!previewImageUrl && siblings.length > 0){
        const imageFile = siblings.find(f => f.rfilename && (f.rfilename.endsWith('.png') || f.rfilename.endsWith('.jpg') || f.rfilename.endsWith('.jpeg')) && (f.rfilename.toLowerCase().includes('preview') || f.rfilename.toLowerCase().includes('example') || f.rfilename.toLowerCase().includes('sample') || f.rfilename.toLowerCase().includes('cover')));
        if(imageFile) previewImageUrl = `https://huggingface.co/${repoId}/resolve/main/${imageFile.rfilename}`;
    }

    let downloadUrl = null;
    let modelFilename = null;
    const safetensorFile = siblings.find(f => f.rfilename && f.rfilename.endsWith('.safetensors'));

    if (safetensorFile) {
      modelFilename = safetensorFile.rfilename;
      downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${modelFilename}`;
    } else {
      // Fallback for other potential LoRA file types if needed in future, e.g. .bin, .pt
      logger.warn(`[LoraImportService] No .safetensors file found for HF repo ${repoId}. Check for other types if supported.`);
    }
    
    const metadata = {
      name: cardData.title || data.modelId.split('/')[1] || data.modelId,
      description: description.substring(0,1500), // Truncate long descriptions
      baseModel: baseModel || 'Undetermined', 
      triggerWords: triggerWords.filter(tw => tw.length < 100), // Filter out overly long strings
      previewImageUrl: previewImageUrl,
      downloadUrl: downloadUrl,
      modelFilename: modelFilename,
      huggingFacePageUrl: `https://huggingface.co/${repoId}`,
      originalAuthor: data.author || data.modelId.split('/')[0] || null,
      tags: data.tags?.map(tag => ({ tag: tag, source: "huggingface" })) || [],
    };

    logger.info(`[LoraImportService] Successfully fetched and mapped Hugging Face metadata for repo: ${repoId}`);
    // logger.debug('[LoraImportService] HF Mapped Metadata:', JSON.stringify(metadata, null, 2));
    return metadata;
  } catch (error) {
    logger.error(`[LoraImportService] Error fetching Hugging Face metadata for repo ${repoId}:`, error.message, error.response?.data);
    return null;
  }
}

module.exports = {
  stripHtml,
  extractCivitaiModelId,
  extractCivitaiModelVersionId,
  fetchCivitaiMetadata,
  extractHFRepoId,
  fetchHuggingFaceMetadata
}; 