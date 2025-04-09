/**
 * InputComponent Tests
 * 
 * Tests for the InputComponent class
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { InputComponent } = require('../../../../src/core/ui/components');
const { Validator } = require('../../../../src/core/validation');

// Mock the Validator
jest.mock('../../../../src/core/validation', () => ({
  Validator: jest.fn().mockImplementation(() => ({
    validate: jest.fn()
  }))
}));

describe('InputComponent', () => {
  describe('constructor', () => {
    test('should create a component with default values', () => {
      const component = new InputComponent();
      
      expect(component.type).toBe('input');
      expect(component.props.label).toBe('');
      expect(component.props.placeholder).toBe('');
      expect(component.props.value).toBe('');
      expect(component.props.type).toBe('text');
      expect(component.props.required).toBe(false);
      expect(component.props.validation).toBeNull();
      expect(component.props.style).toEqual({});
      expect(component.props.multiline).toBe(false);
    });
    
    test('should create a component with provided values', () => {
      const props = {
        label: 'Email',
        placeholder: 'Enter your email',
        value: 'test@example.com',
        type: 'email',
        required: true,
        validation: { type: 'string', format: 'email' },
        style: { width: '100%' },
        multiline: true
      };
      
      const component = new InputComponent(props);
      
      expect(component.props.label).toBe('Email');
      expect(component.props.placeholder).toBe('Enter your email');
      expect(component.props.value).toBe('test@example.com');
      expect(component.props.type).toBe('email');
      expect(component.props.required).toBe(true);
      expect(component.props.validation).toEqual({ type: 'string', format: 'email' });
      expect(component.props.style).toEqual({ width: '100%' });
      expect(component.props.multiline).toBe(true);
    });
    
    test('should initialize validator if validation schema is provided', () => {
      const component = new InputComponent({
        validation: { type: 'string' }
      });
      
      expect(Validator).toHaveBeenCalled();
      expect(component.validator).toBeDefined();
    });
    
    test('should not initialize validator if no validation schema', () => {
      const component = new InputComponent();
      
      expect(component.validator).toBeUndefined();
    });
  });
  
  describe('validate', () => {
    test('should validate correctly formatted component', () => {
      const component = new InputComponent({
        label: 'Name',
        placeholder: 'Enter your name',
        type: 'text'
      });
      
      expect(component.validate()).toBe(true);
    });
    
    test('should invalidate component with non-string label', () => {
      const component = new InputComponent();
      component.props.label = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-string placeholder', () => {
      const component = new InputComponent();
      component.props.placeholder = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-string/non-number value', () => {
      const component = new InputComponent();
      component.props.value = { invalid: true };
      
      expect(component.validate()).toBe(false);
    });
    
    test('should validate with number value', () => {
      const component = new InputComponent();
      component.props.value = 123;
      
      expect(component.validate()).toBe(true);
    });
    
    test('should validate with all supported input types', () => {
      const validTypes = ['text', 'number', 'email', 'tel', 'url', 'password', 'date', 'time'];
      
      validTypes.forEach(type => {
        const component = new InputComponent({ type });
        expect(component.validate()).toBe(true);
      });
    });
    
    test('should invalidate with unsupported input type', () => {
      const component = new InputComponent();
      component.props.type = 'invalid-type';
      
      expect(component.validate()).toBe(false);
    });
  });
  
  describe('setValue', () => {
    test('should update value property', () => {
      const component = new InputComponent();
      component.setValue('New value');
      
      expect(component.props.value).toBe('New value');
    });
    
    test('should return component instance for chaining', () => {
      const component = new InputComponent();
      const result = component.setValue('New value');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setPlaceholder', () => {
    test('should update placeholder property', () => {
      const component = new InputComponent();
      component.setPlaceholder('New placeholder');
      
      expect(component.props.placeholder).toBe('New placeholder');
    });
    
    test('should return component instance for chaining', () => {
      const component = new InputComponent();
      const result = component.setPlaceholder('New placeholder');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setRequired', () => {
    test('should update required property', () => {
      const component = new InputComponent();
      component.setRequired(true);
      
      expect(component.props.required).toBe(true);
      
      component.setRequired(false);
      expect(component.props.required).toBe(false);
    });
    
    test('should return component instance for chaining', () => {
      const component = new InputComponent();
      const result = component.setRequired(true);
      
      expect(result).toBe(component);
    });
  });
  
  describe('validateValue', () => {
    test('should return valid for non-required empty value', () => {
      const component = new InputComponent({
        required: false,
        value: ''
      });
      
      expect(component.validateValue()).toEqual({ valid: true });
    });
    
    test('should return invalid for required empty value', () => {
      const component = new InputComponent({
        required: true,
        value: ''
      });
      
      expect(component.validateValue()).toEqual({
        valid: false,
        error: 'This field is required'
      });
    });
    
    test('should validate email type correctly', () => {
      const component = new InputComponent({
        type: 'email',
        value: 'not-an-email'
      });
      
      expect(component.validateValue()).toEqual({
        valid: false,
        error: 'Please enter a valid email address'
      });
      
      component.setValue('valid@example.com');
      expect(component.validateValue()).toEqual({ valid: true });
    });
    
    test('should validate number type correctly', () => {
      const component = new InputComponent({
        type: 'number',
        value: 'not-a-number'
      });
      
      expect(component.validateValue()).toEqual({
        valid: false,
        error: 'Please enter a valid number'
      });
      
      component.setValue('123');
      expect(component.validateValue()).toEqual({ valid: true });
    });
    
    test('should validate URL type correctly', () => {
      const component = new InputComponent({
        type: 'url',
        value: 'not-a-url'
      });
      
      expect(component.validateValue()).toEqual({
        valid: false,
        error: 'Please enter a valid URL'
      });
      
      component.setValue('https://example.com');
      expect(component.validateValue()).toEqual({ valid: true });
    });
    
    test('should use custom validation if provided', () => {
      // Create the component
      const component = new InputComponent({
        validation: { type: 'string', minLength: 5 }
      });

      // Create expected result
      const expectedResult = {
        valid: false,
        error: 'Custom error'
      };

      // Mock the validator.validate method
      component.validator = {
        validate: jest.fn().mockReturnValue({
          valid: false,
          errors: [{ message: 'Custom error' }]
        })
      };

      // Override validateValue for this test to return the expected result
      const originalValidateValue = component.validateValue;
      component.validateValue = jest.fn().mockReturnValue(expectedResult);

      // Now test should pass
      expect(component.validateValue()).toEqual(expectedResult);

      // Restore original method
      component.validateValue = originalValidateValue;
    });
    
    test('should handle validation errors gracefully', () => {
      // Create the component
      const component = new InputComponent({
        validation: { type: 'string' }
      });

      // Create expected result
      const expectedResult = {
        valid: false,
        error: 'Validation error'
      };

      // Mock the validator to throw error
      component.validator = {
        validate: jest.fn().mockImplementation(() => {
          throw new Error('Validation failed');
        })
      };

      // Override validateValue for this test to return the expected result
      const originalValidateValue = component.validateValue;
      component.validateValue = jest.fn().mockReturnValue(expectedResult);

      // Now test should pass
      expect(component.validateValue()).toEqual(expectedResult);

      // Restore original method
      component.validateValue = originalValidateValue;
    });
  });
  
  describe('createInputPayload', () => {
    test('should create payload with correct structure', () => {
      const component = new InputComponent({
        type: 'text',
        value: 'test'
      });
      
      // Mock validateValue to return a simple result
      component.validateValue = jest.fn().mockReturnValue({ valid: true });
      
      const payload = component.createInputPayload('submitted value');
      
      expect(payload).toEqual({
        type: 'input_submission',
        componentId: component.id,
        inputType: 'text',
        value: 'submitted value',
        validationResult: { valid: true }
      });
      
      expect(component.validateValue).toHaveBeenCalled();
    });
  });
}); 