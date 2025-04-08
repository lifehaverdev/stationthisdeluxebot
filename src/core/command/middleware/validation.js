/**
 * Command Validation Middleware
 * 
 * Provides validation for command parameters based on schema definitions.
 */

const { AppError, ERROR_SEVERITY } = require('../../shared/errors');

/**
 * Validate a value against a schema
 * @param {*} value - Value to validate
 * @param {Object} schema - Validation schema
 * @param {string} [path=''] - Current path (for nested validation)
 * @returns {Object|true} True if valid, error object if invalid
 */
function validateAgainstSchema(value, schema, path = '') {
  const displayPath = path ? path : 'value';
  
  // Check type
  if (schema.type) {
    const typeFn = getTypeValidator(schema.type);
    if (!typeFn(value)) {
      return {
        path: displayPath,
        message: `Expected ${displayPath} to be ${schema.type}`
      };
    }
  }
  
  // Required check
  if (schema.required && (value === undefined || value === null)) {
    return {
      path: displayPath,
      message: `${displayPath} is required`
    };
  }
  
  // Enum check
  if (schema.enum && Array.isArray(schema.enum) && value !== undefined && value !== null) {
    if (!schema.enum.includes(value)) {
      return {
        path: displayPath,
        message: `${displayPath} must be one of: ${schema.enum.join(', ')}`
      };
    }
  }
  
  // Min/max for numbers
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return {
        path: displayPath,
        message: `${displayPath} must be at least ${schema.minimum}`
      };
    }
    
    if (schema.maximum !== undefined && value > schema.maximum) {
      return {
        path: displayPath,
        message: `${displayPath} must be at most ${schema.maximum}`
      };
    }
  }
  
  // Min/max length for strings
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return {
        path: displayPath,
        message: `${displayPath} must be at least ${schema.minLength} characters`
      };
    }
    
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return {
        path: displayPath,
        message: `${displayPath} must be at most ${schema.maxLength} characters`
      };
    }
    
    // Pattern validation
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      return {
        path: displayPath,
        message: schema.patternMessage || `${displayPath} does not match the required pattern`
      };
    }
  }
  
  // Object properties validation
  if (schema.type === 'object' && typeof value === 'object' && value !== null && schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (value[propName] !== undefined || propSchema.required) {
        const propResult = validateAgainstSchema(
          value[propName], 
          propSchema, 
          path ? `${path}.${propName}` : propName
        );
        
        if (propResult !== true) {
          return propResult;
        }
      }
    }
  }
  
  // Array items validation
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const itemResult = validateAgainstSchema(
        value[i], 
        schema.items, 
        `${displayPath}[${i}]`
      );
      
      if (itemResult !== true) {
        return itemResult;
      }
    }
    
    // Min/max items for arrays
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return {
        path: displayPath,
        message: `${displayPath} must contain at least ${schema.minItems} items`
      };
    }
    
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return {
        path: displayPath,
        message: `${displayPath} must contain at most ${schema.maxItems} items`
      };
    }
  }
  
  // Custom validation function
  if (schema.validate && typeof schema.validate === 'function') {
    const customResult = schema.validate(value);
    if (customResult !== true) {
      return {
        path: displayPath,
        message: customResult || `Invalid ${displayPath}`
      };
    }
  }
  
  return true;
}

/**
 * Get a type validation function for a given type
 * @param {string} type - Type name
 * @returns {Function} Type validation function
 */
function getTypeValidator(type) {
  switch (type) {
    case 'string':
      return (v) => typeof v === 'string';
    case 'number':
      return (v) => typeof v === 'number' && !isNaN(v);
    case 'boolean':
      return (v) => typeof v === 'boolean';
    case 'array':
      return (v) => Array.isArray(v);
    case 'object':
      return (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'null':
      return (v) => v === null;
    case 'integer':
      return (v) => typeof v === 'number' && !isNaN(v) && Number.isInteger(v);
    default:
      return () => true; // No validation for unknown types
  }
}

/**
 * Create a validation middleware for command parameters
 * @param {Object} [options] - Middleware options
 * @returns {Function} Validation middleware
 */
function createValidationMiddleware(options = {}) {
  return async (context, next) => {
    const command = context.command;
    
    // Skip validation if command has no parameter schema
    if (!command.parameterSchema) {
      return next();
    }
    
    const parameters = context.parameters || {};
    const validationResult = validateAgainstSchema(parameters, command.parameterSchema, 'parameters');
    
    if (validationResult !== true) {
      throw new AppError(validationResult.message, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'PARAMETER_VALIDATION_FAILED',
        details: {
          validation: validationResult
        },
        userMessage: `Invalid parameter: ${validationResult.message}`
      });
    }
    
    return next();
  };
}

module.exports = {
  createValidationMiddleware,
  validateAgainstSchema
}; 