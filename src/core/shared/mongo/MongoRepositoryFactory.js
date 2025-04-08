/**
 * MongoRepositoryFactory
 * 
 * Factory for creating and managing MongoDB repository instances.
 * Provides centralized configuration and caching of repository instances.
 * 
 * @module core/shared/mongo/MongoRepositoryFactory
 */

const { MongoRepository } = require('./MongoRepository');
const eventBus = require('../events').default;

/**
 * MongoRepositoryFactory
 * 
 * Creates and manages MongoDB repository instances with shared configuration
 */
class MongoRepositoryFactory {
  /**
   * Create a new MongoRepositoryFactory
   * @param {Object} [options={}] - Factory configuration
   * @param {string} [options.dbName] - Default database name (default: from environment)
   * @param {string} [options.connectionString] - Default connection string (default: from environment)
   * @param {Object} [options.connectionOptions] - Default MongoDB client options
   */
  constructor(options = {}) {
    this.defaultOptions = {
      dbName: options.dbName || process.env.BOT_NAME || 'application',
      connectionString: options.connectionString || process.env.MONGO_PASS,
      connectionOptions: options.connectionOptions || {
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000
      }
    };

    // Cache of repository instances
    this.repositories = new Map();
    
    // Register event for monitoring
    eventBus.publish('mongoFactory:initialized', {
      timestamp: new Date(),
      dbName: this.defaultOptions.dbName
    });
  }

  /**
   * Get or create a repository for a collection
   * @param {string} collectionName - MongoDB collection name
   * @param {Object} [options={}] - Repository-specific options
   * @returns {MongoRepository} Repository instance
   */
  getRepository(collectionName, options = {}) {
    if (!collectionName) {
      throw new Error('Collection name is required');
    }

    // Generate a cache key (collection name + possible database override)
    const cacheKey = options.dbName 
      ? `${options.dbName}-${collectionName}`
      : collectionName;

    // Return cached instance if available
    if (this.repositories.has(cacheKey)) {
      return this.repositories.get(cacheKey);
    }

    // Merge default options with repository-specific options
    const repositoryOptions = {
      ...this.defaultOptions,
      ...options,
      collectionName
    };

    // Create and cache a new repository instance
    const repository = new MongoRepository(repositoryOptions);
    this.repositories.set(cacheKey, repository);

    // Emit event for monitoring
    eventBus.publish('mongoFactory:repositoryCreated', {
      timestamp: new Date(),
      collectionName,
      dbName: repositoryOptions.dbName
    });

    return repository;
  }
  
  /**
   * Create a specialized repository with custom prototype
   * @param {string} collectionName - MongoDB collection name
   * @param {Object} customMethods - Object with custom methods to add to the repository
   * @param {Object} [options={}] - Repository-specific options
   * @returns {MongoRepository} Enhanced repository instance
   */
  createCustomRepository(collectionName, customMethods, options = {}) {
    // Get base repository
    const baseRepository = this.getRepository(collectionName, options);
    
    // Clone the repository to avoid modifying cached instances
    const customRepository = Object.create(baseRepository);
    
    // Add custom methods
    Object.assign(customRepository, customMethods);
    
    return customRepository;
  }

  /**
   * Get statistics for all managed repositories
   * @returns {Object} Combined stats for all repositories
   */
  getStats() {
    const stats = {
      repositoryCount: this.repositories.size,
      operationCount: 0,
      errorCount: 0,
      repositories: {}
    };

    for (const [name, repository] of this.repositories.entries()) {
      const repoStats = repository.getStats();
      stats.operationCount += repoStats.operationCount;
      stats.errorCount += repoStats.errors.length;
      stats.repositories[name] = repoStats;
    }

    return stats;
  }

  /**
   * Clear all repository caches
   */
  clearCache() {
    this.repositories.clear();
    
    eventBus.publish('mongoFactory:cacheCleared', {
      timestamp: new Date()
    });
  }

  /**
   * Close all MongoDB connections
   * @returns {Promise<void>}
   */
  async closeAllConnections() {
    await MongoRepository.closeConnection();
    
    eventBus.publish('mongoFactory:connectionsClose', {
      timestamp: new Date()
    });
  }
}

/**
 * Create a new MongoRepositoryFactory with default options
 * @param {Object} [options={}] - Factory configuration
 * @returns {MongoRepositoryFactory} A new factory instance
 */
function createMongoRepositoryFactory(options = {}) {
  return new MongoRepositoryFactory(options);
}

// Default singleton instance for common use
let defaultFactory;

/**
 * Get the default MongoRepositoryFactory instance
 * @param {Object} [options={}] - Options to initialize the default factory (only used on first call)
 * @returns {MongoRepositoryFactory} The default factory instance
 */
function getDefaultFactory(options = {}) {
  if (!defaultFactory) {
    defaultFactory = createMongoRepositoryFactory(options);
  }
  return defaultFactory;
}

module.exports = {
  MongoRepositoryFactory,
  createMongoRepositoryFactory,
  getDefaultFactory
}; 