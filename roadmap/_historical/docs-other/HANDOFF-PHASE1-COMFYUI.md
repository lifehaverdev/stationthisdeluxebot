> Imported from docs/handoffs/HANDOFF-PHASE1-COMFYUI.md on 2025-08-21

# HANDOFF: PHASE1-COMFYUI

## Work Completed
- Implemented the ComfyUI service as the first core service
- Extracted key functionality from `utils/bot/queue.js` and `archive/src/core/generation`
- Created a clean, platform-agnostic interface for ComfyUI interaction
- Added comprehensive documentation and error handling
- Updated progress tracking documents

## Current State

### Repository Structure
The ComfyUI service has been added to the core services layer:

```
src/
  core/
    services/
      comfyui.js      # New ComfyUI service implementation
      index.js        # Services index for easy importing
```

### Implementation Details

The ComfyUI service provides the following capabilities:
- Submitting generation requests to ComfyUI
- Checking status of active requests
- Retrieving results of completed generations
- Canceling active requests
- Managing timeouts and stale requests
- Implementing retry mechanisms for API calls

The service uses a clean OOP approach with:
- Public methods for the main functionality
- Private helper methods (prefixed with `_`) for internal operations
- Comprehensive error handling and logging
- Configurable options via constructor

## Next Tasks
1. Implement Points Service:
   - Extract functionality from `utils/bot/points.js`
   - Create a clean interface for points management
   - Implement balance tracking and transaction history

2. Continue with Phase 1 service implementations:
   - Workflows Service for workflow management
   - Media Service for handling image and file operations
   - Session Service for user session management

3. Prepare for the workflow layer:
   - Analyze how workflow components will use the core services
   - Plan the interface between services and workflows

## Changes to Plan
No significant changes to the REFACTOR_GENIUS_PLAN.md at this time. The implementation follows the planned simplified architecture.

## Open Questions

### 1. How should the ComfyUI service handle different workflow types?
**Answer**: Based on analysis of the original codebase in `commands/make.js` and `utils/bot/initialize.js`, we should implement:

- Integration with the Workflows service to access workflow templates stored in MongoDB
- A workflow parser that extracts required inputs from ComfyUI workflow JSON (already implemented in `initialize.js` via `parseWorkflow`)
- Support for dynamic workflow selection through `getDeploymentIdByType` function
- A mechanism to map workflow types to their respective IDs and required inputs
- Support for load balancing across multiple deployment IDs based on context (API calls, cook mode, etc.)

The ComfyUI service should be enhanced during initialization to load workflow templates and their required inputs, making it easier for clients to know what parameters are needed for each workflow type.

### 2. How will authentication be handled for ComfyUI API calls?
**Answer**: The original implementation in `commands/make.js` shows that:

- The system uses ComfyDeploy's API at "https://www.comfydeploy.com/api/run" rather than a direct ComfyUI instance
- Authentication is handled via Bearer token in the Authorization header: `"Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY`
- API keys are stored in the .env file and loaded via process.env

Our ComfyUI service should be updated to:
- Use the ComfyDeploy API endpoint by default
- Accept an API key via constructor options and/or environment variables
- Implement proper Bearer token authentication in all API requests
- Support both the ComfyDeploy API and direct ComfyUI API through configuration 