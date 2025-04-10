/**
 * ComfyDeploy Integration Test
 * 
 * This script tests the ComfyDeploy integration by simulating
 * both text-to-image and media operations.
 */

// Import required modules
const ComfyDeployService = require('../services/comfydeploy');
const ComfyDeployMediaService = require('../services/comfydeploy/media');
const { SessionManager } = require('../services/sessionManager');
const { generateImage } = require('../commands/makeCommand');
const { processImageToImage, removeBackground } = require('../commands/mediaCommand');

// Mock workflows for testing
const mockWorkflows = [
  {
    name: 'FLUX',
    ids: ['flux-deployment-id-123'],
    inputs: {
      prompt: 'default prompt',
      negative_prompt: 'default negative',
      width: 1024,
      height: 1024
    }
  },
  {
    name: 'I2I',
    ids: ['i2i-deployment-id-456'],
    inputs: {
      prompt: 'default prompt',
      negative_prompt: 'default negative',
      image: 'https://example.com/image.jpg'
    }
  },
  {
    name: 'RMBG',
    ids: ['rmbg-deployment-id-789'],
    inputs: {
      image: 'https://example.com/image.jpg'
    }
  }
];

// Mocked services
class MockComfyDeployClient {
  async generate(params) {
    console.log('MockComfyDeployClient.generate called with:', JSON.stringify(params, null, 2));
    return { run_id: 'mock-run-id-' + Math.random().toString(36).substring(2, 10) };
  }
  
  async getStatus(run_id) {
    console.log(`MockComfyDeployClient.getStatus called for run_id: ${run_id}`);
    return {
      status: 'success',
      progress: 1.0,
      outputs: [
        { url: 'https://example.com/output.jpg', type: 'image' }
      ]
    };
  }
  
  on(eventName, callback) {
    // Mock event subscription
  }
}

class MockSessionManager {
  constructor() {
    this.sessions = new Map();
  }
  
  async createSession(userId, data) {
    const session = {
      id: userId,
      data: { ...data },
      get: (key) => this.sessions.get(userId)?.data[key],
      version: 1
    };
    this.sessions.set(userId, session);
    return session;
  }
  
  async getSession(userId) {
    return this.sessions.get(userId);
  }
  
  async updateSession(userId, update) {
    const session = this.sessions.get(userId);
    if (session) {
      session.data = { ...session.data, ...update };
      session.version += 1;
    }
    return session;
  }
}

class MockPointsService {
  constructor() {
    this.userPoints = new Map();
  }
  
  async hasSufficientPoints(userId, amount) {
    const points = this.userPoints.get(userId) || 1000; // Default 1000 points
    console.log(`Checking if user ${userId} has ${amount} points (current: ${points})`);
    return points >= amount;
  }
  
  async deductPoints(userId, amount) {
    const currentPoints = this.userPoints.get(userId) || 1000;
    const newPoints = currentPoints - amount;
    this.userPoints.set(userId, newPoints);
    console.log(`Deducted ${amount} points from user ${userId}, new balance: ${newPoints}`);
    return newPoints;
  }
  
  async addPoints(userId, amount) {
    const currentPoints = this.userPoints.get(userId) || 1000;
    const newPoints = currentPoints + amount;
    this.userPoints.set(userId, newPoints);
    console.log(`Added ${amount} points to user ${userId}, new balance: ${newPoints}`);
    return newPoints;
  }
}

// Override the client in ComfyDeployService
ComfyDeployService.prototype.createClient = function(options) {
  return new MockComfyDeployClient(options);
};

// Main test function
async function runTests() {
  console.log('🧪 Starting ComfyDeploy Integration Tests');
  
  // Create services
  const sessionManager = new MockSessionManager();
  const pointsService = new MockPointsService();
  
  // Set up ComfyDeploy service with mock workflows
  const comfyDeployService = new ComfyDeployService({
    workflows: mockWorkflows
  });
  
  // Set up media service
  const mediaService = new ComfyDeployMediaService({
    workflows: mockWorkflows
  });
  
  // User info
  const userId = 'test-user-123';
  const username = 'testuser';
  
  console.log('\n🧪 Test 1: Text-to-Image Generation (/make command)');
  try {
    const result = await generateImage({
      generationService: { createTask: () => ({ taskId: 'mock-task-123', status: 'pending' }), startProcessingTask: () => ({}) },
      comfyDeployService,
      sessionManager,
      pointsService,
      userId,
      prompt: 'a beautiful sunset over the ocean',
      options: {
        type: 'FLUX',
        settings: {
          width: 768,
          height: 768,
          seed: 42
        },
        metadata: {
          username,
          source: 'test'
        }
      }
    });
    
    console.log('✅ Text-to-Image Generation Result:', result);
  } catch (error) {
    console.error('❌ Text-to-Image Generation Error:', error);
  }
  
  console.log('\n🧪 Test 2: Image-to-Image Generation');
  try {
    const result = await processImageToImage({
      mediaService,
      sessionManager,
      pointsService,
      userId,
      prompt: 'transform this into a watercolor painting',
      imageUrl: 'https://example.com/input.jpg',
      settings: {
        strength: 0.8
      }
    });
    
    console.log('✅ Image-to-Image Generation Result:', result);
  } catch (error) {
    console.error('❌ Image-to-Image Generation Error:', error);
  }
  
  console.log('\n🧪 Test 3: Background Removal');
  try {
    const result = await removeBackground({
      mediaService,
      sessionManager,
      pointsService,
      userId,
      imageUrl: 'https://example.com/with_background.jpg'
    });
    
    console.log('✅ Background Removal Result:', result);
  } catch (error) {
    console.error('❌ Background Removal Error:', error);
  }
  
  console.log('\n🧪 All Tests Completed');
}

// Run the tests
runTests().catch(error => {
  console.error('Test error:', error);
}); 

// Export the test function
module.exports = {
  runTests
}; 