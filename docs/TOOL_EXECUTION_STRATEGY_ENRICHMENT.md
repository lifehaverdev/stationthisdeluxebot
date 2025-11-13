# Tool Execution Strategy Enrichment

## Problem Statement

Currently, `WorkflowExecutionService` contains extensive conditional logic to handle different service types:

```javascript
// Current messy approach in WorkflowExecutionService
if (adapter) {
    if (tool.deliveryMode === 'immediate') {
        // Skip adapter, use centralized endpoint
    } else if (typeof adapter.startJob === 'function') {
        // Create generation record
        // Start async job
        // Set up polling
        // Handle webhook
    }
}

if (tool.deliveryMode === 'immediate' && executionResponse.data?.response) {
    // Update generation record
    // Send WebSocket notifications
    // Handle immediate response
}

// Different output normalization based on tool type
if (pollRes.type === 'text' && finalData) {
    if (typeof finalData.text === 'string') {
        finalData = { text: [finalData.text] };
    } else if (typeof finalData.description === 'string') {
        finalData = { text: [finalData.description] };
    }
}
```

This creates:
- ❌ Tight coupling between WorkflowExecutionService and service implementations
- ❌ Hard to add new service types
- ❌ Difficult to test service-specific logic
- ❌ Code duplication across different service handlers

## Solution: Execution Strategy Pattern

Move all service-specific logic into **enriched tool definitions** using an **Execution Strategy** pattern. Each tool defines how it should be executed, how its output should be processed, and how it should notify users.

## Enriched Tool Definition Structure

### Current Tool Definition (Minimal)
```javascript
{
  toolId: 'chatgpt-free',
  displayName: 'ChatGPT',
  service: 'openai',
  deliveryMode: 'immediate',
  inputSchema: { /* ... */ }
}
```

### Enriched Tool Definition (With Execution Strategy)
```javascript
{
  toolId: 'chatgpt-free',
  displayName: 'ChatGPT',
  service: 'openai',
  deliveryMode: 'immediate',
  inputSchema: { /* ... */ },
  
  // NEW: Execution Strategy
  executionStrategy: {
    type: 'immediate',
    
    // How to execute this tool
    execute: async (inputs, context, dependencies) => {
      // Tool-specific execution logic
      // Returns: { generationId, response, status }
    },
    
    // How to handle execution response
    handleResponse: async (executionResponse, context, dependencies) => {
      // Update generation record
      // Send WebSocket notifications
      // Return processed response
    },
    
    // How to normalize output for this tool
    normalizeOutput: (rawOutput) => {
      // Tool-specific normalization
      // Returns: standardized output format
    },
    
    // How to handle errors/timeouts
    handleError: async (error, context, dependencies) => {
      // Tool-specific error handling
    },
    
    // Retry policy for this tool
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelay: 1000
    }
  }
}
```

## Execution Strategy Types

### 1. Immediate Strategy (e.g., ChatGPT, String Primitive)

```javascript
{
  toolId: 'chatgpt-free',
  executionStrategy: {
    type: 'immediate',
    
    execute: async (inputs, context, dependencies) => {
      const { internalApiClient, eventId } = dependencies;
      
      // Call centralized execution endpoint
      const response = await internalApiClient.post('/internal/v1/data/execute', {
        toolId: context.tool.toolId,
        inputs,
        user: context.user,
        eventId,
        metadata: context.metadata
      });
      
      return {
        generationId: response.data.generationId,
        response: response.data.response,
        status: 'completed'
      };
    },
    
    handleResponse: async (executionResponse, context, dependencies) => {
      const { generationRecordManager, workflowNotifier } = dependencies;
      
      // Update generation record
      await generationRecordManager.updateGenerationRecord(
        executionResponse.generationId,
        {
          responsePayload: { result: executionResponse.response },
          status: 'completed'
        }
      );
      
      // Send WebSocket notifications
      await workflowNotifier.notifyStepProgress(
        context,
        executionResponse.generationId,
        context.tool
      );
      
      await workflowNotifier.notifyToolResponse(
        context,
        context.tool,
        executionResponse.response
      );
      
      return executionResponse.response;
    },
    
    normalizeOutput: (rawOutput) => {
      // ChatGPT returns text directly
      if (typeof rawOutput === 'string') {
        return { text: [rawOutput] };
      }
      if (rawOutput?.result) {
        return { text: [rawOutput.result] };
      }
      return rawOutput;
    },
    
    handleError: async (error, context, dependencies) => {
      // For immediate tools, timeout errors are acceptable
      if (error.message?.includes('timeout') || error.message?.includes('exceeded')) {
        // Generation continues in background, event-driven continuation handles it
        return { handled: true, shouldRetry: false };
      }
      return { handled: false, shouldRetry: true };
    },
    
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelay: 1000
    }
  }
}
```

### 2. Async Adapter Strategy (e.g., HuggingFace)

```javascript
{
  toolId: 'huggingface-image-classification',
  executionStrategy: {
    type: 'async_adapter',
    
    execute: async (inputs, context, dependencies) => {
      const { adapter, generationRecordManager, eventId } = dependencies;
      
      // Create generation record FIRST
      const generationParams = {
        masterAccountId: context.user.masterAccountId,
        initiatingEventId: eventId,
        serviceName: context.tool.service,
        toolId: context.tool.toolId,
        requestPayload: inputs,
        status: 'processing',
        deliveryStatus: 'pending',
        deliveryStrategy: 'spell_step',
        metadata: {
          isSpell: true,
          castId: context.castId,
          spell: context.spell,
          stepIndex: context.stepIndex,
          pipelineContext: context.pipelineContext,
          originalContext: context.originalContext,
          run_id: null
        }
      };
      
      const { generationId } = await generationRecordManager.createGenerationRecord(generationParams);
      
      // Start async job
      const runInfo = await adapter.startJob(inputs);
      
      // Update with runId
      await generationRecordManager.updateGenerationRecord(generationId, {
        'metadata.run_id': runInfo.runId
      });
      
      // Start polling (delegated to AsyncJobPoller)
      return {
        generationId,
        runId: runInfo.runId,
        status: 'processing',
        pollingRequired: true
      };
    },
    
    normalizeOutput: (rawOutput) => {
      // HuggingFace-specific normalization
      if (rawOutput?.type === 'text' && rawOutput?.data) {
        if (typeof rawOutput.data.text === 'string') {
          return { text: [rawOutput.data.text] };
        } else if (typeof rawOutput.data.description === 'string') {
          return { text: [rawOutput.data.description] };
        }
      }
      return rawOutput;
    },
    
    handleError: async (error, context, dependencies) => {
      // Update generation record to failed
      await dependencies.generationRecordManager.updateGenerationRecord(
        context.generationId,
        {
          status: 'failed',
          deliveryError: error.message
        }
      );
      return { handled: true, shouldRetry: false };
    },
    
    retryPolicy: {
      maxAttempts: 60, // 5 min at 5s interval
      backoff: 'fixed',
      baseDelay: 5000
    }
  }
}
```

### 3. Webhook Strategy (e.g., ComfyUI)

```javascript
{
  toolId: 'comfyui-text-to-image',
  executionStrategy: {
    type: 'webhook',
    
    execute: async (inputs, context, dependencies) => {
      const { adapter, generationRecordManager, eventId } = dependencies;
      
      // Create generation record
      const generationParams = {
        // ... same as async_adapter
        metadata: {
          // ... same as async_adapter
          run_id: null // Will be set by webhook processor
        }
      };
      
      const { generationId } = await generationRecordManager.createGenerationRecord(generationParams);
      
      // Start job via adapter
      const runInfo = await adapter.startJob(inputs);
      
      // Update with runId
      await generationRecordManager.updateGenerationRecord(generationId, {
        'metadata.run_id': runInfo.runId
      });
      
      // Webhook will handle completion
      return {
        generationId,
        runId: runInfo.runId,
        status: 'processing',
        webhookExpected: true
      };
    },
    
    normalizeOutput: (rawOutput) => {
      // ComfyUI-specific normalization
      if (rawOutput?.images) {
        return { images: rawOutput.images };
      }
      return rawOutput;
    },
    
    handleError: async (error, context, dependencies) => {
      // Webhook tools don't poll, errors come via webhook
      return { handled: false, shouldRetry: false };
    }
  }
}
```

## Refactored WorkflowExecutionService

### Before (Messy)
```javascript
async _executeStep(spell, stepIndex, pipelineContext, originalContext) {
    // ... validation ...
    
    const adapter = adapterRegistry.get(tool.service);
    if (adapter) {
        if (tool.deliveryMode === 'immediate') {
            // Skip adapter path
        } else if (typeof adapter.startJob === 'function') {
            // Create generation record
            // Start async job
            // Set up polling
            // Handle webhook
        }
    }
    
    // Call centralized endpoint
    const executionResponse = await this.internalApiClient.post('/internal/v1/data/execute', ...);
    
    if (tool.deliveryMode === 'immediate' && executionResponse.data?.response) {
        // Update generation record
        // Send WebSocket notifications
    }
    
    // Different output normalization based on tool type
    // ... messy conditionals ...
}
```

### After (Clean)
```javascript
async _executeStep(spell, stepIndex, pipelineContext, originalContext) {
    // ... validation ...
    
    // Get execution strategy (with fallback to default)
    const strategy = tool.executionStrategy || this._getDefaultStrategy(tool);
    
    // Prepare execution context
    const executionContext = {
        tool,
        spell,
        stepIndex,
        pipelineContext,
        originalContext,
        user: {
            masterAccountId: originalContext.masterAccountId,
            platform: originalContext.platform,
            // ...
        },
        castId: originalContext.castId,
        metadata: {
            isSpell: true,
            castId: originalContext.castId,
            spell,
            stepIndex,
            pipelineContext,
            originalContext
        }
    };
    
    // Prepare dependencies
    const dependencies = {
        adapter: this.adapterRegistry.get(tool.service),
        generationRecordManager: this.generationRecordManager,
        workflowNotifier: this.workflowNotifier,
        eventManager: this.eventManager,
        internalApiClient: this.internalApiClient,
        eventId: await this.eventManager.createEvent(...)
    };
    
    // Execute using strategy
    try {
        const result = await strategy.execute(pipelineContext, executionContext, dependencies);
        
        // Handle response using strategy
        if (result.status === 'completed' && strategy.handleResponse) {
            await strategy.handleResponse(result, executionContext, dependencies);
        }
        
        return result;
    } catch (error) {
        // Handle error using strategy
        if (strategy.handleError) {
            const errorResult = await strategy.handleError(error, executionContext, dependencies);
            if (errorResult.handled) {
                return; // Error handled by strategy
            }
        }
        throw error; // Re-throw if not handled
    }
}
```

## Strategy Factory Pattern

For tools that don't define their own strategy, provide a factory that creates default strategies based on tool properties:

```javascript
// In WorkflowExecutionService or StrategyFactory
_getDefaultStrategy(tool) {
    if (tool.deliveryMode === 'immediate') {
        return this._createImmediateStrategy(tool);
    } else if (tool.deliveryMode === 'webhook') {
        const adapter = this.adapterRegistry.get(tool.service);
        if (adapter && typeof adapter.startJob === 'function') {
            return this._createWebhookStrategy(tool);
        }
        return this._createAsyncAdapterStrategy(tool);
    }
    throw new Error(`Unknown deliveryMode: ${tool.deliveryMode}`);
}

_createImmediateStrategy(tool) {
    return {
        type: 'immediate',
        execute: async (inputs, context, deps) => {
            // Default immediate execution
        },
        handleResponse: async (response, context, deps) => {
            // Default immediate response handling
        },
        normalizeOutput: (output) => {
            // Default output normalization
        }
    };
}
```

## Benefits

### 1. Cleaner WorkflowExecutionService
- ✅ No more conditional logic for different service types
- ✅ Single execution path: `strategy.execute()`
- ✅ Easy to understand and maintain

### 2. Tool-Specific Logic Encapsulated
- ✅ Each tool defines its own execution behavior
- ✅ Output normalization is tool-specific
- ✅ Error handling is tool-specific
- ✅ Retry policies are tool-specific

### 3. Easy to Add New Service Types
- ✅ Just define a new execution strategy
- ✅ No changes to WorkflowExecutionService needed
- ✅ Can even support custom strategies per tool

### 4. Better Testability
- ✅ Test execution strategies independently
- ✅ Mock strategies in WorkflowExecutionService tests
- ✅ Test tool-specific logic in isolation

### 5. Better Maintainability
- ✅ Service-specific bugs are isolated to strategy definitions
- ✅ Changes to one service type don't affect others
- ✅ Clear separation of concerns

## Migration Strategy

### Phase 1: Create Strategy Interface
1. Define `ExecutionStrategy` interface/type
2. Create default strategy factory
3. Add strategy property to tool definitions (optional initially)

### Phase 2: Extract Default Strategies
1. Create `ImmediateStrategy` class
2. Create `AsyncAdapterStrategy` class
3. Create `WebhookStrategy` class
4. Move logic from WorkflowExecutionService to strategies

### Phase 3: Update WorkflowExecutionService
1. Refactor `_executeStep` to use strategies
2. Remove conditional logic
3. Use strategy factory for tools without explicit strategies

### Phase 4: Enrich Tool Definitions
1. Add execution strategies to tool definitions
2. Customize strategies per tool as needed
3. Remove default strategy fallbacks over time

## Example: Enriched Tool Definition File

```javascript
// src/core/tools/definitions/chatgpt-free.js
module.exports = {
  toolId: 'chatgpt-free',
  displayName: 'ChatGPT',
  service: 'openai',
  deliveryMode: 'immediate',
  inputSchema: {
    prompt: {
      name: 'prompt',
      type: 'text',
      required: true
    }
  },
  
  executionStrategy: {
    type: 'immediate',
    
    execute: async (inputs, context, deps) => {
      const response = await deps.internalApiClient.post('/internal/v1/data/execute', {
        toolId: context.tool.toolId,
        inputs,
        user: context.user,
        eventId: deps.eventId,
        metadata: context.metadata
      });
      
      return {
        generationId: response.data.generationId,
        response: response.data.response,
        status: 'completed'
      };
    },
    
    handleResponse: async (executionResponse, context, deps) => {
      await deps.generationRecordManager.updateGenerationRecord(
        executionResponse.generationId,
        {
          responsePayload: { result: executionResponse.response },
          status: 'completed'
        }
      );
      
      await deps.workflowNotifier.notifyStepProgress(context, executionResponse.generationId, context.tool);
      await deps.workflowNotifier.notifyToolResponse(context, context.tool, executionResponse.response);
      
      return executionResponse.response;
    },
    
    normalizeOutput: (rawOutput) => {
      if (typeof rawOutput === 'string') {
        return { text: [rawOutput] };
      }
      if (rawOutput?.result) {
        return { text: [rawOutput.result] };
      }
      return rawOutput;
    },
    
    handleError: async (error, context, deps) => {
      if (error.message?.includes('timeout') || error.message?.includes('exceeded')) {
        return { handled: true, shouldRetry: false };
      }
      return { handled: false, shouldRetry: true };
    }
  }
};
```

## Implementation in Refactored Architecture

In the refactored `StepExecutor.js`:

```javascript
// src/core/services/workflow/execution/StepExecutor.js
class StepExecutor {
    constructor({ logger, toolRegistry, adapterRegistry, strategyFactory, ... }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.adapterRegistry = adapterRegistry;
        this.strategyFactory = strategyFactory; // Creates default strategies
    }
    
    async executeStep(spell, stepIndex, pipelineContext, originalContext, dependencies) {
        const tool = this._resolveTool(spell.steps[stepIndex]);
        
        // Get execution strategy (from tool definition or factory)
        const strategy = tool.executionStrategy || 
                        this.strategyFactory.createDefaultStrategy(tool);
        
        // Prepare execution context
        const executionContext = this._buildExecutionContext(
            spell, stepIndex, pipelineContext, originalContext, tool
        );
        
        // Execute using strategy
        return await strategy.execute(pipelineContext, executionContext, dependencies);
    }
}
```

## Summary

By enriching tool definitions with execution strategies:

1. **WorkflowExecutionService becomes a thin orchestrator** - no service-specific logic
2. **Each tool is self-describing** - defines its own execution behavior
3. **Easy to add new service types** - just define a new strategy
4. **Better testability** - strategies can be tested independently
5. **Better maintainability** - service-specific logic is isolated

This is a key part of the refactor that will significantly reduce the complexity and size of `WorkflowExecutionService`.

