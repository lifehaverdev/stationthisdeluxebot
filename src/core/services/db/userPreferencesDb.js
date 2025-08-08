const { BaseDB, ObjectId } = require('./BaseDB');
const { v4: uuidv4 } = require('uuid');

const COLLECTION_NAME = 'userPreferences';
const LORA_FAVORITES_KEY = 'loraFavoriteIds'; // Define a constant for the key
const MODEL_FAVORITES_KEY = 'modelFavorites'; // Root key holding per-category arrays

class UserPreferencesDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      // This console.warn will be replaced by the logger behavior if logger is undefined.
      // However, the logger should be passed. If it isn't, this log is a fallback.
      // For consistency, we can use a temporary console.warn here if truly no logger, 
      // but the aim is that 'logger' is always provided.
      const tempLogger = console;
      tempLogger.warn('[UserPreferencesDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger; 
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new preferences record for a user, typically with empty preferences.
   * @param {ObjectId} masterAccountId - The master account ID of the user.
   * @param {Object} [initialPreferences={}] - Initial preferences object.
   * @returns {Promise<Object>} The created user preferences document.
   */
  async createUserPreferences(masterAccountId, initialPreferences = {}) {
    const now = new Date();
    const dataToInsert = {
      masterAccountId: new ObjectId(masterAccountId),
      preferences: initialPreferences,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.insertOne(dataToInsert);
    if (result.insertedId) {
        return { _id: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds the preferences record for a user by their masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @returns {Promise<Object|null>} The user preferences document, or null if not found.
   */
  async findByMasterAccountId(masterAccountId) {
    return this.findOne({ masterAccountId: new ObjectId(masterAccountId) });
  }

  /**
   * Retrieves all preferences for a user.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @returns {Promise<Object|null>} The 'preferences' object, or null if user/preferences not found.
   */
  async getAllPreferences(masterAccountId) {
    const record = await this.findByMasterAccountId(masterAccountId);
    return record ? record.preferences : null;
  }

  /**
   * Retrieves specific preferences for a user by a key (e.g., 'globalSettings', 'workflowId_A').
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} preferenceKey - The key for the specific preference set (e.g., 'globalSettings', 'tool_imageEnhance').
   * @returns {Promise<Object|null>} The specific preference object, or null if not found.
   */
  async getPreferenceByKey(masterAccountId, preferenceKey) {
    const record = await this.findByMasterAccountId(masterAccountId);
    if (record && record.preferences && record.preferences[preferenceKey]) {
      return record.preferences[preferenceKey];
    }
    return null;
  }

  /**
   * Sets or updates preferences for a specific key for a user.
   * This will overwrite existing settings under this key or create it if it doesn't exist.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} preferenceKey - The key for the preference set.
   * @param {Object} settingsObject - The object containing the settings for this key.
   * @returns {Promise<Object>} The update result.
   */
  async setPreferenceByKey(masterAccountId, preferenceKey, settingsObject) {
    const updateField = `preferences.${preferenceKey}`;
    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      {
        $set: { [updateField]: settingsObject, updatedAt: new Date() },
        // If the top-level document might not exist, we might need an upsert option
        // or ensure createUserPreferences is called first.
        // For simplicity, assuming the userPreferences document exists.
        // Alternatively, ensure userPreferences record exists with an upsert or a separate check.
      }
    );
  }

  /**
   * Deletes a specific preference key (and its settings) for a user.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} preferenceKey - The key for the preference set to delete.
   * @returns {Promise<Object>} The update result.
   */
  async deletePreferenceKey(masterAccountId, preferenceKey) {
    const unsetField = `preferences.${preferenceKey}`;
    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      {
        $unset: { [unsetField]: "" }, // Value for $unset doesn't matter
        $set: { updatedAt: new Date() }
      }
    );
  }

  /**
   * Merges new settings into an existing preference key.
   * Does a shallow merge. For deep merge, retrieve, merge in code, then set.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} preferenceKey - The key for the preference set.
   * @param {Object} newSettings - The new settings to merge in.
   * @returns {Promise<Object>} The update result.
   */
  async updatePreferenceByKey(masterAccountId, preferenceKey, newSettings) {
    const setUpdates = {};
    for (const key in newSettings) {
      setUpdates[`preferences.${preferenceKey}.${key}`] = newSettings[key];
    }
    setUpdates['updatedAt'] = new Date();

    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      { $set: setUpdates }
    );
  }

  async getPreferences(masterAccountId) {
    if (!masterAccountId) {
      this.logger.error('[UserPreferencesDB] masterAccountId is required to get preferences.');
      return null;
    }
    return this.findOne({ masterAccountId });
  }

  async updatePreferences(masterAccountId, preferencesData) {
    if (!masterAccountId) {
      this.logger.error('[UserPreferencesDB] masterAccountId is required to update preferences.');
      return null;
    }
    // Ensure preferencesData is not null or undefined to prevent errors with $set
    if (preferencesData === null || typeof preferencesData === 'undefined') {
        this.logger.warn('[UserPreferencesDB] preferencesData is null or undefined, cannot update.');
        return null; 
    }
    return this.updateOne({ masterAccountId }, { $set: preferencesData }, { upsert: true });
  }

  async getPreference(masterAccountId, key) {
    if (!masterAccountId || !key) {
      this.logger.error('[UserPreferencesDB] masterAccountId and key are required to get a specific preference.');
      return undefined;
    }
    const preferences = await this.findOne({ masterAccountId });
    return preferences ? preferences[key] : undefined;
  }

  async setPreference(masterAccountId, key, value) {
    if (!masterAccountId || !key) {
      this.logger.error('[UserPreferencesDB] masterAccountId and key are required to set a specific preference.');
      return null;
    }
    // To prevent setting undefined values, though MongoDB handles it.
    if (typeof value === 'undefined') {
        this.logger.warn(`[UserPreferencesDB] Value for key '${key}' is undefined. Not setting.`);
        // Fetch current state to return if needed, or decide behavior.
        return this.findOne({ masterAccountId }); 
    }
    return this.updateOne({ masterAccountId }, { $set: { [key]: value } }, { upsert: true });
  }

  // ++ NEW LORA FAVORITES METHODS ++
  /**
   * Retrieves the list of favorite LoRA IDs for a user.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @returns {Promise<string[]>} An array of LoRA IDs, or an empty array if none/error.
   */
  async getLoraFavoriteIds(masterAccountId) {
    try {
      const record = await this.findByMasterAccountId(masterAccountId);
      if (record && record.preferences && Array.isArray(record.preferences[LORA_FAVORITES_KEY])) {
        return record.preferences[LORA_FAVORITES_KEY];
      }
      return []; // Return empty array if no favorites or path doesn't exist
    } catch (error) {
      this.logger.error(`[UserPreferencesDB] Error in getLoraFavoriteIds for MAID ${masterAccountId}:`, error);
      return []; // Return empty array on error
    }
  }

  /**
   * Adds a LoRA ID to the user's favorites list.
   * Ensures the user preferences document and the loraFavoriteIds array exist.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} loraId - The LoRA ID (string) to add.
   * @returns {Promise<boolean>} True if added or already existed, false on error.
   */
  async addLoraFavorite(masterAccountId, loraId) {
    if (!loraId) {
      this.logger.warn(`[UserPreferencesDB] addLoraFavorite called with null/empty loraId for MAID ${masterAccountId}`);
      return false;
    }
    try {
      const MAID = new ObjectId(masterAccountId);
      const userPrefsDoc = await this.findOne({ masterAccountId: MAID });

      if (!userPrefsDoc) {
        // Document doesn't exist, use upsert to create it with the favorite.
        // $setOnInsert will correctly initialize 'preferences' as an object.
        const 최초결과 = await this.updateOne(
        { masterAccountId: MAID },
        {
            $addToSet: { [`preferences.${LORA_FAVORITES_KEY}`]: loraId }, // Ensures loraId is added
          $setOnInsert: { 
            masterAccountId: MAID, 
              preferences: { [LORA_FAVORITES_KEY]: [loraId] }, // Initializes structure
            createdAt: new Date() 
          },
          $currentDate: { updatedAt: true }
        },
        { upsert: true }
      );
        // Check upsert success
        if (!최초결과.upsertedId && 최초결과.matchedCount === 0) {
            this.logger.error(`[UserPreferencesDB] addLoraFavorite: Upsert operation failed unexpectedly for new MAID ${masterAccountId}.`, { 최초결과 });
         return false;
      }
        return true;
      }

      // Document exists, check 'preferences' field
      if (!userPrefsDoc.preferences || typeof userPrefsDoc.preferences !== 'object') {
        // 'preferences' is null, undefined, or not an object.
        // Overwrite 'preferences' with a correct structure including the new favorite.
        this.logger.warn(`[UserPreferencesDB] addLoraFavorite: 'preferences' field for MAID ${masterAccountId} is missing or not an object. Re-initializing.`);
        await this.updateOne(
          { masterAccountId: MAID },
          {
            $set: {
              preferences: { [LORA_FAVORITES_KEY]: [loraId] },
              updatedAt: new Date()
            }
          }
        );
        return true;
      }

      // 'preferences' exists and is an object. Proceed with $addToSet.
      // This also handles if preferences.loraFavoriteIds is not an array; $addToSet will create it.
      await this.updateOne(
        { masterAccountId: MAID },
        {
          $addToSet: { [`preferences.${LORA_FAVORITES_KEY}`]: loraId },
          $currentDate: { updatedAt: true }
        }
      );
      return true;

    } catch (error) {
      this.logger.error(`[UserPreferencesDB] Error in addLoraFavorite for MAID ${masterAccountId}, LoRA ${loraId}:`, error);
      return false;
    }
  }

  /**
   * Removes a LoRA ID from the user's favorites list.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} loraId - The LoRA ID (string) to remove.
   * @returns {Promise<boolean>} True if removed or was not present, false on error.
   */
  async removeLoraFavorite(masterAccountId, loraId) {
    if (!loraId) {
      this.logger.warn(`[UserPreferencesDB] removeLoraFavorite called with null/empty loraId for MAID ${masterAccountId}`);
      return false;
    }
    try {
      const MAID = new ObjectId(masterAccountId);
      const updateResult = await this.updateOne(
        { masterAccountId: MAID, [`preferences.${LORA_FAVORITES_KEY}`]: loraId }, // Only match if LoRA is in favorites
        {
          $pull: { [`preferences.${LORA_FAVORITES_KEY}`]: loraId },
          $currentDate: { updatedAt: true }
        }
        // No upsert needed here; if user or favorites list doesn't exist, can't remove from it.
      );
      // $pull is successful even if the item wasn't in the array.
      // We consider it successful if the operation didn't error.
      // modifiedCount will be 1 if removed, 0 if not present. matchedCount indicates doc was found.
      return true; 
    } catch (error) {
      this.logger.error(`[UserPreferencesDB] Error in removeLoraFavorite for MAID ${masterAccountId}, LoRA ${loraId}:`, error);
      return false;
    }
  }
  // -- END NEW LORA FAVORITES METHODS --

  // ++ GENERIC MODEL FAVORITES METHODS ++
  /**
   * Retrieves a user’s model favourites.
   * @param {ObjectId} masterAccountId – The master account ID.
   * @param {string} [category] – Optional category filter (checkpoint|lora|vae|upscale|embedding|controlnet|clipseg).
   * @returns {Promise<Object|Array>} Entire favourites object or array for the category.
   */
  async getModelFavorites(masterAccountId, category = null) {
    try {
      const record = await this.findByMasterAccountId(masterAccountId);
      const root = record?.preferences?.[MODEL_FAVORITES_KEY] || {};
      return category ? (root[category] || []) : root;
    } catch (err) {
      this.logger.error(`[UserPreferencesDB] getModelFavorites error for MAID ${masterAccountId}:`, err);
      return category ? [] : {};
    }
  }

  /**
   * Adds a model ID to a user’s favourites for the given category (idempotent).
   */
  async addModelFavorite(masterAccountId, category, modelId) {
    if (!category || !modelId) {
      this.logger.warn('[UserPreferencesDB] addModelFavorite called with empty category/modelId');
      return false;
    }
    try {
      const MAID = new ObjectId(masterAccountId);
      const prefPath = `preferences.${MODEL_FAVORITES_KEY}.${category}`;
      await this.updateOne(
        { masterAccountId: MAID },
        {
          $addToSet: { [prefPath]: modelId },
          $setOnInsert: {
            masterAccountId: MAID,
            // preferences root omitted to avoid path conflict when nested path is also in this update
            createdAt: new Date(),
          },
          $currentDate: { updatedAt: true },
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      this.logger.error('[UserPreferencesDB] addModelFavorite error:', err);
      return false;
    }
  }

  /**
   * Removes a model ID from a user’s favourites.
   */
  async removeModelFavorite(masterAccountId, category, modelId) {
    if (!category || !modelId) {
      this.logger.warn('[UserPreferencesDB] removeModelFavorite called with empty category/modelId');
      return false;
    }
    try {
      const MAID = new ObjectId(masterAccountId);
      const prefPath = `preferences.${MODEL_FAVORITES_KEY}.${category}`;
      await this.updateOne(
        { masterAccountId: MAID },
        {
          $pull: { [prefPath]: modelId },
          $currentDate: { updatedAt: true },
        }
      );
      return true;
    } catch (err) {
      this.logger.error('[UserPreferencesDB] removeModelFavorite error:', err);
      return false;
    }
  }
  // -- END GENERIC MODEL FAVORITES METHODS --
}

module.exports = UserPreferencesDB; 