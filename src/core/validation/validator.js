/**
 * Validator Module
 * 
 * Provides functionality for validating data against schemas stored in the registry
 */

const { AppError } = require('../../utils/errors');
const { SchemaRegistry } = require('./schemaRegistry');
const { FormatValidators } = require('./formatValidators');

/**
 * JSON Schema validator for data validation
 */
class Validator {
  /**
   * Create a new validator
   * @param {Object} options - Configuration options
   * @param {SchemaRegistry} [options.registry] - Schema registry to use
   * @param {FormatValidators} [options.formatValidators] - Format validators to use
   */
  constructor(options = {}) {
    this.registry = options.registry || new SchemaRegistry();
    this.formatValidators = options.formatValidators || new FormatValidators();
  }

  /**
   * Register a schema with the validator
   * @param {string} name - Schema name
   * @param {Object} schema - Schema object
   * @returns {Validator} This validator instance
   */
  registerSchema(name, schema) {
    this.registry.addSchema(name, schema);
    return this;
  }

  /**
   * Validate data against a schema
   * @param {*} data - Data to validate
   * @param {string|Object} schema - Schema name or schema object
   * @param {Object} options - Validation options
   * @param {boolean} [options.coerce=false] - Whether to coerce data types
   * @returns {Object} Validation result object { valid, errors, value }
   */
  validate(data, schema, options = {}) {
    const { coerce = false } = options;
    let schemaObj;
    
    try {
      // Get schema object if schema is a string (schema name)
      if (typeof schema === 'string') {
        schemaObj = this.registry.getSchema(schema);
      } else if (schema && typeof schema === 'object') {
        schemaObj = schema;
      } else {
        throw new AppError('INVALID_SCHEMA', 'Schema must be a string name or schema object');
      }
      
      // Prepare validation result
      const result = {
        valid: true,
        errors: [],
        value: data
      };
      
      // Coerce data if requested
      if (coerce) {
        result.value = this._coerceData(result.value, schemaObj);
      }
      
      // Validate data
      this._validateSchema(result.value, schemaObj, '', result.errors);
      
      // Update valid status based on errors
      result.valid = result.errors.length === 0;
      
      return result;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('VALIDATION_ERROR', `Validation failed: ${error.message}`);
    }
  }

  /**
   * Validate data against a schema and throw an error if invalid
   * @param {*} data - Data to validate
   * @param {string|Object} schema - Schema name or schema object
   * @param {Object} options - Validation options
   * @param {boolean} [options.coerce=false] - Whether to coerce data types
   * @returns {*} Validated (and possibly coerced) data
   * @throws {AppError} If validation fails
   */
  validateThrow(data, schema, options = {}) {
    const result = this.validate(data, schema, options);
    
    if (!result.valid) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', {
        errors: result.errors
      });
    }
    
    return result.value;
  }

  /**
   * Coerce data according to schema
   * @private
   * @param {*} data - Data to coerce
   * @param {Object} schema - Schema to use for coercion
   * @returns {*} Coerced data
   */
  _coerceData(data, schema) {
    if (data === null || data === undefined) {
      return data;
    }
    
    if (!schema.type) {
      return data;
    }
    
    switch (schema.type) {
      case 'string':
        return this._coerceString(data);
      
      case 'number':
      case 'integer':
        return this._coerceNumber(data, schema.type);
      
      case 'boolean':
        return this._coerceBoolean(data);
      
      case 'array':
        return this._coerceArray(data, schema);
      
      case 'object':
        return this._coerceObject(data, schema);
      
      default:
        return data;
    }
  }

  /**
   * Validate data against schema
   * @private
   * @param {*} data - Data to validate
   * @param {Object} schema - Schema to validate against
   * @param {string} path - Path to current data in the object
   * @param {Array} errors - Array to collect validation errors
   */
  _validateSchema(data, schema, path, errors) {
    // Check required
    if (schema.required === true && (data === undefined || data === null)) {
      errors.push({
        path,
        message: 'Value is required',
        code: 'REQUIRED'
      });
      return;
    }
    
    // Skip validation for null/undefined non-required values
    if (data === undefined || data === null) {
      return;
    }
    
    // Validate type
    if (schema.type) {
      this._validateType(data, schema.type, path, errors);
    }
    
    // Type-specific validation
    if (typeof data === 'string') {
      this._validateString(data, schema, path, errors);
    } else if (typeof data === 'number') {
      this._validateNumber(data, schema, path, errors);
    } else if (Array.isArray(data)) {
      this._validateArray(data, schema, path, errors);
    } else if (typeof data === 'object' && data !== null) {
      this._validateObject(data, schema, path, errors);
    }
    
    // Validate format
    if (schema.format && typeof data === 'string') {
      const validator = this.formatValidators.getValidator(schema.format);
      if (validator && !validator(data)) {
        errors.push({
          path,
          message: `Invalid format: ${schema.format}`,
          code: 'INVALID_FORMAT'
        });
      }
    }
    
    // Validate enum
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push({
        path,
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        code: 'ENUM_MISMATCH'
      });
    }
    
    // Validate const
    if (schema.const !== undefined && data !== schema.const) {
      errors.push({
        path,
        message: `Value must be ${JSON.stringify(schema.const)}`,
        code: 'CONST_MISMATCH'
      });
    }
  }

  /**
   * Validate data type
   * @private
   * @param {*} data - Data to validate
   * @param {string|Array} type - Expected type(s)
   * @param {string} path - Path to data
   * @param {Array} errors - Array to collect errors
   */
  _validateType(data, type, path, errors) {
    let valid = false;
    
    if (Array.isArray(type)) {
      valid = type.some(t => this._checkType(data, t));
    } else {
      valid = this._checkType(data, type);
    }
    
    if (!valid) {
      errors.push({
        path,
        message: `Invalid type: expected ${Array.isArray(type) ? type.join(' or ') : type}`,
        code: 'INVALID_TYPE'
      });
    }
  }

  /**
   * Check if data matches type
   * @private
   * @param {*} data - Data to check
   * @param {string} type - Type to check
   * @returns {boolean} True if data matches type
   */
  _checkType(data, type) {
    switch (type) {
      case 'string':
        return typeof data === 'string';
      case 'number':
        return typeof data === 'number' && !isNaN(data);
      case 'integer':
        return typeof data === 'number' && Number.isInteger(data) && !isNaN(data);
      case 'boolean':
        return typeof data === 'boolean';
      case 'array':
        return Array.isArray(data);
      case 'object':
        return typeof data === 'object' && data !== null && !Array.isArray(data);
      case 'null':
        return data === null;
      default:
        return false;
    }
  }

  /**
   * Validate string value
   * @private
   * @param {string} data - String to validate
   * @param {Object} schema - Schema constraints
   * @param {string} path - Path to data
   * @param {Array} errors - Array to collect errors
   */
  _validateString(data, schema, path, errors) {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path,
        message: `String too short (min: ${schema.minLength})`,
        code: 'MIN_LENGTH'
      });
    }
    
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path,
        message: `String too long (max: ${schema.maxLength})`,
        code: 'MAX_LENGTH'
      });
    }
    
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push({
        path,
        message: `String does not match pattern: ${schema.pattern}`,
        code: 'PATTERN_MISMATCH'
      });
    }
  }

  /**
   * Validate number value
   * @private
   * @param {number} data - Number to validate
   * @param {Object} schema - Schema constraints
   * @param {string} path - Path to data
   * @param {Array} errors - Array to collect errors
   */
  _validateNumber(data, schema, path, errors) {
    if (schema.minimum !== undefined) {
      if ((schema.exclusiveMinimum && data <= schema.minimum) || 
          (!schema.exclusiveMinimum && data < schema.minimum)) {
        errors.push({
          path,
          message: `Value ${data} ${schema.exclusiveMinimum ? 'must be greater than' : 'must be greater than or equal to'} ${schema.minimum}`,
          code: 'MINIMUM'
        });
      }
    }
    
    if (schema.maximum !== undefined) {
      if ((schema.exclusiveMaximum && data >= schema.maximum) ||
          (!schema.exclusiveMaximum && data > schema.maximum)) {
        errors.push({
          path,
          message: `Value ${data} ${schema.exclusiveMaximum ? 'must be less than' : 'must be less than or equal to'} ${schema.maximum}`,
          code: 'MAXIMUM'
        });
      }
    }
    
    if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
      // Check if the number is a multiple of the specified value
      const remainder = Math.abs(data) % schema.multipleOf;
      if (remainder > Number.EPSILON && remainder < schema.multipleOf - Number.EPSILON) {
        errors.push({
          path,
          message: `Value ${data} must be a multiple of ${schema.multipleOf}`,
          code: 'MULTIPLE_OF'
        });
      }
    }
  }

  /**
   * Validate array value
   * @private
   * @param {Array} data - Array to validate
   * @param {Object} schema - Schema constraints
   * @param {string} path - Path to data
   * @param {Array} errors - Array to collect errors
   */
  _validateArray(data, schema, path, errors) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path,
        message: `Array too short (min: ${schema.minItems})`,
        code: 'MIN_ITEMS'
      });
    }
    
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path,
        message: `Array too long (max: ${schema.maxItems})`,
        code: 'MAX_ITEMS'
      });
    }
    
    if (schema.uniqueItems && data.length > 1) {
      // Check for duplicate items
      const seen = new Set();
      const duplicates = [];
      
      for (let i = 0; i < data.length; i++) {
        const serialized = JSON.stringify(data[i]);
        if (seen.has(serialized)) {
          duplicates.push(i);
        } else {
          seen.add(serialized);
        }
      }
      
      if (duplicates.length > 0) {
        errors.push({
          path,
          message: 'Array items must be unique',
          code: 'UNIQUE_ITEMS',
          data: { duplicates }
        });
      }
    }
    
    // Validate items if schema specifies
    if (schema.items) {
      // Items could be a schema for all items or array of schemas for tuple validation
      if (Array.isArray(schema.items)) {
        // Tuple validation
        const minItems = Math.min(data.length, schema.items.length);
        
        for (let i = 0; i < minItems; i++) {
          this._validateSchema(
            data[i],
            schema.items[i],
            `${path}[${i}]`,
            errors
          );
        }
        
        // If additionalItems is false, then we should not have more items than schemas
        if (schema.additionalItems === false && data.length > schema.items.length) {
          errors.push({
            path,
            message: `Array has more items than allowed (${schema.items.length})`,
            code: 'ADDITIONAL_ITEMS'
          });
        } else if (typeof schema.additionalItems === 'object' && data.length > schema.items.length) {
          // Validate additional items against additionalItems schema
          for (let i = schema.items.length; i < data.length; i++) {
            this._validateSchema(
              data[i],
              schema.additionalItems,
              `${path}[${i}]`,
              errors
            );
          }
        }
      } else {
        // Validate each item against the same schema
        for (let i = 0; i < data.length; i++) {
          this._validateSchema(
            data[i],
            schema.items,
            `${path}[${i}]`,
            errors
          );
        }
      }
    }
  }

  /**
   * Validate object value
   * @private
   * @param {Object} data - Object to validate
   * @param {Object} schema - Schema constraints
   * @param {string} path - Path to data
   * @param {Array} errors - Array to collect errors
   */
  _validateObject(data, schema, path, errors) {
    // Validate required properties
    if (Array.isArray(schema.required)) {
      for (const prop of schema.required) {
        if (data[prop] === undefined) {
          errors.push({
            path: path ? `${path}.${prop}` : prop,
            message: `Missing required property: ${prop}`,
            code: 'REQUIRED_PROPERTY'
          });
        }
      }
    }
    
    // Check minimum/maximum properties
    const properties = Object.keys(data);
    
    if (schema.minProperties !== undefined && properties.length < schema.minProperties) {
      errors.push({
        path,
        message: `Object has too few properties, minimum ${schema.minProperties}`,
        code: 'MIN_PROPERTIES'
      });
    }
    
    if (schema.maxProperties !== undefined && properties.length > schema.maxProperties) {
      errors.push({
        path,
        message: `Object has too many properties, maximum ${schema.maxProperties}`,
        code: 'MAX_PROPERTIES'
      });
    }
    
    // Track properties that have been validated against specific schemas
    const validatedProps = new Set();
    
    // Validate properties
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (data[prop] !== undefined) {
          validatedProps.add(prop);
          this._validateSchema(
            data[prop],
            propSchema,
            path ? `${path}.${prop}` : prop,
            errors
          );
        }
      }
    }
    
    // Validate pattern properties
    if (schema.patternProperties) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        const regex = new RegExp(pattern);
        
        for (const prop of properties) {
          if (regex.test(prop)) {
            validatedProps.add(prop);
            this._validateSchema(
              data[prop],
              patternSchema,
              path ? `${path}.${prop}` : prop,
              errors
            );
          }
        }
      }
    }
    
    // Validate additional properties
    if (schema.additionalProperties !== undefined) {
      const unvalidatedProps = properties.filter(prop => !validatedProps.has(prop));
      
      if (schema.additionalProperties === false && unvalidatedProps.length > 0) {
        for (const prop of unvalidatedProps) {
          errors.push({
            path: path ? `${path}.${prop}` : prop,
            message: `Additional property ${prop} not allowed`,
            code: 'ADDITIONAL_PROPERTY'
          });
        }
      } else if (typeof schema.additionalProperties === 'object') {
        for (const prop of unvalidatedProps) {
          this._validateSchema(
            data[prop],
            schema.additionalProperties,
            path ? `${path}.${prop}` : prop,
            errors
          );
        }
      }
    }
  }

  /**
   * Coerce value to string
   * @private
   * @param {*} data - Data to coerce
   * @returns {string|*} Coerced value
   */
  _coerceString(data) {
    if (typeof data === 'string') {
      return data;
    }
    
    if (data === null || data === undefined) {
      return data;
    }
    
    return String(data);
  }

  /**
   * Coerce value to number or integer
   * @private
   * @param {*} data - Data to coerce
   * @param {string} type - 'number' or 'integer'
   * @returns {number|*} Coerced value
   */
  _coerceNumber(data, type) {
    if (typeof data === 'number') {
      return type === 'integer' ? Math.trunc(data) : data;
    }
    
    if (data === null || data === undefined || data === '') {
      return data;
    }
    
    const parsed = Number(data);
    
    if (isNaN(parsed)) {
      return data;
    }
    
    return type === 'integer' ? Math.trunc(parsed) : parsed;
  }

  /**
   * Coerce value to boolean
   * @private
   * @param {*} data - Data to coerce
   * @returns {boolean|*} Coerced value
   */
  _coerceBoolean(data) {
    if (typeof data === 'boolean') {
      return data;
    }
    
    if (data === null || data === undefined) {
      return data;
    }
    
    if (data === 'true' || data === '1' || data === 1) {
      return true;
    }
    
    if (data === 'false' || data === '0' || data === 0) {
      return false;
    }
    
    return Boolean(data);
  }

  /**
   * Coerce value to array
   * @private
   * @param {*} data - Data to coerce
   * @param {Object} schema - Schema object
   * @returns {Array|*} Coerced value
   */
  _coerceArray(data, schema) {
    if (Array.isArray(data)) {
      if (schema.items) {
        if (Array.isArray(schema.items)) {
          // Tuple validation - coerce each item using its respective schema
          return data.map((item, index) => {
            if (index < schema.items.length) {
              return this._coerceData(item, schema.items[index]);
            } else if (typeof schema.additionalItems === 'object') {
              return this._coerceData(item, schema.additionalItems);
            }
            return item;
          });
        } else {
          // Array validation - coerce all items using the same schema
          return data.map(item => this._coerceData(item, schema.items));
        }
      }
      return data;
    }
    
    if (data === null || data === undefined) {
      return data;
    }
    
    // Convert to array if possible
    const arr = [data];
    
    if (schema.items) {
      if (Array.isArray(schema.items) && schema.items.length > 0) {
        return [this._coerceData(data, schema.items[0])];
      } else if (typeof schema.items === 'object') {
        return [this._coerceData(data, schema.items)];
      }
    }
    
    return arr;
  }

  /**
   * Coerce value to object
   * @private
   * @param {*} data - Data to coerce
   * @param {Object} schema - Schema object
   * @returns {Object|*} Coerced value
   */
  _coerceObject(data, schema) {
    if (typeof data !== 'object' || data === null) {
      // Can't reasonably coerce non-objects
      return data;
    }
    
    const result = { ...data };
    
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (result[prop] !== undefined) {
          result[prop] = this._coerceData(result[prop], propSchema);
        }
      }
    }
    
    return result;
  }
}

module.exports = { Validator };