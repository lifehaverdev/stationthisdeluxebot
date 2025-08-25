> Imported from vibecode/bulk/audits/PLAN-ComfyUI-ToolRegistry-Migration.md on 2025-08-21

# PLAN: ComfyUI Service Migration to ToolRegistry

This document outlines the strategy and steps for migrating the existing ComfyUI service integration (located in `src/core/services/comfyuideploy/`) to the new `ToolDefinition` and `ToolRegistry` system, as defined in ADR-004.

## 🎯 Goal

The primary goal is to create a robust, step-by-step implementation plan for extracting `ToolDefinition`s from ComfyDeploy workflows and registering them into a `ToolRegistry` instance at runtime. This will standardize how ComfyUI capabilities are exposed and managed within the broader application.

---

### 🧱 1. System Overview

Currently, ComfyDeploy workflows are managed primarily by the `workflowCacheManager.js` module within the `src/core/services/comfyuideploy/` directory.

*   **Discovery**: Workflows are discovered by fetching all available deployments from the ComfyDeploy API. Each deployment usually corresponds to a usable workflow. `resourceFetcher.js` handles the raw API calls to list deployments and fetch individual workflow JSON definitions.
*   **Parsing**: `workflowCacheManager.js` fetches the raw workflow JSON. `workflowUtils.js` provides utilities to parse this JSON, specifically to identify input nodes (e.g., `CLIPTextEncode`, `ImageUpload`, `KSampler`), their parameters, types, and default values. It also helps in standardizing names and extracting output information.
*   **Indexing**: `workflowCacheManager.js` builds in-memory indexes (maps) of these parsed workflows, typically by workflow ID and sometimes by a derived "name". This allows for quick lookup. The cache has a Time-To-Live (TTL) and refresh mechanism.
*   **Exposure**: The `workflows.js` module acts as the public API for the rest of the application to access this processed workflow information. It uses `workflowCacheManager.js` to get details like required inputs, output types, and associated deployment IDs for a given workflow. `comfyui.js` orchestrates actual workflow runs, file uploads, and fetches machine details (including GPU type for costing).

The most logical seam for intercepting this logic and creating `ToolDefinition`s is within `workflowCacheManager.js`, specifically after a workflow's JSON and its associated deployment data have been fetched and initially processed. At this point, we have access to the raw workflow structure (for inputs and Note nodes) and deployment details (for ID, potential naming, and machine association for costing).

---

### 🔨 2. Implementation Steps

#### Step 1: Ensure `ToolDefinition` and `ToolRegistry` Primitives Exist

*   **Files Modified**: Potentially `src/core/tools/ToolDefinition.ts` (or `.js`), `src/core/tools/ToolRegistry.ts` (or `.js`).
*   **Description**: Verify that the `ToolDefinition` type/class and the `ToolRegistry` class, as outlined in `ADR-004-Tool_Definition_and_Registry.md`, are implemented. The ADR provides the TypeScript schema. If they are not yet implemented, create these foundational components. The `ToolRegistry` should be a singleton or a globally accessible instance.
*   **Pseudocode/Example**:
    ```typescript
    // src/core/tools/ToolDefinition.ts
    export type ToolDefinition = {
      toolId: string;
      service: string; // 'comfyui', 'vidu', etc.
      displayName: string;
      description?: string;
      commandName?: string;
      apiPath?: string;
      inputSchema: Record<string, InputField>;
      outputSchema?: Record<string, any>; // Simplified for now
      costingModel?: CostingModel;
      webhookStrategy?: WebhookConfig;
      platformHints?: PlatformHints;
      category?: 'text-to-image' | 'img2img' | 'upscale' | 'inpaint' | 'video' | 'interrogate';
      humanDefaults?: Record<string, string>;
      visibility?: 'public' | 'internal' | 'hidden';
      metadata?: Record<string, any>; // For extra service-specific data
    };

    export type InputField = {
      name: string;
      type: 'string' | 'number' | 'image' | 'video' | 'audio' | 'file' | 'boolean';
      required: boolean;
      default?: any;
      description?: string;
      advanced?: boolean;
    };

    // ... other types from ADR-004 (CostingModel, WebhookConfig, PlatformHints)

    // src/core/tools/ToolRegistry.ts
    export class ToolRegistry {
      private static instance: ToolRegistry;
      private tools: Map<string, ToolDefinition> = new Map();

      private constructor() {} // Singleton

      public static getInstance(): ToolRegistry {
        if (!ToolRegistry.instance) {
          ToolRegistry.instance = new ToolRegistry();
        }
        return ToolRegistry.instance;
      }

      public registerTool(tool: ToolDefinition): void {
        if (this.tools.has(tool.toolId)) {
          console.warn(`ToolRegistry: Tool with ID ${tool.toolId} is being overwritten.`);
        }
        this.tools.set(tool.toolId, tool);
      }

      public getToolById(toolId: string): ToolDefinition | undefined {
        return this.tools.get(toolId);
      }

      public getAllTools(): ToolDefinition[] {
        return Array.from(this.tools.values());
      }

      public findByCommand(commandName: string): ToolDefinition | undefined {
        // ... implementation ...
      }
      
      public validate(): { isValid: boolean; errors: string[] } {
        // ... implementation ...
      }
    }
    ```
*   **Acceptance Criteria**:
    *   `ToolDefinition` type and related types (`InputField`, `CostingModel`, etc.) are defined.
    *   `ToolRegistry` class exists with methods for registering and retrieving tools.
    *   `ToolRegistry` can be instantiated and accessed.

#### Step 2: Initialize `ToolRegistry`

*   **Files Modified**: Application entry point or a core service initialization file (e.g., `src/main.ts` or `src/core/services/index.js`).
*   **Description**: Ensure the `ToolRegistry` is initialized when the application starts. This might involve just getting the instance.
*   **Pseudocode/Example**:
    ```javascript
    // In an application setup file
    import { ToolRegistry } from './core/tools/ToolRegistry';

    const toolRegistry = ToolRegistry.getInstance();
    // Potentially load from a flashed file if implementing Step 6 later
    // toolRegistry.loadFromStaticFile('tool_registry.generated.json');
    ```
*   **Acceptance Criteria**:
    *   A `ToolRegistry` instance is created and accessible globally or via dependency injection.

#### Step 3: Integrate `ToolDefinition` Creation in `WorkflowCacheManager`

*   **Files Modified**: `src/core/services/comfyuideploy/workflowCacheManager.js`
*   **Description**: Modify the workflow processing logic within `WorkflowCacheManager` (likely in the `_fetchAndProcessWorkflowDetails` or a similar method where individual workflow data is available after fetching from `resourceFetcher.js`). After parsing a workflow's JSON and getting its deployment information, construct a `ToolDefinition` object.
*   **Details for Hydration**:
    *   **`toolId`**: Use the `deployment_id` or `workflow_id`. Ensure uniqueness. E.g., `comfy-${deployment_id}`.
    *   **`service`**: Static string: `'comfyui'`.
    *   **`displayName`**: Use the workflow's name if available (e.g., from deployment name or a convention in workflow data). Fallback to a generated name like "Comfy Workflow [ID]".
    *   **`description`**:
        *   Attempt to parse "Note" nodes from the workflow JSON. Concatenate their contents.
        *   `workflowUtils.extractNotes(workflowJson)` could be a new utility.
        *   Fallback: "Executes a ComfyUI workflow. Inputs: [list of inputs]."
    *   **`commandName`**: Generate from `displayName`, e.g., `/fluxGeneral` from "Flux General". Sanitize to be command-friendly.
    *   **`apiPath`**: A conventional path, e.g., `/api/internal/comfy/run/${deployment_id}`.
    *   **`inputSchema`**:
        *   Use `workflowUtils.getWorkflowInputs(workflowJson, deploymentInputs)` to get the list of input nodes and their parameters.
        *   Map ComfyUI node types to `InputField.type` (e.g., `String` -> `'string'`, `INT` -> `'number'`, `IMAGE` -> `'image'`).
        *   Determine `required` status (ComfyUI inputs are generally required unless they have defaults or are optional by design, check node properties).
        *   Extract `default` values.
        *   Add `description` from node properties if available.
    *   **`costingModel`**:
        *   Requires fetching machine details associated with the deployment. This might involve a call to a method in `comfyui.js` (e.g., `ComfyUIService.getDeployment(deployment_id)` which should return machine info, then `ComfyUIService.getCostRateForMachine(machine.gpu)`).
        *   `config.js` contains `MACHINE_COST_RATES`.
        *   `unit`: `'second'` (typical for GPU usage).
        *   `rateSource`: `'machine'` or `'api'` if fetched dynamically.
    *   **`webhookStrategy`**: Static for ComfyUI, as per its run lifecycle.
        ```javascript
        // Example static webhook config for ComfyUI
        const comfyWebhookStrategy = {
          expectedStatusField: 'status.status_str', // Path to status in webhook payload
          successValue: 'success', // Value indicating successful completion
          durationTracking: true, // If duration can be derived
          resultPath: ['output.files'] // JSON path to output artifact(s)
        };
        ```
    *   **`platformHints`**: Determine based on primary inputs (e.g., if it has a prominent text input, `primaryInput: 'text'`).
    *   **`category`**: (New) Attempt to infer from workflow name, tags (if ComfyDeploy supports them), or specific input/output node types. Examples: 'text-to-image', 'img2img'. Could default to a generic category or be manually curated later.
    *   **`humanDefaults`**: (New) For inputs with default values, provide a human-friendly string if the default itself isn't descriptive (e.g., if `seed.default` is -1, `humanDefaults.seed` could be "Random").
    *   **`visibility`**: (New) Default to `'public'`. Could be changed based on naming conventions (e.g., a workflow named `_internal_utility` might become `'internal'`) or metadata flags if supported.
    *   **`metadata`**: Store `deployment_id`, `workflow_id`, raw workflow JSON version/hash, etc.
*   **Pseudocode/Example** (inside `workflowCacheManager.js`):
    ```javascript
    // Assuming 'workflowData' contains fetched deployment info and 'workflowJson' is the workflow structure
    // Also assuming 'comfyApiService' is an instance of ComfyUIService or similar for fetching costs

    async function createToolDefinitionFromWorkflow(workflowData, workflowJson, comfyApiService, config) {
      const toolDefinition = {};
      toolDefinition.toolId = `comfy-${workflowData.deployment_id}`;
      toolDefinition.service = 'comfyui';
      toolDefinition.displayName = workflowData.name || `Comfy Workflow ${workflowData.deployment_id}`;
      toolDefinition.commandName = generateCommandName(toolDefinition.displayName); // Util function
      toolDefinition.apiPath = `/api/internal/comfy/run/${workflowData.deployment_id}`;

      // Description from Notes
      const notes = workflowUtils.extractNotes(workflowJson); // Implement in workflowUtils
      toolDefinition.description = notes.join('\n') || `Runs the ${toolDefinition.displayName} workflow.`;

      // Input Schema
      const inputs = workflowUtils.getWorkflowInputs(workflowJson, workflowData.inputs); // Adjust getWorkflowInputs if needed
      toolDefinition.inputSchema = {};
      for (const inp of inputs) {
        toolDefinition.inputSchema[inp.name] = {
          name: inp.name,
          type: mapComfyTypeToToolType(inp.type), // Implement this mapping
          required: inp.required !== undefined ? inp.required : true, // Adjust logic
          default: inp.default,
          description: inp.description || `Input for ${inp.name}`,
          advanced: inp.advanced || false
        };
      }
      
      // Costing Model
      try {
        // This is a simplification. May need to get deployment, then machine, then rate.
        const costRate = await comfyApiService.getCostRateForDeployment(workflowData.deployment_id);
        if (costRate) {
            toolDefinition.costingModel = {
                rate: costRate, // This should be the actual rate value
                unit: 'second',
                rateSource: 'machine', // Or 'api' based on how it's derived from MACHINE_COST_RATES
            };
        }
      } catch (error) {
        console.warn(`Could not determine cost for ${toolDefinition.toolId}:`, error);
      }


      toolDefinition.webhookStrategy = { /* ... static comfy webhook config ... */ };
      toolDefinition.platformHints = { /* ... derive from inputs ... */ };
      
      // New fields - population logic TBD or based on conventions
      toolDefinition.category = inferCategoryFromNameOrNodes(workflowData.name, workflowJson); // e.g. 'text-to-image'
      toolDefinition.humanDefaults = generateHumanDefaults(toolDefinition.inputSchema); // e.g. { seed: "Random" }
      toolDefinition.visibility = inferVisibility(workflowData.name); // e.g. 'public'
      
      toolDefinition.metadata = { 
        deploymentId: workflowData.deployment_id, 
        workflowId: workflowData.workflow_id,
        // Potentially add other relevant ComfyUI specific data here
      };

      return toolDefinition;
    }
    ```
*   **Acceptance Criteria**:
    *   `ToolDefinition` objects are correctly constructed for each discovered and processed ComfyUI workflow.
    *   `description` is populated from Note nodes if present.
    *   `inputSchema` accurately reflects the workflow's inputs.
    *   `costingModel` is populated using machine GPU type and `MACHINE_COST_RATES`.
    *   `webhookStrategy` is set to the standard ComfyUI webhook configuration.

#### Step 4: Register Tools into `ToolRegistry`

*   **Files Modified**: `src/core/services/comfyuideploy/workflowCacheManager.js`
*   **Description**: After a `ToolDefinition` is created in `WorkflowCacheManager` (as per Step 3), register it with the global `ToolRegistry` instance. This should happen as part of the same workflow processing loop.
*   **Pseudocode/Example** (inside `workflowCacheManager.js`, after `createToolDefinitionFromWorkflow`):
    ```javascript
    // ... inside the loop processing each workflow ...
    const toolDef = await createToolDefinitionFromWorkflow(workflowData, workflowJson, this.comfyApiService, this.config); // Assuming comfyApiService and config are available
    if (toolDef) {
      const toolRegistry = ToolRegistry.getInstance();
      toolRegistry.registerTool(toolDef);
      console.log(`Registered tool: ${toolDef.toolId}`);
    }
    ```
*   **Acceptance Criteria**:
    *   All processed ComfyUI workflows are registered as tools in the `ToolRegistry`.
    *   `ToolRegistry.getAllTools()` or `ToolRegistry.getToolById()` can retrieve these registered ComfyUI tools.

#### Step 5: Add Validation Method to `ToolRegistry`

*   **Files Modified**: `src/core/tools/ToolRegistry.ts` (or `.js`)
*   **Description**: Implement a `validate()` method in the `ToolRegistry` class. This method should iterate through all registered tools and check them against the `ToolDefinition` schema. It should report any missing required fields or type mismatches. This is useful for debugging and ensuring consistency.
*   **Pseudocode/Example**:
    ```typescript
    // src/core/tools/ToolRegistry.ts
    public validate(): { isValid: boolean; errors: { toolId: string, message: string }[] } {
      const errors: { toolId: string, message: string }[] = [];
      this.tools.forEach(tool => {
        if (!tool.toolId) errors.push({ toolId: 'unknown', message: 'Missing toolId' });
        if (!tool.service) errors.push({ toolId: tool.toolId, message: 'Missing service' });
        if (!tool.displayName) errors.push({ toolId: tool.toolId, message: 'Missing displayName' });
        if (!tool.inputSchema) errors.push({ toolId: tool.toolId, message: 'Missing inputSchema' });
        // ... more checks for required fields and correct types ...
        for (const key in tool.inputSchema) {
            const input = tool.inputSchema[key];
            if(!input.name) errors.push({ toolId: tool.toolId, message: `Input ${key} missing name` });
            if(!input.type) errors.push({ toolId: tool.toolId, message: `Input ${key} missing type` });
            // ... etc.
        }
        // Validations for new optional fields
        if (tool.category && !['text-to-image', 'img2img', 'upscale', 'inpaint', 'video', 'interrogate'].includes(tool.category)) {
            errors.push({ toolId: tool.toolId, message: `Invalid category: ${tool.category}` });
        }
        if (tool.visibility && !['public', 'internal', 'hidden'].includes(tool.visibility)) {
            errors.push({ toolId: tool.toolId, message: `Invalid visibility: ${tool.visibility}` });
        }
        if (tool.humanDefaults && typeof tool.humanDefaults !== 'object') {
            errors.push({ toolId: tool.toolId, message: 'humanDefaults should be an object' });
        }
      });
      return { isValid: errors.length === 0, errors };
    }
    ```
*   **Acceptance Criteria**:
    *   `ToolRegistry.validate()` method exists and can identify schema violations in registered tools.
    *   The validation logic covers key fields of `ToolDefinition` and `InputField`.

#### Step 6: Optionally: Implement `tools/flashToolRegistry.js`

*   **Files Modified**: New file: `tools/flashToolRegistry.js`
*   **Description**: Create a standalone script that:
    1.  Initializes the application services to the point where `WorkflowCacheManager` populates the `ToolRegistry` (or directly triggers the cache population).
    2.  Retrieves all tools from the `ToolRegistry` instance.
    3.  Serializes the array of `ToolDefinition` objects to a JSON file (e.g., `tool_registry.generated.json`).
    This is useful for debugging, offline development, and providing a static snapshot.
*   **Pseudocode/Example**:
    ```javascript
    // tools/flashToolRegistry.js
    // This is highly dependent on your application's structure for service initialization.
    // You'll need to import and initialize WorkflowCacheManager and ToolRegistry.

    const fs = require('fs');
    const path = require('path');
    // Adjust paths based on your project structure
    const { ToolRegistry } = require('../src/core/tools/ToolRegistry'); 
    const { WorkflowCacheManager } = require('../src/core/services/comfyuideploy/workflowCacheManager');
    // ... other necessary imports like config, ComfyUIService ...

    async function flashRegistry() {
      // Simplified: Initialize services needed to populate the registry
      // This might involve instantiating ComfyUIService, ConfigService, etc.
      // and then ensuring WorkflowCacheManager.initialize() is called.
      // For example:
      // const configService = new ConfigService();
      // const comfyApiService = new ComfyUIService(configService.get('COMFY_API_KEY'));
      // const cacheManager = WorkflowCacheManager.getInstance(comfyApiService, configService);
      // await cacheManager.initialize(); // This should populate the ToolRegistry

      const toolRegistry = ToolRegistry.getInstance();
      // Ensure tools are loaded (e.g. by awaiting initialization of WorkflowCacheManager)
      // await new Promise(resolve => setTimeout(resolve, 5000)); // Crude wait if async registration

      const tools = toolRegistry.getAllTools();
      const outputPath = path.join(__dirname, '..', 'tool_registry.generated.json'); // Or specific tool_defs/
      fs.writeFileSync(outputPath, JSON.stringify(tools, null, 2));
      console.log(`ToolRegistry flashed to ${outputPath}`);
    }

    flashRegistry().catch(console.error);
    ```
*   **Acceptance Criteria**:
    *   A script exists that can serialize the contents of the `ToolRegistry` to a JSON file.
    *   The generated JSON file contains valid `ToolDefinition` objects.

#### Step 7: Refactor `workflows.js` or Platform Adapters (Optional Milestone)

*   **Files Modified**: `src/core/services/comfyuideploy/workflows.js`, platform adapter files (e.g., `src/platforms/telegram/commands.js`).
*   **Description**: Once the `ToolRegistry` is populated, update existing code that relies on `workflows.js` or directly on ComfyUI workflow details to instead query the `ToolRegistry`.
    *   For example, instead of `workflows.js.getAvailableWorkflows()`, a platform adapter might call `ToolRegistry.getAllTools().filter(t => t.service === 'comfyui')`.
    *   Instead of `workflows.js.getWorkflowInputs(workflowId)`, it would use `ToolRegistry.getToolById(toolId).inputSchema`.
*   **Pseudocode/Example**:
    ```javascript
    // Before (in a platform adapter)
    // const comfyWorkflows = workflowsService.getAvailableWorkflows();
    // const inputs = workflowsService.getWorkflowInputs('some-workflow-id');

    // After
    const toolRegistry = ToolRegistry.getInstance();
    const allComfyTools = toolRegistry.getAllTools().filter(tool => tool.service === 'comfyui');
    const specificTool = toolRegistry.getToolById('comfy-some-workflow-id');
    const inputs = specificTool ? specificTool.inputSchema : null;
    ```
*   **Acceptance Criteria**:
    *   Key parts of the application that need ComfyUI workflow information are refactored to use `ToolRegistry`.
    *   Existing functionality remains intact.
    *   This demonstrates the utility and integration of the new registry.

---

### 🧠 3. Risk Areas / Open Questions

*   **LoRA Support / Multi-Deployment Workflows**:
    *   **Risk**: A single "tool" might involve multiple ComfyUI deployments (e.g., a base model + multiple LoRAs selected by user). The current `ToolDefinition` might not elegantly represent this.
    *   **Mitigation/Question**: Do we create a "master" tool that then dynamically calls other deployments? Or does the `inputSchema` need to be more complex to represent choices that select different underlying deployments? For now, focus on 1 deployment = 1 tool. Complex cases can be a V2.
*   **Workflows Missing Key Metadata**:
    *   **Risk**: Some workflows might not have Note nodes for descriptions, or names might be generic.
    *   **Mitigation**: Implement robust fallbacks for `displayName` and `description`. Log warnings for such cases. Encourage better metadata in workflows.
*   **Costing Accuracy**:
    *   **Risk**: Associating a deployment with a specific machine and then a cost rate might be complex if deployments can run on various machine types or if machine details aren't readily available at the `WorkflowCacheManager` level during its initialization.
    *   **Mitigation**: Ensure `comfyui.js` or `resourceFetcher.js` can reliably provide the GPU type for a deployment, or the default machine it runs on. The cost calculation might need to be slightly delayed or fetched on-demand if not available during initial processing.
*   **Pre-filtering Tools (Registry-time vs. Platform-time)**:
    *   **Question**: Should the `ToolRegistry` only contain "runnable" or "publicly exposed" tools, or should it contain everything, and let platforms decide what to show?
    *   **Proposal**: Register all valid tools. Add `metadata.internalOnly: boolean` or `platformHints.supportedPlatforms: string[]` to `ToolDefinition` if filtering is needed at registry level. Otherwise, let consuming platforms filter. For now, register all.
*   **Refresh Strategy**:
    *   **Question**: `WorkflowCacheManager` has a TTL. How does this interact with `ToolRegistry`?
    *   **Proposal**: When `WorkflowCacheManager` refreshes its cache, it should re-process and re-register (overwrite) the tools in `ToolRegistry`. The `registerTool` method should handle updates gracefully (e.g., log a warning or simply replace).
*   **Mapping ComfyUI Input Types**:
    *   **Risk**: ComfyUI has a variety of specific input types (e.g., `MODEL`, `VAE`, `CONDITIONING`). Mapping these accurately to the simpler `ToolDefinition.InputField.type` set (`string`, `number`, `image`, etc.) might lose some nuance or require careful consideration for how they are presented to the user.
    *   **Mitigation**: Create a clear mapping function. For complex types not directly supported by `InputField.type`, map them to `'string'` and use the `description` to clarify, or store original type in `InputField.metadata.originalType`. Some inputs (like `MODEL`) might be implicit or pre-configured and not exposed as user-facing tool inputs.
*   **Dynamic `toolId` Stability**:
    *   **Risk**: If `deployment_id` can change for the "same" conceptual workflow (e.g., if re-deployed), then `toolId` would change, breaking references.
    *   **Mitigation**: Use a stable identifier if available from ComfyDeploy. If not, `deployment_id` is the best proxy. This is more a ComfyDeploy API characteristic to be aware of.

---

### ✅ 4. Completion Criteria

A complete integration will:

*   Successfully create valid `ToolDefinition` objects for the majority of text-to-image and image-to-image ComfyUI workflows that have clear, user-settable inputs (e.g., prompt, seed, steps, cfg, image uploads).
*   Register these `ToolDefinition`s into the global `ToolRegistry` instance when the `WorkflowCacheManager` initializes or refreshes.
*   Allow downstream platforms or services to:
    *   Call `ToolRegistry.getAllTools()` and receive a list of ComfyUI tools.
    *   For each tool, access:
        *   A sensible `commandName` (e.g., `/fluxGeneral`, `/simpleTextToImage`).
        *   A populated `inputSchema` detailing parameters (name, type, required, default, description) suitable for generating settings menus or CLI arguments.
        *   A `description` (ideally from Note nodes, otherwise a good fallback).
        *   A `costingModel` with rate and unit.
*   **Output Benchmark**: At least 10-20 distinct ComfyUI workflows are registered as tools, including common ones like "Flux General", "Text to Video" (if applicable and parsable as a standard workflow), basic SDXL, etc.
*   The `ToolRegistry.validate()` method passes for all registered ComfyUI tools, indicating schema compliance.
*   (Optional but Recommended) The `tools/flashToolRegistry.js` script can successfully serialize the ComfyUI tools.

This plan provides a comprehensive approach to migrating ComfyUI services to the new ToolRegistry architecture, enhancing modularity and consistency across the application. 