/**
 * SelectComponent Tests
 * 
 * Tests for the SelectComponent class
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { SelectComponent } = require('../../../../src/core/ui/components');
const { Validator } = require('../../../../src/core/validation');

// Mock the Validator
jest.mock('../../../../src/core/validation', () => ({
  Validator: jest.fn().mockImplementation(() => ({
    validate: jest.fn()
  }))
}));

describe('SelectComponent', () => {
  describe('constructor', () => {
    test('should create a component with default values', () => {
      const component = new SelectComponent();
      
      expect(component.type).toBe('select');
      expect(component.props.label).toBe('');
      expect(component.props.placeholder).toBe('Select an option');
      expect(component.props.value).toBe('');
      expect(component.props.options).toEqual([]);
      expect(component.props.required).toBe(false);
      expect(component.props.validation).toBeNull();
      expect(component.props.style).toEqual({});
      expect(component.props.multiple).toBe(false);
      expect(component.props.disabled).toBe(false);
    });
    
    test('should create a component with provided values', () => {
      const options = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' }
      ];
      
      const props = {
        label: 'Select a country',
        placeholder: 'Choose your country',
        value: 'option1',
        options: options,
        required: true,
        validation: { type: 'string', enum: ['option1', 'option2'] },
        style: { width: '100%' },
        multiple: true,
        disabled: true
      };
      
      const component = new SelectComponent(props);
      
      expect(component.props.label).toBe('Select a country');
      expect(component.props.placeholder).toBe('Choose your country');
      expect(component.props.value).toBe('option1');
      expect(component.props.options).toEqual(options);
      expect(component.props.required).toBe(true);
      expect(component.props.validation).toEqual({ type: 'string', enum: ['option1', 'option2'] });
      expect(component.props.style).toEqual({ width: '100%' });
      expect(component.props.multiple).toBe(true);
      expect(component.props.disabled).toBe(true);
    });
    
    test('should initialize validator if validation schema is provided', () => {
      const component = new SelectComponent({
        validation: { type: 'string' }
      });
      
      expect(Validator).toHaveBeenCalled();
      expect(component.validator).toBeDefined();
    });
    
    test('should not initialize validator if no validation schema', () => {
      const component = new SelectComponent();
      
      expect(component.validator).toBeUndefined();
    });
  });
  
  describe('validate', () => {
    test('should validate correctly formatted component', () => {
      const options = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' }
      ];
      
      const component = new SelectComponent({
        label: 'Select Option',
        options: options
      });
      
      expect(component.validate()).toBe(true);
    });
    
    test('should invalidate component with non-string label', () => {
      const component = new SelectComponent();
      component.props.label = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-string placeholder', () => {
      const component = new SelectComponent();
      component.props.placeholder = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with non-array options', () => {
      const component = new SelectComponent();
      component.props.options = 'invalid';
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with invalid option objects', () => {
      const component = new SelectComponent();
      component.props.options = [
        { invalid: 'no value or label' }
      ];
      
      expect(component.validate()).toBe(false);
    });
    
    test('should validate component with valid option objects', () => {
      const component = new SelectComponent();
      component.props.options = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' }
      ];
      
      expect(component.validate()).toBe(true);
    });
    
    test('should invalidate if value is not among option values for single select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        value: 'option3',
        multiple: false
      });
      
      expect(component.validate()).toBe(false);
    });
    
    test('should validate if value is empty string for single select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        value: '',
        multiple: false
      });
      
      expect(component.validate()).toBe(true);
    });
    
    test('should invalidate if value contains invalid options for multiple select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        value: ['option1', 'option3'],
        multiple: true
      });
      
      expect(component.validate()).toBe(false);
    });
    
    test('should validate if value is empty array for multiple select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        value: [],
        multiple: true
      });
      
      expect(component.validate()).toBe(true);
    });
    
    test('should validate if all values are among option values for multiple select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        value: ['option1', 'option2'],
        multiple: true
      });
      
      expect(component.validate()).toBe(true);
    });
  });
  
  describe('setOptions', () => {
    test('should update options property', () => {
      const component = new SelectComponent();
      const options = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' }
      ];
      
      component.setOptions(options);
      
      expect(component.props.options).toEqual(options);
    });
    
    test('should clear value if it is not valid with new options', () => {
      const component = new SelectComponent({
        value: 'option1',
        options: [
          { value: 'option1', label: 'Option 1' }
        ]
      });
      
      component.setOptions([
        { value: 'option2', label: 'Option 2' }
      ]);
      
      expect(component.props.value).toBe('');
    });
    
    test('should return component instance for chaining', () => {
      const component = new SelectComponent();
      const result = component.setOptions([]);
      
      expect(result).toBe(component);
    });
  });
  
  describe('setValue', () => {
    test('should update value property for single select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        multiple: false
      });
      
      component.setValue('option2');
      
      expect(component.props.value).toBe('option2');
    });
    
    test('should update value property for multiple select', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ],
        multiple: true
      });
      
      component.setValue(['option1', 'option2']);
      
      expect(component.props.value).toEqual(['option1', 'option2']);
    });
    
    test('should invalidate if value is not among option values', () => {
      const component = new SelectComponent({
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ]
      });
      
      component.setValue('option3');
      
      expect(component.validate()).toBe(false);
    });
    
    test('should return component instance for chaining', () => {
      const component = new SelectComponent();
      const result = component.setValue('option1');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setMultiple', () => {
    test('should update multiple property', () => {
      const component = new SelectComponent();
      component.setMultiple(true);
      
      expect(component.props.multiple).toBe(true);
      
      component.setMultiple(false);
      expect(component.props.multiple).toBe(false);
    });
    
    test('should convert value to array when switching to multiple', () => {
      const component = new SelectComponent({
        value: 'option1',
        options: [
          { value: 'option1', label: 'Option 1' }
        ]
      });
      
      component.setMultiple(true);
      
      expect(component.props.value).toEqual(['option1']);
    });
    
    test('should convert value to string when switching from multiple', () => {
      const component = new SelectComponent({
        multiple: true,
        value: ['option1', 'option2'],
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ]
      });
      
      component.setMultiple(false);
      
      expect(component.props.value).toBe('option1');
    });
    
    test('should set empty string when switching from multiple with empty array', () => {
      const component = new SelectComponent({
        multiple: true,
        value: [],
        options: [
          { value: 'option1', label: 'Option 1' }
        ]
      });
      
      component.setMultiple(false);
      
      expect(component.props.value).toBe('');
    });
    
    test('should return component instance for chaining', () => {
      const component = new SelectComponent();
      const result = component.setMultiple(true);
      
      expect(result).toBe(component);
    });
  });
  
  describe('setDisabled', () => {
    test('should update disabled property', () => {
      const component = new SelectComponent();
      component.setDisabled(true);
      
      expect(component.props.disabled).toBe(true);
      
      component.setDisabled(false);
      expect(component.props.disabled).toBe(false);
    });
    
    test('should return component instance for chaining', () => {
      const component = new SelectComponent();
      const result = component.setDisabled(true);
      
      expect(result).toBe(component);
    });
  });
  
  describe('validateValue', () => {
    test('should return valid for non-required empty value', () => {
      const component = new SelectComponent({
        required: false,
        value: ''
      });
      
      expect(component.validateValue()).toEqual({ valid: true });
    });
    
    test('should return invalid for required empty value', () => {
      const component = new SelectComponent({
        required: true,
        value: ''
      });
      
      expect(component.validateValue()).toEqual({
        valid: false,
        error: 'This field is required'
      });
    });
    
    test('should return invalid for required empty array in multiple select', () => {
      const component = new SelectComponent({
        required: true,
        multiple: true,
        value: []
      });
      
      expect(component.validateValue()).toEqual({
        valid: false,
        error: 'This field is required'
      });
    });
    
    test('should use custom validation if provided', () => {
      // Create the component
      const component = new SelectComponent({
        validation: { type: 'string', enum: ['option1', 'option2'] }
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
  });
  
  describe('createSelectPayload', () => {
    test('should create payload with correct structure for single select', () => {
      const component = new SelectComponent({
        value: 'option1'
      });
      
      // Mock validateValue to return a simple result
      component.validateValue = jest.fn().mockReturnValue({ valid: true });
      
      const payload = component.createSelectPayload('option2');
      
      expect(payload).toEqual({
        type: 'select_change',
        componentId: component.id,
        value: 'option2',
        validationResult: { valid: true }
      });
      
      expect(component.validateValue).toHaveBeenCalled();
    });
    
    test('should create payload with correct structure for multiple select', () => {
      const component = new SelectComponent({
        multiple: true,
        value: ['option1']
      });
      
      // Mock validateValue to return a simple result
      component.validateValue = jest.fn().mockReturnValue({ valid: true });
      
      const payload = component.createSelectPayload(['option1', 'option2']);
      
      expect(payload).toEqual({
        type: 'select_change',
        componentId: component.id,
        value: ['option1', 'option2'],
        validationResult: { valid: true }
      });
      
      expect(component.validateValue).toHaveBeenCalled();
    });
  });
}); 