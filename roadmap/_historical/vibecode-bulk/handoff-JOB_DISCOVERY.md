> Imported from vibecode/bulk/audits/handoff-JOB_DISCOVERY.md on 2025-08-21

# Handoff: Job System Discovery - {{today}}

## 1. Current Tool Execution Mechanism

The system executes tools, primarily ComfyUI workflows, through a series of services and handlers:

*   **Tool Definition**:
    *   Tools are defined by a `ToolDefinition` schema (see `vibecode/decisions/ADR-004-Tool_Definition_and_Registry.md`). This includes `toolId`, `service` (e.g., 'comfyui'), `displayName`, `description`, `inputSchema`, `outputSchema` (less defined), `costingModel`, `platformHints`, and `metadata` (which stores `deploymentId` for ComfyUI tools).
    *   The `inputSchema` details each parameter: `name`, `type` (string, number, image, video, audio, file, boolean), `required`, `default`, `description`.
    *   `src/core/tools/ToolRegistry.js` acts as a central repository for these `ToolDefinition` objects. It loads and validates them.
    *   `src/core/services/comfydeploy/workflowCacheManager.js` is responsible for dynamically creating `ToolDefinition` objects from ComfyUI workflow data (fetched from `comfyui-deploy` API), including parsing workflow JSON to derive `inputSchema` and `description` (from "Note" nodes).
    *   `src/core/services/comfydeploy/workflowUtils.js` contains utilities to parse ComfyUI workflow JSON, extract input/output types, and infer metadata like `toolCategory` and `primaryInput`.

*   **Invocation - Web/API**:
    *   `src/platforms/web/routes/index.js` dynamically creates API routes for tools (e.g., `/api/internal/run/:toolId` or `/api/internal/comfy/run/:deployment_id`).
    *   When a request hits these routes:
        1.  `WorkflowsService` (`src/core/services/comfydeploy/workflows.js`) method `prepareToolRunPayload` is called. This method:
            *   Retrieves the `ToolDefinition` using `ToolRegistry`.
            *   Validates the user-provided `inputPayload` against the tool's `inputSchema`.
            *   Merges user inputs with default values from the `inputSchema`.
        2.  The prepared payload and the `deploymentId` (from `tool.metadata.deploymentId`) are passed to `ComfyUIService` (`src/core/services/comfyui.js`).
        3.  `ComfyUIService.submitRequest` makes the actual API call to the `comfyui-deploy` backend (e.g., `/api/run/deployment/queue`) to start the workflow execution.
        4.  A `run_id` is returned from `comfyui-deploy`.

*   **Invocation - Telegram**:
    *   `src/platforms/telegram/dynamicCommands.js` sets up command handlers for Telegram.
    *   It fetches tools from `WorkflowsService` (implicitly using the `ToolRegistry`).
    *   Tools are classified based on their `inputSchema` and `platformHints` to determine a `telegramHandlerType` (e.g., `text_only`, `image_required_with_text`). This determines how user input (text, replied-to images) is processed.
    *   A `bot.onText` listener is registered for each command (derived from `tool.displayName`).
    *   When a command is received:
        1.  User input (text, image URLs from replied messages) is parsed and mapped to the tool's `inputSchema` fields (e.g., `promptInputKey`, `imageInputKey`).
        2.  It makes a POST request to an internal API endpoint, likely `/tools/run` (the exact URL needs to be confirmed but this is a common pattern seen), providing the `toolId` and the prepared `userInputsForTool`. This internal API call would then follow a similar flow to the direct Web/API invocation.

*   **Task Tracking**:
    *   The `generationRecord` schema, defined in `vibecode/decisions/ADR-002-NoemaCoreDataSchemas.md`, is the primary structure for tracking tool executions.
    *   `src/core/services/db/generationOutputsDb.js` (class `GenerationOutputsDB`) manages the persistence of these records in a database (likely MongoDB).
    *   A `generationRecord` includes:
        *   `generationId` (PK), `masterAccountId`, `sessionId`, `initiatingEventId`.
        *   `serviceName`, `platformSpecificRunId` (the `run_id` from ComfyUI Deploy).
        *   Timestamps (`requestTimestamp`, `responseTimestamp`), `durationMs`.
        *   `status` (e.g., `pending`, `processing`, `completed`, `failed`).
        *   `requestPayload`, `responsePayload` (often includes `artifactUrls`).
        *   `costUsd`.
        *   Notification-related fields (`notificationPlatform`, `deliveryStatus`).
    *   When a tool is invoked, a `generationRecord` is created with status `pending` or `processing`.
    *   A webhook receiver (likely `src/platforms/web/routes/webhookRouter.js` based on `WEBHOOK_URL` in `comfydeploy/config.js`, though not explicitly searched for) listens for updates from `comfyui-deploy`. When a job finishes, the webhook updates the corresponding `generationRecord` with the final `status`, `outputs` (artifact URLs), `durationMs`, etc.
    *   `src/core/services/notificationDispatcher.js` polls these `generationRecord`s to send notifications upon completion or failure.

## 2. Identifying Chaining Logic Insertion Points

The current system is largely single-tool execution focused. Chaining logic could be inserted at several levels:

1.  **Middleware in API/Command Handlers**:
    *   **Web Routes (`src/platforms/web/routes/index.js`)**: Before `comfyuiService.submitRequest`, a "Job Orchestrator" or "Workflow Engine" could intercept the request if the `toolId` represents a multi-step Job. This orchestrator would manage the sequence of tool calls.
    *   **Telegram Commands (`src/platforms/telegram/dynamicCommands.js`)**: Similarly, after parsing user input and before calling the internal `/tools/run` API, the logic could determine if a Job is being invoked. The call could be redirected to a Job execution endpoint.

2.  **Dedicated Job Service/Queue**:
    *   Instead of directly calling `comfyuiService.submitRequest` or an internal `/tools/run` for a single tool, requests identified as "Jobs" could be submitted to a new, dedicated Job Queue.
    *   A "Job Worker" process would pick up jobs from this queue. This worker would be responsible for:
        *   Interpreting the Job definition (sequence of tools, dependencies).
        *   Executing each tool in the chain, likely by calling the existing `WorkflowsService.prepareToolRunPayload` and `ComfyUIService.submitRequest` (or their equivalents for other services) for each step.
        *   Managing state and passing outputs from one step as inputs to the next.
        *   Updating a "JobRecord" (analogous to `generationRecord` but for the overall Job) and individual `generationRecord`s for each step.

3.  **Enhancement to `WorkflowsService`**:
    *   The `WorkflowsService` itself could be enhanced to understand "Job Definitions" in addition to "Tool Definitions." Its `prepareToolRunPayload` or a new method like `executeJob` could handle the orchestration if the `toolId` refers to a Job. This keeps orchestration logic closer to tool management but might make `WorkflowsService` too complex.

## 3. Proposed Job Representation (Multi-step Toolchains)

We can represent Jobs as a new type of definition, perhaps `JobDefinition`, managed by a `JobRegistry` (similar to `ToolRegistry`).

A `JobDefinition` would include:

*   `jobId`: Unique identifier for the job.
*   `displayName`: User-facing name for the job.
*   `description`: What the job does.
*   `inputSchema`: Defines the initial inputs the job as a whole requires from the user. These would be a subset of the inputs required by the first tool(s) in the chain.
*   `outputSchema`: Defines the final outputs the job produces.
*   `steps`: An ordered array or graph of steps. Each step would define:
    *   `stepId`: A unique ID for this step within the job.
    *   `toolId`: The `toolId` of the tool to execute for this step (from `ToolRegistry`).
    *   `inputMappings`: How to map inputs for this tool. This could be:
        *   From the Job's initial `inputSchema` (for the first step).
        *   From the output of a previous step (`{ "sourceStepId": "stepX", "sourceOutputName": "image_url", "targetInputName": "input_image" }`).
        *   Static values defined within the Job definition.
        *   Transformations or default values.
    *   `dependencies`: An array of `stepId`s that must complete before this step can start (for graph-based execution). For simple linear chains, this might be implicit.
    *   `condition`: (Optional) A condition to evaluate (e.g., based on output of a previous step) to determine if this step should run.
*   `errorHandlingStrategy`: (Optional) Job-level or step-level strategies (e.g., retry step, skip step, halt job).

**Example `JobDefinition`**:

```json
{
  "jobId": "generate_and_upscale_image",
  "displayName": "Generate & Upscale Image",
  "description": "Generates an image based on a prompt, then upscales it.",
  "inputSchema": {
    "prompt": { "type": "string", "required": true, "description": "Text prompt for image generation" },
    "negative_prompt": { "type": "string", "required": false, "description": "Negative prompt" }
  },
  "outputSchema": {
    "upscaled_image_url": { "type": "string", "description": "URL of the final upscaled image" }
  },
  "steps": [
    {
      "stepId": "generate_image",
      "toolId": "comfy-fluxGeneral", // Example toolId
      "inputMappings": [
        { "sourceJobInput": "prompt", "targetInputName": "text_prompt" },
        { "sourceJobInput": "negative_prompt", "targetInputName": "negative_prompt" }
        // other necessary inputs for fluxGeneral might have defaults or be static
      ]
    },
    {
      "stepId": "upscale_image",
      "toolId": "comfy-RealESRGAN", // Example upscaler toolId
      "dependencies": ["generate_image"],
      "inputMappings": [
        { "sourceStepId": "generate_image", "sourceOutputName": "image", "targetInputName": "image_to_upscale" }
        // "image" here would be the conventional name for the primary image output of a ComfyUI tool
      ]
    }
  ]
}
```

**Job Tracking**:
A new `jobRecord` collection/table would be needed, similar to `generationRecord`:
*   `jobId` (PK), `jobDefinitionId` (FK), `masterAccountId`, `sessionId`, `initiatingEventId`.
*   `status` (`pending`, `running`, `completed`, `failed`, `partially_completed`).
*   `jobInputs` (the initial user inputs).
*   `stepStatuses`: An array/object tracking the status and `generationId` of each step execution.
    *   `[{ "stepId": "generate_image", "generationId": "xyz123", "status": "completed", "output": { "image": "url1" } }]`
*   `finalOutputs`.
*   Timestamps.

## 4. Brittle or Tightly-Coupled Patterns Blocking Job Abstraction

1.  **Direct Service Calls**:
    *   The current flow `Web Route -> WorkflowsService -> ComfyUIService -> External API` is for single tool calls. If a Job requires tools from *different* services (e.g., ComfyUI then a Vidu tool), `ComfyUIService` cannot handle the entire chain. The orchestration logic needs to be above individual service clients.

2.  **Implicit Output Naming**:
    *   The example above assumes `sourceOutputName: "image"` for the `generate_image` step. For robust chaining, `ToolDefinition` needs a more explicit `outputSchema` that clearly names its potential outputs and their types. Currently, output seems to be primarily inferred (e.g., "the first image URL found in the ComfyUI webhook payload"). This makes it hard to reliably map outputs to inputs.

3.  **Webhook Handling**:
    *   Webhooks are currently tied to a single `generationRecord`. For a Job, the webhook from an individual step needs to update that step's status *within* the overarching `jobRecord`, and potentially trigger the next step(s) in the Job. The webhook handler needs to be aware of Jobs or notify a Job orchestrator.

4.  **State Management**:
    *   There's no current mechanism for passing complex state or multiple artifacts between tools beyond a single primary output (like an image URL). A Job system would need a way to store intermediate results (e.g., in temporary storage, or by passing multiple output fields) if subsequent tools need them.

5.  **Configuration of `deploymentId`**:
    *   The `deploymentId` for ComfyUI tools is stored in `tool.metadata.deploymentId`. This is fine for single tools. A Job system would simply use this `deploymentId` when executing that specific step. This isn't a blocker but part of the existing tool execution that a Job system would leverage.

6.  **Error Handling and Recovery**:
    *   Current error handling seems to be per-tool execution (fail the `generationRecord`). A Job system needs more sophisticated strategies: retry a failed step, run a cleanup step, branch to an alternative path, or mark the whole Job as failed with partial results.

7.  **UI/Client Awareness**:
    *   Clients (Telegram, Web UI) are built around submitting a single command/request and getting a result. A Job system would introduce longer-running processes. The UI would need to reflect Job status, step progress, and potentially allow interaction with intermediate steps (though this adds complexity). The `generationRecord.status` and `notificationDispatcher` are good building blocks for this.

By addressing these points, especially by introducing a Job orchestrator/queue and well-defined `JobDefinition` and `outputSchema` for tools, the system can be generalized to support complex, multi-step Jobs. 