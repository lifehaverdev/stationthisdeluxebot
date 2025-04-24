/**
 * Parameter Tracing Test Script - Mock Version
 * 
 * This script simulates parameter flow through the system without making API calls.
 */

// Mock parameters to trace through the system
const mockUserInput = {
  prompt: "A beautiful mountain landscape",
  width: 1024,
  height: 768,
  seed: 42,
  steps: 30,
  cfg: 7.5,
  // Nested inputs - representing UI form inputs
  inputs: {
    // Parameters using numeric keys (for UI form field references)
    1: "prompt",
    2: "width",
    3: "height",
    // Parameters with direct keys - some with input_ prefix, some without
    input_seed: 42,
    steps: 30,
    sampler: "euler_a"
  }
};

// Mock the parameter transformation chain

// 1. Web Request Stage
console.log('====== PARAMETER TRACING TEST (MOCK) ======');
console.log('\n1. WEB REQUEST (generationRoutes.js)');
console.log('-----------------------------------------');
console.log('User parameters received:', JSON.stringify(mockUserInput, null, 2));

// 2. Service Entry Stage
console.log('\n2. SERVICE ENTRY (ComfyDeployService.generate)');
console.log('-----------------------------------------');
const serviceInput = {
  type: 'MAKE',
  prompt: mockUserInput.prompt,
  settings: mockUserInput,
  userId: 'test-user'
};
console.log('Service parameters:', JSON.stringify(serviceInput, null, 2));

// 3. Common Prompt Object Stage
console.log('\n3. COMMON PROMPT OBJECT (PromptBuilder._buildCommonPromptObj)');
console.log('-----------------------------------------');
const commonPromptObj = {
  type: serviceInput.type,
  userId: serviceInput.userId,
  prompt: serviceInput.prompt,
  basePrompt: '',
  negativePrompt: 'embedding:easynegative',
  
  // Image settings
  photoStats: {
    height: mockUserInput.height || 1024,
    width: mockUserInput.width || 1024,
  },
  
  // Note how these properties get the input_ prefix directly
  input_seed: mockUserInput.seed || -1,
  input_batch: mockUserInput.batch || 1,
  input_steps: mockUserInput.steps || 30,
  input_cfg: mockUserInput.cfg || 7,
  
  // Original settings preserved
  settings: mockUserInput
};
console.log('Common prompt object:', JSON.stringify(commonPromptObj, null, 2));

// 4. Deployment Info Stage
console.log('\n4. DEPLOYMENT INFO (PromptBuilder._applyDeploymentInfo)');
console.log('-----------------------------------------');
const mockDeploymentInfo = {
  ids: ['10f46770-f89c-47ba-8b06-57c82d3b9bfc'],
  inputs: {
    // Note: Some templates use input_ prefix, others don't - SOURCE OF CONFUSION
    prompt: { type: 'string', required: true },
    negative_prompt: { type: 'string', required: false },
    input_width: { type: 'number', default: 1024 },
    input_height: { type: 'number', default: 1024 },
    input_seed: { type: 'number', default: -1 }
  }
};
console.log('Deployment template:', JSON.stringify(mockDeploymentInfo, null, 2));

// After applying deployment info
const promptObjWithDeployment = {
  ...commonPromptObj,
  deploymentIds: mockDeploymentInfo.ids,
  inputTemplate: mockDeploymentInfo.inputs
};
console.log('Prompt object with deployment info:', JSON.stringify({
  type: promptObjWithDeployment.type,
  deploymentIds: promptObjWithDeployment.deploymentIds,
  inputTemplateKeys: Object.keys(promptObjWithDeployment.inputTemplate || {})
}, null, 2));

// 5. Parameter Normalization Stage
console.log('\n5. FINALIZE REQUEST (PromptBuilder._finalizeRequest)');
console.log('-----------------------------------------');

// Example of normalized parameters with inconsistent prefixing
const normalizedParams = {
  // Properly prefixed parameters from different sources
  input_prompt: "A beautiful mountain landscape",
  input_negative: "embedding:easynegative",
  input_width: 1024,
  input_height: 768,
  input_seed: 42,
  input_steps: 30,
  input_cfg: 7.5,
  
  // Parameters that might be incorrect without the input_ prefix
  // These could cause issues if the API expects all parameters with input_ prefix
  sampler: "euler_a",
  batch_size: 1
};

console.log('Normalized parameters:', JSON.stringify(normalizedParams, null, 2));

// 6. API Request Stage
console.log('\n6. API REQUEST (ComfyClient.sendRequest)');
console.log('-----------------------------------------');

// This is what should be sent to the API
const finalAPIRequest = {
  deployment_id: '10f46770-f89c-47ba-8b06-57c82d3b9bfc',
  // All inputs should have input_ prefix for API
  inputs: {
    input_prompt: "A beautiful mountain landscape",
    input_negative: "embedding:easynegative",
    input_width: 1024,
    input_height: 768,
    input_seed: 42,
    input_steps: 30,
    input_cfg: 7.5,
    input_sampler: "euler_a",
    input_batch_size: 1
  }
};

console.log('API request payload:', JSON.stringify(finalAPIRequest, null, 2));

// Analyze the parameter transformation
console.log('\n====== PARAMETER TRANSFORMATION ANALYSIS ======');

// 1. Identify parameters with inconsistent naming
const inconsistentParams = Object.keys(normalizedParams)
  .filter(key => !key.startsWith('input_'));

console.log('\nINCONSISTENT PARAMETER NAMING:');
if (inconsistentParams.length > 0) {
  console.log('The following parameters are missing the required input_ prefix:');
  console.log(JSON.stringify(inconsistentParams, null, 2));
} else {
  console.log('All parameters have the correct input_ prefix');
}

// 2. Identify template/API mismatches
const templateKeys = Object.keys(mockDeploymentInfo.inputs);
const templateWithoutPrefix = templateKeys.filter(key => !key.startsWith('input_'));
const templateWithPrefix = templateKeys.filter(key => key.startsWith('input_'));

console.log('\nTEMPLATE/API PREFIX MISMATCH:');
if (templateWithoutPrefix.length > 0 && templateWithPrefix.length > 0) {
  console.log('Deployment template has inconsistent parameter naming:');
  console.log('- Parameters with input_ prefix:', templateWithPrefix);
  console.log('- Parameters without input_ prefix:', templateWithoutPrefix);
} else if (templateWithoutPrefix.length === 0) {
  console.log('Deployment template consistently uses input_ prefix');
} else {
  console.log('Deployment template consistently does not use input_ prefix');
}

// 3. Show the parameter mapping transformation
console.log('\nPARAMETER MAPPING TRANSFORMATION:');
console.log('| Original Parameter | Intermediate Form | Final API Parameter |');
console.log('|-------------------|------------------|-------------------|');
console.log(`| width              | ${commonPromptObj.input_width ? 'input_width' : 'width'} (commonPromptObj) | input_width         |`);
console.log(`| height             | ${commonPromptObj.input_height ? 'input_height' : 'height'} (commonPromptObj) | input_height        |`);
console.log(`| prompt             | prompt (commonPromptObj) | input_prompt        |`);
console.log(`| inputs.sampler     | ${commonPromptObj.input_sampler ? 'input_sampler' : 'sampler or undefined'} | ${normalizedParams.input_sampler ? 'input_sampler' : normalizedParams.sampler ? 'sampler (!) INCORRECT' : 'input_sampler'} |`);

console.log('\n====== RECOMMENDED SOLUTION ======');
console.log('1. Ensure deployment templates consistently use input_ prefix');
console.log('2. Normalize parameter names at the earliest possible stage');
console.log('3. Validate parameter names before API request to ensure correct prefixing');
console.log('4. Update client-side code to use consistent parameter naming');

console.log('\n====== PARAMETER TRACING TEST COMPLETE ======'); 