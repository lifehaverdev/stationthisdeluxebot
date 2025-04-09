/**
 * UIManager Tests
 * 
 * Tests for the UIManager class
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { UIManager, UIRenderer, UIComponent } = require('../../../../src/core/ui/interfaces');
const { AppError } = require('../../../../src/core/shared/errors');

// Mock component class
class MockComponent extends UIComponent {
  constructor(props = {}) {
    super(props);
    this.type = 'mock';
    this.validate = require('@jest/globals').jest.fn().mockReturnValue(true);
  }
}

// Mock renderer class
class MockRenderer extends UIRenderer {
  constructor(options = {}) {
    super(options);
    this.platform = 'mock';
    const jestGlobals = require('@jest/globals').jest;
    this.render = jestGlobals.fn().mockResolvedValue({ reference: 'rendered' });
    this.update = jestGlobals.fn().mockResolvedValue({ reference: 'updated' });
    this.processInput = jestGlobals.fn().mockResolvedValue({ result: 'processed' });
    this.remove = jestGlobals.fn().mockResolvedValue(true);
    this.supportsComponentType = jestGlobals.fn().mockReturnValue(true);
  }
}

describe('UIManager', () => {
  let manager;
  let renderer;
  let component;
  
  beforeEach(() => {
    manager = new UIManager();
    renderer = new MockRenderer();
    component = new MockComponent({ test: 'value' });
  });
  
  describe('constructor', () => {
    test('should create a manager with default options', () => {
      expect(manager.options).toEqual({});
      expect(manager.renderers).toBeInstanceOf(Map);
      expect(manager.componentRegistry).toBeInstanceOf(Map);
      expect(manager.renderCache).toBeInstanceOf(Map);
      expect(manager.defaultRenderer).toBeNull();
    });
    
    test('should create a manager with provided options', () => {
      const options = { debugging: true };
      const customManager = new UIManager(options);
      expect(customManager.options).toEqual(options);
    });
  });
  
  describe('registerRenderer', () => {
    test('should register a renderer for a platform', () => {
      manager.registerRenderer('mock', renderer);
      expect(manager.renderers.get('mock')).toBe(renderer);
    });
    
    test('should set the first registered renderer as default', () => {
      manager.registerRenderer('mock', renderer);
      expect(manager.defaultRenderer).toBe(renderer);
    });
    
    test('should set a renderer as default if specified', () => {
      const firstRenderer = new MockRenderer();
      const secondRenderer = new MockRenderer();
      
      manager.registerRenderer('first', firstRenderer);
      manager.registerRenderer('second', secondRenderer, true);
      
      expect(manager.defaultRenderer).toBe(secondRenderer);
    });
    
    test('should return the manager for chaining', () => {
      const result = manager.registerRenderer('mock', renderer);
      expect(result).toBe(manager);
    });
  });
  
  describe('registerComponent', () => {
    test('should register a component type', () => {
      manager.registerComponent('mock', MockComponent);
      expect(manager.componentRegistry.get('mock')).toBe(MockComponent);
    });
    
    test('should return the manager for chaining', () => {
      const result = manager.registerComponent('mock', MockComponent);
      expect(result).toBe(manager);
    });
  });
  
  describe('getRenderer', () => {
    test('should get a renderer for a platform', () => {
      manager.registerRenderer('mock', renderer);
      expect(manager.getRenderer('mock')).toBe(renderer);
    });
    
    test('should return the default renderer if platform not found', () => {
      manager.registerRenderer('mock', renderer);
      expect(manager.getRenderer('unknown')).toBe(renderer);
    });
    
    test('should throw if no renderer found and no default', () => {
      expect(() => manager.getRenderer('any'))
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('No renderer found for platform: any')
        }));
    });
  });
  
  describe('createComponent', () => {
    test('should create a component of the registered type', () => {
      manager.registerComponent('mock', MockComponent);
      const props = { test: 'value' };
      const component = manager.createComponent('mock', props);
      
      expect(component).toBeInstanceOf(MockComponent);
      expect(component.props).toEqual(props);
    });
    
    test('should throw if component type not registered', () => {
      expect(() => manager.createComponent('unknown'))
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('Component type not registered: unknown')
        }));
    });
  });
  
  describe('render', () => {
    beforeEach(() => {
      manager.registerRenderer('mock', renderer);
      manager.registerComponent('mock', MockComponent);
    });
    
    test('should render a component instance', async () => {
      const context = { userId: '123' };
      const result = await manager.render(component, {}, 'mock', context);
      
      expect(result).toEqual({ reference: 'rendered' });
      expect(renderer.render).toHaveBeenCalledWith(component, context);
      expect(manager.renderCache.get(component.id)).toBeDefined();
    });
    
    test('should create and render from component type', async () => {
      const props = { value: 'test' };
      const context = { userId: '123' };
      const result = await manager.render('mock', props, 'mock', context);
      
      expect(result).toEqual({ reference: 'rendered' });
      expect(renderer.render).toHaveBeenCalled();
      
      const renderCall = renderer.render.mock.calls[0];
      expect(renderCall[0]).toBeInstanceOf(MockComponent);
      expect(renderCall[0].props).toEqual(props);
      expect(renderCall[1]).toBe(context);
    });
    
    test('should validate the component before rendering', async () => {
      component.validate.mockReturnValueOnce(false);
      
      await expect(manager.render(component, {}, 'mock', {}))
        .rejects
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('Invalid component configuration')
        }));
        
      expect(renderer.render).not.toHaveBeenCalled();
    });
    
    test('should check if renderer supports the component type', async () => {
      renderer.supportsComponentType.mockReturnValueOnce(false);
      
      await expect(manager.render(component, {}, 'mock', {}))
        .rejects
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('does not support component type')
        }));
        
      expect(renderer.render).not.toHaveBeenCalled();
    });
  });
  
  describe('update', () => {
    beforeEach(() => {
      manager.registerRenderer('mock', renderer);
      // Setup render cache
      manager.renderCache.set(component.id, {
        component,
        platform: 'mock',
        renderReference: { reference: 'original' },
        context: { original: true }
      });
    });
    
    test('should update a rendered component', async () => {
      const newProps = { updated: true };
      const result = await manager.update(component.id, newProps);
      
      expect(result).toEqual({ reference: 'updated' });
      expect(component.props.updated).toBe(true);
      expect(renderer.update).toHaveBeenCalledWith(
        component,
        { reference: 'original' },
        { original: true }
      );
    });
    
    test('should throw if component not found in render cache', async () => {
      await expect(manager.update('unknown-id', {}))
        .rejects
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('Component not found in render cache')
        }));
        
      expect(renderer.update).not.toHaveBeenCalled();
    });
    
    test('should validate the updated component', async () => {
      component.validate.mockReturnValueOnce(false);
      
      await expect(manager.update(component.id, {}))
        .rejects
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('Invalid component configuration after update')
        }));
        
      expect(renderer.update).not.toHaveBeenCalled();
    });
  });
  
  describe('processInput', () => {
    beforeEach(() => {
      manager.registerRenderer('mock', renderer);
      // Setup render cache
      manager.renderCache.set(component.id, {
        component,
        platform: 'mock',
        renderReference: { reference: 'original' },
        context: { original: true }
      });
    });
    
    test('should process input for a rendered component', async () => {
      const input = { type: 'click' };
      const additionalContext = { userId: '123' };
      const result = await manager.processInput(component.id, input, additionalContext);
      
      expect(result).toEqual({ result: 'processed' });
      expect(renderer.processInput).toHaveBeenCalledWith(
        input,
        component,
        { original: true, userId: '123' }
      );
    });
    
    test('should throw if component not found in render cache', async () => {
      await expect(manager.processInput('unknown-id', {}))
        .rejects
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('Component not found in render cache')
        }));
        
      expect(renderer.processInput).not.toHaveBeenCalled();
    });
  });
  
  describe('remove', () => {
    beforeEach(() => {
      manager.registerRenderer('mock', renderer);
      // Setup render cache
      manager.renderCache.set(component.id, {
        component,
        platform: 'mock',
        renderReference: { reference: 'original' },
        context: { original: true }
      });
    });
    
    test('should remove a rendered component', async () => {
      const result = await manager.remove(component.id);
      
      expect(result).toBe(true);
      expect(renderer.remove).toHaveBeenCalledWith(
        { reference: 'original' },
        { original: true }
      );
      expect(manager.renderCache.has(component.id)).toBe(false);
    });
    
    test('should not remove from cache if renderer returns false', async () => {
      renderer.remove.mockResolvedValueOnce(false);
      const result = await manager.remove(component.id);
      
      expect(result).toBe(false);
      expect(renderer.remove).toHaveBeenCalled();
      expect(manager.renderCache.has(component.id)).toBe(true);
    });
    
    test('should throw if component not found in render cache', async () => {
      await expect(manager.remove('unknown-id'))
        .rejects
        .toThrow(expect.objectContaining({
          message: expect.stringContaining('Component not found in render cache')
        }));
        
      expect(renderer.remove).not.toHaveBeenCalled();
    });
  });
}); 