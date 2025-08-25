> Imported from vibecode/bulk/handoffs/HANDOFF-2025-05-12-TelegramRefactorCostRate.md on 2025-08-21

# HANDOFF: 2025-05-12 - Telegram Dynamic Command Refactor & Cost Rate Calculation

## Work Completed

This session focused on refactoring the Telegram platform adapter, specifically the dynamic command handlers (`src/platforms/telegram/dynamicCommands.js`), to utilize the Internal API and correctly determine generation cost rates.

**Phase 9: Internal API Authentication:**
*   Implemented `internalApiAuthMiddleware` in `app.js` to require `X-Internal-Client-Key` header validation for requests to the Internal API (`/internal/v1/*`).
*   Tested and confirmed middleware correctly rejects requests with missing or invalid keys (401/403).

**Phase 10: Telegram `/status` Command Refactor:**
*   Created `src/platforms/telegram/utils/internalApiClient.js` (axios instance with base URL and auth header).
*   Refactored `src/platforms/telegram/commands/statusCommand.js` to use `internalApiClient` for user/session/event interactions, replacing direct DB calls. Tested successfully.

**Phase 11: Telegram Dynamic Commands Refactor:**
*   **`/noemainfome` Command:** Refactored to use `internalApiClient.get('/users/by-platform/telegram/{targetTelegramId}')`. Tested successfully.
*   **Dynamic Workflow Commands (e.g., `/l4_t2i`):**
    *   **User/Session/Event Handling:** Refactored to use `internalApiClient` for `POST /users/find-or-create`, `GET /users/.../sessions/active`, `POST /sessions`, `POST /events`, and `PUT /sessions/.../activity`.
    *   **Generation Logging:** Implemented logging of generation requests via `POST /generations`, linking to the triggering user command event (`initiatingEventId`).
    *   **Cost Rate Determination:**
        *   Refactored `src/core/services/comfydeploy/comfyui.js`:
            *   Added `initialize()` method to cache machine (`machinesCache`) and deployment (`deploymentsCache`) details fetched via `resourceFetcher`.
            *   Refactored `getCostRateForDeployment(deploymentId)`:
                *   Initially attempted lookup via `getWorkflowDetails(deploymentId)`, resulted in 404.
                *   Updated to use `deploymentsCache` to find `machine_id`.
                *   Updated again to use `machinesCache` to find the machine details using `machine_id`.
                *   Identified `machine.gpu` as the correct field containing the GPU identifier (e.g., "A10G").
                *   Implemented logic to extract `machine.gpu` and use it (uppercase) as the key for lookup in the static `MACHINE_COST_RATES` map.
        *   Updated `dynamicCommands.js` to call `comfyuiService.getCostRateForDeployment(deploymentId)` and store the resulting rate object (e.g., `{ amount: ..., currency: ..., unit: ... }`) or an error string in the `metadata.costRate` field of the generation record logged via `POST /generations`.
    *   **ComfyUI Submission & Linking:** Successfully submits jobs to ComfyUI via `comfyuiService.submitRequest` and links the returned `run_id` to the corresponding generation record via `PUT /generations/{id}`.
    *   **Regex Fix:** Corrected the `bot.onText` regex to properly handle commands with and without prompts (`^/${commandName}(?:@\w+)?(?:\s+(.*))?$`).
*   **Error Handling:** Added `APIError` class in `src/utils/errors.js` and updated `comfyui.js` to use it for better error reporting.

## Current State

*   The Telegram platform adapter now uses the authenticated Internal API for `/status` and `/noemainfome` commands.
*   Dynamic workflow commands (text-input only) are successfully registered based on ComfyDeploy workflows.
*   When a dynamic command is triggered:
    *   User/session context is correctly handled via the Internal API.
    *   A `user_command_triggered` event is logged via the Internal API.
    *   The generation cost rate is determined by looking up the deployment's associated machine and its `gpu` field, then mapping it to the `MACHINE_COST_RATES`. This rate object is stored in the generation record's metadata.
    *   The generation task is logged via `POST /generations`, including the cost rate and linking event.
    *   The job is submitted to ComfyUI.
    *   The ComfyUI `run_id` is linked back to the generation record via `PUT /generations/{id}`.
*   The system successfully handles the flow from Telegram command trigger to ComfyUI job submission, including Internal API interactions and cost rate calculation.

## Next Tasks

As per your request, the next major step is to complete the generation lifecycle by implementing the webhook handling system:

1.  **Implement ComfyDeploy Webhook Handler:**
    *   Create a new route (e.g., `/webhooks/comfyui-run-updates`) in `src/api/webhooks/` (or similar appropriate location).
    *   This endpoint will receive status updates (e.g., `succeeded`, `failed`, `running`) and output results from ComfyDeploy runs, identifiable by `run_id`.
2.  **Update Generation Record:**
    *   When a webhook for a completed run (`succeeded`, `failed`) is received:
        *   Extract the `run_id`.
        *   Find the corresponding `GenerationOutputObject` record via the Internal API (potentially by querying `GET /generations?metadata.run_id={run_id}`).
        *   Update the generation record via `PUT /generations/{id}` with:
            *   `status` (e.g., 'completed', 'failed').
            *   `statusReason` (if failed).
            *   `responseTimestamp`.
            *   `responsePayload` (containing the output data, e.g., image URLs).
            *   `costUsd` (calculated based on the stored `costRate` and the actual run duration, which might also come from the webhook or require a separate API call to ComfyDeploy history).
3.  **Notify User (Telegram):**
    *   After successfully updating the generation record for a completed job:
        *   Retrieve the `telegramChatId` and `telegramUserId` from the generation record's metadata.
        *   Send a message back to the originating Telegram chat, indicating success (potentially with the generated output/image) or failure.

## Open Questions

*   What specific data does the ComfyDeploy webhook payload contain, particularly regarding run duration for accurate final cost calculation? We may need to investigate the ComfyDeploy API documentation or webhook examples.
*   How should the final cost be calculated and stored? (`costUsd` field in `GenerationOutputObject`).
*   Does the `PUT /generations/{id}` endpoint support updating nested metadata fields without overwriting others, or do we need to fetch, merge, and put the entire metadata object? (Assumed partial update works for `run_id` linking, need to confirm for cost/status).

## Files Touched/Created in this Phase (Major):
*   `src/platforms/telegram/dynamicCommands.js` (Refactored handlers)
*   `src/core/services/comfydeploy/comfyui.js` (Added caching, refactored cost rate logic)
*   `src/core/services/comfydeploy/resourceFetcher.js` (Reviewed)
*   `src/utils/errors.js` (Created `APIError`)
*   `vibecode/handoffs/HANDOFF-2025-05-12-TelegramRefactorCostRate.md` (This document)

## Referenced Documents:
*   `ADR-003-InternalAPIForNoemaServices.md`
*   `AGENT_COLLABORATION_PROTOCOL.md`
*   `vibecode/handoffs/HANDOFF-2025-05-12-InternalApiComplete.md` 