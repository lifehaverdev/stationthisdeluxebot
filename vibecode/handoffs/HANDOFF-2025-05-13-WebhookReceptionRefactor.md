# HANDOFF: 2025-05-13 - ComfyDeploy Webhook Reception Refactor & Initial Processing

## Work Completed

This session focused on successfully establishing and refactoring the reception of ComfyDeploy webhooks, routing them to a dedicated processor, and ensuring the correct webhook URL is sent during job submission.

**Key Achievements:**

1.  **Webhook Endpoint Correction & Refinement:**
    *   The ComfyDeploy webhook URL construction in `src/core/services/comfydeploy/comfyui.js` was updated to correctly append `/api/webhook/comfydeploy` to the base URL defined in the `.env` file (`WEBHOOK_URL`). This ensures ComfyDeploy is always instructed to send webhooks to the correct new endpoint.
    *   The Express route handler in `src/platforms/web/routes/index.js` was updated to listen on the new path `/api/webhook/comfydeploy`.

2.  **Webhook Processing Logic Refactor:**
    *   Created a new dedicated module `src/core/services/comfydeploy/webhookProcessor.js`.
    *   Moved the primary logic for handling incoming ComfyDeploy webhooks (parsing, logging, and initial status handling) from the route handler in `index.js` to the `processComfyDeployWebhook` function within this new module.
    *   The route handler in `index.js` now imports and calls `processComfyDeployWebhook`, passing the request body and necessary (currently mocked/simulated) dependencies like a logger.

3.  **Successful Webhook Reception & Logging:**
    *   Confirmed through extensive logging that:
        *   The `ComfyUIService` correctly constructs and submits the full webhook URL (`http://<YOUR_IP>:<YOUR_PORT>/api/webhook/comfydeploy`) to ComfyDeploy when a job is initiated.
        *   ComfyDeploy successfully sends a series of `run.updated` webhooks (for `queued`, `started`, `running` with progress, `uploading`, and `success`/`failed` statuses) to the `/api/webhook/comfydeploy` endpoint.
        *   The `webhookProcessor.js` module correctly receives these POST requests, parses the JSON payloads, and logs the key information (run_id, status, progress, live_status, outputs).

4.  **Environment Configuration:**
    *   Identified and resolved the critical issue where the `WEBHOOK_URL` environment variable needed to include the specific port (`:81` in this case) that the Docker container's internal port `4000` is mapped to on the host.

## Current State

*   The application can now reliably receive the full stream of status updates from ComfyDeploy for each generation job.
*   The webhook endpoint is correctly configured at `/api/webhook/comfydeploy`.
*   Incoming webhooks are routed to `webhookProcessor.js`, which logs their content, captures `startTime` on the first "running" event, and simulates the next steps (fetching generation records, calculating cost, updating records, notifying users).
*   The `activeJobProgress` Map within `webhookProcessor.js` tracks intermediate statuses including the `startTime` for duration calculation.
*   The full lifecycle from Telegram command -> ComfyDeploy job submission -> multiple webhook updates received -> webhook processor logging is functional.

## Next Tasks

The immediate focus is to implement the actual business logic within `src/core/services/comfydeploy/webhookProcessor.js`:

1.  **Integrate Dependencies into `webhookProcessor.js`:**
    *   Modify `src/platforms/web/routes/index.js` to pass the actual `internalApiClient` (from the `services` object) to `processComfyDeployWebhook`.
    *   Similarly, pass a `telegramNotifier` service/function (from `services`).
    *   Pass the application's standard `logger` (from `services`, if different from `console`).

2.  **Implement "Real" Generation Record Update in `webhookProcessor.js`:**
    *   When a final status webhook (`success` or `failed`) is received:
        *   **Fetch Record:** Uncomment and implement the `await internalApiClient.get('/generations?metadata.run_id={run_id}')` call to find the corresponding `GenerationOutputObject` record. Handle cases where the record is not found.
        *   **Extract Data:** From the fetched `generationRecord`, extract `generationId = generationRecord.id`, `costRate = generationRecord.metadata.costRate` (this is the pre-calculated rate per unit of time), and `telegramChatId = generationRecord.metadata.telegramChatId`.
        *   **Calculate `costUsd` (for `status: "success"` only):**
            *   The `startTime` is already being captured in `activeJobProgress` upon the first `status: "running"` webhook.
            *   The `finalEventTimestamp` (timestamp of the `success` webhook) is already being captured.
            *   Calculate `runDurationSeconds = (new Date(finalEventTimestamp).getTime() - new Date(jobStartDetails.startTime).getTime()) / 1000`.
            *   Calculate `costUsd = runDurationSeconds * costRate.amount` (ensure `costRate` and its `amount` and `unit` are valid).
            *   Log the calculated duration and cost, or any warnings if data was missing for calculation.
        *   **Prepare `updatePayload`:** Construct the payload with `status` (mapped to 'completed' or 'failed'), `statusReason`, `responseTimestamp`, `responsePayload` (outputs or error details), and the calculated `costUsd`.
        *   **Update Record:** Uncomment and implement `await internalApiClient.put('/generations/{generationId}', updatePayload)`. (Partial update confirmed to be supported by the API).

3.  **Implement "Real" User Notification (Telegram) in `webhookProcessor.js`:**
    *   After successfully (or even on failure to update DB, if desired) processing the webhook:
        *   Use the retrieved `telegramChatId` and the `telegramNotifier` service.
        *   If `status === "success"`, send a success message, potentially including the image URL (`outputs[0].data.images[0].url`).
        *   If `status === "failed"`, send a failure message including the `statusReason`.

4.  **Error Handling & Resilience in `webhookProcessor.js`:**
    *   Implement robust `try...catch` blocks around API calls (`internalApiClient.get`, `internalApiClient.put`, `telegramNotifier.sendMessage`).
    *   Log errors clearly.
    *   Decide on behavior if, for example, the generation record can't be found or updated – should user notification still proceed?

## Changes to Plan
*   No major deviations from the overall plan. The refactor of webhook handling into a dedicated service (`webhookProcessor.js`) is an architectural improvement. Clarification on duration calculation and API update behavior has refined the implementation details for the next phase.

## Open Questions

*   **Webhook Timestamps for General Information (Answered for cost calculation):** While the duration for cost is now defined (first `running` to `success` event), are there other timestamps in the webhook payloads (e.g., `created_at`, `updated_at` at the root of the webhook, or in `outputs`) that might be useful to store for general run analytics or debugging? *(This is a minor point for future consideration, not a blocker for current tasks)*.
*   **Internal API Partial Updates (Answered):** Confirmed. The `PUT /generations/{id}` endpoint supports partial updates by wrapping the request body in a `$set` operation if no top-level MongoDB operators are present in the request body. This simplifies the update logic in `webhookProcessor.js`.

## Files Touched/Created in this Phase (Major):
*   `src/core/services/comfydeploy/comfyui.js` (Updated webhook URL construction)
*   `src/platforms/web/routes/index.js` (Updated endpoint path, calls new processor)
*   `src/core/services/comfydeploy/webhookProcessor.js` (New file for webhook processing logic, including `startTime` capture and `costUsd` calculation logic)
*   `vibecode/handoffs/HANDOFF-2025-05-13-WebhookReceptionRefactor.md` (This document)

## Demonstration / Proof of Success
The successful reception and logging of the full ComfyDeploy webhook stream can be demonstrated by:
1.  Setting the `WEBHOOK_URL` in the `.env` file on the deployment server to `http://<YOUR_IP>:<MAPPED_PUBLIC_PORT>` (e.g., `http://64.227.15.104:81`).
2.  Deploying the latest code.
3.  Triggering a generation via a Telegram command (e.g., `/l4_t2i <prompt>`).
4.  Observing the server logs, which will show:
    *   `ComfyUIService` correctly forming the `finalWebhookUrl` to include `/api/webhook/comfydeploy`.
    *   A series of `POST /api/webhook/comfydeploy` entries.
    *   Logs from `[Webhook Processor]` for each webhook received, detailing its status, payload, `startTime` capture, and simulated `costUsd` calculation.

This demonstrates that the fundamental mechanism for receiving and initially parsing webhooks is now robust and correctly configured. 