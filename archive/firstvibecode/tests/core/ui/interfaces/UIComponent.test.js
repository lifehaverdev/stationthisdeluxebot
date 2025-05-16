/**
 * UIComponent Tests
 * 
 * Tests for the base UIComponent class
 */

const { describe, test, expect } = require('@jest/globals');
const { UIComponent } = require('../../../../src/core/ui/interfaces');

describe('UIComponent', () => {
  describe('constructor', () => {
    test('should create a component with default values', () => {
      const component = new UIComponent();
      
      expect(component.type).toBe('base');
      expect(component.props).toEqual({});
      expect(component.id).toBeDefined();
      expect(component.id).toMatch(/^ui-\d+-[a-z0-9]+$/);
      expect(component.metadata).toEqual({});
    });
    
    test('should create a component with provided values', () => {
      const props = { foo: 'bar' };
      const metadata = { test: true };
      const id = 'custom-id';
      
      const component = new UIComponent({ 
        ...props, 
        metadata, 
        id 
      });
      
      expect(component.props).toEqual(props);
      expect(component.metadata).toEqual(metadata);
      expect(component.id).toBe(id);
    });
  });
  
  describe('toJSON', () => {
    test('should serialize the component correctly', () => {
      const props = { value: 'test' };
      const metadata = { category: 'input' };
      const component = new UIComponent({ 
        ...props, 
        metadata 
      });
      component.type = 'custom';
      
      const json = component.toJSON();
      
      expect(json).toEqual({
        type: 'custom',
        id: component.id,
        props,
        metadata
      });
    });
  });
  
  describe('validate', () => {
    test('should return true for base implementation', () => {
      const component = new UIComponent();
      expect(component.validate()).toBe(true);
    });
  });
  
  describe('update', () => {
    test('should merge new props with existing props', () => {
      const component = new UIComponent({ 
        initial: 'value', 
        count: 1 
      });
      
      component.update({ count: 2, new: 'prop' });
      
      expect(component.props).toEqual({
        initial: 'value',
        count: 2,
        new: 'prop'
      });
    });
    
    test('should return the component instance for chaining', () => {
      const component = new UIComponent();
      const result = component.update({ test: true });
      
      expect(result).toBe(component);
    });
  });
}); 