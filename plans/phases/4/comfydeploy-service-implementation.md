# ComfyDeploy Service Implementation Plan

## Overview
This document outlines the detailed implementation plan for enhancing the ComfyDeployService to fully support all image generation capabilities currently handled by the legacy code in `commands/make.js` and `utils/bot/handlers/iMake.js`.

## Current State

The ComfyDeployService is partially implemented with basic functionality, but lacks support for:
1. All generation types (MAKE, I2I, MAKE_PLUS, INPAINT, etc.)
2. Specialized options like LoRA triggers
3. Complete error handling and event propagation
4. Integration with the workflow system

## Implementation Tasks

### 1. API Client Enhancement

#### 1.1 Complete ComfyClient methods
- Add support for all ComfyDeploy API endpoints
- Implement robust error handling with standardized error types
- Add request rate limiting and retry logic
- Create detailed logging for all API operations

```javascript
// Enhancement to ComfyClient.js
async getRunStatus(runId) {
  try {
    const response = await this._makeRequest(`run?run_id=${runId}`, {
      method: 'GET'
    });
    
    return this._processStatusResponse(response);
  } catch (error) {
    this._handleApiError('getRunStatus', error, runId);
  }
}

async cancelRun(runId) {
  try {
    const response = await this._makeRequest(`cancel`, {
      method: 'POST',
      body: JSON.stringify({ run_id: runId })
    });
    
    return response;
  } catch (error) {
    this._handleApiError('cancelRun', error, runId);
  }
}
```

### 2. Generation Request Builder

#### 2.1 Create PromptBuilder for all generation types
- Implement logic to build proper ComfyDeploy API requests
- Support all generation types from the legacy codebase
- Create parameterized templates for each type

```javascript
// Enhancement to PromptBuilder.js
buildPromptForType(type, promptData) {
  switch (type) {
    case 'MAKE':
      return this._buildMakePrompt(promptData);
    case 'I2I':
      return this._buildImageToImagePrompt(promptData);
    case 'MAKE_PLUS':
      return this._buildMakePlusPrompt(promptData);
    case 'INPAINT':
      return this._buildInpaintPrompt(promptData);
    // Additional types...
    default:
      return this._buildDefaultPrompt(promptData);
  }
}

_buildMakePrompt(promptData) {
  // Extract required fields
  const { prompt, negative_prompt, width, height, seed, steps } = promptData;
  
  // Apply LoRA processing
  const processedPrompt = this._processLoRaTriggers(prompt);
  
  // Return formatted request
  return {
    prompt: processedPrompt,
    negative_prompt: negative_prompt || this.defaultNegativePrompt,
    width: width || 1024,
    height: height || 1024,
    seed: seed || -1,
    steps: steps || 30,
    // Other parameters
  };
}
```

#### 2.2 LoRA Trigger Integration
- Port `handleLoraTrigger` functionality from legacy code
- Create structured middleware for prompt processing
- Support balance-based LoRA selection

```javascript
// Add to PromptBuilder.js
_processLoRaTriggers(prompt, checkpoint, balance) {
  try {
    // Call the existing handler but in a structured way
    return this.loraTriggerHandler(prompt, checkpoint, balance);
  } catch (error) {
    this.logger.error('LoRA trigger processing failed:', error);
    return prompt; // Return original prompt on error
  }
}
```

### 3. Generation Type Support

#### 3.1 Implement comprehensive generation type mapping
- Create a mapping system for all generation types
- Support for combined types (e.g., MAKE_STYLE_POSE)
- Document each type and its specific requirements

```javascript
// Addition to ComfyDeployService.js
static GENERATION_TYPES = {
  // Basic types
  MAKE: {
    deploymentKey: 'sdxl',
    requiresPrompt: true,
    supportsControlNet: false,
    template: 'standard'
  },
  I2I: {
    deploymentKey: 'img2img',
    requiresPrompt: true,
    requiresImage: true,
    template: 'img2img'
  },
  MAKE_PLUS: {
    deploymentKey: 'sdxl_plus',
    requiresPrompt: true,
    supportsControlNet: true,
    supportsStyleTransfer: true,
    template: 'enhanced'
  },
  // Additional types...
};

// Composition system for combined types
_getTypeComponents(type) {
  return type.split('_').map(part => ({
    base: part,
    config: this.GENERATION_TYPES[part] || {}
  }));
}
```

#### 3.2 Deployment selection logic
- Implement machine/deployment selection algorithms from legacy code
- Support load balancing and specialized deployments
- Add proper error handling for unavailable deployments

```javascript
// Addition to ComfyDeployService.js
_selectDeployment(type, options = {}) {
  const { isCookMode, isAPI, priority } = options;
  
  // Get available deployments for this type
  const deployments = this.getDeploymentInfo(type);
  
  if (!deployments || deployments.length === 0) {
    throw new AppError(`No deployments available for type: ${type}`, {
      severity: ERROR_SEVERITY.ERROR,
      code: 'NO_DEPLOYMENTS_AVAILABLE'
    });
  }
  
  // Apply selection logic similar to chooseIdByMachine in legacy code
  if (isCookMode) {
    return deployments[0]; // First machine for cook mode
  }
  
  if (isAPI) {
    return deployments[2]; // Third machine for API
  }
  
  // Default selection logic
  const randomIndex = Math.floor(Math.random() * deployments.length);
  return deployments[randomIndex];
}
```

### 4. Output Parsing and Processing

#### 4.1 Standardized output processing
- Implement robust parsing for ComfyDeploy responses
- Support for all media types (images, gifs, videos)
- Create proper type detection and metadata extraction

```javascript
// Addition to ComfyDeployService.js
_processOutputs(apiResponse) {
  if (!apiResponse || !apiResponse.outputs) {
    return { mediaUrls: [] };
  }
  
  const mediaUrls = [];
  const possibleTypes = ["images", "gifs", "videos"];
  
  // Process all outputs and media types
  apiResponse.outputs.forEach(output => {
    possibleTypes.forEach(type => {
      if (output.data && output.data[type] && output.data[type].length > 0) {
        output.data[type].forEach(item => {
          const url = item.url;
          const mediaType = this._detectMediaType(url);
          
          mediaUrls.push({
            type: mediaType,
            url: url,
            metadata: {
              width: item.width,
              height: item.height,
              size: item.size
            }
          });
        });
      }
    });
  });
  
  return {
    mediaUrls,
    progress: apiResponse.progress,
    status: apiResponse.status
  };
}

_detectMediaType(url) {
  const extension = url.split('.').pop().toLowerCase();
  
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
    return 'image';
  } else if (extension === 'gif') {
    return 'animation';
  } else if (['mp4', 'webm', 'mov'].includes(extension)) {
    return 'video';
  }
  
  return 'unknown';
}
```

### 5. Event System Enhancement

#### 5.1 Comprehensive event emission
- Create a robust event system for generation status updates
- Emit events for progress, completion, and errors
- Support for webhook-based updates

```javascript
// Enhancement to ComfyDeployService.js
_setupEventEmitters() {
  // Standard events
  this.EVENTS = {
    GENERATION_STARTED: 'generation:started',
    GENERATION_PROGRESS: 'generation:progress',
    GENERATION_COMPLETED: 'generation:completed',
    GENERATION_FAILED: 'generation:failed',
    MEDIA_AVAILABLE: 'media:available'
  };
  
  // Set up client event forwarding
  this.client.on('run:started', (data) => {
    this.emit(this.EVENTS.GENERATION_STARTED, {
      runId: data.runId,
      timestamp: Date.now(),
      ...data
    });
  });
  
  this.client.on('run:progress', (data) => {
    this.emit(this.EVENTS.GENERATION_PROGRESS, {
      runId: data.runId,
      progress: data.progress,
      timestamp: Date.now(),
      ...data
    });
  });
  
  // Additional event handlers...
}
```

#### 5.2 Webhook handling
- Implement webhook processing for asynchronous updates
- Create standardized event mapping from webhooks
- Support for resuming workflows from webhook notifications

```javascript
// Enhancement to ComfyDeployService.js
processWebhook(payload) {
  try {
    // Validate webhook payload
    if (!payload || !payload.run_id) {
      throw new Error('Invalid webhook payload');
    }
    
    const { run_id, status, progress, outputs } = payload;
    
    // Process based on status
    switch (status) {
      case 'running':
        this.emit(this.EVENTS.GENERATION_PROGRESS, {
          runId: run_id,
          progress: progress || 0,
          status: 'running'
        });
        break;
        
      case 'success':
        // Process outputs
        const processedOutput = this._processOutputs(payload);
        
        // Emit completion event
        this.emit(this.EVENTS.GENERATION_COMPLETED, {
          runId: run_id,
          mediaUrls: processedOutput.mediaUrls,
          status: 'success'
        });
        
        // Emit media events for each output
        processedOutput.mediaUrls.forEach(media => {
          this.emit(this.EVENTS.MEDIA_AVAILABLE, {
            runId: run_id,
            mediaType: media.type,
            mediaUrl: media.url,
            metadata: media.metadata
          });
        });
        break;
        
      case 'failed':
        this.emit(this.EVENTS.GENERATION_FAILED, {
          runId: run_id,
          error: payload.error || 'Generation failed',
          status: 'failed'
        });
        break;
    }
    
    return true;
  } catch (error) {
    console.error('Error processing webhook:', error);
    return false;
  }
}
```

### 6. Public API Methods

#### 6.1 Create unified generation method
- Implement a comprehensive `generate()` method supporting all types
- Handle parameter validation and preparation
- Integrate with the workflow system

```javascript
// Enhancement to ComfyDeployService.js
async generate(request, context) {
  try {
    // Create a standardized request object
    const generationRequest = request instanceof GenerationRequest
      ? request
      : new GenerationRequest(request);
      
    // Validate request
    this._validateRequest(generationRequest);
    
    // Process prompt if needed
    if (generationRequest.prompt) {
      generationRequest.processedPrompt = await this.promptBuilder.processPrompt(
        generationRequest.prompt,
        generationRequest.checkpoint,
        context.balance
      );
    }
    
    // Select appropriate deployment
    const deployment = this._selectDeployment(
      generationRequest.type,
      {
        isCookMode: generationRequest.isCookMode,
        isAPI: generationRequest.isAPI,
        priority: generationRequest.priority
      }
    );
    
    // Build the API request
    const apiRequest = this.promptBuilder.buildRequest(
      generationRequest,
      deployment,
      context
    );
    
    // Make the API call
    const result = await this.client.createRun(apiRequest);
    
    // Return a structured result
    return {
      runId: result.run_id,
      status: 'started',
      type: generationRequest.type,
      userId: context.userId,
      timestamp: Date.now()
    };
  } catch (error) {
    // Handle and transform errors
    const appError = this._transformError(error);
    throw appError;
  }
}
```

#### 6.2 Status checking and cancellation
- Add methods for checking generation status
- Implement run cancellation
- Create helper methods for common operations

```javascript
// Enhancement to ComfyDeployService.js
async checkStatus(runId) {
  try {
    // Get status from API
    const status = await this.client.getRunStatus(runId);
    
    // Process outputs if available
    if (status.outputs) {
      status.processedOutputs = this._processOutputs(status);
    }
    
    return status;
  } catch (error) {
    const appError = this._transformError(error);
    throw appError;
  }
}

async cancelGeneration(runId) {
  try {
    const result = await this.client.cancelRun(runId);
    
    this.emit(this.EVENTS.GENERATION_CANCELLED, {
      runId,
      timestamp: Date.now()
    });
    
    return result;
  } catch (error) {
    const appError = this._transformError(error);
    throw appError;
  }
}
```

## Testing Plan

### 1. Unit Tests

- Test ComfyClient API interactions with mocked responses
- Test PromptBuilder for all generation types
- Test event emission and webhook processing
- Test error handling and recovery

### 2. Integration Tests

- Test end-to-end generation flow with mocked API
- Verify proper event propagation
- Test interaction with workflow system

### 3. Manual Testing

- Test real API integration with sample prompts
- Verify output processing with actual ComfyDeploy responses
- Test webhook handling with real deployment

## Implementation Timeline

1. **Day 1-2**: Complete ComfyClient methods and error handling
2. **Day 3-4**: Implement PromptBuilder and generation type support
3. **Day 5-6**: Add output processing and event system
4. **Day 7-8**: Implement public API methods and workflow integration
5. **Day 9-10**: Write tests and documentation 