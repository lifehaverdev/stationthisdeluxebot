# Execution Strategy Pattern - Quick Reference

## The Problem

`WorkflowExecutionService` currently has messy conditionals checking service types:

```javascript
// Current messy code
if (tool.deliveryMode === 'immediate') {
    // Handle immediate tools
} else if (typeof adapter.startJob === 'function') {
    // Handle async adapter tools
    if (tool.service === 'huggingface') {
        // HuggingFace-specific logic
    } else if (tool.service === 'comfyui') {
        // ComfyUI-specific logic
    }
}

// Different output normalization per service
if (tool.service === 'openai') {
    // OpenAI normalization
} else if (tool.service === 'huggingface') {
    // HuggingFace normalization
}
```

**Problems**:
- ❌ Tight coupling between WorkflowExecutionService and service implementations
- ❌ Hard to add new service types
- ❌ Difficult to test service-specific logic
- ❌ Code duplication

## The Solution: Execution Strategy Pattern

Move service-specific logic into **tool definitions** using execution strategies.

### How It Works

1. **Each tool defines its execution strategy** (or uses a default)
2. **StepExecutor just calls `strategy.execute()`** - no conditionals
3. **Strategies encapsulate** all service-specific logic

### Before vs After

#### Before (Messy)
```javascript
// In StepExecutor
if (tool.deliveryMode === 'immediate') {
    // Immediate tool logic
    const response = await internalApiClient.post('/execute', ...);
    await updateGenerationRecord(...);
    await sendWebSocketNotification(...);
} else if (adapter && typeof adapter.startJob === 'function') {
    // Async adapter logic
    const generationId = await createGenerationRecord(...);
    const runInfo = await adapter.startJob(...);
    await startPolling(...);
}
```

#### After (Clean)
```javascript
// In StepExecutor
const strategy = tool.executionStrategy || strategyFactory.createDefaultStrategy(tool);
const result = await strategy.execute(inputs, context, dependencies);
// That's it! No conditionals.
```

### Strategy Structure

```javascript
{
  toolId: 'chatgpt-free',
  executionStrategy: {
    type: 'immediate',
    
    // How to execute
    execute: async (inputs, context, deps) => {
      // Tool-specific execution logic
    },
    
    // How to handle response
    handleResponse: async (response, context, deps) => {
      // Tool-specific response handling
    },
    
    // How to normalize output
    normalizeOutput: (rawOutput) => {
      // Tool-specific normalization
    },
    
    // How to handle errors
    handleError: async (error, context, deps) => {
      // Tool-specific error handling
    }
  }
}
```

### Strategy Types

1. **ImmediateStrategy** - For ChatGPT, String Primitive
   - Executes via centralized endpoint
   - Handles WebSocket notifications
   - Handles timeout errors gracefully

2. **AsyncAdapterStrategy** - For HuggingFace
   - Creates generation record first
   - Starts async job via adapter
   - Sets up polling
   - Normalizes output

3. **WebhookStrategy** - For ComfyUI
   - Creates generation record with run_id
   - Starts job via adapter
   - Relies on webhook for completion

### Benefits

✅ **WorkflowExecutionService becomes thin** - no service-specific logic  
✅ **Each tool is self-describing** - defines its own behavior  
✅ **Easy to add new service types** - just define a new strategy  
✅ **Better testability** - strategies tested independently  
✅ **Better maintainability** - service-specific bugs isolated  

### Implementation Location

- **Strategies**: `src/core/services/workflow/execution/strategies/`
- **Factory**: `StrategyFactory.js` creates default strategies
- **Usage**: `StepExecutor.js` uses strategies (no conditionals)

### See Also

- **Detailed Guide**: `docs/TOOL_EXECUTION_STRATEGY_ENRICHMENT.md`
- **Refactor Plan**: `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_PROMPT.md` (Phase 3)

