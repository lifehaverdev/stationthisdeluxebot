/**
 * Base Repository
 * Provides a common interface for all repositories
 */

class Repository {
  /**
   * Create a new entity
   * @param {Object} data - Entity data
   * @returns {Promise<Object>} - Created entity
   */
  async create(data) {
    throw new Error('Method not implemented');
  }

  /**
   * Find entities by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Array<Object>>} - Found entities
   */
  async find(query, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Find one entity by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} - Found entity or null
   */
  async findOne(query, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Find an entity by ID
   * @param {string} id - Entity ID
   * @returns {Promise<Object|null>} - Found entity or null
   */
  async findById(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Update one entity by query
   * @param {Object} query - Query criteria
   * @param {Object} data - Data to update
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} - Updated entity or null
   */
  async updateOne(query, data, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Update an entity by ID
   * @param {string} id - Entity ID
   * @param {Object} data - Data to update
   * @returns {Promise<Object|null>} - Updated entity or null
   */
  async updateById(id, data) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete one entity by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<boolean>} - Whether deletion was successful
   */
  async deleteOne(query, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete an entity by ID
   * @param {string} id - Entity ID
   * @returns {Promise<boolean>} - Whether deletion was successful
   */
  async deleteById(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Count entities by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<number>} - Count of entities
   */
  async count(query, options = {}) {
    throw new Error('Method not implemented');
  }
}

module.exports = { Repository }; 