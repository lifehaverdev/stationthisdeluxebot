const { SchemaRegistry } = require('../schemaRegistry');
const { AppError } = require('../../../utils/errors');

describe('SchemaRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new SchemaRegistry();
  });

  describe('constructor', () => {
    it('should create an empty registry', () => {
      expect(registry.size()).toBe(0);
    });
  });

  describe('addSchema', () => {
    it('should add a schema to the registry', () => {
      const schema = { type: 'string' };
      
      registry.addSchema('test', schema);
      
      expect(registry.hasSchema('test')).toBe(true);
      expect(registry.getSchema('test')).toBe(schema);
    });

    it('should return the registry instance for chaining', () => {
      const schema = { type: 'string' };
      
      const result = registry.addSchema('test', schema);
      
      expect(result).toBe(registry);
    });

    it('should throw error for invalid schema name', () => {
      const schema = { type: 'string' };
      
      expect(() => registry.addSchema('', schema)).toThrow(AppError);
      expect(() => registry.addSchema(null, schema)).toThrow(AppError);
      expect(() => registry.addSchema(123, schema)).toThrow(AppError);
      
      expect(() => registry.addSchema('', schema)).toThrow('Schema name must be a non-empty string');
    });

    it('should throw error for invalid schema object', () => {
      expect(() => registry.addSchema('test', null)).toThrow(AppError);
      expect(() => registry.addSchema('test', 'not-an-object')).toThrow(AppError);
      
      expect(() => registry.addSchema('test', null)).toThrow('Schema must be a valid object');
    });

    it('should throw error when schema already exists', () => {
      const schema = { type: 'string' };
      
      registry.addSchema('test', schema);
      
      expect(() => registry.addSchema('test', schema)).toThrow(AppError);
      expect(() => registry.addSchema('test', schema)).toThrow("Schema with name 'test' already exists");
    });
  });

  describe('getSchema', () => {
    it('should return schema object for existing schema', () => {
      const schema = { type: 'string' };
      
      registry.addSchema('test', schema);
      
      expect(registry.getSchema('test')).toBe(schema);
    });

    it('should throw error for non-existing schema', () => {
      expect(() => registry.getSchema('non-existing')).toThrow(AppError);
      expect(() => registry.getSchema('non-existing')).toThrow("Schema with name 'non-existing' not found");
    });
  });

  describe('hasSchema', () => {
    it('should return true for existing schema', () => {
      const schema = { type: 'string' };
      
      registry.addSchema('test', schema);
      
      expect(registry.hasSchema('test')).toBe(true);
    });

    it('should return false for non-existing schema', () => {
      expect(registry.hasSchema('non-existing')).toBe(false);
    });
  });

  describe('removeSchema', () => {
    it('should remove existing schema', () => {
      const schema = { type: 'string' };
      
      registry.addSchema('test', schema);
      expect(registry.hasSchema('test')).toBe(true);
      
      const result = registry.removeSchema('test');
      
      expect(result).toBe(true);
      expect(registry.hasSchema('test')).toBe(false);
    });

    it('should return false for non-existing schema', () => {
      const result = registry.removeSchema('non-existing');
      
      expect(result).toBe(false);
    });
  });

  describe('getSchemaNames', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.getSchemaNames()).toEqual([]);
    });

    it('should return array of schema names', () => {
      registry.addSchema('test1', { type: 'string' });
      registry.addSchema('test2', { type: 'number' });
      
      const names = registry.getSchemaNames();
      
      expect(names).toHaveLength(2);
      expect(names).toContain('test1');
      expect(names).toContain('test2');
    });
  });

  describe('clear', () => {
    it('should remove all schemas', () => {
      registry.addSchema('test1', { type: 'string' });
      registry.addSchema('test2', { type: 'number' });
      
      expect(registry.size()).toBe(2);
      
      registry.clear();
      
      expect(registry.size()).toBe(0);
      expect(registry.hasSchema('test1')).toBe(false);
      expect(registry.hasSchema('test2')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return number of schemas in registry', () => {
      expect(registry.size()).toBe(0);
      
      registry.addSchema('test1', { type: 'string' });
      expect(registry.size()).toBe(1);
      
      registry.addSchema('test2', { type: 'number' });
      expect(registry.size()).toBe(2);
      
      registry.removeSchema('test1');
      expect(registry.size()).toBe(1);
    });
  });
}); 