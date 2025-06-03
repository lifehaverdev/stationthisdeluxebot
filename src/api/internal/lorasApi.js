const express = require('express');
const router = express.Router();
const LoRAModelsDB = require('../../core/services/db/loRAModelDb'); 
const LoRAPermissionsDB = require('../../core/services/db/loRAPermissionsDb');
const UserPreferencesDB = require('../../core/services/db/userPreferencesDb');
const { ObjectId } = require('../../core/services/db/BaseDB');

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

    let dbQuery = { visibility: 'public' };
    let sortOptions = {};
    let MAID = null;
    if (userId) {
        try {
            MAID = new ObjectId(userId);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid userId format for masterAccountId.' });
        }
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

    const totalLoras = await loRAModelsDb.countDocuments(dbQuery);
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
      usageCount: lora.usageCount || 0,
      createdAt: lora.createdAt,
      previewImageUrl: (lora.previewImages && lora.previewImages.length > 0) ? lora.previewImages[0] : null,
      visibility: lora.visibility || 'public',
      ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null,
      tags: lora.tags || [],
      defaultWeight: lora.defaultWeight || 1.0,
      isFavorite: MAID ? userFavoriteIdsSet.has(lora._id.toString()) : false
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

    // TODO: Permission check if lora.visibility is not 'public' and userId is provided.
    // If lora.visibility === 'private' and (!userId || !await loRAPermissionsDb.canUserAccess(userId, lora._id)) {
    //   return res.status(403).json({ error: 'Access denied to this LoRA.' });
    // }

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
// -- END NEW GET LORA BY IDENTIFIER ENDPOINT --

module.exports = router; 