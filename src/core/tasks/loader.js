/**
 * TaskDefinitionLoader - Responsible for loading task definitions from the database
 * 
 * This module fetches task definitions and prepares them for use in the application.
 * Task definitions describe operations that can be performed by users, especially
 * important for guest access with limited permissions.
 */

const { AppError } = require('../shared/errors/AppError');

class TaskDefinitionLoader {
  /**
   * Create a new TaskDefinitionLoader instance
   * 
   * @param {Object} options Configuration options
   * @param {Object} options.database Database service instance
   * @param {Object} options.logger Logger instance
   */
  constructor({ database, logger }) {
    this.database = database;
    this.logger = logger;
    this.collection = 'task_definitions';
  }

  /**
   * Load all task definitions
   * 
   * @returns {Promise<Array>} Array of task definitions
   */
  async loadAllDefinitions() {
    try {
      this.logger.info('Loading all task definitions');
      const definitions = await this.database.findMany(this.collection, {});
      this.logger.info(`Found ${definitions.length} task definitions`);
      return definitions;
    } catch (error) {
      this.logger.error('Failed to load task definitions', { error });
      throw new AppError('Failed to load task definitions', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load task definitions accessible by guests
   * 
   * @returns {Promise<Array>} Array of guest-accessible task definitions
   */
  async loadGuestAccessible() {
    try {
      this.logger.info('Loading guest-accessible task definitions');
      const definitions = await this.database.findMany(this.collection, { guestAccessible: true });
      this.logger.info(`Found ${definitions.length} guest-accessible task definitions`);
      return definitions;
    } catch (error) {
      this.logger.error('Failed to load guest-accessible task definitions', { error });
      throw new AppError('Failed to load guest-accessible task definitions', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load task definitions by category
   * 
   * @param {string} category Task category
   * @param {Object} options Additional options
   * @param {boolean} options.guestAccessibleOnly Only include guest-accessible definitions
   * @returns {Promise<Array>} Array of task definitions
   */
  async loadByCategory(category, { guestAccessibleOnly = false } = {}) {
    try {
      const query = { category };
      
      if (guestAccessibleOnly) {
        query.guestAccessible = true;
      }
      
      this.logger.info(`Loading task definitions for category: ${category}`);
      const definitions = await this.database.findMany(this.collection, query);
      
      this.logger.info(`Found ${definitions.length} task definitions for category: ${category}`);
      return definitions;
    } catch (error) {
      this.logger.error(`Failed to load task definitions for category: ${category}`, { error });
      throw new AppError(`Failed to load task definitions for category: ${category}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load a specific task definition by ID
   * 
   * @param {string} id Task definition ID
   * @returns {Promise<Object>} Task definition
   */
  async loadById(id) {
    try {
      this.logger.info(`Loading task definition by ID: ${id}`);
      const definition = await this.database.findOne(this.collection, { id });
      
      if (!definition) {
        throw new AppError(`Task definition not found: ${id}`, 'NOT_FOUND');
      }
      
      return definition;
    } catch (error) {
      this.logger.error(`Failed to load task definition: ${id}`, { error });
      throw new AppError(`Failed to load task definition: ${id}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Validate a task definition
   * 
   * @param {Object} definition Task definition to validate
   * @returns {boolean} True if valid, throws error otherwise
   */
  validateDefinition(definition) {
    if (!definition.id) {
      throw new AppError('Task definition ID is required', 'VALIDATION_ERROR');
    }
    
    if (!definition.name) {
      throw new AppError('Task definition name is required', 'VALIDATION_ERROR');
    }
    
    if (!definition.category) {
      throw new AppError('Task definition category is required', 'VALIDATION_ERROR');
    }
    
    // Additional validation could be added here
    
    return true;
  }
}

module.exports = { TaskDefinitionLoader }; 