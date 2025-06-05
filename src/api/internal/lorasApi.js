const express = require('express');
const router = express.Router();
const LoRAModelsDB = require('../../core/services/db/loRAModelDb'); 
const LoRAPermissionsDB = require('../../core/services/db/loRAPermissionsDb');
const UserPreferencesDB = require('../../core/services/db/userPreferencesDb');
const { ObjectId } = require('../../core/services/db/BaseDB');
const axios = require('axios'); // For ComfyUI Deploy API call

// TODO: Proper dependency injection for DB services and logger
const logger = console; // Placeholder logger
const loRAModelsDb = new LoRAModelsDB(logger);
const loRAPermissionsDb = new LoRAPermissionsDB(logger);
const userPreferencesDb = new UserPreferencesDB(logger);

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
      checkpoint = 'All', 
      userId, // This is masterAccountId string
      q 
    } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);

    logger.info(`[LorasApi] GET /list called with filters: ${JSON.stringify(req.query)}`);

    let dbQuery = {}; // Base query
    let sortOptions = {};
    let MAID = null;

    if (userId) {
        try {
            MAID = new ObjectId(userId);
            // If userId is present, adjust query for public OR private+owned
            dbQuery.$or = [
                { visibility: 'public' },
                { visibility: 'private', ownedBy: MAID }
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

    if (q) {
      dbQuery.$or = [
        { name: { $regex: q, $options: 'i' } },
        { slug: { $regex: q, $options: 'i' } },
        { triggerWords: { $regex: q, $options: 'i' } }
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

    const skip = (page - 1) * limit;
    
    logger.debug(`[LorasApi] Executing DB query: ${JSON.stringify(dbQuery)}, Sort: ${JSON.stringify(sortOptions)}, Skip: ${skip}, Limit: ${limit}`);

    const totalLoras = await loRAModelsDb.count(dbQuery);
    const lorasFromDb = await loRAModelsDb.findMany(dbQuery, { sort: sortOptions, skip, limit });

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
      createdAt: lora.createdAt,
      previewImageUrl: (lora.previewImages && lora.previewImages.length > 0) ? lora.previewImages[0] : null,
      ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null, // Seller's ID
      monetization: lora.monetization, // Crucial for price display
      isPurchased: userFavoriteIdsSet.has(lora._id.toString()),
      /* Note: other fields like defaultWeight, cognates, full tags, isFavorite 
         are omitted for list view brevity but available in detail view. */
    }));

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

// TODO: Add other endpoints like GET /:slugOrId for details, POST/DELETE for favorites/ratings

// ++ NEW GET LORA BY IDENTIFIER ENDPOINT ++
/**
 * GET /:loraIdentifier - Fetch detailed information for a single LoRA.
 * Path Parameters:
 *  - loraIdentifier (string): The LoRA's slug or MongoDB _id.
 * Query Parameters:
 *  - userId (string, optional): masterAccountId for permission checks (e.g., for private LoRAs).
 */
router.get('/:loraIdentifier', async (req, res) => {
  try {
    const { loraIdentifier } = req.params;
    const { userId } = req.query; // This is masterAccountId string
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

    // Permission check for private LoRAs
    if (lora.visibility === 'private') {
      if (!MAID) {
        return res.status(403).json({ error: 'Access denied. This LoRA is private and requires user authentication.' });
      }
      // Ensure lora.ownedBy is defined and MAID is an ObjectId before comparing
      if (!lora.ownedBy || lora.ownedBy.toString() !== MAID.toString()) {
        logger.warn(`[LorasApi] Access denied for MAID ${MAID.toString()} to private LoRA ${lora._id.toString()} owned by ${lora.ownedBy ? lora.ownedBy.toString() : 'unknown'}`);
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
      rating: lora.rating, // Assuming rating is an object { average, count }
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

  logger.info(`[LorasApi] Admin approval requested for LoRA: ${loraIdentifier}`);

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

    if (!lora.importedFrom?.modelFileUrl || !lora.slug) {
        logger.error(`[LorasApi] Missing modelFileUrl or slug for LoRA ${loraIdentifier}. Cannot deploy.`);
        return res.status(400).json({ error: 'LoRA data incomplete for deployment (missing modelFileUrl or slug).' });
    }

    // Assume .safetensors, make more robust if other types are expected or filename is in metadata
    const filename = `${lora.slug}.safetensors`; 
    const deployPayload = {
      source: "link",
      folder_path: "loras", // As per your example
      filename: filename,
      downloadLink: lora.importedFrom.modelFileUrl
    };

    const comfyDeployUrl = 'https://api.comfydeploy.com/api/volume/model/file';
    logger.info(`[LorasApi] Deploying LoRA ${lora.name} (Filename: ${filename}) to ComfyUI. URL: ${deployPayload.downloadLink}`);

    try {
      const deployResponse = await axios.post(comfyDeployUrl, deployPayload, {
        headers: {
          'Authorization': `Bearer ${comfyDeployApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      // ComfyDeploy API seems to return 200 for success based on typical API patterns
      // Or check specific success conditions from deployResponse.data if available
      logger.info(`[LorasApi] ComfyUI Deploy API response Status: ${deployResponse.status}, Data: ${JSON.stringify(deployResponse.data)}`);
      if (deployResponse.status !== 200 && deployResponse.status !== 201) { // Adjust if other success codes are used by ComfyDeploy
         throw new Error(`ComfyUI deployment failed with status ${deployResponse.status}. Response: ${JSON.stringify(deployResponse.data)}`);
      }
      logger.info(`[LorasApi] Successfully deployed ${lora.name} to ComfyUI.`);
    } catch (deployError) {
      logger.error(`[LorasApi] ComfyUI Deployment Error for LoRA ${lora.name} (File: ${filename}):`, deployError.response?.data || deployError.message);
      const errorDetails = deployError.response?.data?.detail || deployError.response?.data?.error || deployError.response?.data?.message || deployError.message || 'Unknown deployment error';
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

    logger.info(`[LorasApi] LoRA ${loraIdentifier} approved and status updated by ${adminActor}.`);
    res.status(200).json({ message: 'LoRA approved, deployed, and status updated successfully!', loraId: lora._id });

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

  logger.info(`[LorasApi] Admin private approval requested for LoRA: ${loraIdentifier}`);

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

    if (!lora.importedFrom?.modelFileUrl || !lora.slug) {
        logger.error(`[LorasApi] Missing modelFileUrl or slug for LoRA ${loraIdentifier}. Cannot deploy.`);
        return res.status(400).json({ error: 'LoRA data incomplete for deployment (missing modelFileUrl or slug).' });
    }

    const filename = `${lora.slug}.safetensors`; 
    const deployPayload = {
      source: "link",
      folder_path: "loras",
      filename: filename,
      downloadLink: lora.importedFrom.modelFileUrl
    };
    const comfyDeployUrl = 'https://api.comfydeploy.com/api/volume/model/file';

    logger.info(`[LorasApi] Deploying LoRA ${lora.name} (Filename: ${filename}) to ComfyUI for private approval. URL: ${deployPayload.downloadLink}`);
    try {
      const deployResponse = await axios.post(comfyDeployUrl, deployPayload, {
        headers: { 'Authorization': `Bearer ${comfyDeployApiKey}`, 'Content-Type': 'application/json' }
      });
      logger.info(`[LorasApi] ComfyUI Deploy API response Status: ${deployResponse.status}, Data: ${JSON.stringify(deployResponse.data)}`);
      if (deployResponse.status !== 200 && deployResponse.status !== 201) {
         throw new Error(`ComfyUI deployment failed with status ${deployResponse.status}. Response: ${JSON.stringify(deployResponse.data)}`);
      }
      logger.info(`[LorasApi] Successfully deployed ${lora.name} to ComfyUI (for private approval).`);
    } catch (deployError) {
      logger.error(`[LorasApi] ComfyUI Deployment Error for LoRA ${lora.name} (File: ${filename}) during private approval:`, deployError.response?.data || deployError.message);
      const errorDetails = deployError.response?.data?.detail || deployError.response?.data?.error || deployError.response?.data?.message || deployError.message || 'Unknown deployment error';
      return res.status(500).json({ error: 'Failed to deploy LoRA to ComfyUI for private use.', details: errorDetails });
    }
    // --- End ComfyUI Deployment ---

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

    logger.info(`[LorasApi] LoRA ${loraIdentifier} privately approved and status updated by ${adminActor}.`);
    res.status(200).json({ message: 'LoRA privately approved, deployed, and status updated successfully!', loraId: lora._id });

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

  logger.info(`[LorasApi] Admin rejection requested for LoRA: ${loraIdentifier}`);

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

    logger.info(`[LorasApi] LoRA ${loraIdentifier} rejected and status updated by ${adminActor}.`);
    res.status(200).json({ message: 'LoRA rejected and status updated successfully!', loraId: lora._id });

  } catch (error) {
    logger.error(`[LorasApi] Error in admin-reject for LoRA ${loraIdentifier}:`, error.message, error.stack);
     if (error.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid LoRA identifier format for rejection.' });
    }
    res.status(500).json({ error: 'Failed to reject LoRA', details: error.message });
  }
});
// -- END NEW GET LORA BY IDENTIFIER ENDPOINT --

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

    logger.info(`[LorasApi] GET /store/list called with filters: ${JSON.stringify(req.query)}`);

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

    const loras = lorasFromDb.map(lora => ({
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
    }));

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

module.exports = router; 