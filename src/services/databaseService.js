/**
 * Database Service
 * 
 * Provides a unified interface for database operations
 */

const { MongoClient } = require('mongodb');
const { createLogger } = require('../utils/logger');
const config = require('../config');

const logger = createLogger('DatabaseService');

/**
 * Database service for handling database operations
 */
class DatabaseService {
  constructor() {
    this.client = null;
    this.db = null;
    this.connected = false;
    this.uri = config.DB_URI;
  }
  
  /**
   * Connect to the database
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected) {
      return;
    }
    
    try {
      logger.info('Connecting to database...');
      this.client = new MongoClient(this.uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      
      await this.client.connect();
      this.db = this.client.db();
      this.connected = true;
      logger.info('Connected to database');
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      throw new Error('Database connection failed');
    }
  }
  
  /**
   * Disconnect from the database
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.connected || !this.client) {
      return;
    }
    
    try {
      await this.client.close();
      this.connected = false;
      this.client = null;
      this.db = null;
      logger.info('Disconnected from database');
    } catch (error) {
      logger.error('Error disconnecting from database', { error });
    }
  }
  
  /**
   * Get a database collection
   * @param {string} collection - Collection name
   * @returns {Promise<Collection>} MongoDB collection
   * @private
   */
  async _getCollection(collection) {
    if (!this.connected) {
      await this.connect();
    }
    
    return this.db.collection(collection);
  }
  
  /**
   * Find documents in a collection
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of documents
   */
  async find(collection, query = {}, options = {}) {
    try {
      const coll = await this._getCollection(collection);
      
      // Apply default options
      const limit = options.limit || 0;
      const offset = options.offset || 0;
      const sort = options.sort || {};
      
      const cursor = coll.find(query);
      
      if (Object.keys(sort).length > 0) {
        cursor.sort(sort);
      }
      
      if (offset > 0) {
        cursor.skip(offset);
      }
      
      if (limit > 0) {
        cursor.limit(limit);
      }
      
      return await cursor.toArray();
    } catch (error) {
      logger.error(`Error finding documents in ${collection}`, { error, query });
      throw new Error(`Database error: ${error.message}`);
    }
  }
  
  /**
   * Find a single document in a collection
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @returns {Promise<Object|null>} Document or null if not found
   */
  async findOne(collection, query) {
    try {
      const coll = await this._getCollection(collection);
      return await coll.findOne(query);
    } catch (error) {
      logger.error(`Error finding document in ${collection}`, { error, query });
      throw new Error(`Database error: ${error.message}`);
    }
  }
  
  /**
   * Insert a document into a collection
   * @param {string} collection - Collection name
   * @param {Object} document - Document to insert
   * @returns {Promise<Object>} Inserted document
   */
  async insertOne(collection, document) {
    try {
      const coll = await this._getCollection(collection);
      const result = await coll.insertOne(document);
      
      if (!result.acknowledged) {
        throw new Error('Insert operation failed');
      }
      
      return document;
    } catch (error) {
      logger.error(`Error inserting document into ${collection}`, { error });
      throw new Error(`Database error: ${error.message}`);
    }
  }
  
  /**
   * Update a document in a collection
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @param {Object} update - Update operations
   * @returns {Promise<Object>} Update result
   */
  async updateOne(collection, query, update) {
    try {
      const coll = await this._getCollection(collection);
      const result = await coll.updateOne(query, update);
      
      return {
        matched: result.matchedCount,
        modified: result.modifiedCount,
        acknowledged: result.acknowledged
      };
    } catch (error) {
      logger.error(`Error updating document in ${collection}`, { error, query });
      throw new Error(`Database error: ${error.message}`);
    }
  }
  
  /**
   * Delete a document from a collection
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @returns {Promise<boolean>} Success status
   */
  async deleteOne(collection, query) {
    try {
      const coll = await this._getCollection(collection);
      const result = await coll.deleteOne(query);
      
      return result.deletedCount > 0;
    } catch (error) {
      logger.error(`Error deleting document from ${collection}`, { error, query });
      throw new Error(`Database error: ${error.message}`);
    }
  }
  
  /**
   * Count documents in a collection
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @returns {Promise<number>} Document count
   */
  async count(collection, query = {}) {
    try {
      const coll = await this._getCollection(collection);
      return await coll.countDocuments(query);
    } catch (error) {
      logger.error(`Error counting documents in ${collection}`, { error, query });
      throw new Error(`Database error: ${error.message}`);
    }
  }
}

module.exports = {
  DatabaseService
}; 