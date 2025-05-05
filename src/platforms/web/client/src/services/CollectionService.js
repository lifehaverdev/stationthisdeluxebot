/**
 * Collection Service for StationThis Web Client
 * 
 * Handles collection management operations
 */

import { EventBus } from '../stores/EventBus.js';
import { authService } from './AuthService.js';

class CollectionService {
  constructor() {
    this._collections = [];
    this._setupEventHandlers();
  }
  
  /**
   * Set up event handlers for collection-related events
   * @private
   */
  _setupEventHandlers() {
    EventBus.subscribe('collection:create', this.createCollection.bind(this));
    EventBus.subscribe('collection:get', this.getCollection.bind(this));
    EventBus.subscribe('collection:list', this.getUserCollections.bind(this));
    EventBus.subscribe('collection:delete', this.deleteCollection.bind(this));
    EventBus.subscribe('collection:addItem', this.addItemToCollection.bind(this));
    EventBus.subscribe('collection:removeItem', this.removeItemFromCollection.bind(this));
  }
  
  /**
   * Get all collections for the current user
   * @returns {Promise<Array>} List of collections
   */
  async getUserCollections() {
    try {
      const options = authService.addAuthHeader();
      
      const response = await fetch('/api/collections', options);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch collections');
      }
      
      const collections = await response.json();
      this._collections = collections;
      
      // Publish collections loaded event
      EventBus.publish('collection:list:success', collections);
      
      return collections;
    } catch (error) {
      console.error('Get collections error:', error);
      
      // Publish error event
      EventBus.publish('collection:list:error', {
        message: error.message
      });
      
      return [];
    }
  }
  
  /**
   * Get a specific collection by ID
   * @param {Object} data Collection request data
   * @param {string} data.id Collection ID
   * @returns {Promise<Object>} Collection data
   */
  async getCollection(data) {
    try {
      const options = authService.addAuthHeader();
      
      const response = await fetch(`/api/collections/${data.id}`, options);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch collection');
      }
      
      const collection = await response.json();
      
      // Publish collection loaded event
      EventBus.publish('collection:get:success', collection);
      
      return collection;
    } catch (error) {
      console.error('Get collection error:', error);
      
      // Publish error event
      EventBus.publish('collection:get:error', {
        id: data.id,
        message: error.message
      });
      
      return null;
    }
  }
  
  /**
   * Create a new collection
   * @param {Object} data Collection data
   * @param {string} data.name Collection name
   * @param {string} data.description Collection description
   * @returns {Promise<Object>} Created collection
   */
  async createCollection(data) {
    try {
      const options = authService.addAuthHeader({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description || ''
        })
      });
      
      const response = await fetch('/api/collections', options);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create collection');
      }
      
      const collection = await response.json();
      
      // Refresh collections list
      this.getUserCollections();
      
      // Publish collection created event
      EventBus.publish('collection:create:success', collection);
      
      return collection;
    } catch (error) {
      console.error('Create collection error:', error);
      
      // Publish error event
      EventBus.publish('collection:create:error', {
        message: error.message
      });
      
      return null;
    }
  }
  
  /**
   * Delete a collection
   * @param {Object} data Collection data
   * @param {string} data.id Collection ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteCollection(data) {
    try {
      const options = authService.addAuthHeader({
        method: 'DELETE'
      });
      
      const response = await fetch(`/api/collections/${data.id}`, options);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete collection');
      }
      
      // Refresh collections list
      this.getUserCollections();
      
      // Publish collection deleted event
      EventBus.publish('collection:delete:success', { id: data.id });
      
      return true;
    } catch (error) {
      console.error('Delete collection error:', error);
      
      // Publish error event
      EventBus.publish('collection:delete:error', {
        id: data.id,
        message: error.message
      });
      
      return false;
    }
  }
  
  /**
   * Add an item to a collection
   * @param {Object} data Item data
   * @param {string} data.collectionId Collection ID
   * @param {string} data.itemId Item ID
   * @param {string} data.itemType Item type
   * @returns {Promise<boolean>} Success status
   */
  async addItemToCollection(data) {
    try {
      const options = authService.addAuthHeader({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          itemId: data.itemId,
          itemType: data.itemType
        })
      });
      
      const response = await fetch(`/api/collections/${data.collectionId}/items`, options);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add item to collection');
      }
      
      // Publish item added event
      EventBus.publish('collection:addItem:success', data);
      
      return true;
    } catch (error) {
      console.error('Add item to collection error:', error);
      
      // Publish error event
      EventBus.publish('collection:addItem:error', {
        ...data,
        message: error.message
      });
      
      return false;
    }
  }
  
  /**
   * Remove an item from a collection
   * @param {Object} data Item data
   * @param {string} data.collectionId Collection ID
   * @param {string} data.itemId Item ID
   * @returns {Promise<boolean>} Success status
   */
  async removeItemFromCollection(data) {
    try {
      const options = authService.addAuthHeader({
        method: 'DELETE'
      });
      
      const response = await fetch(`/api/collections/${data.collectionId}/items/${data.itemId}`, options);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove item from collection');
      }
      
      // Publish item removed event
      EventBus.publish('collection:removeItem:success', data);
      
      return true;
    } catch (error) {
      console.error('Remove item from collection error:', error);
      
      // Publish error event
      EventBus.publish('collection:removeItem:error', {
        ...data,
        message: error.message
      });
      
      return false;
    }
  }
}

// Create a singleton instance
export const collectionService = new CollectionService();

// Export the class for testing
export { CollectionService }; 