/**
 * Generic Repository Interface
 * Provides a standard interface for data access operations
 * This is an abstract class that should be extended by concrete repository implementations
 */

class Repository {
  /**
   * Create a new entity
   * @param {Object} data - The data to create the entity with
   * @returns {Promise<Object>} - The created entity
   */
  async create(data) {
    throw new Error('Method not implemented');
  }

  /**
   * Find an entity by ID
   * @param {string|number} id - The ID of the entity to find
   * @returns {Promise<Object|null>} - The found entity or null if not found
   */
  async findById(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Find entities by query
   * @param {Object} query - The query criteria
   * @param {Object} [options] - Additional options (pagination, sorting, etc.)
   * @returns {Promise<Array<Object>>} - The found entities
   */
  async find(query, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Find one entity by query
   * @param {Object} query - The query criteria
   * @returns {Promise<Object|null>} - The found entity or null if not found
   */
  async findOne(query) {
    throw new Error('Method not implemented');
  }

  /**
   * Update an entity by ID
   * @param {string|number} id - The ID of the entity to update
   * @param {Object} data - The data to update the entity with
   * @returns {Promise<Object|null>} - The updated entity or null if not found
   */
  async updateById(id, data) {
    throw new Error('Method not implemented');
  }

  /**
   * Update entities by query
   * @param {Object} query - The query criteria
   * @param {Object} data - The data to update the entities with
   * @returns {Promise<number>} - The number of entities updated
   */
  async update(query, data) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete an entity by ID
   * @param {string|number} id - The ID of the entity to delete
   * @returns {Promise<boolean>} - Whether the entity was deleted
   */
  async deleteById(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete entities by query
   * @param {Object} query - The query criteria
   * @returns {Promise<number>} - The number of entities deleted
   */
  async delete(query) {
    throw new Error('Method not implemented');
  }

  /**
   * Count entities by query
   * @param {Object} query - The query criteria
   * @returns {Promise<number>} - The number of entities matching the query
   */
  async count(query) {
    throw new Error('Method not implemented');
  }
}

module.exports = Repository; 