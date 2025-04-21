/**
 * DatabaseService - Provides a unified interface for database operations
 * 
 * This service abstracts the database implementation details and provides
 * a consistent API for database operations across the application.
 */

const { AppError } = require('../../core/shared/errors/AppError');

class DatabaseService {
  /**
   * Create a new DatabaseService instance
   * 
   * @param {Object} options Configuration options
   * @param {string} options.uri MongoDB connection URI
   * @param {Object} options.options MongoDB connection options
   * @param {Object} options.logger Logger instance
   */
  constructor({ uri, options = {}, logger }) {
    this.uri = uri;
    this.options = options;
    this.logger = logger;
    this.client = null;
    this.db = null;
    this.isConnected = () => !!this.client && !!this.db;
  }

  /**
   * Connect to the database
   * 
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      // Dynamically import MongoDB to avoid dependency if not used
      const { MongoClient } = require('mongodb');
      
      this.logger.info('Connecting to database');
      this.client = new MongoClient(this.uri, this.options);
      await this.client.connect();
      
      // Get database name from URI
      const dbName = this.uri.split('/').pop().split('?')[0];
      this.db = this.client.db(dbName);
      
      this.logger.info('Database connection established');
    } catch (error) {
      this.logger.error('Failed to connect to database', { error });
      throw new AppError('Failed to connect to database', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Disconnect from the database
   * 
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.client) {
      return;
    }
    
    try {
      this.logger.info('Disconnecting from database');
      await this.client.close();
      this.client = null;
      this.db = null;
      this.logger.info('Database connection closed');
    } catch (error) {
      this.logger.error('Failed to disconnect from database', { error });
      throw new AppError('Failed to disconnect from database', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Find a single document in a collection
   * 
   * @param {string} collection Collection name
   * @param {Object} query Query filter
   * @returns {Promise<Object|null>} Found document or null
   */
  async findOne(collection, query) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      this.logger.debug(`Finding document in ${collection}`, { query });
      return await this.db.collection(collection).findOne(query);
    } catch (error) {
      this.logger.error(`Failed to find document in ${collection}`, { error, query });
      throw new AppError(`Failed to find document in ${collection}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Find multiple documents in a collection
   * 
   * @param {string} collection Collection name
   * @param {Object} query Query filter
   * @param {Object} options Query options (e.g., limit, sort)
   * @returns {Promise<Array>} Array of found documents
   */
  async findMany(collection, query, options = {}) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      this.logger.debug(`Finding documents in ${collection}`, { query, options });
      return await this.db.collection(collection).find(query, options).toArray();
    } catch (error) {
      this.logger.error(`Failed to find documents in ${collection}`, { error, query });
      throw new AppError(`Failed to find documents in ${collection}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Insert a document into a collection
   * 
   * @param {string} collection Collection name
   * @param {Object} document Document to insert
   * @returns {Promise<Object>} Inserted document
   */
  async insertOne(collection, document) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      this.logger.debug(`Inserting document into ${collection}`);
      const result = await this.db.collection(collection).insertOne(document);
      return { ...document, _id: result.insertedId };
    } catch (error) {
      this.logger.error(`Failed to insert document into ${collection}`, { error });
      throw new AppError(`Failed to insert document into ${collection}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Update a document in a collection
   * 
   * @param {string} collection Collection name
   * @param {Object} query Query filter
   * @param {Object} update Update operations
   * @returns {Promise<Object>} Update result
   */
  async updateOne(collection, query, update) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      this.logger.debug(`Updating document in ${collection}`, { query });
      return await this.db.collection(collection).updateOne(query, update);
    } catch (error) {
      this.logger.error(`Failed to update document in ${collection}`, { error, query });
      throw new AppError(`Failed to update document in ${collection}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Delete a document from a collection
   * 
   * @param {string} collection Collection name
   * @param {Object} query Query filter
   * @returns {Promise<Object>} Delete result
   */
  async deleteOne(collection, query) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      this.logger.debug(`Deleting document from ${collection}`, { query });
      return await this.db.collection(collection).deleteOne(query);
    } catch (error) {
      this.logger.error(`Failed to delete document from ${collection}`, { error, query });
      throw new AppError(`Failed to delete document from ${collection}`, 'DATABASE_ERROR', error);
    }
  }
}

module.exports = { DatabaseService }; 