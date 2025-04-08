/**
 * MongoRepository Base Class
 * Extends the Repository interface to provide MongoDB-specific data access
 * Manages connection pooling, reuse, and centralized error handling
 * 
 * @module core/shared/mongo/MongoRepository
 */

const { MongoClient, ObjectId } = require('mongodb');
const { Repository } = require('../repository');
const eventBus = require('../events').default;

// Singleton connection cache
let cachedClient = null;
let connectionPromise = null;

/**
 * MongoDB Repository Base Class
 * Implements Repository interface for MongoDB persistence
 */
class MongoRepository extends Repository {
  /**
   * Create a new MongoRepository
   * @param {Object} options - Repository configuration
   * @param {string} options.collectionName - MongoDB collection name
   * @param {string} [options.dbName] - MongoDB database name (default: from environment)
   * @param {string} [options.connectionString] - MongoDB connection string (default: from environment)
   * @param {Object} [options.connectionOptions] - MongoDB client options
   */
  constructor(options) {
    super();

    if (!options || !options.collectionName) {
      throw new Error('MongoRepository requires collectionName option');
    }

    this.collectionName = options.collectionName;
    this.dbName = options.dbName || process.env.BOT_NAME || 'application';
    this.connectionString = options.connectionString || process.env.MONGO_PASS;
    this.connectionOptions = options.connectionOptions || {
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    };

    if (!this.connectionString) {
      throw new Error('MongoDB connection string not provided and not available in environment');
    }

    // Add monitoring capabilities
    this.operationCount = 0;
    this.lastOperation = null;
    this.errors = [];
  }

  /**
   * Get MongoDB connection from cache or create new one
   * @private
   * @returns {Promise<MongoClient>} MongoDB client
   */
  async getClient() {
    // Reuse existing connection promise if in progress
    if (connectionPromise) {
      await connectionPromise;
      return cachedClient;
    }

    // Reuse existing connected client
    if (cachedClient?.topology?.isConnected?.()) {
      return cachedClient;
    }

    // Create new connection
    connectionPromise = (async () => {
      try {
        const client = new MongoClient(this.connectionString, this.connectionOptions);
        await client.connect();
        cachedClient = client;
        
        // Publish connection event
        eventBus.publish('mongodb:connected', { 
          dbName: this.dbName,
          timestamp: new Date()
        });
        
        return client;
      } catch (error) {
        // Publish error event
        eventBus.publish('mongodb:error', { 
          error: error.message,
          timestamp: new Date()
        });
        
        throw error;
      } finally {
        connectionPromise = null;
      }
    })();

    return connectionPromise;
  }

  /**
   * Get MongoDB collection
   * @private
   * @returns {Promise<Collection>} MongoDB collection
   */
  async getCollection() {
    const client = await this.getClient();
    return client.db(this.dbName).collection(this.collectionName);
  }

  /**
   * Monitor MongoDB operation with error handling
   * @private
   * @param {Function} operation - Async function to monitor
   * @param {string} operationType - Type of operation for logging
   * @returns {Promise<any>} Operation result
   */
  async monitorOperation(operation, operationType) {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      
      this.lastOperation = {
        type: operationType,
        collection: this.collectionName,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        success: true
      };
      
      this.operationCount++;
      return result;
    } catch (error) {
      const errorDetail = {
        type: operationType,
        collection: this.collectionName,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        error: error.message,
        stack: error.stack
      };
      
      this.errors.push(errorDetail);
      
      // Publish error event
      eventBus.publish('mongodb:operationError', {
        ...errorDetail,
        repository: this.constructor.name
      });
      
      throw error;
    }
  }

  /**
   * Convert string ID to ObjectId if needed
   * @private
   * @param {string|ObjectId} id - ID to convert
   * @returns {ObjectId} MongoDB ObjectId
   */
  toObjectId(id) {
    if (!id) return null;
    return typeof id === 'string' ? new ObjectId(id) : id;
  }

  /**
   * Create a new entity
   * @param {Object} data - Entity data
   * @returns {Promise<Object>} Created entity with _id
   */
  async create(data) {
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      const result = await collection.insertOne(data);
      
      if (!result.acknowledged) {
        throw new Error('Failed to create document');
      }
      
      return { ...data, _id: result.insertedId };
    }, 'create');
  }

  /**
   * Find entities by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Array<Object>>} Found entities
   */
  async find(query, options = {}) {
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      const cursor = collection.find(query, options);
      
      if (options.sort) {
        cursor.sort(options.sort);
      }
      
      if (options.skip) {
        cursor.skip(options.skip);
      }
      
      if (options.limit) {
        cursor.limit(options.limit);
      }
      
      return cursor.toArray();
    }, 'find');
  }

  /**
   * Find one entity by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} Found entity or null
   */
  async findOne(query, options = {}) {
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      return collection.findOne(query, options);
    }, 'findOne');
  }

  /**
   * Find an entity by ID
   * @param {string} id - Entity ID
   * @returns {Promise<Object|null>} Found entity or null
   */
  async findById(id) {
    if (!id) return null;
    
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      return collection.findOne({ _id: this.toObjectId(id) });
    }, 'findById');
  }

  /**
   * Update one entity by query
   * @param {Object} query - Query criteria
   * @param {Object} data - Data to update
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} Updated entity or null
   */
  async updateOne(query, data, options = {}) {
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      
      // Use $set by default to avoid replacing the entire document
      const updateDoc = data.$set || data.$unset || data.$inc 
        ? data 
        : { $set: data };
      
      const result = await collection.updateOne(query, updateDoc, options);
      
      if (!result.acknowledged) {
        throw new Error('Failed to update document');
      }
      
      if (result.matchedCount === 0 && !options.upsert) {
        return null;
      }
      
      // Return updated document if specified
      if (options.returnDocument === 'after') {
        return this.findOne(query);
      }
      
      return { acknowledged: true, modifiedCount: result.modifiedCount };
    }, 'updateOne');
  }

  /**
   * Update an entity by ID
   * @param {string} id - Entity ID
   * @param {Object} data - Data to update
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} Updated entity or null
   */
  async updateById(id, data, options = {}) {
    if (!id) return null;
    
    return this.updateOne(
      { _id: this.toObjectId(id) },
      data,
      options
    );
  }

  /**
   * Delete one entity by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteOne(query, options = {}) {
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      const result = await collection.deleteOne(query, options);
      
      if (!result.acknowledged) {
        throw new Error('Failed to delete document');
      }
      
      return result.deletedCount > 0;
    }, 'deleteOne');
  }

  /**
   * Delete an entity by ID
   * @param {string} id - Entity ID
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteById(id) {
    if (!id) return false;
    
    return this.deleteOne({ _id: this.toObjectId(id) });
  }

  /**
   * Count entities by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<number>} Count of entities
   */
  async count(query, options = {}) {
    return this.monitorOperation(async () => {
      const collection = await this.getCollection();
      return collection.countDocuments(query, options);
    }, 'count');
  }

  /**
   * Check if entity exists
   * @param {Object} query - Query criteria
   * @returns {Promise<boolean>} Whether entity exists
   */
  async exists(query) {
    const count = await this.count(query, { limit: 1 });
    return count > 0;
  }

  /**
   * Get repository operation statistics
   * @returns {Object} Repository statistics
   */
  getStats() {
    return {
      collectionName: this.collectionName,
      operationCount: this.operationCount,
      lastOperation: this.lastOperation,
      errorCount: this.errors.length
    };
  }

  /**
   * Clear error log
   */
  clearErrors() {
    this.errors = [];
  }

  /**
   * Close MongoDB connection (useful for tests)
   * @static
   */
  static async closeConnection() {
    if (cachedClient) {
      await cachedClient.close();
      cachedClient = null;
    }
  }
}

module.exports = { MongoRepository }; 