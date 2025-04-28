/**
 * Tests for WorkflowStep
 */

const { WorkflowStep } = require('../state');

describe('WorkflowStep', () => {
  describe('constructor', () => {
    test('should create a step with minimal config', () => {
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step'
      });
      
      expect(step.id).toBe('test');
      expect(step.name).toBe('Test Step');
      expect(step.nextStep).toBeNull();
      expect(step.ui).toEqual({ type: 'text' });
      expect(typeof step.validate).toBe('function');
      expect(typeof step.preProcess).toBe('function');
      expect(typeof step.postProcess).toBe('function');
    });
    
    test('should create a step with all config options', () => {
      const validate = jest.fn();
      const preProcess = jest.fn();
      const postProcess = jest.fn();
      
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step',
        nextStep: 'next-step',
        ui: { type: 'custom', options: ['a', 'b'] },
        validate,
        preProcess,
        postProcess
      });
      
      expect(step.id).toBe('test');
      expect(step.name).toBe('Test Step');
      expect(step.nextStep).toBe('next-step');
      expect(step.ui).toEqual({ type: 'custom', options: ['a', 'b'] });
      expect(step.validate).toBe(validate);
      expect(step.preProcess).toBe(preProcess);
      expect(step.postProcess).toBe(postProcess);
    });
    
    test('should throw error when required fields are missing', () => {
      expect(() => new WorkflowStep({})).toThrow();
      expect(() => new WorkflowStep({ id: 'test' })).toThrow();
      // UI is now optional with a default value
    });
  });
  
  describe('validation', () => {
    test('default validate function should always return valid', () => {
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step'
      });
      
      const result = step._defaultValidate('anything');
      
      expect(result.valid).toBe(true);
    });
    
    test('custom validate function should be called with input', () => {
      const validate = jest.fn().mockReturnValue({ valid: true });
      
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step',
        validate
      });
      
      const testInput = { test: 'value' };
      step.validate(testInput);
      
      expect(validate).toHaveBeenCalledWith(testInput);
    });
    
    test('should handle validation errors', () => {
      const validate = jest.fn().mockReturnValue({ 
        valid: false, 
        error: 'Invalid input'
      });
      
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step',
        validate
      });
      
      const testInput = { test: 'invalid' };
      const result = step.validate(testInput);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid input');
    });
  });
  
  describe('processing functions', () => {
    test('default preProcess function should return input unchanged', () => {
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step'
      });
      
      const testInput = { test: 'value' };
      const result = step._defaultProcess(testInput);
      
      expect(result).toBe(testInput);
    });
    
    test('default postProcess function should return input unchanged', () => {
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step'
      });
      
      const testInput = { test: 'value' };
      const result = step._defaultProcess(testInput);
      
      expect(result).toBe(testInput);
    });
    
    test('custom preProcess function should transform input', () => {
      const preProcess = jest.fn().mockImplementation(input => input.toUpperCase());
      
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step',
        preProcess
      });
      
      const result = step.preProcess('test');
      
      expect(result).toBe('TEST');
      expect(preProcess).toHaveBeenCalledWith('test');
    });
    
    test('custom postProcess function should transform input', () => {
      const postProcess = jest.fn().mockImplementation(input => input * 2);
      
      const step = new WorkflowStep({
        id: 'test',
        name: 'Test Step',
        postProcess
      });
      
      const result = step.postProcess(5);
      
      expect(result).toBe(10);
      expect(postProcess).toHaveBeenCalledWith(5);
    });
  });
  
  describe('complex steps', () => {
    test('should handle steps with complex validation and processing', () => {
      // Define a step that:
      // 1. Validates numeric input between 1-10
      // 2. Preprocesses by converting strings to numbers
      // 3. Postprocesses by doubling the value
      
      const step = new WorkflowStep({
        id: 'number',
        name: 'Number Input',
        ui: { type: 'number_input' },
        preProcess: (input) => {
          return typeof input === 'string' ? Number(input) : input;
        },
        validate: (input) => {
          if (typeof input !== 'number' || isNaN(input)) {
            return { valid: false, error: 'Must be a number' };
          }
          if (input < 1 || input > 10) {
            return { valid: false, error: 'Must be between 1 and 10' };
          }
          return { valid: true, value: input };
        },
        postProcess: (input) => input * 2
      });
      
      // Test the full pipeline
      
      // Valid number as string
      let input = '5';
      let preprocessed = step.preProcess(input); // 5
      let validation = step.validate(preprocessed); // { valid: true, value: 5 }
      let output = step.postProcess(validation.value); // 10
      
      expect(preprocessed).toBe(5);
      expect(validation.valid).toBe(true);
      expect(output).toBe(10);
      
      // Invalid: out of range
      input = '15';
      preprocessed = step.preProcess(input); // 15
      validation = step.validate(preprocessed); // { valid: false, error: '...' }
      
      expect(preprocessed).toBe(15);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe('Must be between 1 and 10');
      
      // Invalid: not a number
      input = 'abc';
      preprocessed = step.preProcess(input); // NaN
      validation = step.validate(preprocessed); // { valid: false, error: '...' }
      
      expect(isNaN(preprocessed)).toBe(true);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe('Must be a number');
    });
  });
  
  describe('serialization', () => {
    test('should serialize to JSON correctly', () => {
      const step = new WorkflowStep({
        id: 'serialize-test',
        name: 'Serialize Test',
        nextStep: 'next',
        ui: { type: 'text' },
        validate: () => ({ valid: true }),
        preProcess: input => input,
        postProcess: input => input
      });
      
      const serialized = JSON.stringify(step);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.id).toBe('serialize-test');
      expect(parsed.name).toBe('Serialize Test');
      expect(parsed.nextStep).toBe('next');
      expect(parsed.ui).toEqual({ type: 'text' });
      
      // Functions should not be serialized
      expect(parsed.validate).toBeUndefined();
      expect(parsed.preProcess).toBeUndefined();
      expect(parsed.postProcess).toBeUndefined();
    });
    
    test('should handle circular references in serialization', () => {
      const step = new WorkflowStep({
        id: 'circular-step',
        name: 'Circular Step',
        ui: { type: 'text' }
      });
      
      // Create circular reference
      step.circular = step;
      
      // This should not throw
      const serialized = JSON.stringify(step);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.id).toBe('circular-step');
      expect(parsed.name).toBe('Circular Step');
      
      // Circular reference should be removed or replaced
      expect(parsed.circular).not.toEqual(parsed);
    });
  });
}); 