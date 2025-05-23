const express = require('express');
const { ObjectId } = require('mongodb');
// Import UserSettingsService - adjust path as necessary
const { getUserSettingsService } = require('../../core/services/userSettingsService'); 

// This function initializes the routes for the User Preferences API
module.exports = function userPreferencesApi(dependencies) {
  const { logger, db, toolRegistry, internalApiClient } = dependencies; // Added toolRegistry and internalApiClient for UserSettingsService
  // Use mergeParams to access masterAccountId from the parent router (userCoreApi)
  const router = express.Router({ mergeParams: true }); 

  // Instantiate UserSettingsService
  // It's better if UserSettingsService is initialized once and passed in dependencies.
  // For now, creating an instance here. Consider passing as 'userSettingsService' in dependencies.
  const userSettingsService = getUserSettingsService({ toolRegistry, internalApiClient });

  // Check for essential dependencies
  if (!db || !db.userPreferences) {
    logger.error('[userPreferencesApi] Critical dependency failure: db.userPreferences service is missing!');
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserPreferences database service is not available.' } });
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

    const { preferenceScope } = req.params; // This is the toolId
     if (!preferenceScope || typeof preferenceScope !== 'string' || preferenceScope.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'preferenceScope (toolId) path parameter must be a non-empty string.' } });
    }
    const toolId = preferenceScope.trim();

    const preferencesToSave = req.body;
    if (!preferencesToSave || typeof preferencesToSave !== 'object') {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Request body must be an object containing the settings for the scope (toolId).' }
      });
    }

    logger.info(`[userPreferencesApi] PUT /users/${masterAccountId}/preferences/${toolId} - Received request`, { body: preferencesToSave });

    // Validate preferences using UserSettingsService
    const validationResult = userSettingsService.validatePreferences(toolId, preferencesToSave);
    if (!validationResult.isValid) {
      logger.warn(`[userPreferencesApi] PUT .../${toolId}: Validation failed.`, { errors: validationResult.errors });
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
        logger.info(`[userPreferencesApi] PUT .../${toolId}: User preferences document not found for ${masterAccountId}, creating one.`);
        userPrefsDoc = await db.userPreferences.createUserPreferences(masterAccountId);
        if (!userPrefsDoc) {
          // This would be an unexpected failure during creation
          throw new Error('Failed to create initial user preferences document.');
        }
      }

      // Now, set the preference for the specific key
      const updateResult = await db.userPreferences.updatePreferenceByKey(masterAccountId, toolId, preferencesToSave);

       if (updateResult.matchedCount === 0 && updateResult.upsertedCount === 0 && !updateResult.modifiedCount ===0 ) { // also check modifiedCount if upsert is false for setPreferenceByKey
           // This might happen if the doc was deleted between check and update, or other issue
           // or if setPreferenceByKey does not upsert the user document itself.
           logger.error(`[userPreferencesApi] PUT .../${toolId}: Failed to match or update document during setPreferenceByKey.`, { updateResult });
           // Check if userPrefsDoc was initially null and creation failed, or if it simply wasn't matched by setPreferenceByKey
           const existingDoc = await db.userPreferences.findByMasterAccountId(masterAccountId);
           if (!existingDoc) {
             throw new Error('User preferences document does not exist and could not be created/updated.');
           }
           throw new Error('Preference scope update failed to find or modify document.');
       }

      // Fetch the updated scope to return it
      const updatedScope = await db.userPreferences.getPreferenceByKey(masterAccountId, toolId);

      logger.info(`[userPreferencesApi] PUT .../${toolId}: Preferences scope updated successfully.`);
      res.status(200).json(updatedScope || {}); // Return updated scope, or {} if somehow null

    } catch (error) {
      logger.error(`[userPreferencesApi] PUT .../${toolId}: Error - ${error.message}`, error);
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

  logger.info('[userPreferencesApi] User Preferences API routes initialized.');
  return router;
}; 