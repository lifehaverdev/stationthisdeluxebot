/**
 * BaseRepository - Base class for repository pattern implementation
 * 
 * This module provides a common foundation for all repositories in the system.
 * It abstracts database operations and enforces consistent error handling.
 */

const { AppError } = require('../errors/AppError');

class BaseRepository {
  /**
   * Create a new BaseRepository instance
   * 
   * @param {Object} options Configuration options
   * @param {string} options.collectionName Name of the collection
   * @param {Object} options.db Database connection or service
   * @param {Object} options.logger Logger instance
   */
  constructor({ collectionName, db, logger }) {
    if (!collectionName) {
      throw new Error('Collection name is required for repository');
    }
    
    this.collectionName = collectionName;
    this.db = db;
    this.logger = logger;
  }

  /**
   * Get the collection
   * 
   * @returns {Object} MongoDB collection
   * @throws {AppError} If database not connected
   */
  getCollection() {
    if (!this.db || !this.db.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    return this.db.collection(this.collectionName);
  }

  /**
   * Find a single document
   * 
   * @param {Object} query Query filter
   * @returns {Promise<Object|null>} Found document or null
   */
  async findOne(query) {
    try {
      this.logger.debug(`BaseRepository.findOne: Executing query on collection ${this.collectionName}`, { query });
      
      const collection = this.getCollection();
      this.logger.debug(`BaseRepository.findOne: Collection obtained: ${this.collectionName}`);
      
      const result = await collection.findOne(query);
      this.logger.debug(`BaseRepository.findOne: Query result`, { 
        hasResult: !!result,
        resultType: result ? typeof result : 'null',
        resultKeys: result ? Object.keys(result) : []
      });
      
      return result;
    } catch (error) {
      this.logger.error(`Repository findOne error in ${this.collectionName}`, { error, query });
      
      // Rethrow AppError or wrap in AppError
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to find document in ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Find multiple documents
   * 
   * @param {Object} query Query filter
   * @param {Object} options Query options (e.g., limit, sort)
   * @returns {Promise<Array>} Array of found documents
   */
  async find(query, options = {}) {
    try {
      const collection = this.getCollection();
      const cursor = collection.find(query);
      
      if (options.sort) {
        cursor.sort(options.sort);
      }
      
      if (options.limit) {
        cursor.limit(options.limit);
      }
      
      if (options.skip) {
        cursor.skip(options.skip);
      }
      
      return await cursor.toArray();
    } catch (error) {
      this.logger.error(`Repository find error in ${this.collectionName}`, { error, query });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to find documents in ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Insert a document
   * 
   * @param {Object} document Document to insert
   * @returns {Promise<Object>} Inserted document
   */
  async insertOne(document) {
    try {
      const collection = this.getCollection();
      const result = await collection.insertOne(document);
      return { ...document, _id: result.insertedId };
    } catch (error) {
      this.logger.error(`Repository insertOne error in ${this.collectionName}`, { error });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to insert document into ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Insert multiple documents
   * 
   * @param {Array} documents Documents to insert
   * @returns {Promise<Object>} Insert result
   */
  async insertMany(documents) {
    try {
      const collection = this.getCollection();
      return await collection.insertMany(documents);
    } catch (error) {
      this.logger.error(`Repository insertMany error in ${this.collectionName}`, { error });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to insert documents into ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Update a document
   * 
   * @param {Object} query Query filter
   * @param {Object} update Update operations or document
   * @returns {Promise<Object>} Update result
   */
  async updateOne(query, update) {
    try {
      const collection = this.getCollection();
      
      // Handle direct document updates or update operators
      const updateDoc = update.$set || update.$unset || update.$push || update.$pull
        ? update // It's already an update document
        : { $set: update }; // Convert to $set operation
        
      return await collection.updateOne(query, updateDoc);
    } catch (error) {
      this.logger.error(`Repository updateOne error in ${this.collectionName}`, { error, query });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to update document in ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Update multiple documents
   * 
   * @param {Object} query Query filter
   * @param {Object} update Update operations
   * @returns {Promise<Object>} Update result
   */
  async updateMany(query, update) {
    try {
      const collection = this.getCollection();
      
      // Handle direct document updates or update operators
      const updateDoc = update.$set || update.$unset || update.$push || update.$pull
        ? update // It's already an update document
        : { $set: update }; // Convert to $set operation
      
      return await collection.updateMany(query, updateDoc);
    } catch (error) {
      this.logger.error(`Repository updateMany error in ${this.collectionName}`, { error, query });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to update documents in ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Delete a document
   * 
   * @param {Object} query Query filter
   * @returns {Promise<Object>} Delete result
   */
  async deleteOne(query) {
    try {
      const collection = this.getCollection();
      return await collection.deleteOne(query);
    } catch (error) {
      this.logger.error(`Repository deleteOne error in ${this.collectionName}`, { error, query });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to delete document from ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Delete multiple documents
   * 
   * @param {Object} query Query filter
   * @returns {Promise<Object>} Delete result
   */
  async deleteMany(query) {
    try {
      const collection = this.getCollection();
      return await collection.deleteMany(query);
    } catch (error) {
      this.logger.error(`Repository deleteMany error in ${this.collectionName}`, { error, query });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to delete documents from ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Count documents matching a query
   * 
   * @param {Object} query Query filter
   * @returns {Promise<number>} Document count
   */
  async count(query = {}) {
    try {
      const collection = this.getCollection();
      return await collection.countDocuments(query);
    } catch (error) {
      this.logger.error(`Repository count error in ${this.collectionName}`, { error, query });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(`Failed to count documents in ${this.collectionName}`, 'DATABASE_ERROR', error);
    }
  }
}

module.exports = { BaseRepository }; 