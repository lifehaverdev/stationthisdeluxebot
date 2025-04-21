# ComfyUI Deploy Workflow Parameter Pipeline Analysis

## 🗺️ System Map & Component Overview

This document maps the end-to-end flow for user workflow configuration through the ComfyUI Deploy pipeline, focusing on how parameters should be preserved from frontend to execution.

## 🧩 Component Structure

### Frontend Components
- **WorkflowToolbar** (`user-interface/js/workflow-toolbar.js`)
  - Responsible for displaying available workflows and inputs in the UI
  - Collects user inputs from form elements
  - Makes POST request to `/api/internal/workflows/execute/{workflowName}` with inputs

### API Layer
- **internalAPI** (`src/core/internalAPI.js`)
  - Provides REST endpoint `/workflows/execute/:name` that receives workflow execution requests
  - Routes workflow execution through the `executeWorkflow()` function
  - Transforms input parameters and prepares them for service execution

### Core Services
- **ComfyDeployAdapter** (`src/services/comfydeploy/adapter.js`)
  - Acts as an interface between the internal API and ComfyDeploy service
  - Transforms service parameters into generation requests

- **ComfyDeployService** (`src/services/comfydeploy/ComfyDeployService.js`)
  - Handles generation requests
  - Validates inputs
  - Communicates with external ComfyDeploy services

- **PromptBuilder** (`src/services/comfydeploy/PromptBuilder.js`)
  - Constructs the final request object to be sent to ComfyDeploy
  - The `_finalizeRequest()` method is where user inputs are processed and transformed

## 📊 Data Flow Analysis

### 1. Frontend Input Collection (WorkflowToolbar)
- User selects workflow and configures parameters
- Inputs are collected in `runCurrentWorkflow()` method
- Payload structure: `{ inputs: { param1: value1, param2: value2, ... } }`

### 2. API Request Processing (internalAPI)
- `executeWorkflow()` receives request and prepares execution context
- Input processing happens in multiple steps:
  - Processes numeric keys (indexed inputs)
  - Processes direct input parameters with `input_` prefix
  - Processes standard parameters and converts them to `input_` format

### 3. Service Execution (ComfyDeployService)
- `generate()` method validates the request and prepares a task
- Calls `promptBuilder.build()` to construct the ComfyDeploy request

### 4. Request Finalization (PromptBuilder)
- `_finalizeRequest()` transforms inputs into the format expected by ComfyDeploy
- Currently has issues with input handling:
  - Retrieves inputs from multiple sources
  - May not correctly prioritize user-supplied values
  - Has overlapping logic for input processing

## 🔍 Input Loss Analysis

The primary issue appears to be in the `PromptBuilder._finalizeRequest()` method, where inputs from different sources are processed with the following issues:

1. **Source Priority Confusion**: The method collects inputs from multiple sources but doesn't clearly prioritize user-specified values over defaults.

2. **Input Parameter Naming**: Inconsistent handling of `input_` prefixed parameters vs. non-prefixed parameters.

3. **Re-mapping Logic**: The code tries to map inputs across multiple paths which can lead to overwriting user values.

4. **UI-Requested Inputs**: Logic to handle UI-requested inputs is present but may not be working correctly, as it doesn't consistently use the user's input values.

## 💡 Improvement Areas

1. The `_finalizeRequest()` method needs to clearly prioritize inputs:
   - User-supplied values from UI should take precedence
   - Then direct parameters from the workflow request
   - Only then apply defaults for missing values

2. Input processing needs to handle both prefixed (`input_`) and non-prefixed parameters consistently

3. Debug logging should be enhanced to track exactly which values are being used and from what source

4. UI-requested inputs should be properly tracked and preserved throughout the pipeline

## 🛠️ Recommended Fix Location

The primary fix should be targeted at `src/services/comfydeploy/PromptBuilder.js` in the `_finalizeRequest()` method, ensuring that user-provided inputs are correctly preserved through the transformation process. 