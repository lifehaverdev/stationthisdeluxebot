/**
 * ComfyDeployService Unit Tests
 */

const { ComfyDeployService, ComfyClient, PromptBuilder, ComfyTaskMapper } = require('../index');
const { GenerationRequest } = require('../../../core/generation/models');

// Mock dependencies
jest.mock('../ComfyClient');
jest.mock('../PromptBuilder');
jest.mock('../ComfyTaskMapper');

describe('ComfyDeployService', () => {
  let service;
  let mockClient;
  let mockPromptBuilder;
  let mockTaskMapper;
  
  // Sample workflows
  const sampleWorkflows = [
    {
      name: 'FLUX',
      ids: ['flux-1', 'flux-2'],
      inputs: {
        prompt: '',
        negative_prompt: '',
        width: 1024,
        height: 1024
      }
    },
    {
      name: 'MAKE',
      ids: ['make-1'],
      inputs: {
        prompt: '',
        negative_prompt: '',
        width: 1024,
        height: 1024
      }
    }
  ];
  
  beforeEach(() => {
    // Create mocks
    mockClient = new ComfyClient();
    mockPromptBuilder = new PromptBuilder();
    mockTaskMapper = new ComfyTaskMapper();
    
    // Mock implementations
    mockClient.sendRequest.mockResolvedValue({ run_id: 'test-run-123' });
    mockPromptBuilder.build.mockResolvedValue({
      deployment_id: 'test-deployment',
      inputs: { prompt: 'test prompt' },
      originalPrompt: { type: 'FLUX', userId: 'user123' }
    });
    mockTaskMapper.mapRequestToTask.mockReturnValue({
      taskId: 'task-123',
      userId: 'user123',
      type: 'FLUX',
      run_id: 'test-run-123',
      status: 'queued'
    });
    
    // Create service with mocks
    service = new ComfyDeployService({
      client: mockClient,
      promptBuilder: mockPromptBuilder,
      taskMapper: mockTaskMapper,
      workflows: sampleWorkflows
    });
    
    // Mock emit method
    service.emit = jest.fn();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('generate', () => {
    it('should generate an image with a GenerationRequest', async () => {
      // Arrange
      const request = new GenerationRequest({
        userId: 'user123',
        type: 'FLUX',
        prompt: 'a beautiful landscape'
      });
      const userContext = {
        userId: 'user123',
        balance: 1000
      };
      
      // Act
      const result = await service.generate(request, userContext);
      
      // Assert
      expect(mockPromptBuilder.build).toHaveBeenCalledWith(
        request,
        userContext,
        expect.objectContaining({
          ids: expect.arrayContaining(['flux-1', 'flux-2']),
          inputs: expect.any(Object)
        })
      );
      expect(mockClient.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          deployment_id: 'test-deployment',
          inputs: expect.any(Object)
        }),
        expect.objectContaining({
          webhookData: expect.objectContaining({
            taskId: expect.any(String),
            userId: 'user123'
          })
        })
      );
      expect(result).toEqual(expect.objectContaining({
        runId: 'test-run-123',
        status: 'queued',
        userContext: expect.objectContaining({
          userId: 'user123',
          type: 'FLUX',
          prompt: 'a beautiful landscape'
        })
      }));
      expect(service.emit).toHaveBeenCalledWith('task:created', expect.any(Object));
    });
    
    it('should generate an image with a plain object', async () => {
      // Arrange
      const promptObj = {
        userId: 'user123',
        type: 'MAKE',
        prompt: 'a futuristic city'
      };
      const userContext = {
        userId: 'user123',
        balance: 1000
      };
      
      // Act
      const result = await service.generate(promptObj, userContext);
      
      // Assert
      expect(mockPromptBuilder.build).toHaveBeenCalled();
      expect(mockClient.sendRequest).toHaveBeenCalled();
      expect(result.runId).toBe('test-run-123');
    });
    
    it('should handle errors during generation', async () => {
      // Arrange
      mockClient.sendRequest.mockRejectedValue(new Error('API error'));
      const request = new GenerationRequest({
        userId: 'user123',
        type: 'FLUX',
        prompt: 'a beautiful landscape'
      });
      
      // Act & Assert
      await expect(service.generate(request, {})).rejects.toThrow('Failed to generate image');
      expect(service.emit).toHaveBeenCalledWith('generation:error', expect.any(Object));
    });
  });
  
  describe('checkStatus', () => {
    beforeEach(() => {
      mockClient.getStatus.mockResolvedValue({
        run_id: 'test-run-123',
        status: 'success',
        progress: 1.0,
        outputs: [{ url: 'https://example.com/image.jpg', type: 'image' }]
      });
      mockTaskMapper.mapStatusToTaskStatus.mockReturnValue({
        taskId: 'task-123',
        run_id: 'test-run-123',
        status: 'completed',
        progress: 100,
        isComplete: true,
        result: {
          outputs: ['https://example.com/image.jpg']
        }
      });
    });
    
    it('should check status of a generation run', async () => {
      // Act
      const result = await service.checkStatus('test-run-123');
      
      // Assert
      expect(mockClient.getStatus).toHaveBeenCalledWith('test-run-123');
      expect(mockTaskMapper.mapStatusToTaskStatus).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        taskId: 'task-123',
        run_id: 'test-run-123',
        status: 'completed',
        isComplete: true
      }));
    });
  });
  
  describe('processWebhook', () => {
    beforeEach(() => {
      mockTaskMapper.mapWebhookToTaskResult.mockReturnValue({
        requestId: 'task-123',
        userId: 'user123',
        outputs: ['https://example.com/image.jpg'],
        success: true,
        isSuccessful: () => true
      });
    });
    
    it('should process a webhook payload', () => {
      // Arrange
      const webhookPayload = {
        status: 'success',
        run_id: 'test-run-123',
        webhook_data: {
          taskId: 'task-123',
          userId: 'user123'
        }
      };
      
      // Act
      const result = service.processWebhook(webhookPayload);
      
      // Assert
      expect(mockTaskMapper.mapWebhookToTaskResult).toHaveBeenCalledWith(
        webhookPayload,
        webhookPayload.webhook_data
      );
      expect(service.emit).toHaveBeenCalledWith('generation:completed', expect.any(Object));
      expect(result.isSuccessful()).toBe(true);
    });
  });
  
  describe('_defaultGetDeploymentInfo', () => {
    it('should get deployment info for a valid type', () => {
      // Act
      const result = service._defaultGetDeploymentInfo('FLUX');
      
      // Assert
      expect(result).toEqual({
        ids: ['flux-1', 'flux-2'],
        inputs: expect.objectContaining({
          prompt: '',
          negative_prompt: '',
          width: 1024,
          height: 1024
        })
      });
    });
    
    it('should throw an error for an invalid type', () => {
      // Act & Assert
      expect(() => service._defaultGetDeploymentInfo('INVALID_TYPE')).toThrow(
        'Deployment info not found for type: INVALID_TYPE'
      );
    });
  });
}); 