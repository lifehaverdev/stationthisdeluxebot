/**
 * Parameter Flow Test
 * 
 * This test verifies that parameters are properly normalized throughout the system.
 * It traces the flow from the web API boundary through the service layer, PromptBuilder,
 * and finally to the API client, ensuring that parameters are consistently prefixed
 * with 'input_' at each step.
 */

const { normalizeUIParameters, normalizeAPIParameters } = require('../normalizeParameters');
const PromptBuilder = require('../../PromptBuilder');
const ComfyClient = require('../../ComfyClient');
const { GenerationRequest } = require('../../../../core/generation/models');

// Mock external dependencies and services
jest.mock('../../../../core/generation/models', () => ({
  GenerationRequest: jest.fn().mockImplementation((data) => data),
}));

// Mock ComfyClient to avoid actual API calls
jest.mock('../../ComfyClient', () => {
  return jest.fn().mockImplementation(() => ({
    sendRequest: jest.fn().mockImplementation((requestData) => Promise.resolve({
      run_id: 'test-run-id',
      requestData
    })),
    on: jest.fn(),
    emit: jest.fn()
  }));
});

describe('Parameter Normalization Flow', () => {
  let promptBuilder;
  let comfyClient;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create the PromptBuilder instance with minimal config
    promptBuilder = new PromptBuilder({
      defaultSettings: {
        WIDTH: 1024,
        HEIGHT: 1024,
        STEPS: 30,
        CFG: 7
      }
    });
    
    // Create a ComfyClient instance
    comfyClient = new ComfyClient({
      apiKey: 'test-api-key',
      baseUrl: 'http://localhost/api'
    });
  });
  
  test('parameters are properly normalized throughout the flow', async () => {
    // Stage 1: Web API Request Parameters (raw user input)
    const webRequestParams = {
      workflowId: 'MAKE',
      parameters: {
        prompt: 'A beautiful sunset over mountains',
        width: 1024,
        height: 768,
        seed: 42,
        inputs: {
          negative_prompt: 'blurry, low quality',
          steps: 30
        }
      },
      userId: 'test-user'
    };
    
    // Stage 2: API Boundary Normalization (web routes)
    const normalizedParams = normalizeUIParameters(webRequestParams.parameters);
    
    // Verify that parameters are properly normalized at API boundary
    expect(normalizedParams).toHaveProperty('input_prompt');
    expect(normalizedParams).toHaveProperty('input_width');
    expect(normalizedParams).toHaveProperty('input_height');
    expect(normalizedParams).toHaveProperty('input_seed');
    expect(normalizedParams).toHaveProperty('input_negative_prompt');
    expect(normalizedParams).toHaveProperty('input_steps');
    
    // Create settings object with normalized parameters
    const settings = {
      ...webRequestParams.parameters,
      inputs: normalizedParams
    };
    
    // Stage 3: Create GenerationRequest for ComfyDeployService
    const generationRequest = {
      type: webRequestParams.workflowId,
      prompt: webRequestParams.parameters.prompt,
      settings: settings,
      userId: webRequestParams.userId
    };
    
    // Stage 4: PromptBuilder Build (ComfyDeployService -> PromptBuilder)
    const mockDeploymentInfo = {
      ids: ['test-deployment-id'],
      inputs: {
        prompt: { type: 'string', required: true },
        negative_prompt: { type: 'string' },
        width: { type: 'number', default: 1024 },
        height: { type: 'number', default: 768 }
      }
    };
    
    // Mock user context
    const userContext = { userId: webRequestParams.userId };
    
    // Build prompt with PromptBuilder
    const builtPrompt = await promptBuilder.build(generationRequest, userContext, mockDeploymentInfo);
    
    // Verify that all parameters in the built prompt have input_ prefix
    const inputParams = builtPrompt.inputs;
    Object.keys(inputParams).forEach(key => {
      // Ignore non-parameter properties
      if (typeof inputParams[key] !== 'object' || inputParams[key] === null) {
        expect(key.startsWith('input_') || key === 'deployment_id').toBeTruthy();
      }
    });
    
    // Make sure key parameters are properly normalized
    expect(inputParams).toHaveProperty('input_prompt');
    expect(inputParams).toHaveProperty('input_negative_prompt');
    expect(inputParams).toHaveProperty('input_width');
    expect(inputParams).toHaveProperty('input_height');
    expect(inputParams).toHaveProperty('input_seed');
    expect(inputParams).toHaveProperty('input_steps');
    
    // Stage 5: API Client (Final Request Normalization)
    const finalRequest = normalizeAPIParameters(builtPrompt);
    await comfyClient.sendRequest(finalRequest);
    
    // Verify that sendRequest was called with normalized parameters
    expect(comfyClient.sendRequest).toHaveBeenCalledTimes(1);
    const sentRequest = comfyClient.sendRequest.mock.calls[0][0];
    
    // Ensure all input parameters in the final API request have input_ prefix
    Object.keys(sentRequest.inputs).forEach(key => {
      // All parameters should have input_ prefix
      expect(key.startsWith('input_')).toBeTruthy();
    });
    
    // Check that deployment_id is preserved (should not have input_ prefix)
    expect(sentRequest).toHaveProperty('deployment_id');
    expect(sentRequest.deployment_id).not.toMatch(/^input_/);
  });
}); 