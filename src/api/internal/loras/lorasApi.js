const express = require('express');
const router = express.Router();
const LoRAModelsDB = require('../../../core/services/db/loRAModelDb'); 
const LoRAPermissionsDB = require('../../../core/services/db/loRAPermissionsDb');
const UserPreferencesDB = require('../../../core/services/db/userPreferencesDb');
const { ObjectId } = require('../../../core/services/db/BaseDB');
const axios = require('axios'); // For ComfyUI Deploy API call
const loraTriggerMapApi = require('./loraTriggerMapApi');
const { sendAdminLoraApprovalRequest } = require('../../../core/services/notifications/telegramNotifier');
const crypto = require('crypto');

// Mount the trigger map router
router.use(loraTriggerMapApi.router);

// TODO: Proper dependency injection for DB services and logger
const logger = console; // Placeholder logger
const loRAModelsDb = new LoRAModelsDB(logger);
const loRAPermissionsDb = new LoRAPermissionsDB(logger);
const userPreferencesDb = new UserPreferencesDB(logger);

/**
 * Fetches and transforms model data from a Civitai URL.
 * @param {string} url - The Civitai model URL.
 * @returns {Promise<Object|null>} - The transformed model data or null.
 */
async function getCivitaiModelData(url) {
    logger.debug(`[LorasApi] Fetching Civitai data for URL: ${url}`);
    
    const modelVersionIdMatch = url.match(/modelVersionId=(\d+)/);
    const modelIdMatch = url.match(/models\/(\d+)/);

    let versionId = modelVersionIdMatch ? modelVersionIdMatch[1] : null;
    let modelId = modelIdMatch ? modelIdMatch[1] : null;

    if (!versionId && !modelId) {
        logger.error('[LorasApi] Could not extract modelId or modelVersionId from Civitai URL.');
        throw new Error('Could not extract modelId or modelVersionId from Civitai URL.');
    }

    let modelJson;
    let versionJson;

    try {
        if (versionId) {
            const versionResponse = await axios.get(`https://civitai.com/api/v1/model-versions/${versionId}`);
            versionJson = versionResponse.data;
            modelJson = versionJson.model; // The model object is nested inside the version response
        } else { // We have a modelId, but not a versionId
            const modelResponse = await axios.get(`https://civitai.com/api/v1/models/${modelId}`);
            modelJson = modelResponse.data;
            if (!modelJson.modelVersions || modelJson.modelVersions.length === 0) {
                throw new Error(`No model versions found for modelId ${modelId}`);
            }
            versionJson = modelJson.modelVersions[0]; // Get the latest version
        }
    } catch (apiError) {
        const errorMsg = apiError.response ? JSON.stringify(apiError.response.data) : apiError.message;
        logger.error(`[LorasApi] Civitai API error fetching data for versionId=${versionId}/modelId=${modelId}: ${errorMsg}`);
        throw new Error(`Civitai API request failed: ${errorMsg}`);
    }

    if (!versionJson) {
        logger.error(`[LorasApi] No version data found on Civitai for url: ${url}`);
        throw new Error('No version data found on Civitai for the provided URL.');
    }

    if (!modelJson) {
        logger.error(`[LorasApi] No parent model data found for Civitai version ${versionJson.id}`);
        throw new Error(`Could not find parent model data for version ${versionJson.id}`);
    }

    const modelFile = versionJson.files.find(f => f.type === 'Model' && f.metadata?.format?.toLowerCase() === 'safetensors');
    
    if (!modelFile) {
        logger.warn(`[LorasApi] No SafeTensors model file found for Civitai model version ${versionJson.id}. Proceeding without a direct modelFileUrl.`);
    }
    
    let trainedWords = versionJson.trainedWords || [];
    if (trainedWords.length === 0) {
        logger.debug(`[LorasApi] No trigger words found for Civitai model '${modelJson.name}'. Generating a hash-based trigger.`);
        const hash = crypto.createHash('sha256').update(modelJson.name).digest('hex');
        const generatedTrigger = `lorahash_${hash.substring(0, 16)}`;
        trainedWords.push(generatedTrigger);
        logger.debug(`[LorasApi] Generated trigger for '${modelJson.name}': ${generatedTrigger}`);
    }
    
    const modelData = {
        name: modelJson.name,
        description: versionJson.description || modelJson.description || '',
        triggerWords: trainedWords,
        checkpoint: versionJson.baseModel,
        tags: (modelJson.tags || []).map(tag => ({ tag: tag, source: 'civitai' })),
        previewImages: (versionJson.images || []).filter(img => img.url).map(img => img.url),
        defaultWeight: 1.0,
    };

    const importDetails = {
        source: 'civitai',
        url: url,
        originalAuthor: modelJson.creator?.username || null,
        modelFileUrl: modelFile ? modelFile.downloadUrl : null,
    };
    
    return { modelData, importDetails };
}

/**
 * POST /import - Imports a LoRA model from a URL.
 * Body:
 *  - url (string): The URL of the model to import (e.g., from Civitai).
 *  - userId (string): The masterAccountId of the user initiating the import.
 */
router.post('/import', async (req, res) => {
    const { url, userId } = req.body;

    if (!url || !userId) {
        return res.status(400).json({ message: 'URL and userId are required.' });
    }

    logger.debug(`[LorasApi] POST /import called for URL: ${url} by UserID: ${userId}`);

    try {
        let MAID;
        try {
            MAID = new ObjectId(userId);
        } catch (e) {
            return res.status(400).json({ message: 'Invalid userId format for masterAccountId.' });
        }

        let modelData;
        let importDetails;

        if (url.includes('civitai.com')) {
            const civitaiData = await getCivitaiModelData(url);
            modelData = civitaiData.modelData;
            importDetails = civitaiData.importDetails;
        } else if (url.includes('huggingface.co')) {
            return res.status(501).json({ message: 'Hugging Face import is not yet implemented.' });
        } else {
            return res.status(400).json({ message: 'Unsupported model URL. Please use a Civitai or Hugging Face link.' });
        }
        
        const newLora = await loRAModelsDb.createImportedLoRAModel(modelData, userId, importDetails);

        if (!newLora) {
            return res.status(500).json({ message: 'Failed to create LoRA model record in the database.' });
        }

        logger.info(`[LorasApi] Successfully imported LoRA '${newLora.name}' (ID: ${newLora._id}) for user ${userId}`);

        // --- NEW: Automatically grant private access to the importing user ---
        try {
            await loRAPermissionsDb.grantAccess({
              loraId: newLora._id,
              userId: userId,
              licenseType: 'owner_grant',
              priceCents: 0,
              grantedBy: userId,
            });
            logger.info(`[LorasApi] Granted private access for LoRA ${newLora._id} to user ${userId}`);
        } catch (permErr) {
            logger.error(`[LorasApi] Failed to grant private access for LoRA ${newLora._id}: ${permErr.message}`);
        }

        // --- NEW: Send admin notification ---
        sendAdminLoraApprovalRequest(newLora).catch(err => {
            logger.error(`[LorasApi] Failed to send admin notification for new LoRA ${newLora._id}: ${err.message}`);
        });
        // --- END NEW ---

        res.status(200).json({ 
            message: `✅ Successfully imported LoRA: *${newLora.name}* and granted you private access.\n\nIt is pending admin review for public listing, but you can start using it immediately!`,
            lora: newLora 
        });

    } catch (error) {
        logger.error(`[LorasApi] Error in POST /import for URL ${url}:`, error.stack);
        res.status(500).json({ message: `An error occurred during import: ${error.message}` });
    }
});

/**
 * GET /list - Fetch a list of LoRAs based on filters.
 * Query Parameters:
 *  - filterType (string, optional): type_category, popular, recent, favorites
 *  - checkpoint (string, optional, default: 'All'): SDXL, SD1.5, FLUX, All
 *  - userId (string, optional): masterAccountId for permissions/favorites
 *  - page (number, optional, default: 1)
 *  - limit (number, optional, default: 10)
 *  - q (string, optional): Search query
 */
router.get('/list', async (req, res) => {
  try {
    const { 
      filterType, 
      sort,
      checkpoint = 'All', 
      userId, // This is masterAccountId string
      q 
    } = req.query;
    // Resolve user from query or authenticated context
    const resolvedUserId = userId || (req.user && req.user.userId);
    // Allow `search` as an alias for `q`
    const searchTerm = q || req.query.search;
    const category = req.query.category;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);

    logger.debug(`[LorasApi] GET /list called with filters: ${JSON.stringify(req.query)}`);

    let dbQuery = {}; // Base query
    let sortOptions = {};
    let MAID = null;

    if (resolvedUserId) {
        try {
            MAID = new ObjectId(resolvedUserId);
            // If userId is present, fetch IDs of accessible private LoRAs and combine with public ones.
            const accessibleLoraPermissions = await loRAPermissionsDb.listAccessibleLoRAs(resolvedUserId);
            const accessiblePrivateLoraIds = accessibleLoraPermissions.map(p => p.loraId);

            dbQuery.$or = [
                { visibility: 'public' },
                { _id: { $in: accessiblePrivateLoraIds } }
            ];
        } catch (e) {
            return res.status(400).json({ error: 'Invalid userId format for masterAccountId.' });
        }
    } else {
        // No userId, only public LoRAs
        dbQuery.visibility = 'public';
    }

    if (checkpoint && checkpoint.toLowerCase() !== 'all') {
      dbQuery.checkpoint = checkpoint;
    }

    // NEW: explicit category filter (checks both dedicated field and tags.tag)
    if (category && category.toLowerCase() !== 'all') {
      dbQuery.$or = dbQuery.$or || [];
      dbQuery.$or.push({ category: category });
      dbQuery.$or.push({ 'tags.tag': category });
    }

    if (searchTerm) {
      dbQuery.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { slug: { $regex: searchTerm, $options: 'i' } },
        { triggerWords: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { 'tags.tag': { $regex: searchTerm, $options: 'i' } }
      ];
    }

    if (filterType) {
      if (filterType.startsWith('type_')) {
        const category = filterType.substring(5);
        dbQuery['tags.tag'] = category;
        sortOptions = { createdAt: -1 };
      } else if (filterType === 'popular') {
        sortOptions = { usageCount: -1 };
      } else if (filterType === 'recent') {
        sortOptions = { createdAt: -1 };
      } else if (filterType === 'favorites') {
        if (!MAID) {
          return res.status(400).json({ error: 'userId is required to fetch favorites.'});
        }
        const userFavoriteIds = await userPreferencesDb.getLoraFavoriteIds(MAID);
        if (userFavoriteIds.length === 0) {
          return res.status(200).json({ loras: [], pagination: { currentPage: page, totalPages: 0, totalLoras: 0, limit } });
        }
        dbQuery._id = { $in: userFavoriteIds.map(id => new ObjectId(id)) };
        sortOptions = { createdAt: -1 }; 
      }
    }

    // -- NEW generic sort parameter (overrides filterType sort if present) --
    if (sort) {
      const sortMap = {
        // common aliases
        recent: { createdAt: -1 },
        createdAt_desc: { createdAt: -1 },
        createdAt_asc: { createdAt: 1 },
        popular: { usageCount: -1 },
        name_asc: { name: 1 },
        name_desc: { name: -1 },
        price_asc: { 'monetization.priceUSD': 1 },
        price_desc: { 'monetization.priceUSD': -1 },
        rating_desc: { 'rating.sum': -1 }, // uses total rating sum as proxy for avg
        rating_asc: { 'rating.sum': 1 }
      };
      if (sortMap[sort]) {
        sortOptions = sortMap[sort];
      } else {
        logger.warn(`[LorasApi] Unknown sort param '${sort}', defaulting to createdAt desc`);
        sortOptions = { createdAt: -1 };
      }
    }

    const skip = (page - 1) * limit;

    // Special default ordering when no explicit sort/filterType: 
    // 1) user favorites, 2) newest within 30 days, 3) most popular
    if (!sort && !filterType) {
      const totalLoras = await loRAModelsDb.count(dbQuery);

      let favoriteObjectIds = [];
      if (MAID) {
        try {
          const favIds = await userPreferencesDb.getLoraFavoriteIds(MAID);
          favoriteObjectIds = favIds
            .filter(id => /^[0-9a-fA-F]{24}$/.test(id))
            .map(id => new ObjectId(id));
        } catch (favErr) {
          logger.warn('[LorasApi] Failed to load favorite ids for special sort:', favErr.message);
        }
      }

      const recentThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const pipeline = [
        { $match: dbQuery },
        { $addFields: {
            isFavorite: favoriteObjectIds.length ? { $in: ['$_id', favoriteObjectIds] } : false,
            isRecent: { $gte: ['$createdAt', recentThreshold] }
        }},
        { $sort: { isFavorite: -1, isRecent: -1, createdAt: -1, usageCount: -1 } },
        { $skip: skip },
        { $limit: limit }
      ];

      logger.debug(`[LorasApi] Executing special-sort aggregate. Match: ${JSON.stringify(dbQuery)}, Skip: ${skip}, Limit: ${limit}`);
      const lorasFromDb = await loRAModelsDb.aggregate(pipeline);

      let userFavoriteIdsSet = new Set();
      if (MAID) {
        const favIds = await userPreferencesDb.getLoraFavoriteIds(MAID);
        userFavoriteIdsSet = new Set(favIds);
      }

      const loras = lorasFromDb.map(lora => ({
        _id: lora._id.toString(),
        slug: lora.slug,
        name: lora.name, 
        triggerWords: lora.triggerWords || [],
        checkpoint: lora.checkpoint,
        tags: lora.tags || [],
        createdAt: lora.createdAt,
        previewImageUrl: (lora.previewImages && lora.previewImages.length > 0) ? lora.previewImages[0] : null,
        ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null, // Seller's ID
        monetization: lora.monetization, // Crucial for price display
        isPurchased: userFavoriteIdsSet.has(lora._id.toString()),
      }));

      const totalPages = Math.ceil(totalLoras / limit);

      return res.status(200).json({
        loras,
        pagination: {
          currentPage: page,
          totalPages,
          totalLoras,
          limit
        }
      });
    }

    logger.debug(`[LorasApi] Executing DB query: ${JSON.stringify(dbQuery)}, Sort: ${JSON.stringify(sortOptions)}, Skip: ${skip}, Limit: ${limit}`);

    const totalLoras = await loRAModelsDb.count(dbQuery);
    const lorasFromDb = await loRAModelsDb.findMany(dbQuery, { sort: sortOptions, skip, limit });

    let userFavoriteIdsSet = new Set();
    if (MAID) {
      const favIds = await userPreferencesDb.getLoraFavoriteIds(MAID);
      userFavoriteIdsSet = new Set(favIds);
    }

    const loras = lorasFromDb.map(lora => {
      const includeCivitai = String(req.query.includeCivitaiTags||'').toLowerCase()==='true';
      const cleanTags = (lora.tags||[]).filter(t=>{
        if(includeCivitai) return true;
        if(typeof t==='string') return true;
        return (t.source||'').toLowerCase()!=='civitai';
      });
      return ({
      _id: lora._id.toString(),
      slug: lora.slug,
      name: lora.name, 
      triggerWords: lora.triggerWords || [],
      checkpoint: lora.checkpoint,
      tags: cleanTags,
      createdAt: lora.createdAt,
      previewImageUrl: (lora.previewImages && lora.previewImages.length > 0) ? lora.previewImages[0] : null,
      ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null, // Seller's ID
      monetization: lora.monetization, // Crucial for price display
      isPurchased: userFavoriteIdsSet.has(lora._id.toString()),
      /* Note: other fields like defaultWeight, cognates, full tags, isFavorite 
         are omitted for list view brevity but available in detail view. */
    }); });

    const totalPages = Math.ceil(totalLoras / limit);

    res.status(200).json({
      loras,
      pagination: {
        currentPage: page,
        totalPages,
        totalLoras,
        limit
      }
    });

  } catch (error) {
    logger.error(`[LorasApi] Error in GET /list: ${error.message}`, error.stack);
    res.status(500).json({ error: 'Failed to fetch LoRAs', details: error.message });
  }
});

/**
 * GET /categories - Fetch distinct LoRA categories.
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = await loRAModelsDb.listCategories();
    res.status(200).json({ categories });
  } catch (error) {
    logger.error(`[LorasApi] Error in GET /categories: ${error.message}`, error.stack);
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
  }
});

// TODO: Add other endpoints like GET /:slugOrId for details, POST/DELETE for favorites/ratings

// ++ NEW GET LORA BY IDENTIFIER ENDPOINT ++
/**
 * GET /:loraIdentifier - Fetch detailed information for a single LoRA.
 * Path Parameters:
 *  - loraIdentifier (string): The LoRA's slug or MongoDB _id.
 * Query Parameters:
 *  - userId (string, optional): masterAccountId for permission checks (e.g., for private LoRAs).
 *  - isAdmin (boolean, optional): Flag to bypass standard permission checks for private LoRAs.
 */
router.get('/:loraIdentifier', async (req, res) => {
  try {
    const { loraIdentifier } = req.params;
    const { userId, isAdmin } = req.query; // isAdmin flag for bypassing permission checks.
    let MAID = null;
    if (userId) {
        try {
            MAID = new ObjectId(userId);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid userId format for masterAccountId.' });
        }
    }

    logger.info(`[LorasApi] GET /${loraIdentifier} called, userId: ${userId}`);

    let lora = await loRAModelsDb.findOne({ slug: loraIdentifier });

    if (!lora) {
      // Try finding by _id if not found by slug
      // loRAModelsDb.findById should handle string-to-ObjectId conversion if necessary
      // or we might need to explicitly try/catch ObjectId conversion if findById expects an ObjectId object
      try {
        // Assuming findById can take a string and handles conversion, or your DB layer does.
        // If not, you'd do: lora = await loRAModelsDb.findById(new ObjectId(loraIdentifier));
        // For now, let's assume loRAModelsDb.findById handles string ID.
        lora = await loRAModelsDb.findById(loraIdentifier);
      } catch (idError) {
        // This catch is primarily if ObjectId conversion itself fails for an invalid format string
        logger.warn(`[LorasApi] Invalid format for _id lookup: ${loraIdentifier}`, idError.message);
        // lora will remain null, leading to 404 below
      }
    }

    if (!lora) {
      return res.status(404).json({ error: 'LoRA not found.' });
    }

    let isFavorite = false;
    if (MAID) {
      const userFavoriteIds = await userPreferencesDb.getLoraFavoriteIds(MAID);
      isFavorite = userFavoriteIds.includes(lora._id.toString());
    }

    // Permission check for private LoRAs, bypassed for admins
    if (lora.visibility === 'private' && !isAdmin) {
      if (!MAID) {
        return res.status(403).json({ error: 'Access denied. This LoRA is private and requires user authentication.' });
      }
      // Check for a specific permission grant instead of just ownership
      const hasPermission = await loRAPermissionsDb.hasAccess(userId, lora._id.toString());
      if (!hasPermission) {
          logger.warn(`[LorasApi] Access denied for MAID ${userId} to private LoRA ${lora._id.toString()}. No permission found.`);
        return res.status(403).json({ error: 'Access denied to this private LoRA.' });
      }
    }
    // TODO: Implement more granular license-based permission check if lora.permissionType is 'licensed'
    // using loRAPermissionsDb.canUserAccess(userId, lora._id)

    // Map to the desired output structure (similar to the list, but potentially more fields)
    const loraDetails = {
      _id: lora._id.toString(),
      slug: lora.slug,
      name: lora.name,
      description: lora.description,
      triggerWords: lora.triggerWords || [],
      cognates: lora.cognates || [],
      tags: lora.tags || [],
      checkpoint: lora.checkpoint,
      baseModel: lora.baseModel,
      version: lora.versionInfo, // Assuming schema has versionInfo or similar for LoRA version
      visibility: lora.visibility || 'public',
      ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null,
      usageCount: lora.usageCount || 0,
      lastUsedAt: lora.lastUsedAt,
      rating: lora.rating || { sum:0, count:0 },
      ratingAvg: lora.rating && lora.rating.count ? (lora.rating.sum / lora.rating.count) : 0,
      previewImages: lora.previewImages || [],
      downloadUrl: lora.downloadUrl,
      civitaiPageUrl: lora.civitaiPageUrl,
      notes: lora.notes,
      defaultWeight: lora.defaultWeight || 1.0,
      createdAt: lora.createdAt,
      updatedAt: lora.updatedAt,
      isFavorite: isFavorite // Add isFavorite flag
    };

    res.status(200).json({ lora: loraDetails });

  } catch (error) {
    logger.error(`[LorasApi] Error in GET /:loraIdentifier (${req.params.loraIdentifier}): ${error.message}`, error.stack);
    // Check if it's a CastError from MongoDB (e.g. invalid ObjectId format for _id lookup)
    if (error.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid LoRA identifier format.' });
    }
    res.status(500).json({ error: 'Failed to fetch LoRA details', details: error.message });
  }
});

// ++ NEW ADMIN APPROVAL/REJECTION ENDPOINTS ++

/**
 * POST /:loraIdentifier/admin-approve - Approve a LoRA and deploy to ComfyUI.
 * Path Parameters:
 *  - loraIdentifier (string): The LoRA's slug or MongoDB _id.
 */
router.post('/:loraIdentifier/admin-approve', async (req, res) => {
  const { loraIdentifier } = req.params;
  // const adminMasterAccountId = req.user?.masterAccountId; // Assuming auth middleware might provide admin MAID
  const adminActor = 'ADMIN_ACTION'; // Placeholder for who performed the action

  logger.debug(`[LorasApi] Admin approval requested for LoRA: ${loraIdentifier}`);

  try {
    let lora = await loRAModelsDb.findOne({ slug: loraIdentifier });
    if (!lora) {
      try {
        lora = await loRAModelsDb.findById(new ObjectId(loraIdentifier));
      } catch (idError) { /* Handled by !lora check below */ }
    }

    if (!lora) {
      return res.status(404).json({ error: 'LoRA not found for approval.' });
    }

    if (lora.moderation?.status === 'approved' && lora.visibility === 'public') {
        return res.status(200).json({ message: 'LoRA already approved and public.', lora });
    }

    // --- ComfyUI Deployment Step ---
    const comfyDeployApiKey = process.env.COMFY_DEPLOY_API_KEY;
    if (!comfyDeployApiKey) {
      logger.error('[LorasApi] COMFY_DEPLOY_API_KEY environment variable not set. Cannot deploy LoRA.');
      return res.status(500).json({ error: 'ComfyUI deployment configuration error.', details: 'API key missing.' });
    }

    // --- MODIFICATION: Relax modelFileUrl requirement for Civitai ---
    const source = (lora.importedFrom?.source || 'link').toLowerCase();
    if (source !== 'civitai' && !lora.importedFrom?.modelFileUrl) {
        logger.error(`[LorasApi] Missing modelFileUrl for non-Civitai LoRA ${loraIdentifier}. Cannot deploy.`);
        return res.status(400).json({ error: 'LoRA data incomplete for deployment (missing modelFileUrl for non-civitai source).' });
    }
    if (!lora.slug) {
        logger.error(`[LorasApi] Missing slug for LoRA ${loraIdentifier}. Cannot deploy.`);
        return res.status(400).json({ error: 'LoRA data incomplete for deployment (missing slug).' });
    }
    // --- END MODIFICATION ---

    // Assume .safetensors, make more robust if other types are expected or filename is in metadata
    const filename = `${lora.slug}.safetensors`; 
    let deployPayload;

    if (source === 'civitai') {
      deployPayload = {
        source: "civitai",
        folderPath: "loras",
        filename: filename,
        civitai: {
          "url": lora.importedFrom.url
        }
      };
    } else if (source === 'huggingface') {
      deployPayload = {
        source: "huggingface",
        folderPath: "loras",
        filename: filename,
        huggingface: {
          "repoId": lora.importedFrom.modelFileUrl
        }
      };
    } else {
      deployPayload = {
        source: "link",
        folderPath: "loras",
        filename: filename,
        download_link: lora.importedFrom.modelFileUrl
      };
      logger.debug(`[LorasApi] Deploying LoRA with unknown source '${source}' using 'link' method.`);
    }

    const comfyDeployUrl = 'https://api.comfydeploy.com/api/volume/model';
    logger.debug(`[LorasApi] --- Attempting ComfyUI Deployment for Public Approval ---`);
    logger.debug(`[LorasApi] LoRA Name: ${lora.name} (Filename: ${filename})`);
    logger.debug(`[LorasApi] Target Endpoint: POST ${comfyDeployUrl}`);
    logger.debug(`[LorasApi] Payload:\n${JSON.stringify(deployPayload, null, 2)}`);
    logger.debug(`[LorasApi] --- End ComfyUI Deployment Details ---`);

    try {
      const deployResponse = await axios.post(comfyDeployUrl, deployPayload, {
        headers: {
          'Authorization': `Bearer ${comfyDeployApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      // ComfyDeploy API seems to return 200 for success based on typical API patterns
      // Or check specific success conditions from deployResponse.data if available
      logger.debug(`[LorasApi] ComfyUI Deploy API response Status: ${deployResponse.status}, Data: ${JSON.stringify(deployResponse.data)}`);
      if (deployResponse.status !== 200 && deployResponse.status !== 201) { // Adjust if other success codes are used by ComfyDeploy
         throw new Error(`ComfyUI deployment failed with status ${deployResponse.status}. Response: ${JSON.stringify(deployResponse.data)}`);
      }
      logger.info(`[LorasApi] Successfully deployed ${lora.name} to ComfyUI.`);
    } catch (deployError) {
      const errorPayload = deployError.response?.data || deployError.message;
      logger.error(`[LorasApi] ComfyUI Deployment Error for LoRA ${lora.name} (File: ${filename}):`, JSON.stringify(errorPayload, null, 2));
      const errorDetails = deployError.response?.data?.detail || deployError.response?.data?.error || deployError.response?.data?.message || errorPayload || 'Unknown deployment error';
      
      // Mark the LoRA as failed in the DB
      const failureUpdateData = {
        moderation: {
          ...(lora.moderation || {}),
          status: 'deployment_failed',
          reviewNotes: `Deployment failed on ${new Date().toISOString()}: ${JSON.stringify(errorDetails)}`,
          reviewedBy: adminActor,
          reviewedAt: new Date()
        },
        updatedAt: new Date()
      };
      try {
        await loRAModelsDb.updateModel(lora._id, failureUpdateData);
        logger.info(`[LorasApi] Marked LoRA ${lora.name} as 'deployment_failed' in the database.`);
      } catch (dbError) {
        logger.error(`[LorasApi] CRITICAL: Failed to mark LoRA ${lora.name} as 'deployment_failed' after a deployment error. DB may be inconsistent.`, dbError);
      }
      
      return res.status(500).json({ error: 'Failed to deploy LoRA to ComfyUI.', details: errorDetails });
    }
    // --- End ComfyUI Deployment ---

    // Update LoRA model in DB
    const updateData = {
      visibility: 'public',
      moderation: {
        ...(lora.moderation || {}),
        status: 'approved',
        flagged: false,
        reviewedBy: adminActor, 
        reviewedAt: new Date()
      },
      updatedAt: new Date()
    };

    const updateResult = await loRAModelsDb.updateModel(lora._id, updateData);
    if (!updateResult || updateResult.modifiedCount === 0) {
      // This might happen if the LoRA was deleted between fetch and update, or DB error
      logger.warn(`[LorasApi] Failed to update LoRA ${loraIdentifier} to approved status in DB, or no changes made.`);
      // Still, deployment might have happened. Consider rollback or manual check if critical.
      // For now, we'll return an error reflecting DB update failure.
      return res.status(500).json({ error: 'Failed to update LoRA status in database after deployment.' });
    }

    const updatedLora = await loRAModelsDb.findById(lora._id);
    logger.info(`[LorasApi] LoRA ${loraIdentifier} approved and status updated by ${adminActor}.`);
    res.status(200).json({ message: 'LoRA approved, deployed, and status updated successfully!', lora: updatedLora });
    triggerMapRefresh();

  } catch (error) {
    logger.error(`[LorasApi] Error in admin-approve for LoRA ${loraIdentifier}:`, error.message, error.stack);
    if (error.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid LoRA identifier format for approval.' });
    }
    res.status(500).json({ error: 'Failed to approve LoRA', details: error.message });
  }
});

/**
 * POST /:loraIdentifier/admin-approve-private - Approve a LoRA privately and deploy to ComfyUI.
 * Path Parameters:
 *  - loraIdentifier (string): The LoRA's slug or MongoDB _id.
 */
router.post('/:loraIdentifier/admin-approve-private', async (req, res) => {
  const { loraIdentifier } = req.params;
  const adminActor = 'ADMIN_ACTION_PRIVATE_APPROVAL'; // Placeholder for who performed the action

  logger.debug(`[LorasApi] Admin private approval requested for LoRA: ${loraIdentifier}`);

  try {
    let lora = await loRAModelsDb.findOne({ slug: loraIdentifier });
    if (!lora) {
      try {
        lora = await loRAModelsDb.findById(new ObjectId(loraIdentifier));
      } catch (idError) { /* Handled by !lora check below */ }
    }

    if (!lora) {
      return res.status(404).json({ error: 'LoRA not found for private approval.' });
    }

    // Idempotency: If already approved privately and visibility is private.
    if (lora.moderation?.status === 'approved' && lora.visibility === 'private') {
        return res.status(200).json({ message: 'LoRA already approved and private.', lora });
    }

    // --- ComfyUI Deployment Step (same as public approval) ---
    const comfyDeployApiKey = process.env.COMFY_DEPLOY_API_KEY;
    if (!comfyDeployApiKey) {
      logger.error('[LorasApi] COMFY_DEPLOY_API_KEY environment variable not set. Cannot deploy LoRA.');
      return res.status(500).json({ error: 'ComfyUI deployment configuration error.', details: 'API key missing.' });
    }

    // --- MODIFICATION: Relax modelFileUrl requirement for Civitai ---
    const source = (lora.importedFrom?.source || 'link').toLowerCase();
    if (source !== 'civitai' && !lora.importedFrom?.modelFileUrl) {
        logger.error(`[LorasApi] Missing modelFileUrl for non-Civitai LoRA ${loraIdentifier} (private approval). Cannot deploy.`);
        return res.status(400).json({ error: 'LoRA data incomplete for deployment (missing modelFileUrl for non-civitai source).' });
    }
    if (!lora.slug) {
        logger.error(`[LorasApi] Missing slug for LoRA ${loraIdentifier} (private approval). Cannot deploy.`);
        return res.status(400).json({ error: 'LoRA data incomplete for deployment (missing slug).' });
    }
    // --- END MODIFICATION ---

    const filename = `${lora.slug}.safetensors`; 
    let deployPayload;

    if (source === 'civitai') {
      deployPayload = {
        source: "civitai",
        folderPath: "loras",
        filename: filename,
        civitai: {
          "url": lora.importedFrom.url
        }
      };
    } else if (source === 'huggingface') {
      deployPayload = {
        source: "huggingface",
        folderPath: "loras",
        filename: filename,
        huggingface: {
          "repoId": lora.importedFrom.modelFileUrl
        }
      };
    } else {
      deployPayload = {
        source: "link",
        folderPath: "loras",
        filename: filename,
        download_link: lora.importedFrom.modelFileUrl
      };
      logger.debug(`[LorasApi] Deploying LoRA with unknown source '${source}' using 'link' method for private approval.`);
    }
    const comfyDeployUrl = 'https://api.comfydeploy.com/api/volume/model';

    logger.debug(`[LorasApi] --- Attempting ComfyUI Deployment for Private Approval ---`);
    logger.debug(`[LorasApi] LoRA Name: ${lora.name} (Filename: ${filename})`);
    logger.debug(`[LorasApi] Target Endpoint: POST ${comfyDeployUrl}`);
    logger.debug(`[LorasApi] Payload:\n${JSON.stringify(deployPayload, null, 2)}`);
    logger.debug(`[LorasApi] --- End ComfyUI Deployment Details ---`);

    try {
      const deployResponse = await axios.post(comfyDeployUrl, deployPayload, {
        headers: { 'Authorization': `Bearer ${comfyDeployApiKey}`, 'Content-Type': 'application/json' }
      });
      logger.debug(`[LorasApi] ComfyUI Deploy API response Status: ${deployResponse.status}, Data: ${JSON.stringify(deployResponse.data)}`);
      if (deployResponse.status !== 200 && deployResponse.status !== 201) {
         throw new Error(`ComfyUI deployment failed with status ${deployResponse.status}. Response: ${JSON.stringify(deployResponse.data)}`);
      }
      logger.info(`[LorasApi] Successfully deployed ${lora.name} to ComfyUI (for private approval).`);
    } catch (deployError) {
      const errorPayload = deployError.response?.data || deployError.message;
      logger.error(`[LorasApi] ComfyUI Deployment Error for LoRA ${lora.name} (File: ${filename}) during private approval:`, JSON.stringify(errorPayload, null, 2));
      const errorDetails = deployError.response?.data?.detail || deployError.response?.data?.error || deployError.response?.data?.message || errorPayload || 'Unknown deployment error';

      // Mark the LoRA as failed in the DB
      const failureUpdateData = {
        moderation: {
          ...(lora.moderation || {}),
          status: 'deployment_failed',
          reviewNotes: `Deployment failed on ${new Date().toISOString()}: ${JSON.stringify(errorDetails)}`,
          reviewedBy: adminActor,
          reviewedAt: new Date()
        },
        updatedAt: new Date()
      };
      try {
        await loRAModelsDb.updateModel(lora._id, failureUpdateData);
        logger.info(`[LorasApi] Marked private LoRA ${lora.name} as 'deployment_failed' in the database.`);
      } catch (dbError) {
        logger.error(`[LorasApi] CRITICAL: Failed to mark private LoRA ${lora.name} as 'deployment_failed' after a deployment error. DB may be inconsistent.`, dbError);
      }

      return res.status(500).json({ error: 'Failed to deploy LoRA to ComfyUI for private use.', details: errorDetails });
    }
    // --- End ComfyUI Deployment ---

    // -- BEGIN NEW: Grant permission to owner --
    if (!lora.ownedBy) {
        logger.error(`[LorasApi] Cannot grant access for privately approved LoRA ${lora._id} because it has no owner (ownedBy is null).`);
    } else {
        const ownerIdStr = lora.ownedBy.toString();
        const loraIdStr = lora._id.toString();
        const existingPermission = await loRAPermissionsDb.hasAccess(ownerIdStr, loraIdStr);
        if (!existingPermission) {
            logger.debug(`[LorasApi] Granting private access to owner ${ownerIdStr} for LoRA ${loraIdStr}`);
            await loRAPermissionsDb.grantAccess({
                loraId: lora._id,
                userId: lora.ownedBy,
                licenseType: 'staff_grant',
                priceCents: 0,
                // Using the owner's ID as the granter, as it's a system-granted ownership permission.
                grantedBy: lora.ownedBy, 
            });
        }
    }
    // -- END NEW ---

    // Update LoRA model in DB
    const updateData = {
      visibility: 'private', // Key difference: set to private
      moderation: {
        ...(lora.moderation || {}),
        status: 'approved',
        flagged: false,
        reviewedBy: adminActor,
        reviewedAt: new Date()
      },
      updatedAt: new Date()
    };

    const updateResult = await loRAModelsDb.updateModel(lora._id, updateData);
    if (!updateResult || updateResult.modifiedCount === 0) {
      logger.warn(`[LorasApi] Failed to update LoRA ${loraIdentifier} to private approved status in DB, or no changes made.`);
      return res.status(500).json({ error: 'Failed to update LoRA status in database after deployment for private approval.' });
    }

    // TODO: Implement user notification about private approval
    // This would involve getting lora.moderation.requestedBy (MAID)
    // and calling a notification service/endpoint.

    const updatedLora = await loRAModelsDb.findById(lora._id);
    logger.info(`[LorasApi] LoRA ${loraIdentifier} privately approved and status updated by ${adminActor}.`);
    res.status(200).json({ message: 'LoRA privately approved, deployed, and status updated successfully!', lora: updatedLora });
    triggerMapRefresh();

  } catch (error) {
    logger.error(`[LorasApi] Error in admin-approve-private for LoRA ${loraIdentifier}:`, error.message, error.stack);
    if (error.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid LoRA identifier format for private approval.' });
    }
    res.status(500).json({ error: 'Failed to privately approve LoRA', details: error.message });
  }
});

/**
 * POST /:loraIdentifier/admin-reject - Reject a LoRA.
 * Path Parameters:
 *  - loraIdentifier (string): The LoRA's slug or MongoDB _id.
 */
router.post('/:loraIdentifier/admin-reject', async (req, res) => {
  const { loraIdentifier } = req.params;
  // const adminMasterAccountId = req.user?.masterAccountId; // Assuming auth middleware
  const adminActor = 'ADMIN_ACTION'; // Placeholder

  logger.debug(`[LorasApi] Admin rejection requested for LoRA: ${loraIdentifier}`);

  try {
    let lora = await loRAModelsDb.findOne({ slug: loraIdentifier });
    if (!lora) {
      try {
        lora = await loRAModelsDb.findById(new ObjectId(loraIdentifier));
      } catch (idError) { /* Handled by !lora check below */ }
    }

    if (!lora) {
      return res.status(404).json({ error: 'LoRA not found for rejection.' });
    }

    if (lora.moderation?.status === 'rejected') {
      return res.status(200).json({ message: 'LoRA already rejected.', lora });
    }

    const updateData = {
      moderation: {
        ...(lora.moderation || {}),
        status: 'rejected',
        flagged: false, // No longer needs immediate attention once rejected
        reviewedBy: adminActor,
        reviewedAt: new Date()
      },
      updatedAt: new Date()
      // Visibility remains 'unlisted' or as is.
    };

    const updateResult = await loRAModelsDb.updateModel(lora._id, updateData);

    if (!updateResult || updateResult.modifiedCount === 0) {
      logger.warn(`[LorasApi] Failed to update LoRA ${loraIdentifier} to rejected status in DB, or no changes made.`);
      return res.status(500).json({ error: 'Failed to update LoRA status to rejected in database.' });
    }

    const updatedLora = await loRAModelsDb.findById(lora._id);
    logger.info(`[LorasApi] LoRA ${loraIdentifier} rejected and status updated by ${adminActor}.`);
    res.status(200).json({ message: 'LoRA rejected and status updated successfully!', lora: updatedLora });
    triggerMapRefresh();

  } catch (error) {
    logger.error(`[LorasApi] Error in admin-reject for LoRA ${loraIdentifier}:`, error.message, error.stack);
     if (error.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid LoRA identifier format for rejection.' });
    }
    res.status(500).json({ error: 'Failed to reject LoRA', details: error.message });
  }
});

/**
 * DELETE /:loraIdentifier - [ADMIN] Delete a LoRA.
 * Path Parameters:
 *  - loraIdentifier (string): The LoRA's MongoDB _id.
 */
router.delete('/:loraIdentifier', async (req, res) => {
    // Note: In a real-world scenario, this should be protected by a robust admin authentication middleware.
    const { loraIdentifier } = req.params;
    const adminActor = 'ADMIN_DELETE_ACTION';

    logger.debug(`[LorasApi] Admin DELETION requested for LoRA: ${loraIdentifier}`);
    
    try {
        const loraId = new ObjectId(loraIdentifier);
        const lora = await loRAModelsDb.findById(loraId);
        if (!lora) {
            return res.status(404).json({ error: 'LoRA not found for deletion.' });
        }

        const deleteResult = await loRAModelsDb.deleteOne({ _id: loraId });

        if (!deleteResult || deleteResult.deletedCount === 0) {
            logger.warn(`[LorasApi] Failed to delete LoRA ${loraIdentifier} from DB, or it was already deleted.`);
            return res.status(500).json({ error: 'Failed to delete LoRA from database.' });
        }
        
        // TODO: Consider a follow-up job to delete the model file from storage (e.g., ComfyUI volume).

        logger.info(`[LorasApi] LoRA ${loraIdentifier} deleted successfully by ${adminActor}.`);
        res.status(200).json({ message: 'LoRA deleted successfully!', loraId: loraIdentifier });
        triggerMapRefresh();

    } catch (error) {
        logger.error(`[LorasApi] Error in admin-delete for LoRA ${loraIdentifier}:`, error.message, error.stack);
        if (error.name === 'CastError') {
            return res.status(400).json({ error: 'Invalid LoRA identifier format for deletion.' });
        }
        res.status(500).json({ error: 'Failed to delete LoRA', details: error.message });
    }
});
// -- END NEW GET LORA BY IDENTIFIER ENDPOINT --

// ++ HELPER FUNCTIONS ++
/**
 * Triggers a refresh of the LoRA trigger map cache.
 * This is a fire-and-forget call.
 */
async function triggerMapRefresh() {
    try {
        logger.debug('[LorasApi] Triggering LoRA trigger map refresh...');
        // This is an async function, but we don't await it.
        // The API response shouldn't be blocked by this.
        loraTriggerMapApi.refreshPublicLoraCache();
    } catch (error) {
        logger.error('[LorasApi] Failed to trigger LoRA trigger map refresh:', error.message);
    }
}

// ++ NEW STORE LISTING ENDPOINT ++
/**
 * GET /store/list - Fetch a list of LoRAs available in the store.
 * Query Parameters:
 *  - storeFilterType (string, optional): price_asc, price_desc, recent, popular, tag
 *  - checkpoint (string, optional, default: 'All'): SDXL, SD1.5, FLUX, All
 *  - userId (string, required): masterAccountId of the browsing user (to exclude their own items and for future personalization)
 *  - page (number, optional, default: 1)
 *  - limit (number, optional, default: 5) // Telegram menus prefer smaller limits
 *  - tag (string, optional): specific tag if filterType is 'tag'
 */
router.get('/store/list', async (req, res) => {
  try {
    const { 
      storeFilterType, 
      checkpoint = 'All', 
      userId, // This is masterAccountId string (REQUIRED for store)
      tag // Specific tag for filtering if storeFilterType is 'tag'
    } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '5', 10); // Default to 5 for store view

    logger.debug(`[LorasApi] GET /store/list called with filters: ${JSON.stringify(req.query)}`);

    if (!userId) {
      return res.status(400).json({ error: 'userId is required to browse the LoRA store.' });
    }

    let MAID;
    try {
        MAID = new ObjectId(userId);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid userId format for masterAccountId.' });
    }

    let dbQuery = {
      'monetization.forSale': true,
      visibility: 'private', // Only private LoRAs are in the store initially
      ownedBy: { $ne: MAID } // Exclude LoRAs owned by the requesting user
    };
    let sortOptions = {};

    if (checkpoint && checkpoint.toLowerCase() !== 'all') {
      dbQuery.checkpoint = checkpoint;
    }

    // Filter specific logic for the store
    if (storeFilterType) {
      if (storeFilterType === 'price_asc') {
        sortOptions['monetization.priceUSD'] = 1;
      } else if (storeFilterType === 'price_desc') {
        sortOptions['monetization.priceUSD'] = -1;
      } else if (storeFilterType === 'recent') { // 'recent' is the default for the store if no specific sort
        sortOptions = { createdAt: -1 };
      } else if (storeFilterType === 'popular') {
        // TODO: Implement a real popularity metric (e.g., purchase count)
        // For now, using usageCount as a placeholder, or could sort by createdAt
        sortOptions = { usageCount: -1 }; 
        logger.warn(`[LorasApi] /store/list 'popular' filter is using usageCount as a placeholder for true purchase popularity.`);
      } else if (storeFilterType === 'tag' && tag) {
        dbQuery['tags.tag'] = tag;
        sortOptions = { createdAt: -1 }; // Default sort for tag view
      } else {
        // Default sort for the store if no specific filterType implies sorting
        sortOptions = { createdAt: -1 };
      }
    } else {
      // Default sort if no storeFilterType is provided
      sortOptions = { createdAt: -1 };
    }

    const skip = (page - 1) * limit;
    
    logger.debug(`[LorasApi] Executing Store DB query: ${JSON.stringify(dbQuery)}, Sort: ${JSON.stringify(sortOptions)}, Skip: ${skip}, Limit: ${limit}`);

    // We'll use the existing findMany and count methods from loRAModelsDb
    const totalLoras = await loRAModelsDb.count(dbQuery);
    const lorasFromDb = await loRAModelsDb.findMany(dbQuery, { sort: sortOptions, skip, limit });

    // We need to check if the current user (MAID) has already purchased any of these listed LoRAs.
    // This is for UI display (e.g., show "Owned" or "View" instead of "Buy price").
    // This logic might be better placed in the detail view, but can be hinted here too.
    let purchasedLoraIdsSet = new Set();
    if (MAID) {
        const permissions = await loRAPermissionsDb.listAccessibleLoRAs(MAID);
        permissions.forEach(p => purchasedLoraIdsSet.add(p.loraId.toString()));
    }

    const loras = lorasFromDb.map(lora => {
      const includeCivitai = String(req.query.includeCivitaiTags||'').toLowerCase()==='true';
      const cleanTags = (lora.tags||[]).filter(t=>{
        if(includeCivitai) return true;
        if(typeof t==='string') return true;
        return (t.source||'').toLowerCase()!=='civitai';
      });
      return ({
      _id: lora._id.toString(),
      slug: lora.slug,
      name: lora.name, 
      triggerWords: lora.triggerWords || [],
      // cognates are not typically needed for list view
      checkpoint: lora.checkpoint,
      // usageCount: lora.usageCount || 0, // Might be relevant depending on popularity metric
      createdAt: lora.createdAt,
      previewImageUrl: (lora.previewImages && lora.previewImages.length > 0) ? lora.previewImages[0] : null,
      // visibility: lora.visibility, // All are private and forSale here
      ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null, // Seller's ID
      // tags: lora.tags || [], // Not usually needed for list view unless it's a tag search result display
      monetization: lora.monetization, // Crucial for price display
      isPurchased: purchasedLoraIdsSet.has(lora._id.toString()), // Flag if current user owns it
      // defaultWeight is not typically needed for list view
      // isFavorite is not directly relevant to store listing context unless we add store-specific favorites
    }); });

    const totalPages = Math.ceil(totalLoras / limit);

    res.status(200).json({
      loras,
      pagination: {
        currentPage: page,
        totalPages,
        totalLoras,
        limit
      }
    });

  } catch (error) {
    logger.error(`[LorasApi] Error in GET /store/list: ${error.message}`, error.stack);
    res.status(500).json({ error: 'Failed to fetch LoRAs from store', details: error.message });
  }
});
// -- END NEW STORE LISTING ENDPOINT --

const VALID_CHECKPOINTS = ['SD1.5', 'SDXL', 'FLUX', 'SD3'];

/**
 * POST /:loraId/checkpoint - Updates the checkpoint for a LoRA model.
 * Admin-only action.
 * Body:
 *  - checkpoint (string): The new checkpoint value (e.g., 'SD1.5', 'SDXL').
 */
router.post('/:loraId/checkpoint', async (req, res) => {
    const { loraId } = req.params;
    const { checkpoint } = req.body;

    // TODO: Add robust admin authentication/authorization middleware
    // For now, we assume this endpoint is only callable by trusted services/admins.

    if (!checkpoint || !VALID_CHECKPOINTS.includes(checkpoint)) {
        return res.status(400).json({ message: `Invalid checkpoint value. Must be one of: ${VALID_CHECKPOINTS.join(', ')}` });
    }

    let loraObjectId;
    try {
        loraObjectId = new ObjectId(loraId);
    } catch (e) {
        return res.status(400).json({ message: 'Invalid loraId format.' });
    }
    
    logger.debug(`[LorasApi] Admin updating checkpoint for LoRA ID ${loraId} to ${checkpoint}`);

    try {
        const result = await loRAModelsDb.updateModel(loraObjectId, { checkpoint: checkpoint });
        
        if (!result || result.matchedCount === 0) {
            return res.status(404).json({ message: 'LoRA model not found.' });
        }

        // Invalidate the cache since a core property has changed.
        loraTriggerMapApi.refreshPublicLoraCache();
        logger.debug(`[LorasApi] LoRA Trigger Map cache cleared due to checkpoint update for ${loraId}.`);

        res.status(200).json({ message: `Checkpoint for LoRA ${loraId} updated to ${checkpoint}` });
    } catch (error) {
        logger.error(`[LorasApi] Error updating checkpoint for LoRA ${loraId}:`, error.stack);
        res.status(500).json({ message: `An error occurred while updating the checkpoint: ${error.message}` });
    }
});

/**
 * POST /:loraId/grant-owner-access - Manually grants ownership access permission for a LoRA.
 * Admin-only action. Useful for fixing permissions on older, privately-approved LoRAs.
 */
router.post('/:loraId/grant-owner-access', async (req, res) => {
    const { loraId } = req.params;
    // Optional: Could take a userId in the body to grant to someone else, but defaults to owner.
    // const { targetUserId } = req.body; 

    // TODO: Add robust admin authentication/authorization middleware
    
    logger.debug(`[LorasApi] Admin request to grant owner access for LoRA ID ${loraId}`);

    try {
        const loraObjectId = new ObjectId(loraId);
        const lora = await loRAModelsDb.findById(loraObjectId);

        if (!lora) {
            return res.status(404).json({ message: 'LoRA model not found.' });
        }

        if (!lora.ownedBy) {
            return res.status(400).json({ message: 'LoRA has no owner, cannot grant access.' });
        }
        
        const ownerIdStr = lora.ownedBy.toString();
        const loraIdStr = lora._id.toString();

        const existingPermission = await loRAPermissionsDb.hasAccess(ownerIdStr, loraIdStr);
        if (existingPermission) {
            return res.status(200).json({ message: 'Owner already has permission for this LoRA.' });
        }

        await loRAPermissionsDb.grantAccess({
            loraId: lora._id,
            userId: lora.ownedBy,
            licenseType: 'staff_grant',
            priceCents: 0,
            grantedBy: lora.ownedBy, // System-granted ownership permission
        });
        
        logger.info(`[LorasApi] Successfully granted owner permission for LoRA ${loraIdStr} to user ${ownerIdStr}.`);
        res.status(200).json({ message: `Permission granted successfully to owner.` });

    } catch (error) {
        logger.error(`[LorasApi] Error in grant-owner-access for LoRA ${loraId}:`, error.stack);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid loraId format.' });
        }
        res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
});

/**
 * POST /:loraId/tag – Add a user tag to LoRA.
 * Body: { tag: string, userId: string }
 */
router.post('/:loraId/tag', async (req, res) => {
  try {
    const { loraId } = req.params;
    const { tag, userId } = req.body;
    const MAID = userId ? new ObjectId(userId) : (req.user && req.user.userId ? new ObjectId(req.user.userId) : null);
    if (!tag || !MAID) return res.status(400).json({ error: 'tag and userId required' });
    const tagObj = { tag: tag.toLowerCase(), source: 'user', addedBy: MAID, addedAt: new Date() };

    // Support both Mongo ObjectId and slug identifiers
    const objFilter = /^[0-9a-fA-F]{24}$/;
    const query = objFilter.test(loraId) ? { _id: new ObjectId(loraId) } : { slug: loraId };

    await loRAModelsDb.updateOne(query, { $addToSet: { tags: tagObj } });

    // Fetch canonical _id so we always store ObjectId in user prefs
    const loraDoc = await loRAModelsDb.findOne(query, { _id: 1 });
    const canonicalId = loraDoc ? loraDoc._id.toString() : loraId;

    // Persist in user preferences
    await userPreferencesDb.addModelFavorite(MAID, 'loraAddedTags', { loraId: canonicalId, tag: tagObj.tag });

    res.json({ ok: true, tag: tagObj.tag });
  } catch (err) {
    logger.error('[LorasApi] add tag error', err);
    res.status(500).json({ error: 'failed' });
  }
});

/**
 * POST /:loraId/rate – Rate LoRA 1-3 stars
 * Body: { stars:1|2|3, userId }
 */
router.post('/:loraId/rate', async (req, res) => {
  try {
    const { loraId } = req.params;
    const { stars, userId } = req.body;
    const n = Number(stars);
    const MAID = userId ? new ObjectId(userId) : (req.user && req.user.userId ? new ObjectId(req.user.userId) : null);
    if (![1,2,3].includes(n) || !MAID) return res.status(400).json({ error:'invalid stars or userId' });

    const objFilter = /^[0-9a-fA-F]{24}$/;
    const query = objFilter.test(loraId) ? { _id: new ObjectId(loraId) } : { slug: loraId };

    await loRAModelsDb.updateOne(query, { $inc: { 'rating.sum': n, 'rating.count': 1 } });

    // Determine canonical id for preference storage
    const loraDoc = await loRAModelsDb.findOne(query, { _id: 1 });
    const canonicalId = loraDoc ? loraDoc._id.toString() : loraId;

    // store per-user rating keyed by canonical id
    await userPreferencesDb.setPreferenceByKey(MAID, 'loraRatings', { [canonicalId]: n });

    res.json({ ok:true });
  } catch(err){
    logger.error('[LorasApi] rate error', err);
    res.status(500).json({ error:'failed' });
  }
});

module.exports = router; 