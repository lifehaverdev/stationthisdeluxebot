/**
 * DatabaseService - Provides database connection and collection access
 * 
 * This service manages MongoDB connections and provides access to collections.
 * It's designed to be used by repositories, not directly by business logic.
 */

const { MongoClient } = require('mongodb');
const { AppError } = require('../core/shared/errors/AppError');

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
    this._connected = false;
  }

  /**
   * Check if the database is connected
   * 
   * @returns {boolean} True if connected
   */
  isConnected() {
    return this._connected && !!this.client && !!this.db;
  }

  /**
   * Connect to the database
   * 
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      if (this.isConnected()) {
        this.logger.debug('Already connected to database');
        return;
      }
      
      // Get database name - prioritize options.dbName, then BOT_NAME env var, then extract from URI
      const dbNameFromOptions = this.options.dbName;
      const dbNameFromEnv = process.env.BOT_NAME;
      const dbNameFromURI = this.uri.split('/').pop().split('?')[0];
      
      const dbName = dbNameFromOptions || dbNameFromEnv || dbNameFromURI;
      
      this.logger.info('Connecting to database', {
        uri: this.uri.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:***@'),
        usingDbName: dbName,
        source: dbNameFromOptions ? 'options' : (dbNameFromEnv ? 'BOT_NAME env' : 'URI')
      });
      
      this.client = new MongoClient(this.uri, this.options);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this._connected = true;
      
      this.logger.info('Database connection established', {
        dbName: dbName
      });
    } catch (error) {
      this._connected = false;
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
      this._connected = false;
      this.logger.info('Database connection closed');
    } catch (error) {
      this.logger.error('Failed to disconnect from database', { error });
      throw new AppError('Failed to disconnect from database', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Get a MongoDB collection
   * 
   * @param {string} collectionName Name of the collection
   * @returns {Object} MongoDB collection
   */
  collection(collectionName) {
    if (!this.isConnected()) {
      this.logger.error(`Database not connected while requesting collection: ${collectionName}`);
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    this.logger.debug(`DBService.collection: Getting collection ${collectionName}`);
    const collection = this.db.collection(collectionName);
    this.logger.debug(`DBService.collection: Collection ${collectionName} obtained successfully`);
    
    return collection;
  }

  /**
   * Create indexes for a collection
   * 
   * @param {string} collectionName Collection name
   * @param {Array} indexes Array of index specifications
   * @returns {Promise<void>}
   */
  async createIndexes(collectionName, indexes) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      const collection = this.collection(collectionName);
      await Promise.all(indexes.map(index => collection.createIndex(index.keys, index.options)));
      this.logger.info(`Created indexes for ${collectionName}`);
    } catch (error) {
      this.logger.error(`Failed to create indexes for ${collectionName}`, { error });
      throw new AppError(`Failed to create indexes for ${collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Drop a collection
   * 
   * @param {string} collectionName Collection name
   * @returns {Promise<boolean>} True if collection was dropped
   */
  async dropCollection(collectionName) {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      const collections = await this.db.listCollections({ name: collectionName }).toArray();
      
      if (collections.length === 0) {
        return false;
      }
      
      await this.db.dropCollection(collectionName);
      this.logger.info(`Dropped collection ${collectionName}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to drop collection ${collectionName}`, { error });
      throw new AppError(`Failed to drop collection ${collectionName}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * List all collections
   * 
   * @returns {Promise<Array>} Array of collection names
   */
  async listCollections() {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      const collections = await this.db.listCollections().toArray();
      return collections.map(c => c.name);
    } catch (error) {
      this.logger.error('Failed to list collections', { error });
      throw new AppError('Failed to list collections', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Get a transaction session
   * 
   * @returns {Promise<Object>} MongoDB session
   */
  async startSession() {
    if (!this.isConnected()) {
      throw new AppError('Database not connected', 'DATABASE_ERROR');
    }
    
    try {
      return await this.client.startSession();
    } catch (error) {
      this.logger.error('Failed to start session', { error });
      throw new AppError('Failed to start session', 'DATABASE_ERROR', error);
    }
  }
}

module.exports = { DatabaseService }; 