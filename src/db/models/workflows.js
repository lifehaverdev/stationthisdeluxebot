/**
 * Workflow Database Model
 * 
 * Provides database access for ComfyDeploy workflows.
 * Uses the MongoDB abstraction layer for database independence.
 */

const { getRepository } = require('../../core/shared/mongo');

/**
 * Workflow Repository
 * Manages workflow data storage
 */
class WorkflowRepository {
  constructor() {
    this.repository = getRepository('workflows');
  }

  /**
   * Find all workflows
   * @param {Object} query - Optional query parameters
   * @param {Object} options - Optional find options
   * @returns {Promise<Array>} Array of workflow documents
   */
  async findMany(query = {}, options = {}) {
    return this.repository.find(query, options);
  }

  /**
   * Find a single workflow document
   * @param {Object} query - Optional query parameters
   * @param {Object} options - Optional find options
   * @returns {Promise<Object|null>} Workflow document or null
   */
  async findOne(query = {}, options = {}) {
    return this.repository.findOne(query, options);
  }

  /**
   * Find workflow by ID
   * @param {string} id - Workflow document ID
   * @returns {Promise<Object|null>} Workflow document or null
   */
  async findById(id) {
    return this.repository.findById(id);
  }

  /**
   * Create a new workflow document
   * @param {Object} data - Workflow data to save
   * @returns {Promise<Object>} Created document with _id
   */
  async create(data) {
    return this.repository.create(data);
  }

  /**
   * Update a workflow document
   * @param {Object} query - Query to find document to update
   * @param {Object} data - Data to update
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Update result
   */
  async updateOne(query, data, options = {}) {
    return this.repository.updateOne(query, data, options);
  }

  /**
   * Delete a workflow document
   * @param {Object} query - Query to find document to delete
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteOne(query) {
    return this.repository.deleteOne(query);
  }

  /**
   * Check if workflow exists
   * @param {Object} query - Query to check existence
   * @returns {Promise<boolean>} Whether document exists
   */
  async exists(query) {
    return this.repository.exists(query);
  }

  /**
   * Get operation statistics
   * @returns {Object} Repository statistics
   */
  getStats() {
    return this.repository.getStats();
  }
}

module.exports = WorkflowRepository; 