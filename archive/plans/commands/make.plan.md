# make.js Plan

## Current Purpose
`make.js` is the central image generation module responsible for transforming user prompts into images. It handles preparation of prompt objects, interaction with the ComfyDeploy API, and processing of the resulting output. This file serves as the bridge between user input and the actual AI image generation service.

## Exported Functions/Classes
- **Prompt Object Building**:
  - `buildCommonPromptObj(userContext, message)` - Builds base prompt object
  - `buildPromptObjFromWorkflow(workflow, userContext, message)` - Creates prompt based on workflow
  - `applyMapping(promptObj, userContext, key, value)` - Applies mappings to prompt objects

- **Prompt Processing**:
  - `promptPreProc(promptObj)` - Pre-processes prompts, handling LoRA triggers
  - `extractType(url)` - Identifies media type from URL extension

- **API Interaction**:
  - `fetchOutput(run_id)` - Retrieves results from ComfyDeploy API
  - `generate(promptObj)` - Main function to send generation requests
  - `imgPreProc(promptObj)` - Prepares images for processing
  - `chooseIdByMachine(ids, promptObj)` - Selects appropriate deployment ID
  - `prepareRequest(promptObj)` - Prepares the API request payload

## Dependencies and Integrations
- External API services:
  - ComfyDeploy API for image generation
- Local modules:
  - LoRA trigger handling from `loraTriggerTranslate.js`
  - Default settings from `defaultSettings.js`
  - Base prompts from `basepromptmenu.js`
  - Deployment IDs from `deployment_ids.js`
- Environment variables for configuration

## Identified Issues
- Direct coupling with specific API format (ComfyDeploy)
- Complex transformations between user context and API payload
- Mixed functionality: prompt building, API interaction, result processing
- No clear error handling or retry strategy
- Hard-coded webhook URL and negative prompt
- Centralized logic for different generation types
- No abstraction for different generation services
- No proper validation of inputs and outputs
- No monitoring or analytics for generation requests

## Migration Plan
1. Create `src/core/generation/`:
   - `prompt.js` - Core prompt building and validation
   - `model.js` - Data models for generation requests and responses
   - `transformer.js` - Context to prompt object transformation
   - `processor.js` - Pre and post processing of prompts/results
   - `service.js` - Orchestration of generation flow

2. Create `src/services/comfydeploy/`:
   - `client.js` - API client for ComfyDeploy
   - `mapper.js` - Maps internal prompt objects to ComfyDeploy format
   - `config.js` - Service-specific configuration

3. Create `src/core/lora/`:
   - `service.js` - LoRA handling logic
   - `transformer.js` - LoRA-specific prompt transformation

4. Implement `src/api/generation.js`:
   - Internal API for generation operations
   - Service-agnostic interfaces
   - Request/response validation

5. Suggested improvements:
   - Implement proper error handling with retries
   - Add validation for all inputs and outputs
   - Create a service abstraction layer for multi-provider support
   - Add metrics collection for generation requests
   - Implement asynchronous generation with callbacks
   - Add result caching for duplicate requests
   - Improve webhook security
   - Create a unified logging system for debugging
   - Support different generation models explicitly
   - Add proper resource management for API quotas and rate limits 