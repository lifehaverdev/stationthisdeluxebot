/**
 * @file Manages database operations for the userCore collection in the Noema database.
 */

const { BaseDB, ObjectId } = require('./BaseDB');
const { PRIORITY } = require('./utils/queue');

const COLLECTION_NAME = 'userCore';

class UserCoreDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      // Fallback to console logging if no logger is provided, with a warning.
      // This maintains basic functionality but signals a configuration issue.
      console.warn('[UserCoreDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console; 
    } else {
      this.logger = logger;
    }
  }

  /**
   * Finds a userCore document by its masterAccountId.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserCoreById(masterAccountId) {
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    return this.findOne({ _id: id }, PRIORITY.HIGH);
  }

  /**
   * Finds a userCore document by a platform identifier.
   * @param {string} platformName - E.g., 'telegram', 'discord'.
   * @param {string} platformId - The user's ID on that platform.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserCoreByPlatformId(platformName, platformId) {
    const query = { [`platformIdentities.${platformName}`]: platformId };
    return this.findOne(query, PRIORITY.HIGH);
  }

  /**
   * Finds a userCore document by platform identifier, or creates one if not found.
   * @param {string} platformName - E.g., 'telegram', 'discord'.
   * @param {string} platformId - The user's ID on that platform.
   * @param {Object} [additionalData={}] - Additional data to include if creating a new user.
   * @returns {Promise<Object|null>} The userCore document.
   */
  async findOrCreateByPlatformId(platformName, platformId, additionalData = {}) {
    let userDoc = await this.findUserCoreByPlatformId(platformName, platformId);
    if (userDoc) {
      return { user: userDoc, isNew: false };
    }

    // User not found, create a new one
    const timestamp = new Date();
    const newUserDocumentData = {
      platformIdentities: {
        [platformName]: platformId,
      },
      wallets: [],
      apiKeys: [],
      awards: [],
      profile: {},
      status: 'active',
      userCreationTimestamp: timestamp,
      updatedAt: timestamp,
      lastLoginTimestamp: timestamp, // Set lastLogin on creation as well
      lastSeenPlatform: platformName, // Set lastSeenPlatform on creation
      ...additionalData, // Allow overriding defaults or adding more info
    };

    // Ensure platformIdentities from additionalData are merged, not overwritten, if any.
    if (additionalData.platformIdentities) {
      newUserDocumentData.platformIdentities = {
        ...newUserDocumentData.platformIdentities,
        ...additionalData.platformIdentities,
      };
    }

    try {
      userDoc = await this.createUserCore(newUserDocumentData);
      // createUserCore in the current implementation returns { _id: result.insertedId, ...newUserDocument }
      // which is what we want.
      if (!userDoc || !userDoc._id) { // Defensive check
        // Log error or throw, as createUserCore should ideally always return a user or throw
        console.error(`[UserCoreDB] Failed to create user for ${platformName}:${platformId} but createUserCore did not throw or return valid user.`);
        // To maintain a consistent return type, though this state indicates a deeper issue.
        return { user: null, isNew: false }; 
      }
      return { user: userDoc, isNew: true };
    } catch (error) {
      console.error(`[UserCoreDB] Error creating user for ${platformName}:${platformId}:`, error);
      // Depending on desired error handling, re-throw or return null
      throw error; // Or return null if preferred that callers handle it
    }
  }

  /**
   * Finds a userCore document by a wallet address.
   * @param {string} walletAddress - The wallet address.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserCoreByWalletAddress(walletAddress) {
    // Ensure case-insensitivity if wallet addresses might be stored with varying cases
    // Or ensure they are always stored checksummed/lowercase.
    // For now, assuming direct match.
    return this.findOne({ 'wallets.address': walletAddress }, PRIORITY.HIGH);
  }

  /**
   * Creates a new userCore document.
   * @param {Object} userData - The initial data for the new user.
   * @returns {Promise<Object>} The created userCore document including its _id.
   */
  async createUserCore(userData) {
    const timestamp = new Date();
    const newUserDocument = {
      platformIdentities: {}, // Should be provided or explicitly set
      wallets: [],
      apiKeys: [],
      awards: [],
      profile: {},
      status: 'active',
      ...userData, // userData can override defaults
      userCreationTimestamp: userData.userCreationTimestamp || timestamp,
      updatedAt: timestamp,
    };
    // _id will be auto-generated by MongoDB and included in the result of insertOne
    const result = await this.insertOne(newUserDocument, false, PRIORITY.CRITICAL);
    return { _id: result.insertedId, ...newUserDocument }; // Return the document with the new _id
  }

  /**
   * Updates an existing userCore document.
   * Automatically sets the updatedAt timestamp for the main document.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user to update.
   * @param {Object} updateOperations - MongoDB update operators (e.g., { $set: { field: value } }).
   * @param {Object} [options={}] - MongoDB options for the updateOne operation (e.g., arrayFilters).
   * @returns {Promise<Object|null>} The updated userCore document or null if not found.
   */
  async updateUserCore(masterAccountId, updateOperations, options = {}) {
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    const updateDoc = {
      ...updateOperations,
      $set: {
        ...(updateOperations.$set || {}),
        updatedAt: new Date(),
      },
    };
    // BaseDB.updateOne returns the result of the operation, not the document.
    // To get the updated document, we'd typically findOneAndUpdate or findOne after update.
    // Modifying BaseDB.updateOne to return document or doing a subsequent find is an option.
    // For now, let's assume we need to fetch it if BaseDB.updateOne doesn't return it.
    const updateResult = await super.updateOne({ _id: id }, updateDoc, options, false, PRIORITY.HIGH);
    if (updateResult.matchedCount > 0) {
        return this.findUserCoreById(id); // Fetch the updated document
    }
    return null;
  }

  /**
   * Adds an award to a user's profile.
   * @param {ObjectId | string} masterAccountId
   * @param {Object} awardData - Object containing awardId, achievedAt, displayName, description.
   * @returns {Promise<Object|null>} The updated userCore document.
   */
  async addAward(masterAccountId, awardData) {
    const award = {
        achievedAt: new Date(),
        ...awardData
    }
    return this.updateUserCore(masterAccountId, { $push: { awards: award } });
  }

  /**
   * Updates specific fields in the user's profile object.
   * @param {ObjectId | string} masterAccountId
   * @param {Object} profileUpdates - Object with fields to update (e.g., { displayName: 'New Name' }).
   * @returns {Promise<Object|null>} The updated userCore document.
   */
  async updateProfile(masterAccountId, profileUpdates) {
    const $set = {};
    for (const key in profileUpdates) {
      if (profileUpdates.hasOwnProperty(key)) {
        $set[`profile.${key}`] = profileUpdates[key];
      }
    }
    if (Object.keys($set).length === 0) {
        return this.findUserCoreById(masterAccountId); // No changes, return current doc
    }
    return this.updateUserCore(masterAccountId, { $set });
  }

  /**
   * Updates the last login timestamp and platform for a user.
   * @param {ObjectId | string} masterAccountId
   * @param {string} platform - The platform the user logged in from.
   * @returns {Promise<Object|null>} The updated userCore document.
   */
  async updateLastLogin(masterAccountId, platform) {
    return this.updateUserCore(masterAccountId, {
      $set: {
        lastLoginTimestamp: new Date(),
        lastSeenPlatform: platform,
      },
    });
  }
  
  /**
   * Adds a platform identity to the user.
   * @param {ObjectId | string} masterAccountId
   * @param {string} platformName e.g., 'telegram', 'discord'
   * @param {string} platformId The user's ID on that platform.
   * @returns {Promise<Object|null>} Updated userCore document.
   */
  async addPlatformIdentity(masterAccountId, platformName, platformId) {
    const updateDoc = { $set: { [`platformIdentities.${platformName}`]: platformId } };
    return this.updateUserCore(masterAccountId, updateDoc);
  }

  /**
   * Adds a wallet to the user's wallets array.
   * @param {ObjectId | string} masterAccountId
   * @param {Object} walletData - { address: string, isPrimary?: boolean, verified?: boolean }
   * @returns {Promise<Object|null>} Updated userCore document.
   */
  async addWallet(masterAccountId, walletData) {
    const newWallet = {
        addedAt: new Date(),
        verified: false, // Default to not verified
        isPrimary: false, // Default to not primary
        ...walletData,
    };
    // Potentially add logic here to ensure only one primary wallet if isPrimary is true.
    // This might involve multiple operations or more complex update logic.
    return this.updateUserCore(masterAccountId, { $push: { wallets: newWallet } });
  }

  /**
   * Updates a user's status.
   * @param {ObjectId | string} masterAccountId
   * @param {string} status - New status (e.g., 'active', 'suspended').
   * @returns {Promise<Object|null>} Updated userCore document.
   */
  async updateUserStatus(masterAccountId, status) {
    // Add validation for allowed status values if needed, based on schema enum
    return this.updateUserCore(masterAccountId, { $set: { status: status } });
  }

  /**
   * Deletes a wallet from a user's wallets array by its address.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {string} walletAddress - The address of the wallet to delete.
   * @returns {Promise<Object|null>} Updated userCore document, or null if user not found or wallet not found/not deleted.
   */
  async deleteWallet(masterAccountId, walletAddress) {
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
      // Basic validation for walletAddress, though more robust checks might be in API layer
      console.error('[UserCoreDB] deleteWallet: walletAddress is required and must be a non-empty string.');
      throw new Error('walletAddress is required and must be a non-empty string for deletion.');
    }

    const updateOperation = {
      $pull: {
        wallets: { address: walletAddress }
      }
    };
    // updateUserCore will set the main document's updatedAt timestamp.
    // It returns the updated document if matchedCount > 0.
    // If the wallet address didn't exist, matchedCount would still be >0 if the user exists,
    // but the wallets array wouldn't change. The caller (API layer) might need to verify
    // that the wallet is actually gone or check modifiedCount if that was available.
    return this.updateUserCore(masterAccountId, updateOperation);
  }

  /**
   * Adds an API key to a user's apiKeys array.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {Object} apiKeyDocument - The API key object to add (should include keyPrefix, keyHash, name, permissions, createdAt, updatedAt, lastUsedAt, status).
   * @returns {Promise<Object|null>} Updated userCore document, or null if user not found.
   */
  async addApiKey(masterAccountId, apiKeyDocument) {
    // Basic validation for the apiKeyDocument structure can be done here if desired,
    // but more comprehensive validation should be in the API layer before this call.
    if (!apiKeyDocument || typeof apiKeyDocument !== 'object' || !apiKeyDocument.keyHash) {
      console.error('[UserCoreDB] addApiKey: apiKeyDocument is invalid or missing keyHash.');
      throw new Error('Invalid apiKeyDocument provided to addApiKey.');
    }

    const updateOperation = {
      $push: {
        apiKeys: apiKeyDocument
      }
    };
    // updateUserCore will set the main document's updatedAt timestamp.
    return this.updateUserCore(masterAccountId, updateOperation);
  }

  /**
   * Updates specific fields of an API key for a user.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {string} keyPrefix - The prefix of the API key to update.
   * @param {Object} updatesForSubDoc - An object containing the fields to update within the matching apiKey element (e.g., { name: 'new name', status: 'inactive' }). MUST include `updatedAt` for the sub-document.
   * @returns {Promise<Object|null>} Updated userCore document, or null if user or key not found/not updated.
   */
  async updateApiKey(masterAccountId, keyPrefix, updatesForSubDoc) {
    if (!masterAccountId) {
      throw new Error('masterAccountId is required for updating API key');
    }
    if (!keyPrefix) {
      throw new Error('keyPrefix is required for updating API key');
    }
    if (!updatesForSubDoc || Object.keys(updatesForSubDoc).length === 0 || !updatesForSubDoc.updatedAt) {
      // Ensure updatedAt is included for the sub-document update
      throw new Error('updatesForSubDoc object is required, cannot be empty, and must include updatedAt field for updating API key');
    }

    // Construct the $set operations for the sub-document using the positional operator
    const setOperations = {};
    for (const key in updatesForSubDoc) {
        setOperations[`apiKeys.$[elem].${key}`] = updatesForSubDoc[key];
    }

    // Prepare the options object with arrayFilters for updateUserCore
    const options = { 
      arrayFilters: [{ 'elem.keyPrefix': keyPrefix }]
    }; 

    this.logger.debug(`[UserCoreDB] updateApiKey: Calling updateUserCore for masterAccountId=${masterAccountId}, keyPrefix=${keyPrefix}, updates=${JSON.stringify(setOperations)}`);
    
    // Call updateUserCore, which handles the update and fetches the updated document
    // updateUserCore expects the full update operation object ({ $set: ... }) and options
    const updatedUserDoc = await this.updateUserCore(masterAccountId, { $set: setOperations }, options);

    if (updatedUserDoc) {
      // Check if the specific key was actually modified if needed (e.g., by comparing updatedAt)
      // For now, assume success if updateUserCore returned a document.
      this.logger.info(`[UserCoreDB] updateApiKey: Successfully updated API key subdocument for masterAccountId ${masterAccountId}, keyPrefix ${keyPrefix}.`);
      return updatedUserDoc;
    } else {
      this.logger.warn(`[UserCoreDB] updateApiKey: Failed to update API key (user or key not found) for masterAccountId ${masterAccountId}, keyPrefix ${keyPrefix}.`);
      return null; // updateUserCore returns null if match count is 0
    }
  }

  async deleteApiKey(masterAccountId, keyPrefix) {
    if (!masterAccountId) {
      throw new Error('masterAccountId is required for deleting API key');
    }
    if (!keyPrefix) {
      throw new Error('keyPrefix is required for deleting API key');
    }

    const filter = { _id: new ObjectId(masterAccountId) };
    const updateOperation = { 
      $pull: { 
        apiKeys: { keyPrefix: keyPrefix } 
      } 
    };
    // Remove the returnDocument option as it's not standard for updateOne
    const options = {}; 

    this.logger.debug(`[UserCoreDB] deleteApiKey: Attempting to delete API key with prefix ${keyPrefix} for masterAccountId ${masterAccountId}`);
    
    // First, check if the user and specific API key exist to ensure we don't return a modified user doc if the key wasn't there.
    // This also helps in the API layer to return a 404 if the key doesn't exist.
    const userExistsWithKey = await this.findOne(
      { _id: new ObjectId(masterAccountId), 'apiKeys.keyPrefix': keyPrefix },
      PRIORITY.MEDIUM // No need for projection here, just existence check
    );

    if (!userExistsWithKey) {
      this.logger.warn(`[UserCoreDB] deleteApiKey: API key with prefix ${keyPrefix} not found for masterAccountId ${masterAccountId}. No deletion performed.`);
      return null; // Or indicate specifically that the key was not found
    }

    // Perform the $pull operation
    const updateResult = await this.updateOne(filter, updateOperation, options, false, PRIORITY.HIGH);
    
    // Check the result of updateOne based on counts
    if (updateResult && updateResult.matchedCount > 0) {
      // User found, proceed to fetch the document
      if (updateResult.modifiedCount > 0) {
         this.logger.info(`[UserCoreDB] deleteApiKey: Successfully removed API key entry with prefix ${keyPrefix} for masterAccountId ${masterAccountId}. Fetching updated user doc.`);
      } else {
          this.logger.warn(`[UserCoreDB] deleteApiKey: User ${masterAccountId} found, but key ${keyPrefix} was likely already removed. Fetching current user doc.`);
      }
      // Fetch and return the document AFTER the update attempt
      return this.findUserCoreById(masterAccountId); 
    } else {
      // User not found by updateOne
      this.logger.warn(`[UserCoreDB] deleteApiKey: User ${masterAccountId} not found during $pull operation for keyPrefix ${keyPrefix}.`);
      return null; 
    }
  }

}

module.exports = UserCoreDB; // Export the class, not an instance 