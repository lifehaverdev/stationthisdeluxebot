# Validation Module

The validation module provides a simple but powerful way to validate data against JSON Schema-like
schemas. It includes support for schema registration, format validation, and type coercion.

## Key Components

### Validator

The `Validator` class is the main entry point for schema validation. It allows you to:

- Validate data against schemas
- Register schemas for reuse
- Coerce data to the expected types

```javascript
const { defaultValidator } = require('../../core/validation');

// Validate with schema object
const result = defaultValidator.validate('test', { type: 'string' });
console.log(result.valid); // true

// Register a schema for reuse
defaultValidator.registerSchema('user', {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer', minimum: 0 }
  },
  required: ['name']
});

// Validate against registered schema
const userResult = defaultValidator.validate({ name: 'John' }, 'user');
console.log(userResult.valid); // true

// Validate and throw error if invalid
try {
  const user = defaultValidator.validateThrow({ name: 123 }, 'user');
} catch (error) {
  console.error(error); // AppError: Validation failed
}

// Validate with type coercion
const coercedResult = defaultValidator.validate('123', { type: 'number' }, { coerce: true });
console.log(coercedResult.value); // 123 (as number)
```

### SchemaRegistry

The `SchemaRegistry` class manages schema storage and retrieval:

```javascript
const { SchemaRegistry } = require('../../core/validation');

// Create a new registry
const registry = new SchemaRegistry();

// Add a schema
registry.addSchema('user', {
  type: 'object',
  properties: {
    name: { type: 'string' }
  }
});

// Check if a schema exists
console.log(registry.hasSchema('user')); // true

// Get a schema
const userSchema = registry.getSchema('user');

// Get all schema names
const schemaNames = registry.getSchemaNames();

// Remove a schema
registry.removeSchema('user');

// Clear all schemas
registry.clear();
```

### FormatValidators

The `FormatValidators` class provides validation for format strings like email, URI, etc:

```javascript
const { FormatValidators } = require('../../core/validation');

// Create a new format validators instance
const formatValidators = new FormatValidators();

// Use a format validator
const emailValidator = formatValidators.getValidator('email');
console.log(emailValidator('user@example.com')); // true
console.log(emailValidator('invalid-email')); // false

// Add a custom format validator
formatValidators.addValidator('even-number', (value) => {
  return typeof value === 'number' && value % 2 === 0;
});

// Check if a validator exists
console.log(formatValidators.hasValidator('email')); // true

// Remove a validator
formatValidators.removeValidator('email');
```

## Supported Schema Features

The validator supports many JSON Schema features:

### Types

- `string`
- `number`
- `integer`
- `boolean`
- `array`
- `object`
- `null`

### String Constraints

- `minLength` - Minimum string length
- `maxLength` - Maximum string length
- `pattern` - Regular expression pattern
- `format` - Format validation (email, uri, etc.)

### Number Constraints

- `minimum` - Minimum value
- `maximum` - Maximum value
- `exclusiveMinimum` - Whether minimum is exclusive
- `exclusiveMaximum` - Whether maximum is exclusive
- `multipleOf` - Value must be a multiple of this

### Array Constraints

- `minItems` - Minimum array length
- `maxItems` - Maximum array length
- `uniqueItems` - Whether items must be unique
- `items` - Schema for items (single schema or array of schemas)
- `additionalItems` - Schema for additional items or false to disallow

### Object Constraints

- `required` - Array of required properties
- `properties` - Object mapping property names to schemas
- `minProperties` - Minimum number of properties
- `maxProperties` - Maximum number of properties
- `additionalProperties` - Schema for additional properties or false to disallow

### General Constraints

- `enum` - Value must be one of these values
- `const` - Value must equal this value

## Default Format Validators

- `email` - Validates email addresses
- `uri` - Validates URIs
- `date-time` - Validates ISO 8601 date-time strings
- `uuid` - Validates UUIDs
- `hostname` - Validates hostnames
- `ipv4` - Validates IPv4 addresses
- `ipv6` - Validates IPv6 addresses 