/**
 * Tests for integrating workflow system with session manager
 */

const { 
  storeWorkflow, 
  retrieveWorkflow, 
  deleteWorkflow, 
  getAllWorkflows,
  findWorkflowsByName,
  createWorkflowMiddleware
} = require('../sessionIntegration');

const { WorkflowState, WorkflowStep } = require('../state');

describe('Session Integration', () => {
  let mockSessionManager;
  const userId = 'test-user';
  const workflowId = 'test-workflow';
  
  // Create mock steps for testing
  const mockSteps = {
    'step1': new WorkflowStep({
      id: 'step1',
      name: 'Step One',
      nextStep: 'step2',
      ui: { type: 'text' }
    }),
    'step2': new WorkflowStep({
      id: 'step2',
      name: 'Step Two',
      ui: { type: 'text' }
    })
  };
  
  // Helper to create a test workflow
  function createTestWorkflow() {
    const workflow = new WorkflowState({
      id: workflowId,
      name: 'Test Workflow',
      steps: mockSteps,
      startStep: 'step1'
    });
    
    // Add sequence info to context for test expectations
    workflow.context = {
      workflowId: workflowId,
      sequenceName: 'TestWorkflow'
    };
    
    return workflow;
  }
  
  beforeEach(() => {
    // Create mock sessions
    const mockSessions = {};
    
    mockSessionManager = {
      // Track calls for verification
      updateCalls: [],
      getCalls: [],
      
      getSession: jest.fn(async (id) => {
        // Track the call
        mockSessionManager.getCalls.push(id);
        
        return mockSessions[id] || {
          get: jest.fn().mockImplementation((path) => {
            if (path === `workflows.${workflowId}`) {
              // Return mock workflow for this specific test
              return { 
                id: workflowId, 
                currentStep: 'step1',
                context: {
                  workflowId: workflowId,
                  sequenceName: 'TestWorkflow'
                }
              };
            } else if (path === 'workflows') {
              // Return mock workflows collection
              return { 
                [workflowId]: { 
                  id: workflowId, 
                  currentStep: 'step1',
                  context: {
                    workflowId: workflowId,
                    sequenceName: 'TestWorkflow'
                  }
                } 
              };
            }
            return undefined;
          }),
          version: 1
        };
      }),
      
      updateSession: jest.fn(async (id, updates) => {
        mockSessionManager.updateCalls.push({ userId: id, updates });
        mockSessions[id] = mockSessions[id] || {};
        Object.assign(mockSessions[id], updates);
        return true;
      })
    };
  });
  
  test('should store workflow in session', async () => {
    const workflow = createTestWorkflow();
    
    const result = await storeWorkflow(mockSessionManager, userId, workflow);
    
    expect(result).toBe(true);
    
    // Check that updateSession was called correctly
    expect(mockSessionManager.updateCalls.length).toBe(1);
    expect(mockSessionManager.updateCalls[0].userId).toBe(userId);
    
    // Check that the workflow was stored in the correct path
    const updatePath = Object.keys(mockSessionManager.updateCalls[0].updates)[0];
    expect(updatePath).toBe(`workflows.${workflowId}`);
    
    // Check that the workflow data was serialized
    const serialized = mockSessionManager.updateCalls[0].updates[updatePath];
    expect(serialized.id).toBeDefined();
    expect(serialized.context).toBeDefined();
    expect(serialized.context.workflowId).toBe(workflowId);
  });
  
  test('should retrieve workflow from session', async () => {
    // Create a mock session with the workflow already in it
    const workflow = createTestWorkflow();
    const workflowData = JSON.parse(JSON.stringify(workflow));
    
    // Setup the session in advance with proper structure
    const mockSession = {
      get: jest.fn().mockImplementation((path) => {
        if (path === `workflows.${workflowId}`) {
          return workflowData;
        }
        return null;
      }),
      version: 1
    };
    
    // Override getSession
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
    
    // Retrieve the workflow
    const retrieved = await retrieveWorkflow(mockSessionManager, userId, workflowId, mockSteps);
    
    // Check that getSession was called correctly
    expect(mockSessionManager.getSession).toHaveBeenCalledWith(userId);
    
    // Check that the correct workflow was retrieved
    expect(retrieved).toBeDefined();
    expect(retrieved.context.workflowId).toBe(workflowId);
    expect(retrieved.context.sequenceName).toBe('TestWorkflow');
    expect(retrieved.getCurrentStep().id).toBe('step1');
  });
  
  test('should delete workflow from session', async () => {
    // Mock a session with unset function that works correctly
    const mockSession = {
      get: jest.fn().mockImplementation((path) => {
        if (path === `workflows.${workflowId}`) {
          return { id: workflowId };
        }
        return undefined;
      }),
      has: jest.fn().mockReturnValue(true),
      unset: jest.fn().mockResolvedValue(true),
      version: 1
    };
    
    // Override getSession to return our mock
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
    
    // Delete the workflow
    const result = await deleteWorkflow(mockSessionManager, userId, workflowId);
    
    // Check that the delete was successful
    expect(result).toBe(true);
    
    // Check that unset was called with the correct path
    expect(mockSession.unset).toHaveBeenCalledWith(`workflows.${workflowId}`);
  });
  
  test('should get all workflows for a user', async () => {
    // Create mock result for getAllWorkflows
    const mockWorkflows = {
      [workflowId]: { id: workflowId, context: { sequenceName: 'TestWorkflow' } },
      'another-workflow': { id: 'another-workflow', context: { sequenceName: 'AnotherWorkflow' } }
    };
    
    // Set up mock to return this data
    mockSessionManager.getSession = jest.fn().mockResolvedValue({
      get: jest.fn().mockReturnValue(mockWorkflows)
    });
    
    // Get all workflows
    const allWorkflows = await getAllWorkflows(mockSessionManager, userId);
    
    // Check that all workflows were retrieved
    expect(Object.keys(allWorkflows).length).toBe(2);
    expect(allWorkflows[workflowId]).toBeDefined();
    expect(allWorkflows['another-workflow']).toBeDefined();
  });
  
  test('should find workflows by name', async () => {
    // Create mock workflows for findWorkflowsByName
    const mockWorkflows = {
      [workflowId]: { 
        name: 'Test Name',
        context: { sequenceName: 'TestWorkflow' } 
      },
      'another-workflow': { 
        name: 'Another Name',
        context: { sequenceName: 'TestWorkflow' } 
      },
      'different-workflow': { 
        name: 'Different',
        context: { sequenceName: 'DifferentWorkflow' } 
      }
    };
    
    // Mock getAllWorkflows to return these values
    mockSessionManager.getSession = jest.fn().mockResolvedValue({
      get: jest.fn().mockReturnValue(mockWorkflows)
    });
    
    // Find workflows by name
    const testWorkflows = await findWorkflowsByName(mockSessionManager, userId, 'TestWorkflow');
    
    // Check that only the workflows with the matching name were found
    expect(testWorkflows.length).toBe(2);
    expect(testWorkflows).toContain(workflowId);
    expect(testWorkflows).toContain('another-workflow');
    expect(testWorkflows).not.toContain('different-workflow');
  });
  
  test('should create workflow middleware', async () => {
    // Create the middleware
    const middleware = createWorkflowMiddleware(mockSessionManager);
    
    // Create a mock context and next function
    const context = {
      userId
    };
    const next = jest.fn();
    
    // Call the middleware
    await middleware(context, next);
    
    // Check that the context was enriched with workflow functions
    expect(context.workflows).toBeDefined();
    expect(typeof context.workflows.store).toBe('function');
    expect(typeof context.workflows.retrieve).toBe('function');
    expect(typeof context.workflows.delete).toBe('function');
    expect(typeof context.workflows.getAll).toBe('function');
    expect(typeof context.workflows.findByName).toBe('function');
    
    // Check that next was called with no arguments (updated API)
    expect(next).toHaveBeenCalled();
  });
}); 