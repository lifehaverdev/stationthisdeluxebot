/**
 * ButtonComponent Tests
 * 
 * Tests for the ButtonComponent class
 */

const { describe, test, expect } = require('@jest/globals');
const { ButtonComponent } = require('../../../../src/core/ui/components');

describe('ButtonComponent', () => {
  describe('constructor', () => {
    test('should create a component with default values', () => {
      const component = new ButtonComponent();
      
      expect(component.type).toBe('button');
      expect(component.props.text).toBe('Button');
      expect(component.props.action).toBe('default');
      expect(component.props.data).toEqual({});
      expect(component.props.style).toBe('default');
      expect(component.props.disabled).toBe(false);
      expect(component.props.url).toBeUndefined();
      expect(component.props.actionId).toMatch(/^btn_\d+_[a-z0-9]+$/);
    });
    
    test('should create a component with provided values', () => {
      const props = {
        text: 'Click Me',
        action: 'submit',
        data: { id: 123 },
        style: 'primary',
        disabled: true,
        url: 'https://example.com',
        actionId: 'custom-action-id'
      };
      
      const component = new ButtonComponent(props);
      
      expect(component.props.text).toBe('Click Me');
      expect(component.props.action).toBe('submit');
      expect(component.props.data).toEqual({ id: 123 });
      expect(component.props.style).toBe('primary');
      expect(component.props.disabled).toBe(true);
      expect(component.props.url).toBe('https://example.com');
      expect(component.props.actionId).toBe('custom-action-id');
    });
  });
  
  describe('validate', () => {
    test('should validate correctly formatted component', () => {
      const component = new ButtonComponent({
        text: 'Valid Button',
        action: 'submit',
        actionId: 'test-id'
      });
      
      expect(component.validate()).toBe(true);
    });
    
    test('should invalidate component with non-string text', () => {
      const component = new ButtonComponent();
      component.props.text = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-string action', () => {
      const component = new ButtonComponent();
      component.props.action = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-string actionId', () => {
      const component = new ButtonComponent();
      component.props.actionId = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-string url', () => {
      const component = new ButtonComponent();
      component.props.url = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should validate component with undefined url', () => {
      const component = new ButtonComponent({
        url: undefined
      });
      
      expect(component.validate()).toBe(true);
    });
  });
  
  describe('setText', () => {
    test('should update text property', () => {
      const component = new ButtonComponent();
      component.setText('New Button Text');
      
      expect(component.props.text).toBe('New Button Text');
    });
    
    test('should return component instance for chaining', () => {
      const component = new ButtonComponent();
      const result = component.setText('New Button Text');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setAction', () => {
    test('should update action property', () => {
      const component = new ButtonComponent();
      component.setAction('confirm');
      
      expect(component.props.action).toBe('confirm');
    });
    
    test('should return component instance for chaining', () => {
      const component = new ButtonComponent();
      const result = component.setAction('confirm');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setStyle', () => {
    test('should update style property', () => {
      const component = new ButtonComponent();
      component.setStyle('danger');
      
      expect(component.props.style).toBe('danger');
    });
    
    test('should return component instance for chaining', () => {
      const component = new ButtonComponent();
      const result = component.setStyle('danger');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setDisabled', () => {
    test('should update disabled property', () => {
      const component = new ButtonComponent();
      component.setDisabled(true);
      
      expect(component.props.disabled).toBe(true);
      
      component.setDisabled(false);
      expect(component.props.disabled).toBe(false);
    });
    
    test('should return component instance for chaining', () => {
      const component = new ButtonComponent();
      const result = component.setDisabled(true);
      
      expect(result).toBe(component);
    });
  });
  
  describe('setUrl', () => {
    test('should update url property', () => {
      const component = new ButtonComponent();
      component.setUrl('https://example.com');
      
      expect(component.props.url).toBe('https://example.com');
    });
    
    test('should return component instance for chaining', () => {
      const component = new ButtonComponent();
      const result = component.setUrl('https://example.com');
      
      expect(result).toBe(component);
    });
  });
  
  describe('isLinkButton', () => {
    test('should return true if url is provided', () => {
      const component = new ButtonComponent({
        url: 'https://example.com'
      });
      
      expect(component.isLinkButton()).toBe(true);
    });
    
    test('should return false if url is not provided', () => {
      const component = new ButtonComponent();
      expect(component.isLinkButton()).toBe(false);
    });
    
    test('should return false if url is empty string', () => {
      const component = new ButtonComponent({
        url: ''
      });
      
      expect(component.isLinkButton()).toBe(false);
    });
  });
  
  describe('createActionPayload', () => {
    test('should create payload with correct structure', () => {
      const component = new ButtonComponent({
        action: 'submit',
        data: { id: 123 },
        actionId: 'test-action-id'
      });
      
      const payload = component.createActionPayload();
      
      expect(payload).toEqual({
        type: 'button_click',
        componentId: component.id,
        actionId: 'test-action-id',
        action: 'submit',
        data: { id: 123 }
      });
    });
  });
}); 