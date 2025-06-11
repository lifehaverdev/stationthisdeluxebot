# ADR-011: Unified Tool Execution Strategy

## Context
Our current system has two distinct tool execution pathways: an asynchronous, webhook-based flow for ComfyUI tools, and a synchronous, direct-response flow for an OpenAI tool. This logic is managed directly within the Telegram command handler (`dynamicCommands.js`), making it brittle, hard to scale, and difficult to maintain. Adding new tools with different execution modalities (e.g., polling) would require further complicating the command handler.

The platform adapters (Telegram, Web, etc.) should be responsible for interpreting user intent, not for managing the lifecycle of a tool's execution.

## Decision
We will refactor our architecture to introduce a centralized `WorkflowExecutionService` and an explicit `executionStrategy` field within the `ToolDefinition`.

### 1. New `executionStrategy` in `ToolDefinition`
The `ToolDefinition` schema will be updated to include a mandatory `executionStrategy` object. This object will define how the system should handle the tool's lifecycle.

```json
"executionStrategy": {
  "type": "sync" | "webhook" | "poll",
  "config": {
    // Strategy-specific configuration
  }
}
```

-   **`type: "sync"`**: For tools that return results immediately. `config` will be empty.
-   **`type: "webhook"`**: For tools that call a webhook upon completion. The existing `webhookStrategy` fields will be moved into this `config` object.
-   **`type: "poll"`**: For tools that require periodic status checks. `config` will define the polling endpoint (`statusPath`), success/failure conditions, and polling interval.

### 2. Centralized `WorkflowExecutionService`
This new service will be the single entry point for running any tool. Platform adapters will no longer contain any execution logic.

**Responsibilities:**
-   Receive a `toolId` and user `inputs`.
-   Fetch the corresponding `ToolDefinition` from the `ToolRegistry`.
-   Read the `executionStrategy` and orchestrate the execution accordingly.
-   Log the initial `generationRecord` to the database.

**Execution Flows:**
-   **Sync Strategy**: The service calls the tool's `apiPath`, awaits the response, updates the `generationRecord` with the result and `completed` status, and returns the final result to the caller.
-   **Webhook Strategy**: The service calls the tool's `apiPath` to initiate the job and returns an immediate acknowledgment. The existing `webhookProcessor.js` will handle the eventual completion.
-   **Poll Strategy**: The service calls the `apiPath` to initiate the job, then hands off the `generationId` to a background "Poller" service which periodically checks the status endpoint defined in the `poll` config.

### 3. Simplified Platform Adapters
The logic in `dynamicCommands.js` (and other future platform adapters) will be greatly simplified:
1.  Parse the user's command and inputs.
2.  Resolve user context (e.g., `masterAccountId`) and merge user preferences.
3.  Call `WorkflowExecutionService.start(toolId, inputs, context)`.
4.  Handle the immediate response from the `start` call (e.g., for `sync` tools, display the result; for async tools, display an acknowledgment message like "Your job has been submitted.").

## Consequences
-   **Improved Scalability & Maintainability**: Adding new tools, even with new execution types, becomes a matter of creating a definition and implementing the specific logic within the `WorkflowExecutionService`, without touching platform adapters.
-   **Clear Separation of Concerns**: Platform adapters handle user interaction, while the `WorkflowExecutionService` handles tool orchestration.
-   **Increased Complexity in Core**: The `WorkflowExecutionService` will become a more complex and critical part of the system. It will require robust state management, especially for the polling strategy.
-   **Refactoring Effort**: Requires refactoring `dynamicCommands.js`, `ToolDefinition`, and creating the new `WorkflowExecutionService`.

## Alternatives Considered
-   **Expanding Logic in Platform Adapters**: Continuing to add `if/else` or `switch` statements in `dynamicCommands.js` for each new tool type. This was rejected as it leads to tightly coupled, unmaintainable code.
-   **Service-Specific Execution Logic**: Having each service (e.g., `OpenAIService`, `ComfyUIService`) contain its own execution logic. This is better than the first alternative but still lacks a single, unified entry point for tool execution, complicating the logic in platform adapters that need to decide which service to call. 