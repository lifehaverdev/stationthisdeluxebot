const express = require('express');
const { ObjectId } = require('mongodb');
// Import UserSettingsService - adjust path as necessary
const { getUserSettingsService } = require('../../../core/services/userSettingsService');
const UserPreferencesDB = require('../../../core/services/db/userPreferencesDb');
const LoRAModelsDB = require('../../../core/services/db/loRAModelDb'); // For validation

// This function initializes the routes for the User Preferences API
module.exports = function userPreferencesApi(dependencies) {
  const { logger, db, toolRegistry, userSettingsService } = dependencies; // Use the injected userSettingsService
  const userPreferencesDb = new UserPreferencesDB(logger);
  const loRAModelsDb = new LoRAModelsDB(logger); // For validating LoRA existence
  // Use mergeParams to access masterAccountId from the parent router (userCoreApi)
  const router = express.Router({ mergeParams: true }); 

  // The UserSettingsService is now injected directly via dependencies.
  // The call to getUserSettingsService() is no longer needed here.
  if (!userSettingsService) {
    logger.error('[userPreferencesApi] Critical dependency failure: userSettingsService is missing!');
    // Return a router that always errors out
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserSettingsService is not available.' } });
    };
  }

  logger.info('[userPreferencesApi] Initializing User Preferences API routes...');

  // Helper function to get masterAccountId (already validated by parent router, but check anyway)
  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.error(`[userPreferencesApi] Invalid or missing masterAccountId (${masterAccountIdStr}) received from parent router.`);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve valid masterAccountId.' } });
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  //-------------------------------------------------------------------------
  // --- Global Preferences Endpoints --- 
  // Mounted at /users/:masterAccountId/preferences
  //-------------------------------------------------------------------------

  // GET / - Retrieves all user preferences
  router.get('/', async (req, res, next) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    logger.info(`[userPreferencesApi] GET /users/${masterAccountId}/preferences - Received request`);

    try {
      const allPreferences = await db.userPreferences.getAllPreferences(masterAccountId);

      if (allPreferences === null) {
        // This means the user document or the preferences field itself wasn't found.
        // Return empty object as per convention? Or 404? Let's return {} for GET all.
        logger.info(`[userPreferencesApi] GET /users/${masterAccountId}/preferences: No preferences found, returning empty object.`);
        return res.status(200).json({}); 
      }

      logger.info(`[userPreferencesApi] GET /users/${masterAccountId}/preferences: Preferences found.`);
      res.status(200).json(allPreferences);

    } catch (error) {
      logger.error(`[userPreferencesApi] GET /users/${masterAccountId}/preferences: Error - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error retrieving preferences.' } });
    }
  });

  // PUT / - Updates/Replaces the entire preferences object for a user
  router.put('/', async (req, res, next) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    logger.info(`[userPreferencesApi] PUT /users/${masterAccountId}/preferences - Received request`, { body: req.body });

    // ADR specifies body as { preferences: object }
    const { preferences } = req.body;
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Request body must contain a \'preferences\' field which is an object.' }
      });
    }

    try {
      const updateResult = await db.userPreferences.updateOne(
        { masterAccountId: masterAccountId },
        { $set: { preferences: preferences, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), masterAccountId: masterAccountId } }, // Ensure masterAccountId on insert
        { upsert: true } // Create the document if it doesn't exist
      );

      if (updateResult.matchedCount === 0 && updateResult.upsertedCount === 0) {
           // Should not happen with upsert: true unless there's a weird error
           logger.error(`[userPreferencesApi] PUT /users/${masterAccountId}/preferences: Upsert operation failed unexpectedly.`, { updateResult });
           throw new Error('Preference update/upsert failed.');
      }

      // Fetch the newly updated/inserted preferences to return
      const updatedPreferences = await db.userPreferences.getAllPreferences(masterAccountId);

      logger.info(`[userPreferencesApi] PUT /users/${masterAccountId}/preferences: Preferences updated/created successfully.`);
      res.status(200).json(updatedPreferences || {}); // Return updated prefs, or {} if somehow null

    } catch (error) {
      logger.error(`[userPreferencesApi] PUT /users/${masterAccountId}/preferences: Error - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error updating preferences.' } });
    }
  });

  //-------------------------------------------------------------------------
  // --- Scoped Preferences Endpoints --- 
  // Mounted at /users/:masterAccountId/preferences
  //-------------------------------------------------------------------------

  // GET /:preferenceScope - Retrieves preferences for a specific scope
  router.get('/:preferenceScope', async (req, res, next) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { preferenceScope } = req.params;
    if (!preferenceScope || typeof preferenceScope !== 'string' || preferenceScope.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'preferenceScope path parameter must be a non-empty string.' } });
    }
    const scopeKey = preferenceScope.trim();

    logger.info(`[userPreferencesApi] GET /users/${masterAccountId}/preferences/${scopeKey} - Received request`);

    try {
      const scopedPreferences = await db.userPreferences.getPreferenceByKey(masterAccountId, scopeKey);

      if (scopedPreferences === null) {
        // User or scope not found
        logger.warn(`[userPreferencesApi] GET .../${scopeKey}: Preferences scope not found.`);
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Preferences scope '${scopeKey}' not found for this user.` }
        });
      }

      logger.info(`[userPreferencesApi] GET .../${scopeKey}: Preferences scope found.`);
      res.status(200).json(scopedPreferences);

    } catch (error) {
      logger.error(`[userPreferencesApi] GET .../${scopeKey}: Error - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error retrieving scoped preferences.' } });
    }
  });

  // PUT /:preferenceScope - Updates/Replaces preferences for a specific scope
  router.put('/:preferenceScope', async (req, res, next) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { preferenceScope } = req.params; // This is the tool's displayName
     if (!preferenceScope || typeof preferenceScope !== 'string' || preferenceScope.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'preferenceScope (tool displayName) path parameter must be a non-empty string.' } });
    }
    const toolIdentifier = preferenceScope.trim();

    // Find the tool by its display name (identifier) to get its canonical toolId for validation
    const toolDef = toolRegistry.findByDisplayName(toolIdentifier);
    if (!toolDef) {
      logger.warn(`[userPreferencesApi] PUT .../${toolIdentifier}: Could not find tool by displayName. Validation cannot proceed.`);
      return res.status(404).json({
        error: { code: 'TOOL_NOT_FOUND', message: `Tool with display name '${toolIdentifier}' not found in registry.` }
      });
    }
    const canonicalToolId = toolDef.toolId;

    const preferencesToSave = req.body;
    if (!preferencesToSave || typeof preferencesToSave !== 'object') {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Request body must be an object containing the settings for the scope (toolId).' }
      });
    }

    logger.info(`[userPreferencesApi] PUT /users/${masterAccountId}/preferences/${toolIdentifier} - Received request`, { body: preferencesToSave });

    // Validate preferences using UserSettingsService with the canonical toolId
    const validationResult = userSettingsService.validatePreferences(canonicalToolId, preferencesToSave);
    if (!validationResult.isValid) {
      logger.warn(`[userPreferencesApi] PUT .../${toolIdentifier}: Validation failed.`, { errors: validationResult.errors });
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid preferences for the given toolId.',
          details: validationResult.errors,
        },
      });
    }

    try {
      // Pre-check: Ensure the top-level user preferences document exists.
      let userPrefsDoc = await db.userPreferences.findByMasterAccountId(masterAccountId);
      if (!userPrefsDoc) {
        logger.info(`[userPreferencesApi] PUT .../${toolIdentifier}: User preferences document not found for ${masterAccountId}, creating one.`);
        userPrefsDoc = await db.userPreferences.createUserPreferences(masterAccountId);
        if (!userPrefsDoc) {
          // This would be an unexpected failure during creation
          throw new Error('Failed to create initial user preferences document.');
        }
      }

      // Now, set the preference for the specific key using the original identifier (displayName)
      const updateResult = await db.userPreferences.updatePreferenceByKey(masterAccountId, toolIdentifier, preferencesToSave);

       if (updateResult.matchedCount === 0 && updateResult.upsertedCount === 0 && !updateResult.modifiedCount ===0 ) { // also check modifiedCount if upsert is false for setPreferenceByKey
           // This might happen if the doc was deleted between check and update, or other issue
           // or if setPreferenceByKey does not upsert the user document itself.
           logger.error(`[userPreferencesApi] PUT .../${toolIdentifier}: Failed to match or update document during setPreferenceByKey.`, { updateResult });
           // Check if userPrefsDoc was initially null and creation failed, or if it simply wasn't matched by setPreferenceByKey
           const existingDoc = await db.userPreferences.findByMasterAccountId(masterAccountId);
           if (!existingDoc) {
             throw new Error('User preferences document does not exist and could not be created/updated.');
           }
           throw new Error('Preference scope update failed to find or modify document.');
       }

      // Fetch the updated scope to return it
      const updatedScope = await db.userPreferences.getPreferenceByKey(masterAccountId, toolIdentifier);

      logger.info(`[userPreferencesApi] PUT .../${toolIdentifier}: Preferences scope updated successfully.`);
      res.status(200).json(updatedScope || {}); // Return updated scope, or {} if somehow null

    } catch (error) {
      logger.error(`[userPreferencesApi] PUT .../${toolIdentifier}: Error - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error updating scoped preferences.' } });
    }
  });

  // DELETE /:preferenceScope - Deletes preferences for a specific scope (toolId)
  router.delete('/:preferenceScope', async (req, res, next) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { preferenceScope } = req.params; // This is the toolId
    if (!preferenceScope || typeof preferenceScope !== 'string' || preferenceScope.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'preferenceScope (toolId) path parameter must be a non-empty string.' } });
    }
    const toolId = preferenceScope.trim();

    logger.info(`[userPreferencesApi] DELETE /users/${masterAccountId}/preferences/${toolId} - Received request`);

    try {
      const deleteResult = await db.userPreferences.deletePreferenceKey(masterAccountId, toolId);

      if (!deleteResult || deleteResult.modifiedCount === 0) {
        // This could mean the user/preference didn't exist, or the key wasn't there.
        // ADR implies this calls db.userPreferences.deletePreferenceKey. Check its return.
        // If it returns null or modifiedCount is 0, it means not found or no change.
        logger.warn(`[userPreferencesApi] DELETE .../${toolId}: Preference scope not found or already deleted.`);
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Preferences scope '${toolId}' not found for this user, or no changes made.` }
        });
      }

      logger.info(`[userPreferencesApi] DELETE .../${toolId}: Preferences scope deleted successfully.`);
      res.status(204).send(); // 204 No Content for successful deletion

    } catch (error) {
      logger.error(`[userPreferencesApi] DELETE .../${toolId}: Error - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error deleting scoped preferences.' } });
    }
  });

  // --- LORA FAVORITES SUB-ROUTER ---
  const loraFavoritesRouter = express.Router({ mergeParams: true });

  /**
   * GET /lora-favorites - Retrieve user's favorite LoRA IDs
   * Path: /users/:masterAccountId/preferences/lora-favorites
   */
  loraFavoritesRouter.get('/', async (req, res) => {
    const { masterAccountId } = req.params;
    try {
      const MAID = new ObjectId(masterAccountId);
      const favoriteLoraIds = await userPreferencesDb.getLoraFavoriteIds(MAID);
      logger.info(`[UserPreferencesApi-LoraFav] GET / for MAID ${masterAccountId} - Found ${favoriteLoraIds.length} favorites.`);
      res.status(200).json({ loraFavoriteIds });
    } catch (error) {
      logger.error(`[UserPreferencesApi-LoraFav] Error getting favorites for MAID ${masterAccountId}:`, error);
      if (error.name === 'BSONTypeError') {
        return res.status(400).json({ error: 'Invalid masterAccountId format.' });
      }
      res.status(500).json({ error: 'Failed to retrieve LoRA favorites.' });
    }
  });

  /**
   * POST /lora-favorites - Add a LoRA to user's favorites
   * Path: /users/:masterAccountId/preferences/lora-favorites
   * Body: { "loraId": "loraMongoId" }
   */
  loraFavoritesRouter.post('/', async (req, res) => {
    const { masterAccountId } = req.params;
    const { loraId } = req.body;

    if (!loraId) {
      return res.status(400).json({ error: 'loraId is required in the request body.' });
    }

    try {
      const MAID = new ObjectId(masterAccountId);
      // Validate loraId actually exists in loRAModelsDb
      const loraExists = await loRAModelsDb.findById(loraId); // Assumes loraId is string here
      if (!loraExists) {
        logger.warn(`[UserPreferencesApi-LoraFav] Attempt to favorite non-existent LoRA ${loraId} by MAID ${masterAccountId}`);
        return res.status(404).json({ error: `LoRA with id ${loraId} not found.` });
      }

      const success = await userPreferencesDb.addLoraFavorite(MAID, loraId);
      
      logger.info(`[UserPreferencesApi-LoraFav] POST / for MAID ${masterAccountId}, LoRA ${loraId}. Success: ${success}`);
      if (success) {
        // To determine if it was newly added vs already existed, getLoraFavoriteIds could be checked before add,
        // or addLoraFavorite could return more detailed info. For now, 201 for simplicity if 'success' is true.
        // The DB method with $addToSet is idempotent, so a 200 or 201 are both reasonable.
        // Let's use 200 if it might have already existed, 201 if we are sure it's new.
        // Since addLoraFavorite returns true if added OR already existed, 200 is safer.
        return res.status(200).json({ message: 'LoRA added to favorites or already existed.', loraId });
      } else {
        // This path might be hit if there was a DB error within addLoraFavorite not caught as an exception
        return res.status(500).json({ error: 'Failed to add LoRA to favorites due to an internal issue.' });
      }
    } catch (error) {
      logger.error(`[UserPreferencesApi-LoraFav] Error adding favorite LoRA ${loraId} for MAID ${masterAccountId}:`, error);
      if (error.name === 'BSONTypeError') { // For masterAccountId ObjectId conversion
        return res.status(400).json({ error: 'Invalid masterAccountId format.' });
      }
      if (error.name === 'CastError') { // From findById if loraId is invalid format for ObjectId (if it expects ObjectId)
          return res.status(400).json({ error: 'Invalid loraId format.' });
      }
      res.status(500).json({ error: 'Failed to add LoRA to favorites.' });
    }
  });

  /**
   * DELETE /lora-favorites/:loraId - Remove a LoRA from user's favorites
   * Path: /users/:masterAccountId/preferences/lora-favorites/:loraId
   */
  loraFavoritesRouter.delete('/:loraId', async (req, res) => {
    const { masterAccountId, loraId } = req.params;

    if (!loraId) {
      return res.status(400).json({ error: 'loraId parameter is required.' });
    }

    try {
      const MAID = new ObjectId(masterAccountId);
      const success = await userPreferencesDb.removeLoraFavorite(MAID, loraId);
      
      logger.info(`[UserPreferencesApi-LoraFav] DELETE /${loraId} for MAID ${masterAccountId}. Success: ${success}`);
      if (success) {
        res.status(204).send(); // Successfully removed or was not present
      } else {
        // This path might be hit if there was a DB error not caught as an exception
        return res.status(500).json({ error: 'Failed to remove LoRA from favorites due to an internal issue.'});
      }
    } catch (error) {
      logger.error(`[UserPreferencesApi-LoraFav] Error removing favorite LoRA ${loraId} for MAID ${masterAccountId}:`, error);
      if (error.name === 'BSONTypeError') { // For masterAccountId ObjectId conversion
        return res.status(400).json({ error: 'Invalid masterAccountId format.' });
      }
      res.status(500).json({ error: 'Failed to remove LoRA from favorites.' });
    }
  });

  // --- MODEL FAVORITES SUB-ROUTER ---
  const modelFavoritesRouter = express.Router({ mergeParams: true });

  /**
   * GET /model-favorites – Retrieve all model favourites or by category
   *    • /preferences/model-favorites            → { checkpoint: [...], lora: [...], ... }
   *    • /preferences/model-favorites/:category → [ ...ids ]
   */
  modelFavoritesRouter.get('/:category?', async (req, res) => {
    const { masterAccountId, category } = { ...req.params };
    try {
      const MAID = new ObjectId(masterAccountId);
      const data = await userPreferencesDb.getModelFavorites(MAID, category);
      res.status(200).json(category ? { favorites: data } : { favoritesByCategory: data });
    } catch (err) {
      logger.error('[UserPreferencesApi-ModelFav] GET error:', err);
      if (err.name === 'BSONTypeError') return res.status(400).json({ error: 'Invalid masterAccountId format.' });
      res.status(500).json({ error: 'Failed to retrieve model favorites.' });
    }
  });

  /**
   * POST /model-favorites/:category – Add a favourite
   * Body: { "modelId": "identifier" }
   */
  modelFavoritesRouter.post('/:category', async (req, res) => {
    const { masterAccountId, category } = req.params;
    const { modelId } = req.body || {};
    if (!modelId) return res.status(400).json({ error: 'modelId is required.' });
    try {
      const MAID = new ObjectId(masterAccountId);
      const success = await userPreferencesDb.addModelFavorite(MAID, category, modelId);
      if (success) return res.status(200).json({ message: 'Model favorited.', category, modelId });
      res.status(500).json({ error: 'Failed to add favorite.' });
    } catch (err) {
      logger.error('[UserPreferencesApi-ModelFav] POST error:', err);
      if (err.name === 'BSONTypeError') return res.status(400).json({ error: 'Invalid masterAccountId format.' });
      res.status(500).json({ error: 'Failed to add favorite.' });
    }
  });

  /**
   * DELETE /model-favorites/:category/:modelId – Remove favourite
   */
  modelFavoritesRouter.delete('/:category/:modelId', async (req, res) => {
    const { masterAccountId, category, modelId } = req.params;
    if (!modelId) return res.status(400).json({ error: 'modelId param required.' });
    try {
      const MAID = new ObjectId(masterAccountId);
      const success = await userPreferencesDb.removeModelFavorite(MAID, category, modelId);
      if (success) return res.status(204).send();
      res.status(500).json({ error: 'Failed to remove favorite.' });
    } catch (err) {
      logger.error('[UserPreferencesApi-ModelFav] DELETE error:', err);
      if (err.name === 'BSONTypeError') return res.status(400).json({ error: 'Invalid masterAccountId format.' });
      res.status(500).json({ error: 'Failed to remove favorite.' });
    }
  });

  // Mount the LoRA favorites sub-router under /preferences
  router.use('/lora-favorites', loraFavoritesRouter);
  // Mount the model favourites sub-router
  router.use('/model-favorites', modelFavoritesRouter);

  logger.info('[userPreferencesApi] User Preferences API routes initialized.');
  return router;
}; 