/**
 * Schema Module
 * 
 * Provides functionality for schema-based validation
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');

/**
 * Creates a validation error from validation results
 * @param {Object} validationResult - Result of validation
 * @returns {AppError} Formatted validation error
 */
function createValidationError(validationResult) {
  const errorMessage = Array.isArray(validationResult.errors) 
    ? validationResult.errors.join('; ') 
    : 'Validation failed';
    
  return new AppError(errorMessage, {
    severity: ERROR_SEVERITY.WARN,
    code: 'VALIDATION_ERROR',
    details: validationResult.errors
  });
}

/**
 * Validates data against a schema
 * @param {any} data - Data to validate
 * @param {Object} schema - Schema definition
 * @param {string} path - Current path for nested validation (for error reporting)
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with valid flag, errors and validated value
 */
function validateAgainstSchema(data, schema, path = '', options = {}) {
  const result = {
    valid: true,
    errors: [],
    value: data
  };

  // Handle null/undefined data
  if (data === null || data === undefined) {
    if (schema.required) {
      result.valid = false;
      result.errors.push(`${path || 'Value'} is required`);
      return result;
    }
    // If not required and null/undefined, it's valid
    return result;
  }

  // Type validation
  if (schema.type) {
    const typeValid = validateType(data, schema.type, options);
    if (!typeValid.valid) {
      result.valid = false;
      result.errors.push(`${path || 'Value'} ${typeValid.error}`);
      return result;
    }
    result.value = typeValid.value; // Use potentially coerced value
  }

  // Schema-specific validations
  switch (schema.type) {
    case 'object':
      return validateObject(result.value, schema, path, options);
    case 'array':
      return validateArray(result.value, schema, path, options);
    case 'string':
      return validateString(result.value, schema, path);
    case 'number':
    case 'integer':
      return validateNumber(result.value, schema, path);
    case 'boolean':
      return result; // Boolean validation is handled by type validation
    default:
      // Custom validation type or no type specified
      break;
  }

  // Format validation
  if (schema.format && typeof formatValidators[schema.format] === 'function') {
    const formatValid = formatValidators[schema.format](result.value);
    if (!formatValid) {
      result.valid = false;
      result.errors.push(`${path || 'Value'} must be a valid ${schema.format}`);
    }
  }

  // Custom validation function
  if (schema.validate && typeof schema.validate === 'function') {
    try {
      const customValid = schema.validate(result.value);
      if (customValid !== true) {
        result.valid = false;
        result.errors.push(`${path || 'Value'} ${customValid || 'failed custom validation'}`);
      }
    } catch (error) {
      result.valid = false;
      result.errors.push(`${path || 'Value'} validation error: ${error.message}`);
    }
  }

  // Enum validation
  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(result.value)) {
      result.valid = false;
      result.errors.push(`${path || 'Value'} must be one of: ${schema.enum.join(', ')}`);
    }
  }

  return result;
}

/**
 * Validates a value against a type definition
 * @param {any} value - Value to validate
 * @param {string} type - Type to validate against
 * @param {Object} options - Validation options
 * @returns {Object} Result object with valid flag, error message, and potentially coerced value
 * @private
 */
function validateType(value, type, options = {}) {
  const result = {
    valid: true,
    error: null,
    value
  };

  const actualType = Array.isArray(value) ? 'array' : typeof value;
  
  // Type matches directly
  if (actualType === type) {
    return result;
  }

  // Type coercion if enabled
  if (options.coerceTypes) {
    if (type === 'string' && (actualType === 'number' || actualType === 'boolean')) {
      result.value = String(value);
      return result;
    }
    
    if (type === 'number' && actualType === 'string' && !isNaN(Number(value))) {
      result.value = Number(value);
      return result;
    }
    
    if (type === 'integer' && actualType === 'string' && !isNaN(parseInt(value, 10))) {
      const num = Number(value);
      if (Number.isInteger(num)) {
        result.value = num;
        return result;
      }
    }
    
    if (type === 'boolean' && actualType === 'string') {
      if (value.toLowerCase() === 'true') {
        result.value = true;
        return result;
      }
      if (value.toLowerCase() === 'false') {
        result.value = false;
        return result;
      }
    }
  }

  // Handle special case where null is allowed
  if (value === null && schema.nullable) {
    return result;
  }

  result.valid = false;
  result.error = `must be of type ${type}, received ${actualType}`;
  return result;
}

/**
 * Validates an object against a schema
 * @param {Object} obj - Object to validate
 * @param {Object} schema - Schema definition
 * @param {string} path - Current path for nested validation
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 * @private
 */
function validateObject(obj, schema, path, options) {
  const result = {
    valid: true,
    errors: [],
    value: { ...obj } // Create a copy to avoid mutations
  };

  // Check required properties
  if (schema.required && Array.isArray(schema.required)) {
    for (const prop of schema.required) {
      if (obj[prop] === undefined) {
        result.valid = false;
        result.errors.push(`${path ? `${path}.${prop}` : prop} is required`);
      }
    }
  }

  // Validate properties
  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (obj[propName] !== undefined) {
        const propPath = path ? `${path}.${propName}` : propName;
        const propResult = validateAgainstSchema(obj[propName], propSchema, propPath, options);
        
        if (!propResult.valid) {
          result.valid = false;
          result.errors.push(...propResult.errors);
        } else {
          result.value[propName] = propResult.value;
        }
      }
    }
  }

  // Handle additional properties
  if (schema.additionalProperties === false) {
    const schemaProps = Object.keys(schema.properties || {});
    const extraProps = Object.keys(obj).filter(prop => !schemaProps.includes(prop));
    
    if (extraProps.length > 0) {
      result.valid = false;
      result.errors.push(`${path || 'Object'} has unexpected properties: ${extraProps.join(', ')}`);
    }
  } else if (typeof schema.additionalProperties === 'object') {
    const schemaProps = Object.keys(schema.properties || {});
    
    for (const [propName, propValue] of Object.entries(obj)) {
      if (!schemaProps.includes(propName)) {
        const propPath = path ? `${path}.${propName}` : propName;
        const propResult = validateAgainstSchema(propValue, schema.additionalProperties, propPath, options);
        
        if (!propResult.valid) {
          result.valid = false;
          result.errors.push(...propResult.errors);
        } else {
          result.value[propName] = propResult.value;
        }
      }
    }
  }

  return result;
}

/**
 * Validates an array against a schema
 * @param {Array} arr - Array to validate
 * @param {Object} schema - Schema definition
 * @param {string} path - Current path for nested validation
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 * @private
 */
function validateArray(arr, schema, path, options) {
  const result = {
    valid: true,
    errors: [],
    value: [...arr] // Create a copy to avoid mutations
  };

  // Check min/max items
  if (schema.minItems !== undefined && arr.length < schema.minItems) {
    result.valid = false;
    result.errors.push(`${path || 'Array'} must have at least ${schema.minItems} items`);
  }

  if (schema.maxItems !== undefined && arr.length > schema.maxItems) {
    result.valid = false;
    result.errors.push(`${path || 'Array'} must have no more than ${schema.maxItems} items`);
  }

  // Check unique items
  if (schema.uniqueItems && arr.length !== new Set(arr.map(JSON.stringify)).size) {
    result.valid = false;
    result.errors.push(`${path || 'Array'} must have unique items`);
  }

  // Validate items
  if (schema.items) {
    for (let i = 0; i < arr.length; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      const itemResult = validateAgainstSchema(arr[i], schema.items, itemPath, options);
      
      if (!itemResult.valid) {
        result.valid = false;
        result.errors.push(...itemResult.errors);
      } else {
        result.value[i] = itemResult.value;
      }
    }
  }

  return result;
}

/**
 * Validates a string against a schema
 * @param {string} str - String to validate
 * @param {Object} schema - Schema definition
 * @param {string} path - Current path for nested validation
 * @returns {Object} Validation result
 * @private
 */
function validateString(str, schema, path) {
  const result = {
    valid: true,
    errors: [],
    value: str
  };

  // Check min/max length
  if (schema.minLength !== undefined && str.length < schema.minLength) {
    result.valid = false;
    result.errors.push(`${path || 'String'} must be at least ${schema.minLength} characters long`);
  }

  if (schema.maxLength !== undefined && str.length > schema.maxLength) {
    result.valid = false;
    result.errors.push(`${path || 'String'} must be no more than ${schema.maxLength} characters long`);
  }

  // Check pattern
  if (schema.pattern) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(str)) {
      result.valid = false;
      result.errors.push(`${path || 'String'} must match pattern: ${schema.pattern}`);
    }
  }

  return result;
}

/**
 * Validates a number against a schema
 * @param {number} num - Number to validate
 * @param {Object} schema - Schema definition
 * @param {string} path - Current path for nested validation
 * @returns {Object} Validation result
 * @private
 */
function validateNumber(num, schema, path) {
  const result = {
    valid: true,
    errors: [],
    value: num
  };

  // Check if integer for integer type
  if (schema.type === 'integer' && !Number.isInteger(num)) {
    result.valid = false;
    result.errors.push(`${path || 'Number'} must be an integer`);
    return result;
  }

  // Check min/max
  if (schema.minimum !== undefined) {
    const valid = schema.exclusiveMinimum ? num > schema.minimum : num >= schema.minimum;
    if (!valid) {
      const operator = schema.exclusiveMinimum ? '>' : '>=';
      result.valid = false;
      result.errors.push(`${path || 'Number'} must be ${operator} ${schema.minimum}`);
    }
  }

  if (schema.maximum !== undefined) {
    const valid = schema.exclusiveMaximum ? num < schema.maximum : num <= schema.maximum;
    if (!valid) {
      const operator = schema.exclusiveMaximum ? '<' : '<=';
      result.valid = false;
      result.errors.push(`${path || 'Number'} must be ${operator} ${schema.maximum}`);
    }
  }

  // Check multipleOf
  if (schema.multipleOf !== undefined) {
    const remainder = num % schema.multipleOf;
    if (remainder !== 0 && Math.abs(remainder - schema.multipleOf) > Number.EPSILON) {
      result.valid = false;
      result.errors.push(`${path || 'Number'} must be a multiple of ${schema.multipleOf}`);
    }
  }

  return result;
}

/**
 * Format validators for common string formats
 */
const formatValidators = {
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  uri: (value) => {
    try {
      new URL(value);
      return true;
    } catch (e) {
      return false;
    }
  },
  'date-time': (value) => !isNaN(Date.parse(value)),
  date: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)),
  time: (value) => /^\d{2}:\d{2}(:\d{2})?$/.test(value),
  uuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  ipv4: (value) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(n => parseInt(n, 10) <= 255),
  ipv6: (value) => /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,6}:|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:)|fe80:(:[0-9a-f]{0,4}){0,4}%[0-9a-z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/i.test(value),
  hostname: (value) => /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(value),
  json: (value) => {
    try {
      JSON.parse(value);
      return true;
    } catch (e) {
      return false;
    }
  }
};

module.exports = {
  validateAgainstSchema,
  createValidationError,
  formatValidators
}; 