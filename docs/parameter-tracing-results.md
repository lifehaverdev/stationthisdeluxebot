# Parameter Tracing: User Input to API Request

## Overview

This document details how user parameters flow through our workflow system to the ComfyDeploy API. It outlines the transformation chain from initial user input to the final API request, identifying potential inconsistencies in parameter naming conventions.

## Parameter Flow Diagram

```
User Interface 
   │
   ▼
Web Request (generationRoutes.js)
   │
   ▼
ComfyDeployAdapter
   │
   ▼
ComfyDeployService
   │
   ▼
PromptBuilder._buildCommonPromptObj()
   │
   ▼
PromptBuilder._applyDeploymentInfo()
   │
   ▼
PromptBuilder._finalizeRequest()
   │
   ▼
ComfyClient.sendRequest()
   │
   ▼
ComfyDeploy API
```

## Key Transformation Points

### 1. Web Routes (`generationRoutes.js`)
- Accepts `parameters` object directly from frontend
- Passes parameters as `settings` to ComfyDeployService
- Optional nested `inputs` object can contain direct parameter values

### 2. Generation Request Creation (`ComfyDeployService.generate()`)
- Creates a normalized `GenerationRequest` object
- Maps `userId` from various potential sources
- Passes request to PromptBuilder

### 3. Common Prompt Object (`PromptBuilder._buildCommonPromptObj()`)
- Creates a standardized object with both prefixed and non-prefixed parameters
- Sets `input_*` prefixed parameters directly on the object
- Preserves original settings in `settings` property

### 4. Deployment Info (`PromptBuilder._applyDeploymentInfo()`)
- Adds deployment IDs and template inputs from service configuration
- Templates may or may not use `input_` prefixes for parameters

### 5. Parameter Normalization (`PromptBuilder._finalizeRequest()`)
- Most complex transformation stage
- Collects parameters from multiple sources in priority order:
  1. User settings.inputs (direct UI inputs)
  2. Direct settings object values 
  3. Special prompt handlers
  4. Direct promptObj input_ prefixed values
  5. Non-prefixed promptObj values
  6. Default values
- Normalizes parameter names by adding `input_` prefix if missing

### 6. API Request (`ComfyClient.sendRequest()`)
- Final transformation before API call
- Must ensure all parameters have correct format for API

## Identified Issues

1. **Inconsistent Parameter Naming**: Parameters can be specified with or without `input_` prefix in various stages, leading to confusion.

2. **Template Mismatch**: Workflow templates in the database may define parameters differently than what the API expects.

3. **Duplication Risk**: Parameters may exist in both prefixed and non-prefixed forms.

4. **Normalization Complexity**: The normalization process in `_finalizeRequest()` is overly complex with multiple priority layers.

## Recommended Fixes

1. **Standardize Parameter Names**: Ensure consistent naming conventions throughout the system:
   - In database templates
   - In service interfaces
   - In prompt builder logic

2. **Single Parameter Source**: Consolidate parameter collection to a single prioritized source:
   ```javascript
   const finalParams = {
     ...defaultParameters,
     ...deploymentTemplate.inputs,
     ...userProvidedParameters
   };
   ```

3. **Normalize Early**: Add `input_` prefix at the earliest possible stage rather than throughout the system.

4. **Validate Against Schema**: Add schema validation for parameters at the service boundary to ensure correct structure.

## Parameter Mapping Reference Table

| Source                  | Format               | Example                | Transformation Needed |
|-------------------------|----------------------|------------------------|------------------------|
| User Input (UI)         | Mixed                | `width` or `input_width` | Normalize to `input_width` |
| settings.inputs         | Mixed                | `{1: "prompt", input_width: 1024}` | Extract and normalize |
| GenerationRequest       | No prefix            | `{width: 1024}`        | Add `input_` prefix |
| deploymentInfo.inputs   | Mixed/Template dependent | Varies by deployment ID | Normalize or match API expectations |
| promptObj               | Mixed, with `input_` properties | Has both `width` and `input_width` | Normalize to `input_` |
| ComfyDeploy API         | `input_` prefixed    | `{input_width: 1024}`  | Required format |

## Parameter Key Transformations

For a typical parameter like "width":

1. User UI input: `width` or `input_width` 
2. Request parameter: `width` (in settings object)
3. PromptBuilder common object: `input_width` directly on object
4. PromptBuilder normalization: `input_width` in final inputs
5. API request: `input_width` required

The inconsistency comes from allowing both forms at various stages, rather than enforcing a single convention throughout. 