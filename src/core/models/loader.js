/**
 * ModelConfigLoader - Responsible for loading model configurations from the database
 * 
 * This module fetches model configurations and prepares them for use in the application.
 */

const { AppError } = require('../shared/errors/AppError');

class ModelConfigLoader {
  /**
   * Create a new ModelConfigLoader instance
   * 
   * @param {Object} options Configuration options
   * @param {Object} options.database Database service instance
   * @param {Object} options.logger Logger instance
   */
  constructor({ database, logger }) {
    this.database = database;
    this.logger = logger;
    this.collection = 'model_configs';
  }

  /**
   * Load all public model configurations
   * 
   * @returns {Promise<Array>} Array of public model configurations
   */
  async loadPublicConfigs() {
    try {
      this.logger.info('Loading public model configurations');
      const configs = await this.database.findMany(this.collection, { isPublic: true });
      this.logger.info(`Found ${configs.length} public model configurations`);
      return configs;
    } catch (error) {
      this.logger.error('Failed to load public model configurations', { error });
      throw new AppError('Failed to load public model configurations', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load a specific model configuration by ID
   * 
   * @param {string} id Model configuration ID
   * @returns {Promise<Object>} Model configuration
   */
  async loadConfigById(id) {
    try {
      this.logger.info(`Loading model configuration by ID: ${id}`);
      const config = await this.database.findOne(this.collection, { id });
      
      if (!config) {
        throw new AppError(`Model configuration not found: ${id}`, 'NOT_FOUND');
      }
      
      return config;
    } catch (error) {
      this.logger.error(`Failed to load model configuration: ${id}`, { error });
      throw new AppError(`Failed to load model configuration: ${id}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load model configurations by type
   * 
   * @param {string} type Model type (e.g., 'text', 'image')
   * @param {Object} options Additional options
   * @param {boolean} options.publicOnly Only include public configurations
   * @returns {Promise<Array>} Array of model configurations
   */
  async loadConfigsByType(type, { publicOnly = true } = {}) {
    try {
      const query = { type };
      
      if (publicOnly) {
        query.isPublic = true;
      }
      
      this.logger.info(`Loading model configurations by type: ${type}`);
      const configs = await this.database.findMany(this.collection, query);
      
      this.logger.info(`Found ${configs.length} model configurations for type: ${type}`);
      return configs;
    } catch (error) {
      this.logger.error(`Failed to load model configurations for type: ${type}`, { error });
      throw new AppError(`Failed to load model configurations for type: ${type}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load featured model configurations
   * 
   * @param {number} limit Maximum number of configurations to load
   * @returns {Promise<Array>} Array of featured model configurations
   */
  async loadFeaturedConfigs(limit = 5) {
    try {
      this.logger.info(`Loading featured model configurations (limit: ${limit})`);
      const configs = await this.database.findMany(
        this.collection,
        { isPublic: true, featured: true },
        { limit }
      );
      
      this.logger.info(`Found ${configs.length} featured model configurations`);
      return configs;
    } catch (error) {
      this.logger.error('Failed to load featured model configurations', { error });
      throw new AppError('Failed to load featured model configurations', 'DATABASE_ERROR', error);
    }
  }
}

module.exports = { ModelConfigLoader }; 