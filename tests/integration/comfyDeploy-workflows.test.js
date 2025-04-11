/**
 * Integration Test for ComfyDeploy Database-Driven Workflows
 * 
 * Tests the functionality of database-driven workflows in the ComfyDeploy adapter.
 * 
 * @jest-environment node
 */

const { ComfyDeployAdapter } = require('../../src/services/comfyDeployAdapter');
const { loadWorkflows, parseWorkflow } = require('../../src/services/comfydeploy/workflowLoader');
const WorkflowRepository = require('../../src/db/models/workflows');
const { ServiceRegistry } = require('../../src/services/registry');

// Mock the repository abstraction layer
jest.mock('../../src/core/shared/mongo', () => {
  // Create an in-memory mock for workflows
  let mockDocuments = new Map();
  
  // Mock repository instance
  const mockRepositoryInstance = {
    find: jest.fn().mockImplementation((query = {}) => {
      return Promise.resolve(Array.from(mockDocuments.values()));
    }),
    findOne: jest.fn().mockImplementation((query = {}) => {
      if (mockDocuments.size === 0) return Promise.resolve(null);
      return Promise.resolve(mockDocuments.values().next().value);
    }),
    findById: jest.fn().mockImplementation((id) => {
      return Promise.resolve(mockDocuments.get(id) || null);
    }),
    create: jest.fn().mockImplementation((data) => {
      const id = `mock-id-${Date.now()}`;
      const doc = { ...data, _id: id };
      mockDocuments.set(id, doc);
      return Promise.resolve(doc);
    }),
    updateOne: jest.fn().mockImplementation((query, data) => {
      // Simple implementation for tests
      if (query._id && mockDocuments.has(query._id)) {
        const doc = mockDocuments.get(query._id);
        const updated = { ...doc, ...data };
        mockDocuments.set(query._id, updated);
        return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
      }
      
      // Just update the first doc for simplicity in tests
      if (mockDocuments.size > 0) {
        const firstKey = mockDocuments.keys().next().value;
        const doc = mockDocuments.get(firstKey);
        const updated = { ...doc, ...data };
        mockDocuments.set(firstKey, updated);
        return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
      }
      
      return Promise.resolve({ acknowledged: true, modifiedCount: 0 });
    }),
    deleteOne: jest.fn().mockImplementation((query) => {
      return Promise.resolve({ acknowledged: true, deletedCount: 1 });
    }),
    exists: jest.fn().mockImplementation(() => {
      return Promise.resolve(mockDocuments.size > 0);
    }),
    getStats: jest.fn().mockReturnValue({ operationCount: 0, errorCount: 0 })
  };
  
  // Export the mock functions
  return {
    getRepository: jest.fn().mockImplementation(() => mockRepositoryInstance),
    // For test control - not part of the actual implementation
    __mockRepositoryInstance: mockRepositoryInstance,
    __mockDocuments: mockDocuments,
    __resetMockData: () => {
      mockDocuments.clear();
    },
    __setMockData: (data) => {
      mockDocuments.clear();
      if (data) {
        mockDocuments.set('mock-id-123', data);
      }
    }
  };
});

// Mock the Logger to prevent log spam during tests
jest.mock('../../src/utils/logger', () => {
  return {
    Logger: jest.fn().mockImplementation(() => {
      return {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      };
    })
  };
});

/**
 * Create test workflow data
 * @returns {Object} Mock workflow DB data
 */
function createTestWorkflows() {
  const workflowLayout1 = {
    nodes: [
      {
        type: 'ComfyUIDeploy',
        widgets_values: [
          'input_prompt',
          'input_negative_prompt',
          'input_width',
          'input_height',
          'input_steps',
          'input_seed'
        ]
      }
    ]
  };
  
  const workflowLayout2 = {
    nodes: [
      {
        type: 'ComfyUIDeploy',
        widgets_values: [
          'input_image',
          'input_scale'
        ]
      }
    ]
  };
  
  return {
    flows: [
      {
        name: 'TEST_TXT2IMG',
        ids: ['test-deployment-id-1'],
        layout: JSON.stringify(workflowLayout1),
        active: true
      },
      {
        name: 'TEST_UPSCALE',
        ids: ['test-deployment-id-2'],
        layout: JSON.stringify(workflowLayout2),
        active: true
      }
    ]
  };
}

describe('ComfyDeploy Database-Driven Workflows', () => {
  let adapter;
  let serviceRegistry;
  const mongoMock = require('../../src/core/shared/mongo');
  
  beforeEach(() => {
    // Reset mock workflows
    const mockWorkflows = createTestWorkflows();
    mongoMock.__resetMockData();
    mongoMock.__setMockData(mockWorkflows);
    
    // Create a fresh service registry
    serviceRegistry = new ServiceRegistry();
    
    // Mock the getInstance method to return our instance
    ServiceRegistry.getInstance = jest.fn().mockReturnValue(serviceRegistry);
  });
  
  afterEach(() => {
    // Clean up adapter
    if (adapter) {
      adapter.shutdown().catch(() => {});
      adapter = null;
    }
    
    // Restore mocks
    jest.clearAllMocks();
  });
  
  test('parseWorkflow should extract input parameters from layout', () => {
    const workflowLayout = {
      nodes: [
        {
          type: 'ComfyUIDeploy',
          widgets_values: [
            'input_prompt',
            'input_negative_prompt',
            'normal_value',
            123,
            'input_width'
          ]
        }
      ]
    };
    
    const result = parseWorkflow(workflowLayout);
    
    expect(result).toEqual(['input_prompt', 'input_negative_prompt', 'input_width']);
    expect(result).not.toContain('normal_value');
    expect(result.length).toBe(3);
  });
  
  test('loadWorkflows should load workflows from database', async () => {
    const workflows = await loadWorkflows();
    
    expect(workflows).toHaveLength(2);
    expect(workflows[0].name).toBe('TEST_TXT2IMG');
    expect(workflows[1].name).toBe('TEST_UPSCALE');
    
    // Verify input template creation
    expect(workflows[0].inputs).toHaveProperty('prompt');
    expect(workflows[0].inputs).toHaveProperty('negative_prompt');
    expect(workflows[0].inputs).toHaveProperty('width');
    expect(workflows[0].inputs).toHaveProperty('height');
    expect(workflows[0].inputs).toHaveProperty('steps');
    expect(workflows[0].inputs).toHaveProperty('seed');
    
    expect(workflows[1].inputs).toHaveProperty('image');
    expect(workflows[1].inputs).toHaveProperty('scale');
  });
  
  test('adapter should initialize with database workflows when none provided', async () => {
    // Create adapter with no workflows
    adapter = new ComfyDeployAdapter({
      serviceName: 'comfydeploy',
      config: {
        apiKey: 'test-api-key',
        baseUrl: 'http://example.com/api',
        // No workflows provided
      }
    });
    
    // Initialize the adapter
    await adapter.init();
    
    // Verify workflows are loaded from DB
    expect(adapter.config.workflows).toHaveLength(2);
    expect(adapter.config.workflows[0].name).toBe('TEST_TXT2IMG');
    expect(adapter.config.workflows[1].name).toBe('TEST_UPSCALE');
    expect(adapter.workflowLastLoaded).toBeGreaterThan(0);
  });
  
  test('adapter should use provided workflows if available', async () => {
    // Create adapter with provided workflows
    adapter = new ComfyDeployAdapter({
      serviceName: 'comfydeploy',
      config: {
        apiKey: 'test-api-key',
        baseUrl: 'http://example.com/api',
        workflows: [
          {
            name: 'PROVIDED_WORKFLOW',
            ids: ['provided-id'],
            inputs: {
              prompt: '',
              width: 512
            }
          }
        ]
      }
    });
    
    // Initialize the adapter
    await adapter.init();
    
    // Verify provided workflows are used
    expect(adapter.config.workflows).toHaveLength(1);
    expect(adapter.config.workflows[0].name).toBe('PROVIDED_WORKFLOW');
  });
  
  test('reloadWorkflows should update workflows from database', async () => {
    // Create adapter with initial workflows
    adapter = new ComfyDeployAdapter({
      serviceName: 'comfydeploy',
      config: {
        apiKey: 'test-api-key',
        baseUrl: 'http://example.com/api',
        workflows: [
          {
            name: 'INITIAL_WORKFLOW',
            ids: ['initial-id'],
            inputs: {
              prompt: ''
            }
          }
        ]
      }
    });
    
    // Initialize the adapter
    await adapter.init();
    
    // Verify initial state
    expect(adapter.config.workflows).toHaveLength(1);
    expect(adapter.config.workflows[0].name).toBe('INITIAL_WORKFLOW');
    
    // Update the mock database with new workflows
    const updatedWorkflows = {
      flows: [
        {
          name: 'UPDATED_WORKFLOW_1',
          ids: ['updated-id-1'],
          layout: JSON.stringify({
            nodes: [
              {
                type: 'ComfyUIDeploy',
                widgets_values: ['input_custom']
              }
            ]
          }),
          active: true
        },
        {
          name: 'UPDATED_WORKFLOW_2',
          ids: ['updated-id-2'],
          layout: JSON.stringify({
            nodes: [
              {
                type: 'ComfyUIDeploy',
                widgets_values: ['input_other']
              }
            ]
          }),
          active: true
        }
      ]
    };
    mongoMock.__setMockData(updatedWorkflows);
    
    // Force reload workflows
    const result = await adapter.reloadWorkflows();
    
    // Verify reload was successful
    expect(result).toBe(true);
    
    // Verify workflows are updated
    expect(adapter.config.workflows).toHaveLength(2);
    expect(adapter.config.workflows[0].name).toBe('UPDATED_WORKFLOW_1');
    expect(adapter.config.workflows[1].name).toBe('UPDATED_WORKFLOW_2');
    expect(adapter.config.workflows[0].inputs).toHaveProperty('custom');
    expect(adapter.config.workflows[1].inputs).toHaveProperty('other');
  });
  
  test('adapter should check for workflow reload at interval', async () => {
    // Track reload times
    const reloadTimes = [];
    
    // Create adapter with short reload interval
    adapter = new ComfyDeployAdapter({
      serviceName: 'comfydeploy',
      config: {
        apiKey: 'test-api-key',
        baseUrl: 'http://example.com/api',
        workflows: [
          {
            name: 'INITIAL_WORKFLOW',
            ids: ['initial-id'],
            inputs: {
              prompt: ''
            }
          }
        ]
      },
      workflowReloadInterval: 100 // 100ms interval for testing
    });
    
    // Mock the reloadWorkflows method
    adapter.reloadWorkflows = jest.fn().mockImplementation(async () => {
      reloadTimes.push(Date.now());
      return true;
    });
    
    // Initialize the adapter
    await adapter.init();
    
    // First check should not trigger reload
    await adapter._checkAndReloadWorkflows();
    expect(adapter.reloadWorkflows).not.toHaveBeenCalled();
    
    // Adjust the last loaded time to trigger reload
    adapter.workflowLastLoaded = Date.now() - 200;
    
    // Second check should trigger reload
    await adapter._checkAndReloadWorkflows();
    expect(adapter.reloadWorkflows).toHaveBeenCalledTimes(1);
  });
  
  test('validateParams should check for valid workflow type', async () => {
    // Create adapter with test workflows
    adapter = new ComfyDeployAdapter({
      serviceName: 'comfydeploy',
      config: {
        apiKey: 'test-api-key',
        baseUrl: 'http://example.com/api'
      }
    });
    
    // Initialize the adapter (loads workflows from DB)
    await adapter.init();
    
    // Valid workflow type should pass validation
    await expect(adapter.validateParams({ type: 'TEST_TXT2IMG', prompt: 'test' }))
      .resolves.toBe(true);
    
    // Invalid workflow type should fail validation
    await expect(adapter.validateParams({ type: 'INVALID_TYPE', prompt: 'test' }))
      .rejects.toThrow(/Invalid generation type/);
  });
}); 