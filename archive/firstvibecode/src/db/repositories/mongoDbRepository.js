/**
 * MongoDbRepository - Manages MongoDB database connections and operations
 * 
 * This module encapsulates MongoDB client connection management and provides
 * methods for accessing collections and executing database operations.
 */

const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

class MongoDbRepository {
  /**
   * Create a new MongoDbRepository instance
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
    this.connectionId = uuidv4().substring(0, 8);
    
    // Default connection options
    this.defaultOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      retryWrites: true,
      connectTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000,  // 45 seconds
      serverSelectionTimeoutMS: 30000, // 30 seconds
      maxPoolSize: 10
    };
    
    // Merge options with defaults
    this.connectionOptions = { ...this.defaultOptions, ...options };
  }

  /**
   * Connect to MongoDB
   * 
   * @returns {Promise<MongoClient>} MongoDB client
   */
  async connect() {
    try {
      if (this.client) {
        this.logger.debug(`[MongoDB:${this.connectionId}] Already have MongoDB client, checking connection...`);
        
        if (this.client.topology && this.client.topology.isConnected()) {
          this.logger.debug(`[MongoDB:${this.connectionId}] Reusing existing MongoDB connection`);
          return this.client;
        } else {
          this.logger.info(`[MongoDB:${this.connectionId}] Existing MongoDB client disconnected, reconnecting...`);
        }
      }

      // Log connection attempt with sanitized URI (hide credentials)
      const sanitizedUri = this.uri.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:***@');
      this.logger.info(`[MongoDB:${this.connectionId}] Connecting to MongoDB at ${sanitizedUri}`, {
        options: Object.keys(this.connectionOptions),
        timeouts: {
          connect: this.connectionOptions.connectTimeoutMS,
          socket: this.connectionOptions.socketTimeoutMS,
          serverSelection: this.connectionOptions.serverSelectionTimeoutMS
        }
      });

      // Create and connect MongoDB client
      this.client = new MongoClient(this.uri, this.connectionOptions);
      const startTime = Date.now();
      await this.client.connect();
      const duration = Date.now() - startTime;
      
      // Fetch server info for logging
      let serverInfo = {};
      try {
        const admin = this.client.db().admin();
        const { version, gitVersion } = await admin.serverInfo();
        serverInfo = { version, gitVersion };
      } catch (error) {
        this.logger.warn(`[MongoDB:${this.connectionId}] Could not retrieve server info: ${error.message}`);
      }

      this.logger.info(`[MongoDB:${this.connectionId}] Connected to MongoDB successfully in ${duration}ms`, {
        server: serverInfo,
        databases: await this._listDatabases()
      });
      
      return this.client;
    } catch (error) {
      this.logger.error(`[MongoDB:${this.connectionId}] Failed to connect to MongoDB: ${error.message}`, {
        uri: this.uri.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:***@'),
        errorCode: error.code,
        errorName: error.name,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get the list of databases on the server
   * 
   * @returns {Promise<Array<string>>} List of database names
   * @private
   */
  async _listDatabases() {
    try {
      const admin = this.client.db().admin();
      const { databases } = await admin.listDatabases();
      return databases.map(db => db.name);
    } catch (error) {
      this.logger.warn(`[MongoDB:${this.connectionId}] Failed to list databases: ${error.message}`);
      return ['unknown'];
    }
  }

  /**
   * Disconnect from MongoDB
   * 
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client) {
      this.logger.info(`[MongoDB:${this.connectionId}] Disconnecting from MongoDB`);
      try {
        await this.client.close();
        this.logger.info(`[MongoDB:${this.connectionId}] Successfully disconnected from MongoDB`);
      } catch (error) {
        this.logger.error(`[MongoDB:${this.connectionId}] Error disconnecting from MongoDB: ${error.message}`);
      } finally {
        this.client = null;
      }
    }
  }

  /**
   * Check if the client is connected
   * 
   * @returns {boolean} True if connected
   */
  isConnected() {
    if (!this.client || !this.client.topology) {
      return false;
    }
    const isConnected = this.client.topology.isConnected();
    this.logger.debug(`[MongoDB:${this.connectionId}] Connection status check: ${isConnected ? 'Connected' : 'Disconnected'}`);
    return isConnected;
  }

  /**
   * Get a MongoDB database
   * 
   * @param {string} [name] Optional database name (uses default from URI if not specified)
   * @returns {Promise<Db>} MongoDB database
   */
  async db(name) {
    const dbName = name || this.options.dbName;
    await this.connect();
    const db = this.client.db(dbName);
    this.logger.debug(`[MongoDB:${this.connectionId}] Accessed database: ${dbName || '(default)'}`);
    return db;
  }

  /**
   * Get a MongoDB collection
   * 
   * @param {string} name Collection name
   * @param {string} [dbName] Optional database name
   * @returns {Promise<Collection>} MongoDB collection
   */
  async collection(name, dbName) {
    try {
      const db = await this.db(dbName);
      const collection = db.collection(name);
      
      // Log collection verification
      try {
        const collections = await db.listCollections({ name }).toArray();
        const exists = collections.length > 0;
        this.logger.debug(`[MongoDB:${this.connectionId}] Collection access: ${name}`, { exists });
        
        if (!exists) {
          this.logger.warn(`[MongoDB:${this.connectionId}] Accessing non-existent collection: ${name}. It will be created on first write.`);
        }
      } catch (err) {
        this.logger.warn(`[MongoDB:${this.connectionId}] Failed to verify collection existence: ${name}`, { error: err.message });
      }
      
      return this._wrapCollection(collection, name);
    } catch (error) {
      this.logger.error(`[MongoDB:${this.connectionId}] Error accessing collection ${name}: ${error.message}`, { 
        stack: error.stack,
        errorCode: error.code
      });
      throw error;
    }
  }

  /**
   * Wrap a MongoDB collection with logging for all operations
   * 
   * @param {Collection} collection MongoDB collection
   * @param {string} collectionName Name of the collection
   * @returns {Collection} Wrapped collection
   * @private
   */
  _wrapCollection(collection, collectionName) {
    // List of methods to wrap with logging
    const methodsToWrap = [
      'findOne', 'find', 'insertOne', 'insertMany', 
      'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
      'aggregate', 'count', 'countDocuments', 'estimatedDocumentCount'
    ];
    
    const wrapper = {};
    
    for (const method of methodsToWrap) {
      if (typeof collection[method] === 'function') {
        wrapper[method] = async (...args) => {
          const queryId = Math.random().toString(36).substring(2, 15); // Generate a random ID for tracking
          const startTime = Date.now();
          
          this.logger.debug(`[MongoDB:${this.connectionId}] Starting ${method} on ${collectionName}`, {
            queryId,
            args: args.map(arg => {
              if (typeof arg === 'object' && arg !== null) {
                return Object.keys(arg).reduce((acc, key) => {
                  // Safely stringify complex objects
                  let value = arg[key];
                  if (typeof value === 'object' && value !== null) {
                    if (value instanceof RegExp) {
                      acc[key] = value.toString();
                    } else if (Array.isArray(value)) {
                      acc[key] = `Array(${value.length})`;
                    } else {
                      acc[key] = Object.keys(value).length ? `Object{${Object.keys(value).join(',')}}` : '{}';
                    }
                  } else {
                    acc[key] = value;
                  }
                  return acc;
                }, {});
              }
              return typeof arg;
            })
          });
          
          try {
            let result;
            
            if (method === 'find') {
              // For find, we need to handle the cursor
              const cursor = collection[method](...args);
              result = await cursor.toArray();
            } else {
              result = await collection[method](...args);
            }
            
            const duration = Date.now() - startTime;
            const resultInfo = this._formatResultForLogging(result, method);
            
            this.logger.debug(`[MongoDB:${this.connectionId}] Completed ${method} on ${collectionName} in ${duration}ms`, {
              queryId,
              duration,
              ...resultInfo
            });
            
            return method === 'find' ? result : result;
          } catch (error) {
            const duration = Date.now() - startTime;
            
            this.logger.error(`[MongoDB:${this.connectionId}] Error in ${method} on ${collectionName} after ${duration}ms: ${error.message}`, {
              queryId,
              duration,
              errorCode: error.code,
              errorName: error.name,
              stack: error.stack
            });
            
            throw error;
          }
        };
      } else {
        wrapper[method] = collection[method];
      }
    }
    
    // Add non-wrapped properties and methods
    return new Proxy(collection, {
      get(target, prop) {
        if (prop in wrapper) {
          return wrapper[prop];
        }
        return target[prop];
      }
    });
  }

  /**
   * Format MongoDB result for logging
   * 
   * @param {*} result Query result
   * @param {string} method Method name
   * @returns {Object} Formatted result info for logging
   * @private
   */
  _formatResultForLogging(result, method) {
    if (!result) {
      return { result: null };
    }
    
    if (method.startsWith('find')) {
      // Handle find results (array or single document)
      if (Array.isArray(result)) {
        return { 
          count: result.length,
          resultType: 'array',
          sampleIds: result.slice(0, 3).map(doc => doc._id?.toString()).filter(Boolean)
        };
      } else {
        return {
          found: !!result,
          resultType: typeof result,
          id: result._id?.toString()
        };
      }
    } else if (method.startsWith('insert')) {
      // Handle insert results
      return {
        inserted: true,
        insertedCount: result.insertedCount || (result.insertedId ? 1 : 0),
        insertedIds: result.insertedIds || (result.insertedId ? [result.insertedId.toString()] : [])
      };
    } else if (method.startsWith('update')) {
      // Handle update results
      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
        upsertedId: result.upsertedId?.toString()
      };
    } else if (method.startsWith('delete')) {
      // Handle delete results
      return {
        deletedCount: result.deletedCount
      };
    } else if (method.startsWith('count')) {
      // Handle count results
      return {
        count: typeof result === 'number' ? result : (result?.count || 0)
      };
    }
    
    // Default for other methods
    return {
      resultType: typeof result,
      resultKeys: typeof result === 'object' && result !== null ? Object.keys(result) : []
    };
  }
}

module.exports = { MongoDbRepository }; 