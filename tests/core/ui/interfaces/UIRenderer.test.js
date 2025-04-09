/**
 * UIRenderer Tests
 * 
 * Tests for the base UIRenderer interface
 */

const { describe, test, expect } = require('@jest/globals');
const { UIRenderer } = require('../../../../src/core/ui/interfaces');

describe('UIRenderer', () => {
  describe('constructor', () => {
    test('should create a renderer with default options', () => {
      const renderer = new UIRenderer();
      
      expect(renderer.options).toEqual({});
      expect(renderer.platform).toBe('generic');
    });
    
    test('should create a renderer with provided options', () => {
      const options = { theme: 'dark', debug: true };
      const renderer = new UIRenderer(options);
      
      expect(renderer.options).toEqual(options);
    });
  });
  
  describe('abstract methods', () => {
    const renderer = new UIRenderer();
    
    test('render should throw not implemented error', async () => {
      await expect(renderer.render({}, {}))
        .rejects
        .toThrow('Method "render" must be implemented by subclasses');
    });
    
    test('update should throw not implemented error', async () => {
      await expect(renderer.update({}, {}, {}))
        .rejects
        .toThrow('Method "update" must be implemented by subclasses');
    });
    
    test('processInput should throw not implemented error', async () => {
      await expect(renderer.processInput({}, {}, {}))
        .rejects
        .toThrow('Method "processInput" must be implemented by subclasses');
    });
    
    test('remove should throw not implemented error', async () => {
      await expect(renderer.remove({}, {}))
        .rejects
        .toThrow('Method "remove" must be implemented by subclasses');
    });
  });
  
  describe('supportsComponentType', () => {
    test('should return false for any component type in base implementation', () => {
      const renderer = new UIRenderer();
      expect(renderer.supportsComponentType('text')).toBe(false);
      expect(renderer.supportsComponentType('button')).toBe(false);
      expect(renderer.supportsComponentType('nonexistent')).toBe(false);
    });
  });
  
  describe('implementation', () => {
    test('should be possible to create a concrete renderer', () => {
      class TestRenderer extends UIRenderer {
        constructor(options) {
          super(options);
          this.platform = 'test';
        }
        
        async render() { return { rendered: true }; }
        async update() { return { updated: true }; }
        async processInput() { return { processed: true }; }
        async remove() { return true; }
        
        supportsComponentType(type) {
          return ['text', 'button'].includes(type);
        }
      }
      
      const renderer = new TestRenderer();
      expect(renderer.platform).toBe('test');
      expect(renderer.supportsComponentType('text')).toBe(true);
      expect(renderer.supportsComponentType('unknown')).toBe(false);
    });
  });
}); 