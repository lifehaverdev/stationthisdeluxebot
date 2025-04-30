/**
 * Integration Test for Train Model Workflow
 * 
 * Tests the complete workflow for LoRA model training.
 */
const trainModelWorkflow = require('../../src/workflows/trainModel');

// Mock dependencies
const mockComfyUIService = {
  submitRequest: jest.fn(async (params) => {
    console.log('Submitting request with params:', JSON.stringify(params));
    return 'mock-run-id-12345';
  }),
  checkStatus: jest.fn(async (runId) => {
    return { status: 'completed', progress: 100 };
  }),
  getResults: jest.fn(async (runId) => {
    return {
      success: true,
      outputs: {
        lora_file: 'path/to/lora.safetensors'
      }
    };
  })
};

const mockPointsService = {
  checkBalance: jest.fn(async (userId, amount) => {
    console.log(`Checking balance for user ${userId}, amount: ${amount}`);
    return amount <= 5000; // Mock 5000 points available
  }),
  deductPoints: jest.fn(async (userId, amount, metadata) => {
    console.log(`Deducting ${amount} points from user ${userId}`);
    return true;
  }),
  addPoints: jest.fn(async (userId, amount, metadata) => {
    console.log(`Adding ${amount} points to user ${userId}`);
    return true;
  }),
  getUserDiscount: jest.fn(async (userId) => {
    return 0; // No discount by default
  })
};

// Mock session with test data
let mockSessionData = {
  '5472638766': {
    userId: '5472638766',
    preferences: {
      defaultWorkflow: 'standard'
    },
    loras: []
  }
};

const mockSessionService = {
  getSession: jest.fn(async (userId) => {
    console.log(`Getting session for user ${userId}`);
    return mockSessionData[userId] || { userId, loras: [] };
  }),
  updateSession: jest.fn(async (userId, sessionData) => {
    console.log(`Updating session for user ${userId}`);
    mockSessionData[userId] = sessionData;
    return true;
  })
};

const mockWorkflowsService = {
  getWorkflowByName: jest.fn(async (name) => {
    if (name === 'lora_training') {
      return {
        name: 'lora_training',
        deploymentIds: ['lora-training-deployment-123'],
        inputs: ['training_data', 'lora_name', 'training_steps']
      };
    }
    return null;
  })
};

const mockMediaService = {
  processImage: jest.fn(async (params) => {
    console.log(`Processing image for user ${params.userId}`);
    return `https://example.com/images/${params.userId}/${Math.random().toString(36).substring(7)}.jpg`;
  })
};

const mockLogger = {
  info: jest.fn((...args) => console.log(...args)),
  error: jest.fn((...args) => console.error(...args)),
  warn: jest.fn((...args) => console.warn(...args))
};

// Test cases
describe('Train Model Workflow', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset session data
    mockSessionData = {
      '5472638766': {
        userId: '5472638766',
        preferences: {
          defaultWorkflow: 'standard'
        },
        loras: []
      }
    };
  });
  
  it('should create a new LoRA dataset', async () => {
    const deps = {
      comfyuiService: mockComfyUIService,
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    const params = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const result = await trainModelWorkflow(deps, params);
    
    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(result.loraId).toBeDefined();
    expect(result.name).toBe('Test LoRA');
    
    // Verify session was updated
    expect(mockSessionService.updateSession).toHaveBeenCalled();
    
    // Get the updated session
    const updatedSession = mockSessionData['5472638766'];
    expect(updatedSession.loras.length).toBe(1);
    expect(updatedSession.loras[0].name).toBe('Test LoRA');
    expect(updatedSession.loras[0].images.length).toBe(20);
    expect(updatedSession.loras[0].captions.length).toBe(20);
  });
  
  it('should add images to an existing LoRA', async () => {
    // First create a LoRA
    const deps = {
      comfyuiService: mockComfyUIService,
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    // Create LoRA first
    const createParams = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const createResult = await trainModelWorkflow(deps, createParams);
    const loraId = createResult.loraId;
    
    // Now add images
    const imageParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      images: ['mock-image-data-1', 'mock-image-data-2'],
      options: {
        slotIndex: 0 // Specify the first slot
      }
    };
    
    const imageResult = await trainModelWorkflow(deps, imageParams);
    
    expect(imageResult.success).toBe(true);
    expect(imageResult.action).toBe('updated');
    expect(imageResult.updatedImages).toBe(2);
    
    // Verify media service was called
    expect(mockMediaService.processImage).toHaveBeenCalledTimes(2);
    
    // Get the updated session to verify
    const updatedSession = mockSessionData['5472638766'];
    expect(updatedSession.loras[0].images[0]).not.toBe('');
  });
  
  it('should add captions to an existing LoRA', async () => {
    // First create a LoRA
    const deps = {
      comfyuiService: mockComfyUIService,
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    // Create LoRA first
    const createParams = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const createResult = await trainModelWorkflow(deps, createParams);
    const loraId = createResult.loraId;
    
    // Now add captions
    const captionParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      captions: ['A test caption 1', 'A test caption 2']
    };
    
    const captionResult = await trainModelWorkflow(deps, captionParams);
    
    expect(captionResult.success).toBe(true);
    expect(captionResult.action).toBe('updated');
    expect(captionResult.updatedCaptions).toBe(2);
    
    // Get the updated session to verify
    const updatedSession = mockSessionData['5472638766'];
    expect(updatedSession.loras[0].captions[0]).toBe('A test caption 1');
    expect(updatedSession.loras[0].captions[1]).toBe('A test caption 2');
  });
  
  it('should not allow training submission with insufficient images', async () => {
    // First create a LoRA
    const deps = {
      comfyuiService: mockComfyUIService,
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    // Create LoRA first
    const createParams = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const createResult = await trainModelWorkflow(deps, createParams);
    const loraId = createResult.loraId;
    
    // Add just 2 images (insufficient)
    const imageParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      images: ['mock-image-data-1', 'mock-image-data-2'],
      options: {}
    };
    
    await trainModelWorkflow(deps, imageParams);
    
    // Try to submit for training
    const trainingParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      options: {
        submitTraining: true
      }
    };
    
    const trainingResult = await trainModelWorkflow(deps, trainingParams);
    
    expect(trainingResult.success).toBe(false);
    expect(trainingResult.error).toBe('insufficient_images');
  });
  
  it('should require captions for all images', async () => {
    // First create a LoRA
    const deps = {
      comfyuiService: mockComfyUIService,
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    // Create LoRA first
    const createParams = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const createResult = await trainModelWorkflow(deps, createParams);
    const loraId = createResult.loraId;
    
    // Add 4 images (sufficient)
    const imageParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      images: ['mock-image-data-1', 'mock-image-data-2', 'mock-image-data-3', 'mock-image-data-4'],
      options: {}
    };
    
    await trainModelWorkflow(deps, imageParams);
    
    // Add only 2 captions (insufficient)
    const captionParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      captions: ['Caption 1', 'Caption 2']
    };
    
    await trainModelWorkflow(deps, captionParams);
    
    // Try to submit for training
    const trainingParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      options: {
        submitTraining: true
      }
    };
    
    const trainingResult = await trainModelWorkflow(deps, trainingParams);
    
    expect(trainingResult.success).toBe(false);
    expect(trainingResult.error).toBe('missing_captions');
  });
  
  it('should submit a training job when all requirements are met', async () => {
    // First create a LoRA
    const deps = {
      comfyuiService: mockComfyUIService,
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    // Create LoRA first
    const createParams = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const createResult = await trainModelWorkflow(deps, createParams);
    const loraId = createResult.loraId;
    
    // Add 4 images
    const imageParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      images: ['mock-image-data-1', 'mock-image-data-2', 'mock-image-data-3', 'mock-image-data-4'],
      options: {}
    };
    
    await trainModelWorkflow(deps, imageParams);
    
    // Add 4 captions
    const captionParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      captions: ['Caption 1', 'Caption 2', 'Caption 3', 'Caption 4']
    };
    
    await trainModelWorkflow(deps, captionParams);
    
    // Submit for training
    const trainingParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      options: {
        submitTraining: true,
        iterations: 2000,
        quality: 'high'
      }
    };
    
    const trainingResult = await trainModelWorkflow(deps, trainingParams);
    
    expect(trainingResult.success).toBe(true);
    expect(trainingResult.action).toBe('training_submitted');
    expect(trainingResult.runId).toBe('mock-run-id-12345');
    
    // Verify points were deducted
    expect(mockPointsService.deductPoints).toHaveBeenCalled();
    
    // Verify training job was submitted
    expect(mockComfyUIService.submitRequest).toHaveBeenCalled();
    
    // Check that the LoRA status was updated
    const updatedSession = mockSessionData['5472638766'];
    expect(updatedSession.loras[0].status).toBe('training');
    expect(updatedSession.loras[0].runId).toBe('mock-run-id-12345');
  });
  
  it('should handle training submission errors and refund points', async () => {
    // First create a LoRA
    const deps = {
      comfyuiService: {
        ...mockComfyUIService,
        submitRequest: jest.fn().mockRejectedValue(new Error('API error'))
      },
      pointsService: mockPointsService,
      sessionService: mockSessionService,
      workflowsService: mockWorkflowsService,
      mediaService: mockMediaService,
      logger: mockLogger
    };
    
    // Create LoRA first
    const createParams = {
      userId: '5472638766',
      name: 'Test LoRA',
      platform: 'telegram'
    };
    
    const createResult = await trainModelWorkflow(deps, createParams);
    const loraId = createResult.loraId;
    
    // Add 4 images and captions
    mockSessionData['5472638766'].loras[0].images = [
      'image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg'
    ];
    mockSessionData['5472638766'].loras[0].captions = [
      'Caption 1', 'Caption 2', 'Caption 3', 'Caption 4'
    ];
    
    // Submit for training
    const trainingParams = {
      userId: '5472638766',
      loraId: loraId,
      platform: 'telegram',
      options: {
        submitTraining: true
      }
    };
    
    const trainingResult = await trainModelWorkflow(deps, trainingParams);
    
    expect(trainingResult.success).toBe(false);
    expect(trainingResult.error).toBe('submission_failed');
    
    // Verify points were refunded
    expect(mockPointsService.addPoints).toHaveBeenCalled();
  });
}); 