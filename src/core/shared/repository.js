/**
 * Repository Interface
 * 
 * Base interface for database repositories.
 * Defines standard methods that should be implemented by all database adapters.
 * This allows for database-agnostic code and potential future migration.
 * 
 * @module core/shared/repository
 */

/**
 * Abstract Repository class
 * Defines standard interface for data access
 * 
 * @abstract
 */
class Repository {
  /**
   * Find multiple entities by query
   * @abstract
   * @param {Object} query - Query criteria
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} Found entities
   */
  async find(query, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Find one entity by query
   * @abstract
   * @param {Object} query - Query criteria
   * @param {Object} options - Additional options
   * @returns {Promise<Object|null>} Found entity or null
   */
  async findOne(query, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Find entity by ID
   * @abstract
   * @param {string} id - Entity ID
   * @returns {Promise<Object|null>} Found entity or null
   */
  async findById(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Create a new entity
   * @abstract
   * @param {Object} data - Entity data
   * @returns {Promise<Object>} Created entity with ID
   */
  async create(data) {
    throw new Error('Method not implemented');
  }

  /**
   * Update one entity by query
   * @abstract
   * @param {Object} query - Query criteria
   * @param {Object} data - Data to update
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Update result
   */
  async updateOne(query, data, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Update entity by ID
   * @abstract
   * @param {string} id - Entity ID
   * @param {Object} data - Data to update
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Update result
   */
  async updateById(id, data, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete one entity by query
   * @abstract
   * @param {Object} query - Query criteria
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteOne(query) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete entity by ID
   * @abstract
   * @param {string} id - Entity ID
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteById(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Count entities by query
   * @abstract
   * @param {Object} query - Query criteria
   * @param {Object} options - Additional options
   * @returns {Promise<number>} Count of entities
   */
  async count(query, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Check if entity exists
   * @abstract
   * @param {Object} query - Query criteria
   * @returns {Promise<boolean>} Whether entity exists
   */
  async exists(query) {
    throw new Error('Method not implemented');
  }

  /**
   * Get repository statistics
   * @abstract
   * @returns {Object} Repository statistics
   */
  getStats() {
    throw new Error('Method not implemented');
  }
}

module.exports = { Repository }; 