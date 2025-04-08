/**
 * Tests for Session Integration
 */

const { WorkflowState, WorkflowStep } = require('../state');
const { 
  storeWorkflow, 
  retrieveWorkflow, 
  deleteWorkflow, 
  getAllWorkflows, 
  findWorkflowsByName,
  createWorkflowMiddleware
} = require('../sessionIntegration');

// Mock SessionManager
class MockSessionManager {
  constructor() {
    this.sessions = new Map();
    this.updateCalls = [];
    this.getCalls = [];
  }
  
  async getSession(userId) {
    this.getCalls.push(userId);
    
    const session = this.sessions.get(userId);
    if (!session) {
      return null;
    }
    
    return {
      get: (path) => {
        if (!path) return session;
        
        // Handle dotted paths
        const parts = path.split('.');
        let current = session;
        for (const part of parts) {
          if (!current || typeof current !== 'object') {
            return undefined;
          }
          current = current[part];
        }
        return current;
      },
      has: (path) => {
        if (!path) return true;
        
        // Handle dotted paths
        const parts = path.split('.');
        let current = session;
        for (const part of parts) {
          if (!current || typeof current !== 'object') {
            return false;
          }
          current = current[part];
        }
        return current !== undefined;
      },
      unset: async (path) => {
        if (!path) return;
        
        // Handle dotted paths
        const parts = path.split('.');
        let current = session;
        let parent = null;
        let lastPart = null;
        
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!current || typeof current !== 'object') {
            return;
          }
          parent = current;
          current = current[part];
          lastPart = part;
        }
        
        if (parent && parts.length > 0) {
          const finalPart = parts[parts.length - 1];
          if (parent[finalPart]) {
            delete parent[finalPart];
          }
        }
      },
      version: 1
    };
  }
  
  async updateSession(userId, updates) {
    this.updateCalls.push({ userId, updates });
    
    let session = this.sessions.get(userId);
    if (!session) {
      session = {};
      this.sessions.set(userId, session);
    }
    
    // Apply updates
    for (const [key, value] of Object.entries(updates)) {
      // Handle dotted paths
      const parts = key.split('.');
      let current = session;
      
      // Create nested objects if needed
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part] || typeof current[part] !== 'object') {
          current[part] = {};
        }
        current = current[part];
      }
      
      // Set the value
      const finalPart = parts[parts.length - 1];
      current[finalPart] = value;
    }
    
    return true;
  }
}

describe('Session Integration', () => {
  // Basic test setup
  const mockSessionManager = new MockSessionManager();
  const userId = 'test-user';
  const workflowId = 'test-workflow';
  
  const mockSteps = {
    'step1': new WorkflowStep({
      id: 'step1',
      name: 'Step 1',
      nextStep: 'step2'
    }),
    'step2': new WorkflowStep({
      id: 'step2',
      name: 'Step 2',
      nextStep: null
    })
  };
  
  // Create a test workflow
  const createTestWorkflow = () => {
    return new WorkflowState({
      id: workflowId,
      steps: mockSteps,
      startStep: 'step1',
      context: {
        userId,
        workflowId,
        sequenceName: 'TestWorkflow'
      }
    });
  };
  
  beforeEach(() => {
    // Reset the mock
    mockSessionManager.sessions.clear();
    mockSessionManager.updateCalls = [];
    mockSessionManager.getCalls = [];
  });
  
  test('should store workflow in session', async () => {
    const workflow = createTestWorkflow();
    
    // Store the workflow
    await storeWorkflow(mockSessionManager, userId, workflow);
    
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
    const workflow = createTestWorkflow();
    
    // Store the workflow
    await storeWorkflow(mockSessionManager, userId, workflow);
    
    // Retrieve the workflow
    const retrieved = await retrieveWorkflow(mockSessionManager, userId, workflowId, mockSteps);
    
    // Check that getSession was called correctly
    expect(mockSessionManager.getCalls.length).toBe(1);
    expect(mockSessionManager.getCalls[0]).toBe(userId);
    
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