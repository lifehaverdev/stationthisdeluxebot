/**
 * Telegram Media Integration Test
 * 
 * This script tests the Telegram integration for media operations
 * by simulating messages from Telegram users.
 */

const { mediaTelegramAdapter } = require('../integrations/telegram/adapters/mediaAdapter');
const ComfyDeployMediaService = require('../services/comfydeploy/media');

// Mock services
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
}

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
}

// Override the client in ComfyDeployMediaService
ComfyDeployMediaService.prototype.client = new MockComfyDeployClient();

// Mock Telegram message creator
function createTelegramMessage({
  userId = 123456789,
  chatId = 123456789,
  messageId = 1,
  text = '',
  username = 'testuser',
  hasPhoto = false,
  hasDocument = false,
  isReply = false
}) {
  const message = {
    message_id: messageId,
    from: {
      id: userId,
      is_bot: false,
      first_name: 'Test',
      last_name: 'User',
      username,
      language_code: 'en'
    },
    chat: {
      id: chatId,
      first_name: 'Test',
      last_name: 'User',
      username,
      type: 'private'
    },
    date: Math.floor(Date.now() / 1000),
    text
  };
  
  if (hasPhoto) {
    message.photo = [
      {
        file_id: 'small-photo-id-123',
        file_unique_id: 'small-photo-unique-id-123',
        width: 320,
        height: 240,
        file_size: 10000
      },
      {
        file_id: 'large-photo-id-456',
        file_unique_id: 'large-photo-unique-id-456',
        width: 1024,
        height: 768,
        file_size: 50000
      }
    ];
  }
  
  if (hasDocument) {
    message.document = {
      file_id: 'document-id-789',
      file_unique_id: 'document-unique-id-789',
      file_name: 'test.jpg',
      mime_type: 'image/jpeg',
      file_size: 100000
    };
  }
  
  if (isReply) {
    message.reply_to_message = {
      message_id: messageId - 1,
      from: {
        id: 987654321,
        is_bot: true,
        first_name: 'Bot',
        username: 'testbot'
      },
      chat: {
        id: chatId,
        first_name: 'Test',
        last_name: 'User',
        username,
        type: 'private'
      },
      date: Math.floor(Date.now() / 1000) - 60,
      photo: [
        {
          file_id: 'reply-photo-id-123',
          file_unique_id: 'reply-photo-unique-id-123',
          width: 1024,
          height: 768,
          file_size: 50000
        }
      ]
    };
  }
  
  return message;
}

// Override the extractImageFromMessage method to return a test URL
mediaTelegramAdapter.extractImageFromMessage = async (message) => {
  if (message.photo || message.document || (message.reply_to_message && message.reply_to_message.photo)) {
    return 'https://example.com/extracted-image.jpg';
  }
  return null;
};

// Main test function
async function runTelegramTests() {
  console.log('🧪 Starting Telegram Media Integration Tests');
  
  // Create services
  const sessionManager = new MockSessionManager();
  const pointsService = new MockPointsService();
  
  // Set up media service
  const mediaService = new ComfyDeployMediaService({
    workflows: [
      {
        name: 'I2I',
        ids: ['i2i-deployment-id-456'],
        inputs: { prompt: 'default', image: 'https://example.com/image.jpg' }
      },
      {
        name: 'RMBG',
        ids: ['rmbg-deployment-id-789'],
        inputs: { image: 'https://example.com/image.jpg' }
      }
    ]
  });
  
  // Services object
  const services = {
    mediaService,
    sessionManager,
    pointsService
  };
  
  console.log('\n🧪 Test 1: Image-to-Image with photo in message');
  try {
    const message = createTelegramMessage({
      hasPhoto: true,
      text: '/i2i make this a watercolor painting'
    });
    
    const result = await mediaTelegramAdapter.processImageToImage(message, services, {
      prompt: 'make this a watercolor painting'
    });
    
    console.log('✅ Image-to-Image Result:', result);
  } catch (error) {
    console.error('❌ Image-to-Image Error:', error);
  }
  
  console.log('\n🧪 Test 2: Background Removal with document');
  try {
    const message = createTelegramMessage({
      hasDocument: true,
      text: '/rmbg'
    });
    
    const result = await mediaTelegramAdapter.removeBackground(message, services, {});
    
    console.log('✅ Background Removal Result:', result);
  } catch (error) {
    console.error('❌ Background Removal Error:', error);
  }
  
  console.log('\n🧪 Test 3: Upscale Image with reply');
  try {
    const message = createTelegramMessage({
      isReply: true,
      text: '/upscale'
    });
    
    const result = await mediaTelegramAdapter.upscaleImage(message, services, {
      settings: {
        scale: 4,
        face_enhance: true
      }
    });
    
    console.log('✅ Upscale Image Result:', result);
  } catch (error) {
    console.error('❌ Upscale Image Error:', error);
  }
  
  console.log('\n🧪 Test 4: Video Generation without image');
  try {
    const message = createTelegramMessage({
      text: '/video a beautiful sunset over the ocean'
    });
    
    const result = await mediaTelegramAdapter.generateVideo(message, services, {
      prompt: 'a beautiful sunset over the ocean'
    });
    
    console.log('✅ Video Generation Result:', result);
  } catch (error) {
    console.error('❌ Video Generation Error:', error);
  }
  
  console.log('\n🧪 Test 5: No Image Error');
  try {
    const message = createTelegramMessage({
      text: '/i2i make this a watercolor painting'
    });
    
    const result = await mediaTelegramAdapter.processImageToImage(message, services, {
      prompt: 'make this a watercolor painting'
    });
    
    console.log('Result (should not reach here):', result);
  } catch (error) {
    console.log('✅ Expected error caught:', error.message);
  }
  
  console.log('\n🧪 All Telegram Tests Completed');
}

// Export the test function
module.exports = {
  runTelegramTests
}; 