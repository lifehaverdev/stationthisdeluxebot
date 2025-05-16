/**
 * Tests for WorkflowSequence
 */

const { WorkflowSequence, WorkflowBuilder } = require('../sequence');
const { WorkflowStep } = require('../state');

describe('WorkflowSequence', () => {
  // Test basic sequence creation
  test('should create a valid sequence with steps', () => {
    const sequence = new WorkflowSequence({
      name: 'TestSequence',
      steps: {
        'step1': {
          id: 'step1',
          name: 'Step 1',
          nextStep: 'step2'
        },
        'step2': {
          id: 'step2',
          name: 'Step 2',
          nextStep: null
        }
      },
      initialStep: 'step1'
    });
    
    expect(sequence.name).toBe('TestSequence');
    expect(sequence.initialStep).toBe('step1');
    expect(Object.keys(sequence.steps).length).toBe(2);
    expect(sequence.steps.step1 instanceof WorkflowStep).toBe(true);
  });
  
  // Test sequence validation
  test('should throw error for invalid sequence', () => {
    // Missing initial step
    expect(() => {
      new WorkflowSequence({
        name: 'InvalidSequence',
        steps: {
          'step1': {
            id: 'step1',
            name: 'Step 1',
            nextStep: 'step2'
          }
        },
        initialStep: 'nonexistent'
      });
    }).toThrow();
    
    // Invalid next step
    expect(() => {
      new WorkflowSequence({
        name: 'InvalidSequence',
        steps: {
          'step1': {
            id: 'step1',
            name: 'Step 1',
            nextStep: 'nonexistent'
          }
        },
        initialStep: 'step1'
      });
    }).toThrow();
  });
  
  // Test workflow instance creation
  test('should create workflow instance correctly', () => {
    const sequence = new WorkflowSequence({
      name: 'TestSequence',
      steps: {
        'step1': {
          id: 'step1',
          name: 'Step 1',
          nextStep: 'step2'
        },
        'step2': {
          id: 'step2',
          name: 'Step 2',
          nextStep: null
        }
      },
      initialStep: 'step1'
    });
    
    const workflow = sequence.createWorkflow({
      userId: 'test-user'
    });
    
    expect(workflow.getState().currentStepId).toBe('step1');
    expect(workflow.context.sequenceName).toBe('TestSequence');
    expect(workflow.context.userId).toBe('test-user');
    expect(workflow.context.workflowId).toBeDefined();
  });
  
  // Test sequence serialization
  test('should serialize sequence correctly', () => {
    const sequence = new WorkflowSequence({
      name: 'TestSequence',
      steps: {
        'step1': {
          id: 'step1',
          name: 'Step 1',
          nextStep: 'step2'
        },
        'step2': {
          id: 'step2',
          name: 'Step 2',
          nextStep: null
        }
      },
      initialStep: 'step1'
    });
    
    const json = sequence.toJSON();
    
    expect(json.name).toBe('TestSequence');
    expect(json.initialStep).toBe('step1');
    expect(json.steps.step1.id).toBe('step1');
    expect(json.steps.step1.nextStep).toBe('step2');
    
    // Function properties should not be included
    expect(json.steps.step1.validate).toBeUndefined();
    expect(json.steps.step1.process).toBeUndefined();
  });
});

describe('WorkflowBuilder', () => {
  // Test linear workflow creation
  test('should create linear workflow correctly', () => {
    const sequence = WorkflowBuilder.createLinearWorkflow({
      name: 'LinearWorkflow',
      steps: [
        {
          id: 'step1',
          name: 'Step 1'
        },
        {
          id: 'step2',
          name: 'Step 2'
        },
        {
          id: 'step3',
          name: 'Step 3'
        }
      ]
    });
    
    expect(sequence.name).toBe('LinearWorkflow');
    expect(sequence.initialStep).toBe('step1');
    expect(Object.keys(sequence.steps).length).toBe(3);
    expect(sequence.steps.step1.nextStep).toBe('step2');
    expect(sequence.steps.step2.nextStep).toBe('step3');
    expect(sequence.steps.step3.nextStep).toBe(null);
  });
  
  // Test form workflow creation
  test('should create form workflow correctly', () => {
    const sequence = WorkflowBuilder.createFormWorkflow({
      name: 'FormWorkflow',
      fields: [
        {
          id: 'name',
          name: 'Name'
        },
        {
          id: 'email',
          name: 'Email'
        },
        {
          id: 'age',
          name: 'Age'
        }
      ]
    });
    
    expect(sequence.name).toBe('FormWorkflow');
    expect(sequence.initialStep).toBe('name');
    expect(Object.keys(sequence.steps).length).toBe(4); // 3 fields + confirmation
    expect(sequence.steps.name.nextStep).toBe('email');
    expect(sequence.steps.email.nextStep).toBe('age');
    expect(sequence.steps.age.nextStep).toBe('confirmation');
    expect(sequence.steps.confirmation.nextStep).toBe(null);
  });
  
  // Test error handling for invalid inputs
  test('should throw error for invalid inputs', () => {
    // Empty steps array
    expect(() => {
      WorkflowBuilder.createLinearWorkflow({
        name: 'InvalidWorkflow',
        steps: []
      });
    }).toThrow();
    
    // Empty fields array
    expect(() => {
      WorkflowBuilder.createFormWorkflow({
        name: 'InvalidForm',
        fields: []
      });
    }).toThrow();
  });
}); 