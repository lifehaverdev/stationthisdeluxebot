> Imported from docs/parameter-tracing-solution.md on 2025-08-21

# Parameter Tracing and Normalization Solution

## Summary of Findings

Our code tracing investigation revealed several inconsistencies in how parameters are structured and transformed from user input to ComfyDeploy API requests:

1. **Inconsistent Parameter Naming**: Parameters are referred to both with and without the `input_` prefix at different stages of processing.

2. **Template Structure Mismatch**: Workflow templates in the database sometimes define parameters differently than what the API expects (some with `input_` prefix, some without).

3. **Complex Transformation Logic**: The `_finalizeRequest()` method in `PromptBuilder.js` implements an overly complex parameter prioritization and normalization scheme.

4. **Missing Final Validation**: The final API request can contain parameters both with and without the required `input_` prefix.

## Parameter Flow Analysis

We traced the parameter transformation through these key stages:

1. **Web Request** (`generationRoutes.js`):
   - Accepts parameters directly from frontend
   - Parameters can be either at root level or in a nested `inputs` object
   - No prefix normalization happens at this stage

2. **Service Entry** (`ComfyDeployService.generate`):
   - Creates a `GenerationRequest` with settings
   - No parameter normalization

3. **Common Prompt Object** (`_buildCommonPromptObj`):
   - Creates parameters with `input_` prefix (e.g., `input_seed`, `input_batch`)
   - Keeps non-prefixed parameters in the settings object

4. **Deployment Info** (`_applyDeploymentInfo`):
   - Adds workflow templates that can have inconsistent parameter naming conventions
   - Some template parameters have `input_` prefix, others don't

5. **Parameter Finalization** (`_finalizeRequest`):
   - Complex normalization with six priority levels
   - Parameters can still emerge without `input_` prefix

6. **API Request** (`ComfyClient.sendRequest`):
   - Final request might have parameters with and without `input_` prefix
   - API expects all parameters to have `input_` prefix

## Implemented Solution

### 1. Parameter Normalization Utility

We've created a utility module (`normalizeParameters.js`) that provides functions for consistently normalizing parameters:

- `normalizeParameterKey`: Adds `input_` prefix to individual parameter keys
- `normalizeParameterKeys`: Normalizes all keys in an object
- `normalizeTemplateParameters`: Normalizes workflow template inputs
- `normalizeAPIParameters`: Ensures API request has consistently prefixed parameters
- `normalizeUIParameters`: Extracts and normalizes parameters from UI input

### 2. Integration Points

The parameter normalization should be applied at these key integration points:

1. **Early Normalization** (web routes and service boundaries)
2. **Template Normalization** (workflow templates)
3. **Simplified Parameter Logic** (replace complex _finalizeRequest logic)
4. **API Request Validation** (ensure all parameters are correctly prefixed)

### 3. Testing Strategy

We implemented a comprehensive test suite for the normalization utility and created a mock parameter tracing test that simulates the data flow through the system.

## Implementation Plan

1. **Phase 1: Utility Deployment**
   - Deploy parameter normalization utility with tests
   - Add logging for parameter structure monitoring

2. **Phase 2: Service Layer Integration**
   - Integrate normalization in ComfyDeployService
   - Replace complex PromptBuilder logic

3. **Phase 3: Boundary Integration**
   - Add normalization to web routes and other input boundaries
   - Normalize workflow templates

4. **Phase 4: Strict Validation**
   - Add strict validation to throw errors on incorrectly prefixed parameters
   - Update client-side code to use consistent parameter naming

## Benefits

- **Consistent Parameter Naming**: All parameters will use the `input_` prefix throughout the system
- **Simplified Logic**: Complex parameter transformation is replaced with simple utility functions
- **Improved Reliability**: Early normalization prevents issues from propagating
- **Better Maintainability**: Centralized handling makes future updates easier

## Next Steps

1. Execute the implementation plan phases
2. Monitor API requests to verify parameter correctness
3. Update documentation to enforce the new parameter naming conventions 