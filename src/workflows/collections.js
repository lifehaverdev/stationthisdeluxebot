/**
 * Collections Workflow
 * 
 * Handles user collections of images and models in a platform-agnostic way.
 * This workflow allows users to create, view, update, and manage their collections.
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * @typedef {import('../core/services/session').SessionService} SessionService
 * @typedef {import('../core/services/media').MediaService} MediaService
 */

/**
 * Collections Workflow
 */
class CollectionsWorkflow {
  /**
   * Create a new Collections Workflow instance
   * @param {Object} services - Service dependencies
   * @param {SessionService} services.sessionService - Session service
   * @param {MediaService} services.mediaService - Media service
   * @param {Object} services.db - Database services
   * @param {Object} services.db.collections - Collections database interface
   */
  constructor({ sessionService, mediaService, db }) {
    this.sessionService = sessionService;
    this.mediaService = mediaService;
    this.collectionDB = db.collections;
  }

  /**
   * Get all collections for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} - List of collections
   */
  async getUserCollections(userId) {
    try {
      return await this.collectionDB.getCollectionsByUserId(userId);
    } catch (error) {
      console.error('Failed to load collections:', error);
      throw new Error('Failed to load collections');
    }
  }

  /**
   * Create a new collection for a user
   * @param {string} userId - User ID
   * @param {string} name - Collection name
   * @param {Object} options - Additional collection options
   * @returns {Promise<Object>} - Created collection
   */
  async createCollection(userId, name, options = {}) {
    try {
      // Generate a unique ID for the collection
      const collectionId = options.collectionId || crypto.randomUUID().replace(/-/g, '');
      
      // Build the collection object
      const newCollection = {
        collectionId,
        name,
        userId,
        iter: '1.0',
        version: '',
        size: options.size || 10,
        config: {
          masterPrompt: options.masterPrompt || '',
          traitTypes: options.traitTypes || [],
          workflow: options.workflow || 'MAKE'
        },
        initiated: Date.now(),
        status: 'incomplete',
        ...options
      };
      
      // Save to the database
      const success = await this.collectionDB.createCollection(newCollection);
      
      if (!success) {
        throw new Error('Collection creation failed');
      }
      
      // Store collection in user session
      await this.sessionService.updateUserData(userId, {
        currentCollection: collectionId
      });
      
      return newCollection;
    } catch (error) {
      console.error('Error during collection creation:', error);
      throw new Error('Failed to create collection');
    }
  }

  /**
   * Get a specific collection by ID
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<Object>} - Collection data
   */
  async getCollection(userId, collectionId, checkShared = true) {
    try {
      const collection = await this.collectionDB.loadCollection(collectionId);
      
      if (!collection) {
        throw new Error(`Collection not found: ${collectionId}`);
      }
      
      // Check if the user owns this collection
      if (collection.userId === userId) {
        return collection;
      }
      
      // If not the owner and we should check for shared access
      if (checkShared && collection.shares && Array.isArray(collection.shares)) {
        const userShare = collection.shares.find(share => share.userId === userId);
        
        if (userShare) {
          // Add a flag indicating this is a shared collection
          return {
            ...collection,
            isShared: true,
            sharePermissions: userShare.permissions
          };
        }
      }
      
      throw new Error('You do not have access to this collection');
    } catch (error) {
      console.error(`Failed to load collection ${collectionId}:`, error);
      throw new Error('Failed to load collection');
    }
  }

  /**
   * Update a collection
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} - Updated collection
   */
  async updateCollection(userId, collectionId, updates) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Prepare the updated collection
      const updatedCollection = {
        ...collection,
        ...updates
      };
      
      // Prevent overwriting critical fields
      updatedCollection.collectionId = collectionId;
      updatedCollection.userId = collection.userId;
      
      // Save the updated collection
      await this.collectionDB.saveStudio(updatedCollection);
      
      return updatedCollection;
    } catch (error) {
      console.error(`Failed to update collection ${collectionId}:`, error);
      throw new Error('Failed to update collection');
    }
  }

  /**
   * Delete a collection
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteCollection(userId, collectionId) {
    try {
      // First get the collection to verify ownership
      await this.getCollection(userId, collectionId);
      
      // Delete the collection
      await this.collectionDB.deleteCollection(collectionId);
      
      // Update session if needed
      const userData = await this.sessionService.getUserData(userId);
      if (userData.currentCollection === collectionId) {
        await this.sessionService.updateUserData(userId, {
          currentCollection: null
        });
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to delete collection ${collectionId}:`, error);
      throw new Error('Failed to delete collection');
    }
  }

  /**
   * Update collection master prompt
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} masterPrompt - New master prompt
   * @returns {Promise<Object>} - Updated collection
   */
  async updateMasterPrompt(userId, collectionId, masterPrompt) {
    try {
      return await this.updateCollection(userId, collectionId, {
        config: {
          masterPrompt
        }
      });
    } catch (error) {
      console.error(`Failed to update master prompt for collection ${collectionId}:`, error);
      throw new Error('Failed to update master prompt');
    }
  }

  /**
   * Add a trait type to a collection
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {Object} traitType - Trait type to add
   * @returns {Promise<Object>} - Updated collection
   */
  async addTraitType(userId, collectionId, traitType) {
    try {
      const collection = await this.getCollection(userId, collectionId);
      
      // Add the new trait type to the collection
      const updatedTraitTypes = [...(collection.config.traitTypes || []), traitType];
      
      return await this.updateCollection(userId, collectionId, {
        config: {
          ...collection.config,
          traitTypes: updatedTraitTypes
        }
      });
    } catch (error) {
      console.error(`Failed to add trait type to collection ${collectionId}:`, error);
      throw new Error('Failed to add trait type');
    }
  }

  /**
   * Update collection metadata
   * @param {string} userId - User ID 
   * @param {string} collectionId - Collection ID
   * @param {Object} metadata - Collection metadata
   * @returns {Promise<Object>} - Updated collection
   */
  async updateMetadata(userId, collectionId, metadata) {
    try {
      // Get valid metadata fields
      const validFields = [
        'name', 
        'totalSupply', 
        'royalty', 
        'editionTitle', 
        'description', 
        'chain', 
        'metadataStandard'
      ];
      
      // Filter only valid fields
      const filteredMetadata = {};
      Object.keys(metadata).forEach(key => {
        if (validFields.includes(key)) {
          filteredMetadata[key] = metadata[key];
        }
      });
      
      return await this.updateCollection(userId, collectionId, filteredMetadata);
    } catch (error) {
      console.error(`Failed to update metadata for collection ${collectionId}:`, error);
      throw new Error('Failed to update collection metadata');
    }
  }

  /**
   * Get the generation count for a collection
   * @param {string} collectionId - Collection ID
   * @returns {Promise<number>} - Generation count
   */
  async getGenerationCount(collectionId) {
    try {
      // This would need to be implemented based on how generations are tracked
      // For now, returning a placeholder
      return 0;
    } catch (error) {
      console.error(`Failed to get generation count for collection ${collectionId}:`, error);
      throw new Error('Failed to get generation count');
    }
  }

  /**
   * Create a hash for a collection configuration
   * @param {Object} collection - Collection data
   * @returns {string} - Configuration hash
   */
  createConfigHash(collection) {
    // Extract required values
    const { totalSupply, config: { traitTypes, masterPrompt } } = collection;
    
    // Create a string of all trait prompts
    const traitPrompts = traitTypes
        .flatMap(traitType => 
            traitType.traits.map(trait => trait.prompt)
        )
        .sort() // Sort for consistency
        .join('|'); // Join with delimiter
    
    // Combine all values into a single string
    const configString = `${masterPrompt}|${traitPrompts}|${totalSupply}`;
    
    // Create SHA-256 hash
    const hash = crypto.createHash('sha256')
        .update(configString)
        .digest('hex');
    
    return hash;
  }

  /**
   * Generate a thumbnail for a collection item based on its type
   * @param {Object} item - Collection item
   * @returns {Promise<string>} - Thumbnail URL or placeholder
   */
  async generateItemThumbnail(item) {
    if (!item) {
      return null;
    }

    try {
      // Handle different item types
      switch (item.type) {
        case 'image':
          // For images, we can generate a resized version
          if (item.url) {
            const thumbnail = await this.mediaService.resizeImage(item.url, 128, 128);
            return thumbnail.url;
          }
          break;
          
        case 'video':
          // For videos, extract a frame as thumbnail using enhanced ffmpeg processing
          if (item.url) {
            const thumbnail = await this.mediaService.extractVideoFrame(item.url, {
              timeOffset: 1, // Extract frame at 1 second
              width: 320,
              height: 180,
              useCache: true // Enable caching for performance
            });
            return thumbnail.url;
          }
          break;
          
        case 'model':
          // For models, return a standard model icon or sample output
          return item.previewUrl || '/assets/model-placeholder.png';
          
        case 'audio':
          // For audio, return a waveform image or standard audio icon
          return '/assets/audio-placeholder.png';
          
        default:
          // Default placeholder based on type
          return `/assets/${item.type}-placeholder.png`;
      }
      
      // Fallback to a generic placeholder
      return '/assets/item-placeholder.png';
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      // Return a fallback placeholder on error
      return '/assets/item-placeholder.png';
    }
  }

  /**
   * Add an item to a collection
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {Object} item - Item to add to the collection
   * @returns {Promise<Object>} - Updated collection with added item
   */
  async addItemToCollection(userId, collectionId, item) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Ensure items array exists
      if (!collection.items) {
        collection.items = [];
      }
      
      // Generate a unique ID for the item if not provided
      if (!item.id) {
        item.id = crypto.randomUUID().replace(/-/g, '');
      }
      
      // Add created timestamp if not present
      if (!item.created) {
        item.created = Date.now();
      }
      
      // Add the item to the collection
      collection.items.push(item);
      
      // Save the updated collection
      return await this.updateCollection(userId, collectionId, {
        items: collection.items
      });
    } catch (error) {
      console.error(`Failed to add item to collection ${collectionId}:`, error);
      throw new Error('Failed to add item to collection');
    }
  }

  /**
   * Remove an item from a collection
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} itemId - ID of the item to remove
   * @returns {Promise<Object>} - Updated collection without the removed item
   */
  async removeItemFromCollection(userId, collectionId, itemId) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Ensure items array exists
      if (!collection.items || collection.items.length === 0) {
        throw new Error('No items in collection');
      }
      
      // Find the item index
      const itemIndex = collection.items.findIndex(item => item.id === itemId);
      
      if (itemIndex === -1) {
        throw new Error('Item not found in collection');
      }
      
      // Remove the item
      collection.items.splice(itemIndex, 1);
      
      // Save the updated collection
      return await this.updateCollection(userId, collectionId, {
        items: collection.items
      });
    } catch (error) {
      console.error(`Failed to remove item from collection ${collectionId}:`, error);
      throw new Error('Failed to remove item from collection');
    }
  }

  /**
   * Get all items in a collection with thumbnails
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<Array>} - List of items with thumbnails
   */
  async getCollectionItems(userId, collectionId) {
    try {
      const collection = await this.getCollection(userId, collectionId);
      
      if (!collection.items || !Array.isArray(collection.items)) {
        return [];
      }
      
      // Generate thumbnails for each item
      const itemsWithThumbnails = await Promise.all(collection.items.map(async (item) => {
        const thumbnailUrl = await this.generateItemThumbnail(item);
        return { ...item, thumbnailUrl };
      }));
      
      return itemsWithThumbnails;
    } catch (error) {
      console.error(`Failed to get items for collection ${collectionId}:`, error);
      throw new Error('Failed to get collection items');
    }
  }

  /**
   * Edit an item in a collection
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} itemId - Item ID to edit
   * @param {Object} updates - Item updates to apply
   * @returns {Promise<Object>} - Updated collection with edited item
   */
  async editItemInCollection(userId, collectionId, itemId, updates) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Ensure items array exists
      if (!collection.items || collection.items.length === 0) {
        throw new Error('No items in collection');
      }
      
      // Find the item index
      const itemIndex = collection.items.findIndex(item => item.id === itemId);
      
      if (itemIndex === -1) {
        throw new Error('Item not found in collection');
      }
      
      // Get the current item
      const currentItem = collection.items[itemIndex];
      
      // Create updated item - preserve essential fields
      const updatedItem = {
        ...currentItem,
        ...updates,
        id: itemId, // Ensure ID is not changed
        updated: Date.now() // Update the timestamp
      };
      
      // Update the item in the collection
      collection.items[itemIndex] = updatedItem;
      
      // Save the updated collection
      return await this.updateCollection(userId, collectionId, {
        items: collection.items
      });
    } catch (error) {
      console.error(`Failed to edit item in collection ${collectionId}:`, error);
      throw new Error('Failed to edit collection item');
    }
  }

  /**
   * Share a collection with another user
   * @param {string} userId - Owner user ID
   * @param {string} collectionId - Collection ID
   * @param {Object} shareOptions - Share options
   * @param {string} shareOptions.targetUserId - User to share with
   * @param {string} shareOptions.permissions - Permission level (view, edit)
   * @returns {Promise<Object>} - Updated collection with share info
   */
  async shareCollection(userId, collectionId, shareOptions) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Initialize shares array if it doesn't exist
      if (!collection.shares) {
        collection.shares = [];
      }
      
      const { targetUserId, permissions = 'view' } = shareOptions;
      
      // Validate targetUserId
      if (!targetUserId) {
        throw new Error('Target user ID is required');
      }
      
      // Check if already shared with this user
      const existingShareIndex = collection.shares.findIndex(
        share => share.userId === targetUserId
      );
      
      // Create the share record
      const shareRecord = {
        userId: targetUserId,
        permissions,
        sharedAt: Date.now()
      };
      
      // Update or add the share
      if (existingShareIndex >= 0) {
        collection.shares[existingShareIndex] = shareRecord;
      } else {
        collection.shares.push(shareRecord);
      }
      
      // Update the collection
      const updatedCollection = await this.updateCollection(userId, collectionId, {
        shares: collection.shares
      });
      
      return updatedCollection;
    } catch (error) {
      console.error(`Failed to share collection ${collectionId}:`, error);
      throw new Error('Failed to share collection');
    }
  }

  /**
   * Remove sharing for a collection with a specific user
   * @param {string} userId - Owner user ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - User to unshare with
   * @returns {Promise<Object>} - Updated collection
   */
  async unshareCollection(userId, collectionId, targetUserId) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Initialize shares array if it doesn't exist
      if (!collection.shares || collection.shares.length === 0) {
        return collection; // Nothing to unshare
      }
      
      // Filter out the target user from shares
      const updatedShares = collection.shares.filter(
        share => share.userId !== targetUserId
      );
      
      // Update the collection only if shares changed
      if (updatedShares.length !== collection.shares.length) {
        return await this.updateCollection(userId, collectionId, {
          shares: updatedShares
        });
      }
      
      return collection;
    } catch (error) {
      console.error(`Failed to unshare collection ${collectionId}:`, error);
      throw new Error('Failed to unshare collection');
    }
  }

  /**
   * Get all collections shared with a user
   * @param {string} userId - User ID to get shared collections for
   * @returns {Promise<Array>} - List of shared collections
   */
  async getSharedCollections(userId) {
    try {
      return await this.collectionDB.getSharedCollectionsByUserId(userId);
    } catch (error) {
      console.error('Failed to load shared collections:', error);
      throw new Error('Failed to load shared collections');
    }
  }

  /**
   * Update share permissions for a collection
   * @param {string} userId - Owner user ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - User to update permissions for
   * @param {string} permissions - New permission level (view, edit)
   * @returns {Promise<Object>} - Updated collection
   */
  async updateSharePermissions(userId, collectionId, targetUserId, permissions) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId);
      
      // Initialize shares array if it doesn't exist
      if (!collection.shares) {
        throw new Error('Collection is not shared');
      }
      
      // Find the share to update
      const shareIndex = collection.shares.findIndex(
        share => share.userId === targetUserId
      );
      
      if (shareIndex === -1) {
        throw new Error('Collection is not shared with this user');
      }
      
      // Update permissions
      collection.shares[shareIndex].permissions = permissions;
      collection.shares[shareIndex].updatedAt = Date.now();
      
      // Update the collection
      return await this.updateCollection(userId, collectionId, {
        shares: collection.shares
      });
    } catch (error) {
      console.error(`Failed to update share permissions for collection ${collectionId}:`, error);
      throw new Error('Failed to update share permissions');
    }
  }

  /**
   * Create a share link for a collection
   * @param {string} userId - Owner user ID
   * @param {string} collectionId - Collection ID
   * @param {Object} options - Share link options
   * @param {string} options.expiry - Expiration time (e.g., '24h', '7d')
   * @param {string} options.permissions - Default permissions for link users
   * @returns {Promise<Object>} - Share link info
   */
  async createShareLink(userId, collectionId, options = {}) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId, false);
      
      // Generate a unique token for this share link
      const shareToken = crypto.randomBytes(16).toString('hex');
      
      // Set default expiry to 7 days if not provided
      const expiryValue = options.expiry || '7d';
      let expiryMs = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
      
      // Parse expiry string (e.g., "24h", "7d")
      if (typeof expiryValue === 'string') {
        const unit = expiryValue.charAt(expiryValue.length - 1);
        const value = parseInt(expiryValue.slice(0, -1), 10);
        
        if (!isNaN(value)) {
          switch (unit) {
            case 'h': // hours
              expiryMs = value * 60 * 60 * 1000;
              break;
            case 'd': // days
              expiryMs = value * 24 * 60 * 60 * 1000;
              break;
            case 'w': // weeks
              expiryMs = value * 7 * 24 * 60 * 60 * 1000;
              break;
          }
        }
      }
      
      // Calculate expiry date
      const expiryDate = Date.now() + expiryMs;
      
      // Create share link object
      const shareLink = {
        token: shareToken,
        collectionId,
        createdBy: userId,
        createdAt: Date.now(),
        expiresAt: expiryDate,
        permissions: options.permissions || 'view'
      };
      
      // Initialize shareLinks array if it doesn't exist
      if (!collection.shareLinks) {
        collection.shareLinks = [];
      }
      
      // Add the share link
      collection.shareLinks.push(shareLink);
      
      // Update the collection
      await this.updateCollection(userId, collectionId, {
        shareLinks: collection.shareLinks
      });
      
      // Return the share link info
      return {
        ...shareLink,
        url: `/share/${shareToken}`
      };
    } catch (error) {
      console.error(`Failed to create share link for collection ${collectionId}:`, error);
      throw new Error('Failed to create share link');
    }
  }

  /**
   * Update the expiry date of a share link
   * @param {string} userId - Owner user ID
   * @param {string} collectionId - Collection ID
   * @param {number} expiryDays - New expiry period in days
   * @returns {Promise<Object>} - Updated share link info
   */
  async updateShareLinkExpiry(userId, collectionId, expiryDays) {
    try {
      // First get the collection to verify ownership
      const collection = await this.getCollection(userId, collectionId, false);
      
      // Check if collection has share links
      if (!collection.shareLinks || collection.shareLinks.length === 0) {
        throw new Error('No share links found for this collection');
      }
      
      // Find the active share link (assuming only one active link per collection)
      const shareLink = collection.shareLinks[collection.shareLinks.length - 1];
      
      // Calculate new expiry date based on expiryDays
      const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
      const newExpiryDate = Date.now() + expiryMs;
      
      // Update the expiry date
      shareLink.expiresAt = newExpiryDate;
      shareLink.updatedAt = Date.now();
      
      // Update the collection
      await this.updateCollection(userId, collectionId, {
        shareLinks: collection.shareLinks
      });
      
      // Return the updated share link info
      return {
        ...shareLink,
        url: `/share/${shareLink.token}`
      };
    } catch (error) {
      console.error(`Failed to update share link expiry for collection ${collectionId}:`, error);
      throw new Error('Failed to update share link expiry');
    }
  }

  /**
   * Get collection by share token
   * @param {string} shareToken - Share token
   * @returns {Promise<Object>} - Collection data
   */
  async getCollectionByShareToken(shareToken) {
    try {
      const collection = await this.collectionDB.getCollectionByShareToken(shareToken);
      
      if (!collection) {
        throw new Error('Invalid or expired share link');
      }
      
      // Find the share link
      const shareLink = collection.shareLinks.find(link => link.token === shareToken);
      
      if (!shareLink) {
        throw new Error('Share link not found');
      }
      
      // Check if the share link has expired
      if (shareLink.expiresAt < Date.now()) {
        throw new Error('Share link has expired');
      }
      
      // Return the collection with share info
      return {
        ...collection,
        isSharedViaLink: true,
        sharePermissions: shareLink.permissions
      };
    } catch (error) {
      console.error(`Failed to get collection by share token:`, error);
      throw new Error('Failed to access shared collection');
    }
  }
}

module.exports = { CollectionsWorkflow }; 