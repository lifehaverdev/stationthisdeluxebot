# ComfyDeploy Service Layer

This directory contains the core service modules responsible for interacting with the ComfyDeploy API (https://www.comfydeploy.com/). These services abstract the raw API calls and provide a structured interface for the rest of the application.

## Modules

*   **`comfyui.js`**: 
    *   **Purpose**: The primary public interface for most general ComfyDeploy API interactions, including managing runs (submit, check status, get results, cancel), managing files (upload), and fetching resources (deployments, machines, specific workflow versions/content).
    *   **Interaction**: Acts as an orchestrator, delegating specific tasks to `runManager.js`, `fileManager.js`, and `resourceFetcher.js`. It handles authentication and basic request formatting.

*   **`workflows.js`**: 
    *   **Purpose**: The primary public interface specifically for accessing processed *workflow definition* information (listing available workflows, getting required inputs, output types, LoRA support, associated deployment IDs).
    *   **Interaction**: Relies entirely on `workflowCacheManager.js` for the underlying data. Provides methods to retrieve cached/processed workflow information. Also uses `workflowActions.js` for operations like creating deployments or uploading workflows, and `workflowUtils.js` for validation and payload preparation.

*   **`workflowCacheManager.js`**: 
    *   **Purpose**: An *internal* module responsible for the heavy lifting of fetching, caching, processing, and indexing workflow data from the ComfyDeploy API.
    *   **Interaction**: Used exclusively by `workflows.js`. It handles the initialization sequence, fetching deployments and workflows, parsing structures, building lookup indexes (by name, by ID), and managing cache state (TTL, staleness).

*   **`config.js`**: 
    *   **Purpose**: Centralized configuration for the ComfyDeploy services.
    *   **Interaction**: Exports constants like API base URL, specific endpoints, default timeouts, and cache TTLs. Imported by most other modules in this directory.

*   **`fileManager.js`**: 
    *   **Purpose**: Handles API calls specifically related to file management (getting upload URLs, performing uploads).
    *   **Interaction**: Used by `comfyui.js`.

*   **`runManager.js`**: 
    *   **Purpose**: Handles API calls related to managing workflow runs (submitting requests, checking status, retrieving results, cancelling).
    *   **Interaction**: Used by `comfyui.js`.

*   **`resourceFetcher.js`**: 
    *   **Purpose**: Handles API calls for fetching various resources like the list of deployments, machines, specific workflow versions, and workflow content/JSON.
    *   **Interaction**: Used by `comfyui.js`. Note that `workflowCacheManager.js` also uses some of these underlying API calls indirectly via temporary `ComfyUIService` instances for fetching workflow details during its initialization.

*   **`workflowUtils.js`**: 
    *   **Purpose**: Provides utility functions for parsing workflow JSON structures (extracting inputs, outputs), standardizing names, validating input payloads, and preparing execution payloads.
    *   **Interaction**: Used primarily by `workflows.js` and `workflowCacheManager.js`.

*   **`workflowActions.js`**: 
    *   **Purpose**: Contains higher-level actions related to workflows, such as creating a new deployment from a workflow version or uploading a new workflow definition.
    *   **Interaction**: Used by `workflows.js`.

## Interaction Flow (Simplified)

```
Application Code
      |
      |--- Calls ---> comfyui.js (for runs, files, resources)
      |                 |--- Delegates --> runManager.js
      |                 |--- Delegates --> fileManager.js
      |                 |--- Delegates --> resourceFetcher.js
      |
      |--- Calls ---> workflows.js (for workflow definitions/info)
                        |
                        |--- Delegates --> workflowCacheManager.js (for data/cache)
                        |                   |--- Uses --> resourceFetcher.js (indirectly via comfyui.js for details)
                        |
                        |--- Delegates --> workflowActions.js (for deployment/upload)
                        |--- Uses ------> workflowUtils.js

```

Both `comfyui.js` and `workflows.js` (and their delegates) utilize `config.js` for endpoint URLs and settings. 