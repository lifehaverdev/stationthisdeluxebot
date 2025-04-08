/**
 * Schema Registry Module
 * 
 * Provides functionality for registering, retrieving, and managing schemas
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');

/**
 * Registry for validation schemas
 */
class SchemaRegistry {
  /**
   * Create a new schema registry
   * @param {Object} options - Registry options
   * @param {Object} [options.schemas={}] - Initial schemas to register
   * @param {boolean} [options.allowOverwrite=false] - Whether to allow overwriting existing schemas
   */
  constructor(options = {}) {
    this.schemas = new Map();
    this.allowOverwrite = options.allowOverwrite || false;
    
    // Register initial schemas if provided
    if (options.schemas && typeof options.schemas === 'object') {
      for (const [id, schema] of Object.entries(options.schemas)) {
        this.register(id, schema, { skipValidation: true });
      }
    }
  }

  /**
   * Register a new schema
   * @param {string} id - Schema identifier
   * @param {Object} schema - Schema definition
   * @param {Object} [options={}] - Registration options
   * @param {boolean} [options.allowOverwrite] - Override default allowOverwrite setting
   * @param {boolean} [options.skipValidation] - Skip schema validation
   * @returns {Object} Registered schema
   */
  register(id, schema, options = {}) {
    if (!id || typeof id !== 'string') {
      throw new AppError('Schema ID must be a non-empty string', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_SCHEMA_ID'
      });
    }

    if (!schema || typeof schema !== 'object') {
      throw new AppError('Schema must be a non-null object', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_SCHEMA'
      });
    }

    // Check if schema already exists
    if (this.schemas.has(id)) {
      const allowOverwrite = options.allowOverwrite !== undefined 
        ? options.allowOverwrite 
        : this.allowOverwrite;
        
      if (!allowOverwrite) {
        throw new AppError(`Schema with ID '${id}' already exists`, {
          severity: ERROR_SEVERITY.ERROR,
          code: 'SCHEMA_ALREADY_EXISTS'
        });
      }
    }

    // Validate schema structure (basic check)
    if (!options.skipValidation) {
      this._validateSchemaStructure(schema);
    }

    // Set schema ID if not already present
    const finalSchema = { ...schema };
    if (!finalSchema.$id) {
      finalSchema.$id = id;
    }

    // Register the schema
    this.schemas.set(id, finalSchema);
    return finalSchema;
  }

  /**
   * Get a schema by ID
   * @param {string} id - Schema identifier
   * @returns {Object|null} Schema or null if not found
   */
  get(id) {
    if (!id || typeof id !== 'string') {
      return null;
    }
    
    // Handle URI fragments in $ref
    const normalizedId = id.startsWith('#/') ? id.slice(2) : id;
    
    return this.schemas.get(normalizedId) || null;
  }

  /**
   * Check if a schema exists
   * @param {string} id - Schema identifier
   * @returns {boolean} True if schema exists
   */
  has(id) {
    return this.schemas.has(id);
  }

  /**
   * Remove a schema
   * @param {string} id - Schema identifier
   * @returns {boolean} True if schema was removed
   */
  remove(id) {
    return this.schemas.delete(id);
  }

  /**
   * Get all registered schema IDs
   * @returns {Array<string>} Array of schema IDs
   */
  getIds() {
    return Array.from(this.schemas.keys());
  }

  /**
   * Get all registered schemas
   * @returns {Object} Map of all schemas
   */
  getAll() {
    const result = {};
    for (const [id, schema] of this.schemas.entries()) {
      result[id] = schema;
    }
    return result;
  }

  /**
   * Clear all schemas
   */
  clear() {
    this.schemas.clear();
  }

  /**
   * Resolve a schema reference
   * @param {string} ref - Schema reference ($ref)
   * @param {Object} rootSchema - Root schema containing the reference
   * @returns {Object|null} Resolved schema or null if not found
   */
  resolveRef(ref, rootSchema = null) {
    // Handle absolute references (full URIs)
    if (ref.match(/^https?:\/\//)) {
      // For now, we don't support fetching remote schemas
      return null;
    }
    
    // Handle local references within the same schema
    if (ref.startsWith('#/') && rootSchema) {
      return this._resolvePointer(ref.slice(2), rootSchema);
    }
    
    // Handle relative references to other schemas in the registry
    return this.get(ref);
  }

  /**
   * Validate basic schema structure
   * @param {Object} schema - Schema to validate
   * @private
   */
  _validateSchemaStructure(schema) {
    // Minimal validation - could be expanded to be more thorough
    if (schema.type && !['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'].includes(schema.type)) {
      throw new AppError(`Invalid schema type: ${schema.type}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_SCHEMA_TYPE'
      });
    }

    // Check items for array type
    if (schema.type === 'array' && schema.items && typeof schema.items !== 'object') {
      throw new AppError('Array items schema must be an object', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_SCHEMA_ITEMS'
      });
    }

    // Check properties for object type
    if (schema.type === 'object' && schema.properties && typeof schema.properties !== 'object') {
      throw new AppError('Object properties schema must be an object', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_SCHEMA_PROPERTIES'
      });
    }
  }

  /**
   * Resolve a JSON pointer within a schema
   * @param {string} pointer - JSON pointer (without the leading #/)
   * @param {Object} schema - Schema to resolve against
   * @returns {*} Resolved value or null if not found
   * @private
   */
  _resolvePointer(pointer, schema) {
    const parts = pointer.split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    
    let current = schema;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        return null;
      }
      
      current = current[part];
      if (current === undefined) {
        return null;
      }
    }
    
    return current;
  }
}

module.exports = {
  SchemaRegistry
}; 