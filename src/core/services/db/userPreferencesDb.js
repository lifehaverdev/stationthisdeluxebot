const { BaseDB, ObjectId: BaseDBObjectId } = require('./BaseDB');
const { ObjectId } = require('mongodb');

class UserPreferencesDB extends BaseDB {
  constructor(logger) {
    super('userPreferences');
    if (!logger) {
      console.warn('[UserPreferencesDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console; 
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
}

module.exports = UserPreferencesDB; 