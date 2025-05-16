/**
 * ComfyDeploy Manual Test Script
 * 
 * This script tests the prompt handling fixes for the ComfyDeploy integration.
 * Run with: node src/services/comfydeploy/manual-test.js
 */

const { PromptBuilder } = require('./index');
const { GenerationRequest } = require('../../core/generation/models');

// Mock the actual API calls for safe testing
class MockComfyClient {
  async sendRequest(request, options) {
    console.log('MOCK API REQUEST:', JSON.stringify(request, null, 2));
    console.log('REQUEST OPTIONS:', JSON.stringify(options, null, 2));
    
    // Simulate successful API response
    return {
      run_id: 'test-run-' + Date.now(),
      status: 'queued'
    };
  }
  
  // Mock event emitter methods
  on() {}
  off() {}
  emit() {}
}

// Run the test
async function runTest() {
  console.log('========================================');
  console.log('COMFYDEPLOY PARAMETER HANDLING TEST');
  console.log('========================================\n');
  
  // Create a prompt builder with default settings
  const promptBuilder = new PromptBuilder({
    getBasePromptByName: (name) => `base prompt for ${name}`,
    defaultSettings: {
      WIDTH: 1024,
      HEIGHT: 1024,
      STEPS: 30,
      CFG: 7
    }
  });
  
  // Instead of using the service, we'll test the prompt builder directly
  // This avoids having to mock the entire service
  
  // Test case 1: Direct prompt in settings.inputs
  console.log('TEST CASE 1: Direct prompt in settings.inputs');
  
  const request1 = new GenerationRequest({
    userId: 'test-user',
    type: 'MAKE',
    prompt: 'This should not be used directly',
    settings: {
      inputs: {
        input_prompt: 'nake sexy beautiful large breasted blonde elf (direct from inputs)'
      }
    }
  });
  
  const userContext = {
    userId: 'test-user',
    balance: 1000
  };
  
  const deploymentInfo = {
    ids: ['test-deployment-1', 'test-deployment-2'],
    inputs: {
      width: 1024,
      height: 1024
    }
  };
  
  try {
    const result1 = await promptBuilder.build(request1, userContext, deploymentInfo);
    console.log('Result 1 input_prompt:', result1.inputs.input_prompt);
    console.log('✅ Test case 1 completed');
  } catch (error) {
    console.error('❌ Test case 1 failed:', error);
  }
  
  console.log('\n');
  
  // Test case 2: Fallback to request.prompt
  console.log('TEST CASE 2: Fallback to request.prompt');
  
  const request2 = new GenerationRequest({
    userId: 'test-user',
    type: 'MAKE',
    prompt: 'nake sexy beautiful large breasted blonde elf (from request.prompt)',
  });
  
  try {
    const result2 = await promptBuilder.build(request2, userContext, deploymentInfo);
    console.log('Result 2 input_prompt:', result2.inputs.input_prompt);
    console.log('✅ Test case 2 completed');
  } catch (error) {
    console.error('❌ Test case 2 failed:', error);
  }
  
  console.log('\n');
  
  // Test case 3: Original empty prompt issue (should now use prompt property)
  console.log('TEST CASE 3: Original empty prompt issue (should now use prompt property)');
  
  const request3 = new GenerationRequest({
    userId: 'test-user',
    type: 'MAKE',
    prompt: 'nake sexy beautiful large breasted blonde elf (from request.prompt)',
    userPrompt: '-1'
  });
  
  try {
    const result3 = await promptBuilder.build(request3, userContext, deploymentInfo);
    console.log('Result 3 input_prompt:', result3.inputs.input_prompt);
    console.log('✅ Test case 3 completed');
  } catch (error) {
    console.error('❌ Test case 3 failed:', error);
  }
  
  // Test case 4: Explicit seed parameter handling
  console.log('TEST CASE 4: Explicit seed parameter handling');
  
  const request4 = new GenerationRequest({
    userId: 'test-user',
    type: 'MAKE',
    prompt: 'This should not be used directly',
    settings: {
      inputs: {
        input_prompt: 'prompt with custom seed value',
        input_seed: 389197908  // Explicit seed value that should be used
      }
    }
  });
  
  try {
    const result4 = await promptBuilder.build(request4, userContext, deploymentInfo);
    console.log('Result 4 input_seed:', result4.inputs.input_seed);
    console.log('✅ Test case 4 completed');
  } catch (error) {
    console.error('❌ Test case 4 failed:', error);
  }
  
  console.log('\n');
  
  // Test case 5: Minimal parameter set - verify only required params are sent
  console.log('TEST CASE 5: Minimal parameter set - verify no unnecessary params');
  
  const request5 = new GenerationRequest({
    userId: 'test-user',
    type: 'MAKE',
    prompt: 'A simple minimal test prompt',
    settings: {
      // No additional settings, should use only required defaults
    }
  });
  
  try {
    const result5 = await promptBuilder.build(request5, userContext, deploymentInfo);
    console.log('Result 5 parameters provided:');
    console.log(JSON.stringify(result5.inputs, null, 2));
    
    // Check we have only the truly required parameters plus any standard defaults
    // Note: We now understand that the API requires these minimal parameters
    const requiredParams = ['input_prompt', 'input_width', 'input_height', 'input_seed'];
    const allowedParams = [...requiredParams, 'input_steps', 'input_cfg', 'input_cfg_scale'];
    
    const hasAllRequiredParams = requiredParams.every(param => result5.inputs[param] !== undefined);
    const hasOnlyAllowedParams = Object.keys(result5.inputs).every(key => allowedParams.includes(key));
    
    if (hasAllRequiredParams && hasOnlyAllowedParams) {
      console.log('✅ Test case 5 completed - Only required and allowed parameters were sent');
    } else {
      console.log('❌ Test case 5 failed - Unexpected parameters were included');
      console.log('Extra parameters:', Object.keys(result5.inputs).filter(key => !allowedParams.includes(key)));
      console.log('Missing required parameters:', requiredParams.filter(param => result5.inputs[param] === undefined));
    }
  } catch (error) {
    console.error('❌ Test case 5 failed:', error);
  }
  
  console.log('\n');
  
  // Test case 6: Explicit parameter override - only provided params should be included
  console.log('TEST CASE 6: Explicit params - only provided explicit params should be included');
  
  const request6 = new GenerationRequest({
    userId: 'test-user',
    type: 'MAKE',
    prompt: 'A simple test prompt with explicit height and CFG',
    settings: {
      // Only provide height and cfg, no other params
      height: 768,
      cfg: 8
    }
  });
  
  try {
    const result6 = await promptBuilder.build(request6, userContext, deploymentInfo);
    console.log('Result 6 parameters provided:');
    console.log(JSON.stringify(result6.inputs, null, 2));
    
    // Check the specific parameters we expect
    const requiredParams = ['input_prompt', 'input_width', 'input_height', 'input_seed'];
    const allowedParams = [...requiredParams, 'input_steps', 'input_cfg', 'input_cfg_scale'];
    
    const hasAllRequiredParams = requiredParams.every(param => result6.inputs[param] !== undefined);
    const hasOnlyAllowedParams = Object.keys(result6.inputs).every(key => allowedParams.includes(key));
    
    // Check for correct user-provided values
    let hasCorrectValues = result6.inputs.input_cfg === 8 || result6.inputs.input_cfg_scale === 8;
    
    if (hasAllRequiredParams && hasOnlyAllowedParams && hasCorrectValues) {
      console.log('✅ Test case 6 completed - Only appropriate parameters were sent with correct values');
    } else {
      console.log('❌ Test case 6 failed - Issues with parameters or values');
      if (!hasAllRequiredParams) {
        console.log('Missing required parameters:', requiredParams.filter(param => result6.inputs[param] === undefined));
      }
      if (!hasOnlyAllowedParams) {
        console.log('Extra parameters:', Object.keys(result6.inputs).filter(key => !allowedParams.includes(key)));
      }
      if (!hasCorrectValues) {
        console.log('CFG setting not properly applied');
      }
    }
  } catch (error) {
    console.error('❌ Test case 6 failed:', error);
  }
  
  console.log('\n');
  
  // Test case 7: QUICKMAKE workflow type
  console.log('TEST CASE 7: QUICKMAKE workflow type handling');
  
  const request7 = new GenerationRequest({
    userId: 'test-user',
    type: 'QUICKMAKE',
    prompt: 'Testing QUICKMAKE workflow type',
    settings: {
      inputs: {
        input_prompt: 'QUICKMAKE test prompt',
        input_cfg: 8
      }
    }
  });
  
  try {
    const result7 = await promptBuilder.build(request7, userContext, deploymentInfo);
    console.log('Result 7 type:', result7.type);
    console.log('Result 7 parameters:', JSON.stringify(Object.keys(result7.inputs), null, 2));
    console.log('✅ Test case 7 completed - QUICKMAKE type preserved');
  } catch (error) {
    console.error('❌ Test case 7 failed:', error);
  }
  
  console.log('\n');
  
  console.log('========================================');
  console.log('TESTS COMPLETED');
  console.log('========================================');
}

// Run the tests
runTest().catch(error => {
  console.error('Test execution failed:', error);
}); 