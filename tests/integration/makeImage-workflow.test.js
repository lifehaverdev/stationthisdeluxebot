/**
 * Make Image Workflow Integration Test
 * 
 * This test verifies that the makeImage workflow correctly integrates with all services
 * and can successfully generate images using the ComfyUI service.
 */

const { makeImageWorkflow } = require('../../src/workflows');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

// Create a simple mock function factory
function createMockFn(implementation) {
  const fn = implementation || (async () => {});
  
  function mockWrapper(...args) {
    mockWrapper.mock.calls.push(args);
    return fn(...args);
  }
  
  mockWrapper.mock = { calls: [] };
  return mockWrapper;
}

// Mock services
const mockServices = {
  // ComfyUI Service mock
  comfyuiService: {
    generateImage: createMockFn(async (workflow, params, options) => {
      console.log('🔄 ComfyUI Service: Generating image with workflow:', workflow.name);
      console.log('🔄 ComfyUI Service: Parameters:', JSON.stringify(params, null, 2));
      
      // Simulate successful generation
      return {
        success: true,
        id: 'mock-generation-123',
        imageUrls: [
          'https://example.com/generated-image-1.png',
          'https://example.com/generated-image-2.png'
        ]
      };
    })
  },
  
  // Points Service mock
  pointsService: {
    checkBalance: createMockFn(async (userId, pointCost) => {
      console.log(`🔄 Points Service: Checking balance for user ${userId}, cost: ${pointCost}`);
      return true; // User has enough points
    }),
    
    deductPoints: createMockFn(async (userId, pointCost, metadata) => {
      console.log(`🔄 Points Service: Deducting ${pointCost} points from user ${userId}`);
      console.log('🔄 Points Service: Operation metadata:', metadata);
      return { success: true, newBalance: 100 - pointCost };
    }),
    
    addPoints: createMockFn(async (userId, pointAmount, metadata) => {
      console.log(`🔄 Points Service: Adding ${pointAmount} points to user ${userId}`);
      console.log('🔄 Points Service: Operation metadata:', metadata);
      return { success: true, newBalance: 100 + pointAmount };
    })
  },
  
  // Session Service mock
  sessionService: {
    getSession: createMockFn(async (userId) => {
      console.log(`🔄 Session Service: Getting session for user ${userId}`);
      return {
        userId,
        preferences: {
          defaultWorkflow: 'standard',
          negative_prompt: 'blurry, bad quality',
          width: 512,
          height: 512,
          steps: 25,
          cfg_scale: 7.5,
          sampler: 'euler_a'
        },
        lastActive: Date.now()
      };
    }),
    
    setSessionValue: createMockFn(async (userId, key, value) => {
      console.log(`🔄 Session Service: Setting ${key} for user ${userId}`);
      return true;
    })
  },
  
  // Workflows Service mock
  workflowsService: {
    getWorkflow: createMockFn(async (workflowType) => {
      console.log(`🔄 Workflows Service: Getting workflow of type ${workflowType}`);
      return {
        name: workflowType,
        id: `mock-${workflowType}-workflow-id`,
        api: 'comfydeploy',
        deploymentId: 'mock-deployment-123',
        config: {
          // Simulated workflow configuration
          nodes: {}
        }
      };
    })
  },
  
  // Media Service mock
  mediaService: {
    downloadFromUrl: createMockFn(async (url, userId) => {
      console.log(`🔄 Media Service: Downloading media from ${url} for user ${userId}`);
      const filename = url.split('/').pop();
      const localPath = path.join(os.tmpdir(), `${userId}-${filename}`);
      
      // Create an empty file to simulate download
      if (!fs.existsSync(path.dirname(localPath))) {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
      }
      fs.writeFileSync(localPath, 'Mock image data');
      
      console.log(`🔄 Media Service: Downloaded to ${localPath}`);
      return localPath;
    }),
    
    getImageMetadata: createMockFn(async (filePath) => {
      console.log(`🔄 Media Service: Getting metadata for ${filePath}`);
      return {
        width: 512,
        height: 512,
        format: 'png',
        size: 1024 * 1024 // 1MB
      };
    }),
    
    saveMedia: createMockFn(async (filePath, userId, metadata) => {
      console.log(`🔄 Media Service: Saving media ${filePath} for user ${userId}`);
      console.log('🔄 Media Service: Metadata:', metadata);
      
      return {
        path: `/permanent/storage/${userId}/${path.basename(filePath)}`,
        userId,
        timestamp: Date.now(),
        metadata
      };
    })
  },
  
  // Logger mock
  logger: {
    info: createMockFn((...args) => console.log('ℹ️ INFO:', ...args)),
    error: createMockFn((...args) => console.error('❌ ERROR:', ...args)),
    warn: createMockFn((...args) => console.warn('⚠️ WARN:', ...args))
  }
};

// Test user details
const testUser = {
  userId: '5472638766', // The specific user ID from the task
  name: 'Test User'
};

/**
 * Main test function for makeImage workflow
 */
async function testMakeImageWorkflow() {
  console.log('🚀 Starting makeImage workflow test');
  console.log('👤 Test user:', testUser);
  
  // Define test parameters
  const params = {
    userId: testUser.userId,
    prompt: 'a beautiful landscape with mountains and a lake',
    platform: 'telegram',
    message: { chat: { id: testUser.userId } }, // Simplified message object
    options: {
      negative_prompt: 'ugly, blurry, lowres',
      workflowType: 'standard'
    }
  };
  
  console.log('📝 Test parameters:', JSON.stringify(params, null, 2));
  
  try {
    // Run the workflow with our test parameters and mock services
    console.log('▶️ Executing makeImage workflow...');
    const result = await makeImageWorkflow(mockServices, params);
    
    // Log the result
    console.log('\n✅ Workflow execution completed');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    // Verify expected service calls
    console.log('\n🔍 Verifying service calls:');
    
    if (mockServices.pointsService.checkBalance.mock.calls.length > 0) {
      console.log('✅ Points balance check was performed');
    } else {
      console.log('❌ Points balance check was NOT performed');
    }
    
    if (mockServices.sessionService.getSession.mock.calls.length > 0) {
      console.log('✅ User session was retrieved');
    } else {
      console.log('❌ User session was NOT retrieved');
    }
    
    if (mockServices.workflowsService.getWorkflow.mock.calls.length > 0) {
      console.log('✅ Workflow was retrieved');
    } else {
      console.log('❌ Workflow was NOT retrieved');
    }
    
    if (mockServices.comfyuiService.generateImage.mock.calls.length > 0) {
      console.log('✅ ComfyUI service was called to generate image');
    } else {
      console.log('❌ ComfyUI service was NOT called');
    }
    
    if (mockServices.sessionService.setSessionValue.mock.calls.length > 0) {
      console.log('✅ Session was updated with generation history');
    } else {
      console.log('❌ Session was NOT updated with generation history');
    }
    
    // Final assessment
    if (result.success) {
      console.log('\n🎉 TEST PASSED: makeImage workflow executed successfully');
    } else {
      console.log('\n❌ TEST FAILED: makeImage workflow returned error', result.error);
    }
    
    return result;
    
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    throw error;
  }
}

/**
 * Test error scenarios
 */
async function testErrorScenarios() {
  console.log('\n🧪 Testing error scenarios');
  
  // Scenario 1: User does not have enough points
  console.log('\n📉 Scenario 1: User does not have enough points');
  
  // Override the checkBalance mock for this test
  const originalCheckBalance = mockServices.pointsService.checkBalance;
  mockServices.pointsService.checkBalance = createMockFn(async () => false);
  
  try {
    const result = await makeImageWorkflow(mockServices, {
      userId: testUser.userId,
      prompt: 'expensive image that costs too many points',
      platform: 'telegram',
      message: { chat: { id: testUser.userId } }
    });
    
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    if (!result.success && result.error === 'not_enough_points') {
      console.log('✅ TEST PASSED: Correctly handled insufficient points');
    } else {
      console.log('❌ TEST FAILED: Did not correctly handle insufficient points');
    }
  } catch (error) {
    console.error('❌ TEST ERROR:', error);
  }
  
  // Restore original mock
  mockServices.pointsService.checkBalance = originalCheckBalance;
  
  // Scenario 2: ComfyUI generation fails
  console.log('\n🛑 Scenario 2: ComfyUI generation fails');
  
  // Override the generateImage mock for this test
  const originalGenerateImage = mockServices.comfyuiService.generateImage;
  mockServices.comfyuiService.generateImage = createMockFn(async () => ({
    success: false,
    error: 'Mock generation error'
  }));
  
  try {
    const result = await makeImageWorkflow(mockServices, {
      userId: testUser.userId,
      prompt: 'image that will fail to generate',
      platform: 'telegram',
      message: { chat: { id: testUser.userId } }
    });
    
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    if (!result.success && result.error === 'generation_failed') {
      console.log('✅ TEST PASSED: Correctly handled generation failure');
      
      // Check if points were refunded
      if (mockServices.pointsService.addPoints.mock.calls.length > 0) {
        console.log('✅ Points were properly refunded');
      } else {
        console.log('❌ Points were NOT refunded');
      }
    } else {
      console.log('❌ TEST FAILED: Did not correctly handle generation failure');
    }
  } catch (error) {
    console.error('❌ TEST ERROR:', error);
  }
  
  // Restore original mock
  mockServices.comfyuiService.generateImage = originalGenerateImage;
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('📋 MAKE IMAGE WORKFLOW TEST SUITE');
  console.log('=================================\n');
  
  // Run the main workflow test
  await testMakeImageWorkflow();
  
  // Test error scenarios
  await testErrorScenarios();
  
  console.log('\n✨ Test suite completed');
}

// Run the tests
if (require.main === module) {
  runTests().catch(error => {
    console.error('Unhandled error in tests:', error);
    process.exit(1);
  });
} else {
  // Export for use in test framework
  module.exports = {
    testMakeImageWorkflow,
    testErrorScenarios,
    runTests
  };
} 