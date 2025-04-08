const { Validator } = require('../validator');
const { SchemaRegistry } = require('../schemaRegistry');
const { FormatValidators } = require('../formatValidators');
const { AppError } = require('../../../utils/errors');

describe('Validator', () => {
  let validator;
  let registry;
  let formatValidators;

  beforeEach(() => {
    registry = new SchemaRegistry();
    formatValidators = new FormatValidators();
    validator = new Validator({ registry, formatValidators });
  });

  describe('constructor', () => {
    it('should create validator with default dependencies if not provided', () => {
      const defaultValidator = new Validator();
      expect(defaultValidator.registry).toBeInstanceOf(SchemaRegistry);
      expect(defaultValidator.formatValidators).toBeInstanceOf(FormatValidators);
    });

    it('should use provided dependencies when passed', () => {
      expect(validator.registry).toBe(registry);
      expect(validator.formatValidators).toBe(formatValidators);
    });
  });

  describe('registerSchema', () => {
    it('should register schema with registry', () => {
      const schema = { type: 'string' };
      const spy = jest.spyOn(registry, 'addSchema');
      
      validator.registerSchema('test', schema);
      
      expect(spy).toHaveBeenCalledWith('test', schema);
    });

    it('should return validator instance for chaining', () => {
      const schema = { type: 'string' };
      
      const result = validator.registerSchema('test', schema);
      
      expect(result).toBe(validator);
    });
  });

  describe('validate', () => {
    it('should validate data against schema object', () => {
      const schema = { type: 'string' };
      
      const result = validator.validate('test', schema);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.value).toBe('test');
    });

    it('should validate data against schema name', () => {
      const schema = { type: 'string' };
      registry.addSchema('string', schema);
      
      const result = validator.validate('test', 'string');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.value).toBe('test');
    });

    it('should return validation errors for invalid data', () => {
      const schema = { type: 'string' };
      
      const result = validator.validate(123, schema);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].code).toBe('INVALID_TYPE');
      expect(result.value).toBe(123);
    });

    it('should throw error for invalid schema name', () => {
      expect(() => validator.validate('test', 'non-existent')).toThrow(AppError);
    });

    it('should throw error for invalid schema parameter', () => {
      expect(() => validator.validate('test', null)).toThrow(AppError);
      expect(() => validator.validate('test', 123)).toThrow(AppError);
    });

    it('should coerce data when coerce option is true', () => {
      const schema = { type: 'number' };
      
      const result = validator.validate('123', schema, { coerce: true });
      
      expect(result.valid).toBe(true);
      expect(result.value).toBe(123);
    });
  });

  describe('validateThrow', () => {
    it('should return validated data when valid', () => {
      const schema = { type: 'string' };
      
      const result = validator.validateThrow('test', schema);
      
      expect(result).toBe('test');
    });

    it('should throw error when data is invalid', () => {
      const schema = { type: 'string' };
      
      expect(() => validator.validateThrow(123, schema)).toThrow(AppError);
      expect(() => validator.validateThrow(123, schema)).toThrow('Validation failed');
    });

    it('should coerce data when coerce option is true', () => {
      const schema = { type: 'number' };
      
      const result = validator.validateThrow('123', schema, { coerce: true });
      
      expect(result).toBe(123);
    });
  });

  describe('type validation', () => {
    it('should validate string type', () => {
      const schema = { type: 'string' };
      
      expect(validator.validate('test', schema).valid).toBe(true);
      expect(validator.validate(123, schema).valid).toBe(false);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate number type', () => {
      const schema = { type: 'number' };
      
      expect(validator.validate(123, schema).valid).toBe(true);
      expect(validator.validate(123.45, schema).valid).toBe(true);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate integer type', () => {
      const schema = { type: 'integer' };
      
      expect(validator.validate(123, schema).valid).toBe(true);
      expect(validator.validate(123.45, schema).valid).toBe(false);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate boolean type', () => {
      const schema = { type: 'boolean' };
      
      expect(validator.validate(true, schema).valid).toBe(true);
      expect(validator.validate(false, schema).valid).toBe(true);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate(123, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate array type', () => {
      const schema = { type: 'array' };
      
      expect(validator.validate([], schema).valid).toBe(true);
      expect(validator.validate([1, 2, 3], schema).valid).toBe(true);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate(123, schema).valid).toBe(false);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
    });

    it('should validate object type', () => {
      const schema = { type: 'object' };
      
      expect(validator.validate({}, schema).valid).toBe(true);
      expect(validator.validate({ prop: 'value' }, schema).valid).toBe(true);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate(123, schema).valid).toBe(false);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate null type', () => {
      const schema = { type: 'null' };
      
      expect(validator.validate(null, schema).valid).toBe(true);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate(123, schema).valid).toBe(false);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate data against array of types', () => {
      const schema = { type: ['string', 'number'] };
      
      expect(validator.validate('test', schema).valid).toBe(true);
      expect(validator.validate(123, schema).valid).toBe(true);
      expect(validator.validate(true, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });
  });

  describe('string validation', () => {
    it('should validate minLength constraint', () => {
      const schema = { type: 'string', minLength: 3 };
      
      expect(validator.validate('test', schema).valid).toBe(true);
      expect(validator.validate('ab', schema).valid).toBe(false);
    });

    it('should validate maxLength constraint', () => {
      const schema = { type: 'string', maxLength: 5 };
      
      expect(validator.validate('test', schema).valid).toBe(true);
      expect(validator.validate('too long', schema).valid).toBe(false);
    });

    it('should validate pattern constraint', () => {
      const schema = { type: 'string', pattern: '^[A-Z][a-z]+$' };
      
      expect(validator.validate('Test', schema).valid).toBe(true);
      expect(validator.validate('test', schema).valid).toBe(false);
      expect(validator.validate('TEST', schema).valid).toBe(false);
    });
  });

  describe('number validation', () => {
    it('should validate minimum constraint', () => {
      const schema = { type: 'number', minimum: 5 };
      
      expect(validator.validate(10, schema).valid).toBe(true);
      expect(validator.validate(5, schema).valid).toBe(true);
      expect(validator.validate(4, schema).valid).toBe(false);
    });

    it('should validate exclusiveMinimum constraint', () => {
      const schema = { type: 'number', minimum: 5, exclusiveMinimum: true };
      
      expect(validator.validate(10, schema).valid).toBe(true);
      expect(validator.validate(5, schema).valid).toBe(false);
      expect(validator.validate(4, schema).valid).toBe(false);
    });

    it('should validate maximum constraint', () => {
      const schema = { type: 'number', maximum: 10 };
      
      expect(validator.validate(5, schema).valid).toBe(true);
      expect(validator.validate(10, schema).valid).toBe(true);
      expect(validator.validate(11, schema).valid).toBe(false);
    });

    it('should validate exclusiveMaximum constraint', () => {
      const schema = { type: 'number', maximum: 10, exclusiveMaximum: true };
      
      expect(validator.validate(5, schema).valid).toBe(true);
      expect(validator.validate(10, schema).valid).toBe(false);
      expect(validator.validate(11, schema).valid).toBe(false);
    });

    it('should validate multipleOf constraint', () => {
      const schema = { type: 'number', multipleOf: 5 };
      
      expect(validator.validate(10, schema).valid).toBe(true);
      expect(validator.validate(15, schema).valid).toBe(true);
      expect(validator.validate(12, schema).valid).toBe(false);
    });
  });

  describe('array validation', () => {
    it('should validate minItems constraint', () => {
      const schema = { type: 'array', minItems: 2 };
      
      expect(validator.validate([1, 2], schema).valid).toBe(true);
      expect(validator.validate([1, 2, 3], schema).valid).toBe(true);
      expect(validator.validate([1], schema).valid).toBe(false);
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it('should validate maxItems constraint', () => {
      const schema = { type: 'array', maxItems: 3 };
      
      expect(validator.validate([], schema).valid).toBe(true);
      expect(validator.validate([1, 2, 3], schema).valid).toBe(true);
      expect(validator.validate([1, 2, 3, 4], schema).valid).toBe(false);
    });

    it('should validate uniqueItems constraint', () => {
      const schema = { type: 'array', uniqueItems: true };
      
      expect(validator.validate([1, 2, 3], schema).valid).toBe(true);
      expect(validator.validate([1, 2, 2], schema).valid).toBe(false);
      expect(validator.validate([{ a: 1 }, { b: 2 }], schema).valid).toBe(true);
      expect(validator.validate([{ a: 1 }, { a: 1 }], schema).valid).toBe(false);
    });

    it('should validate items constraint with schema', () => {
      const schema = { 
        type: 'array', 
        items: { type: 'string' } 
      };
      
      expect(validator.validate(['a', 'b', 'c'], schema).valid).toBe(true);
      expect(validator.validate(['a', 1, 'c'], schema).valid).toBe(false);
    });

    it('should validate items constraint with array of schemas (tuple validation)', () => {
      const schema = { 
        type: 'array', 
        items: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' }
        ]
      };
      
      expect(validator.validate(['a', 1, true], schema).valid).toBe(true);
      expect(validator.validate(['a', 'b', true], schema).valid).toBe(false);
      expect(validator.validate(['a', 1, 'c'], schema).valid).toBe(false);
    });

    it('should validate additionalItems constraint', () => {
      const schema = { 
        type: 'array', 
        items: [
          { type: 'string' },
          { type: 'number' }
        ],
        additionalItems: false
      };
      
      expect(validator.validate(['a', 1], schema).valid).toBe(true);
      expect(validator.validate(['a'], schema).valid).toBe(true);
      expect(validator.validate(['a', 1, true], schema).valid).toBe(false);
    });
  });

  describe('object validation', () => {
    it('should validate required properties', () => {
      const schema = { 
        type: 'object', 
        required: ['name', 'age'] 
      };
      
      expect(validator.validate({ name: 'John', age: 30 }, schema).valid).toBe(true);
      expect(validator.validate({ name: 'John', age: 30, extra: 'value' }, schema).valid).toBe(true);
      expect(validator.validate({ name: 'John' }, schema).valid).toBe(false);
      expect(validator.validate({ age: 30 }, schema).valid).toBe(false);
    });

    it('should validate properties constraint', () => {
      const schema = { 
        type: 'object', 
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        }
      };
      
      expect(validator.validate({ name: 'John', age: 30 }, schema).valid).toBe(true);
      expect(validator.validate({ name: 'John', age: '30' }, schema).valid).toBe(false);
      expect(validator.validate({ name: 123, age: 30 }, schema).valid).toBe(false);
    });

    it('should validate minProperties constraint', () => {
      const schema = { 
        type: 'object', 
        minProperties: 2 
      };
      
      expect(validator.validate({ a: 1, b: 2 }, schema).valid).toBe(true);
      expect(validator.validate({ a: 1, b: 2, c: 3 }, schema).valid).toBe(true);
      expect(validator.validate({ a: 1 }, schema).valid).toBe(false);
      expect(validator.validate({}, schema).valid).toBe(false);
    });

    it('should validate maxProperties constraint', () => {
      const schema = { 
        type: 'object', 
        maxProperties: 2 
      };
      
      expect(validator.validate({}, schema).valid).toBe(true);
      expect(validator.validate({ a: 1 }, schema).valid).toBe(true);
      expect(validator.validate({ a: 1, b: 2 }, schema).valid).toBe(true);
      expect(validator.validate({ a: 1, b: 2, c: 3 }, schema).valid).toBe(false);
    });

    it('should validate additionalProperties constraint', () => {
      const schema = { 
        type: 'object', 
        properties: {
          name: { type: 'string' }
        },
        additionalProperties: false
      };
      
      expect(validator.validate({ name: 'John' }, schema).valid).toBe(true);
      expect(validator.validate({ name: 'John', age: 30 }, schema).valid).toBe(false);
    });

    it('should validate additionalProperties with schema', () => {
      const schema = { 
        type: 'object', 
        properties: {
          name: { type: 'string' }
        },
        additionalProperties: { type: 'number' }
      };
      
      expect(validator.validate({ name: 'John' }, schema).valid).toBe(true);
      expect(validator.validate({ name: 'John', age: 30 }, schema).valid).toBe(true);
      expect(validator.validate({ name: 'John', age: '30' }, schema).valid).toBe(false);
    });
  });

  describe('format validation', () => {
    it('should validate format constraint', () => {
      const schema = { type: 'string', format: 'email' };
      
      expect(validator.validate('user@example.com', schema).valid).toBe(true);
      expect(validator.validate('invalid-email', schema).valid).toBe(false);
    });

    it('should ignore format constraint if format is not registered', () => {
      const schema = { type: 'string', format: 'custom-format' };
      
      expect(validator.validate('any-value', schema).valid).toBe(true);
    });
  });

  describe('enum validation', () => {
    it('should validate enum constraint', () => {
      const schema = { 
        enum: ['red', 'green', 'blue'] 
      };
      
      expect(validator.validate('red', schema).valid).toBe(true);
      expect(validator.validate('green', schema).valid).toBe(true);
      expect(validator.validate('blue', schema).valid).toBe(true);
      expect(validator.validate('yellow', schema).valid).toBe(false);
    });
  });

  describe('const validation', () => {
    it('should validate const constraint', () => {
      const schema = { 
        const: 'fixed-value' 
      };
      
      expect(validator.validate('fixed-value', schema).valid).toBe(true);
      expect(validator.validate('other-value', schema).valid).toBe(false);
    });
  });

  describe('data coercion', () => {
    it('should coerce string values', () => {
      const schema = { type: 'string' };
      
      expect(validator.validate(123, schema, { coerce: true }).value).toBe('123');
      expect(validator.validate(true, schema, { coerce: true }).value).toBe('true');
      expect(validator.validate(null, schema, { coerce: true }).value).toBe(null);
    });

    it('should coerce number values', () => {
      const schema = { type: 'number' };
      
      expect(validator.validate('123', schema, { coerce: true }).value).toBe(123);
      expect(validator.validate('123.45', schema, { coerce: true }).value).toBe(123.45);
      expect(validator.validate(true, schema, { coerce: true }).value).toBe(1);
      expect(validator.validate(false, schema, { coerce: true }).value).toBe(0);
      expect(validator.validate('not-a-number', schema, { coerce: true }).value).toBe('not-a-number');
    });

    it('should coerce integer values', () => {
      const schema = { type: 'integer' };
      
      expect(validator.validate('123', schema, { coerce: true }).value).toBe(123);
      expect(validator.validate('123.45', schema, { coerce: true }).value).toBe(123);
      expect(validator.validate(123.45, schema, { coerce: true }).value).toBe(123);
    });

    it('should coerce boolean values', () => {
      const schema = { type: 'boolean' };
      
      expect(validator.validate('true', schema, { coerce: true }).value).toBe(true);
      expect(validator.validate('false', schema, { coerce: true }).value).toBe(false);
      expect(validator.validate('1', schema, { coerce: true }).value).toBe(true);
      expect(validator.validate('0', schema, { coerce: true }).value).toBe(false);
      expect(validator.validate(1, schema, { coerce: true }).value).toBe(true);
      expect(validator.validate(0, schema, { coerce: true }).value).toBe(false);
    });

    it('should coerce array values', () => {
      const schema = { type: 'array' };
      
      expect(validator.validate('value', schema, { coerce: true }).value).toEqual(['value']);
      
      const arrayItemsSchema = { 
        type: 'array',
        items: { type: 'number' }
      };
      
      const result = validator.validate(['1', '2', '3'], arrayItemsSchema, { coerce: true });
      expect(result.value).toEqual([1, 2, 3]);
    });

    it('should coerce object values', () => {
      const schema = { 
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        }
      };
      
      const result = validator.validate({ name: 123, age: '30' }, schema, { coerce: true });
      expect(result.value).toEqual({ name: '123', age: 30 });
    });
  });
}); 