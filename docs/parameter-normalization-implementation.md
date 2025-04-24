# Parameter Normalization Implementation Plan

This document outlines the implementation plan for integrating the parameter normalization utility to address inconsistencies in parameter naming across the system.

## Context

Our parameter tracing analysis revealed inconsistencies in how parameters are named and transformed throughout the workflow:

1. Parameters in user inputs and workflow templates sometimes include the `input_` prefix and sometimes don't
2. The ComfyDeploy API expects all parameters to include the `input_` prefix
3. The complex parameter transformation logic in `PromptBuilder._finalizeRequest()` is difficult to maintain

## Implementation Plan

### 1. Early Parameter Normalization

Normalize parameters at system boundaries to ensure consistent naming:

#### Integration in Web Routes

```javascript
// src/integrations/web/generationRoutes.js
const { normalizeUIParameters } = require('../../services/comfydeploy/utils/normalizeParameters');

router.post('/execute', async (req, res) => {
  try {
    const { workflowId, parameters, userId } = req.body;
    
    // Normalize parameters early
    const normalizedParams = normalizeUIParameters(parameters);
    
    // Pass normalized parameters to the service
    const result = await comfyDeployService.generate({
      type: workflowId,
      prompt: normalizedParams.input_prompt || '',
      settings: normalizedParams,
      userId: userId || 'web-user',
    }, {
      source: 'web-interface'
    });
    
    // Rest of the function...
  } catch (error) {
    // Error handling...
  }
});
```

#### Integration in ComfyDeployService

```javascript
// src/services/comfydeploy/ComfyDeployService.js
const { normalizeParameterKeys } = require('./utils/normalizeParameters');

async generate(promptObj, userContext, options = {}) {
  try {
    // Early normalization of any settings
    if (promptObj.settings) {
      promptObj.settings = normalizeParameterKeys(promptObj.settings, {
        shallow: true, 
        ignoreKeys: ['inputs', 'type']
      });
    }
    
    // Rest of the function...
  } catch (error) {
    // Error handling...
  }
}
```

### 2. Template Normalization

Ensure deployment templates consistently use the `input_` prefix:

```javascript
// src/services/comfydeploy/ComfyDeployService.js
const { normalizeTemplateParameters } = require('./utils/normalizeParameters');

_defaultGetDeploymentInfo(type) {
  // Get type info
  const typeInfo = typeToDeployment[type] || typeToDeployment['MAKE'];
  
  // Normalize the template
  if (typeInfo.inputTemplate) {
    typeInfo.inputTemplate = normalizeTemplateParameters(typeInfo.inputTemplate);
  }
  
  // Return deployment IDs and inputs
  const result = {
    ids: [typeInfo.deploymentId || 'default_deployment_id'],
    inputs: typeInfo.inputTemplate || {}
  };
  
  return result;
}
```

### 3. Simplify _finalizeRequest Method

Replace the complex parameter normalization logic in PromptBuilder with the utility:

```javascript
// src/services/comfydeploy/PromptBuilder.js
const { normalizeParameterKeys, normalizeAPIParameters } = require('./utils/normalizeParameters');

_finalizeRequest(promptObj) {
  // Choose deployment ID
  const deploymentId = this._chooseDeploymentId(promptObj);
  
  // Collect parameters from all sources
  const allParams = {
    // Default parameters (lowest priority)
    ...this._getDefaultParams(),
    
    // Template parameters (medium priority)
    ...(promptObj.inputTemplate || {}),
    
    // Explicit parameters from settings (highest priority)
    ...(promptObj.settings || {})
  };
  
  // Add special handling for prompt text
  if (promptObj.finalPrompt) {
    allParams.input_prompt = promptObj.finalPrompt;
  }
  
  // Create normalized inputs object
  const finalInputs = normalizeParameterKeys(allParams, {
    ignoreKeys: ['userId', 'type', 'deploymentIds', 'originalPrompt']
  });
  
  // Final API request structure
  const apiRequest = {
    deployment_id: deploymentId,
    inputs: finalInputs,
    originalPrompt: promptObj
  };
  
  // Ensure API parameters are normalized
  return normalizeAPIParameters(apiRequest);
}
```

### 4. Final API Request Validation

Add a validation step in the ComfyClient to ensure all parameters have correct prefixes:

```javascript
// src/services/comfydeploy/ComfyClient.js
const { normalizeAPIParameters } = require('./utils/normalizeParameters');

async sendRequest(promptObj, options = {}) {
  this._checkConnection();
  
  // Ensure all input parameters have the input_ prefix
  const normalizedPromptObj = normalizeAPIParameters(promptObj);
  
  // Validate that all inputs have the required prefix
  this._validateInputPrefixes(normalizedPromptObj.inputs);
  
  // Rest of the function...
}

_validateInputPrefixes(inputs) {
  if (!inputs || typeof inputs !== 'object') return;
  
  const nonPrefixedParams = Object.keys(inputs).filter(key => !key.startsWith('input_'));
  
  if (nonPrefixedParams.length > 0) {
    console.warn('⚠️ WARNING: Non-prefixed parameters found in API request:', nonPrefixedParams);
    // Could throw an error in strict mode
  }
}
```

## Testing Plan

1. **Unit Tests**: We've already created tests for the normalization utility 
2. **Integration Tests**: Create tests that verify parameters flow correctly end-to-end
3. **Manual Testing**: Test actual API requests with monitoring

## Rollout Plan

1. **Phase 1**: Deploy normalization utility and tests
2. **Phase 2**: Integrate in ComfyDeployService and PromptBuilder (with parallel validation for safety)
3. **Phase 3**: Integrate in web routes and other input boundaries
4. **Phase 4**: Enable strict validation (error on non-prefixed parameters)

## Benefits

- **Consistency**: Parameters will have consistent naming throughout the system
- **Simplicity**: The complex parameter transformation logic is replaced with simple utility functions
- **Reliability**: Early normalization prevents issues from propagating through the system
- **Maintainability**: Centralized parameter handling logic is easier to understand and update 