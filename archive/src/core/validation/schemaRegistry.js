const { AppError } = require('../../utils/errors');

/**
 * Registry for storing and retrieving JSON Schemas
 */
class SchemaRegistry {
  constructor() {
    this.schemas = new Map();
  }

  /**
   * Add a schema to the registry
   * @param {string} name - Unique name for the schema
   * @param {object} schema - JSON Schema object
   * @throws {AppError} If name is invalid or schema already exists
   */
  addSchema(name, schema) {
    if (!name || typeof name !== 'string') {
      throw new AppError('INVALID_SCHEMA_NAME', 'Schema name must be a non-empty string');
    }

    if (!schema || typeof schema !== 'object') {
      throw new AppError('INVALID_SCHEMA', 'Schema must be a valid object');
    }

    if (this.schemas.has(name)) {
      throw new AppError('SCHEMA_EXISTS', `Schema with name '${name}' already exists`);
    }

    this.schemas.set(name, schema);
    return this;
  }

  /**
   * Get a schema by name
   * @param {string} name - Name of the schema
   * @returns {object} The schema object
   * @throws {AppError} If schema doesn't exist
   */
  getSchema(name) {
    if (!this.schemas.has(name)) {
      throw new AppError('SCHEMA_NOT_FOUND', `Schema with name '${name}' not found`);
    }
    return this.schemas.get(name);
  }

  /**
   * Check if a schema exists
   * @param {string} name - Name of the schema
   * @returns {boolean} True if schema exists
   */
  hasSchema(name) {
    return this.schemas.has(name);
  }

  /**
   * Remove a schema from the registry
   * @param {string} name - Name of the schema to remove
   * @returns {boolean} True if removed, false if not found
   */
  removeSchema(name) {
    return this.schemas.delete(name);
  }

  /**
   * Get all schema names
   * @returns {Array<string>} Array of schema names
   */
  getSchemaNames() {
    return Array.from(this.schemas.keys());
  }

  /**
   * Clear all schemas
   */
  clear() {
    this.schemas.clear();
  }

  /**
   * Get number of schemas
   * @returns {number} Number of schemas in registry
   */
  size() {
    return this.schemas.size;
  }
}

module.exports = { SchemaRegistry }; 