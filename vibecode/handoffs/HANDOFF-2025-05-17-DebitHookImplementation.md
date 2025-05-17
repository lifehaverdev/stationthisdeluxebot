# Handoff: ADR-005 Debit Hook Implementation - 2025-05-17

## Summary of Implementation

This work implements the standardized debit enforcement flow as per [ADR-005-Standardized-Debit-Accounting.md](mdc:vibecode/decisions/ADR-005-DEBIT.md). The core logic resides in `src/core/services/comfydeploy/webhookProcessor.js`, which now attempts to debit the user's account via the internal economy API immediately after a generation job is successfully completed and its cost (`costUsd`) is finalized.

If the debit is successful, the generation record's status remains `completed`, and it proceeds to the notification dispatch flow (if applicable).

If the debit fails for any reason (e.g., insufficient funds, API error), the generation record's status is updated to `payment_failed`, and the generation is not delivered to the user. The `NotificationDispatcher.js` service has also been updated to explicitly ignore generations marked as `payment_failed`.

## Key Files Changed and Debit Logic

### 1. `src/core/services/comfydeploy/webhookProcessor.js`

-   **Location of Change**: After the `generationRecord` is updated with the final status (`completed` or `failed`) and `costUsd`.
-   **Logic**:
    1.  Checks if the `generationRecord` status is `completed` and `costUsd` is a positive value.
    2.  Retrieves `toolId` from `generationRecord.metadata.toolId` or `generationRecord.toolId`.
    3.  Calls the new helper function `buildDebitPayload()` to construct the debit request body.
    4.  Calls the new helper function `issueDebit()` to send a `POST` request to `/internal/v1/data/users/:masterAccountId/economy/debit`.
    5.  **On Debit Success**: Logs success. The generation proceeds as normal (e.g., to notification).
    6.  **On Debit Failure**:
        -   Logs the error.
        -   Updates the `generationRecord`'s `status` to `payment_failed` and `statusReason` with the error message via an internal API `PUT` request to `/v1/data/generations/:generationId`.
        -   This prevents the `NotificationDispatcher` from picking up the job.

### 2. `src/core/services/notificationDispatcher.js`

-   **Location of Change**: In the `_processPendingNotifications` method, during the filtering of fetched generation records.
-   **Logic**:
    -   The existing query fetches records with `deliveryStatus: 'pending'` and `status_in: ['completed', 'failed']`.
    -   An additional client-side filter `record.status !== 'payment_failed'` has been added to ensure that generations for which payment failed are not processed for notification dispatch.

## Helper Functions Added (in `webhookProcessor.js`)

### 1. `buildDebitPayload(toolId, generationRecord, costUsd)`

-   **Purpose**: Constructs the payload for the debit API request.
-   **Payload Fields**:
    -   `amountUsd`: The finalized `costUsd`.
    -   `toolId`: The ID of the tool used for generation.
    -   `generationId`: The ID of the `generationRecord`.
    -   `metadata`: Contains a description and the `run_id` for traceability.

```javascript
function buildDebitPayload(toolId, generationRecord, costUsd) {
  return {
    amountUsd: costUsd,
    toolId: toolId,
    generationId: generationRecord._id,
    metadata: {
      description: `Debit for generation via ${toolId}`,
      run_id: generationRecord.metadata?.run_id,
    },
  };
}
```

### 2. `issueDebit(masterAccountId, payload, { internalApiClient, logger })`

-   **Purpose**: Handles the actual POST request to the internal economy debit endpoint.
-   **Functionality**:
    -   Takes `masterAccountId`, the `payload` from `buildDebitPayload`, and an object containing `internalApiClient` and `logger`.
    -   Sends a `POST` request to `/internal/v1/data/users/:masterAccountId/economy/debit`.
    -   Includes the `X-Internal-Client-Key` header.
    -   Logs the request and response/error.
    -   Throws an error if the debit API call fails, which is then caught by the main processing logic in `processComfyDeployWebhook`.

```javascript
async function issueDebit(masterAccountId, payload, { internalApiClient, logger }) {
  if (!masterAccountId) {
    logger.error('[Webhook Processor - issueDebit] masterAccountId is undefined. Cannot issue debit.');
    throw new Error('masterAccountId is required for debit.');
  }
  if (!internalApiClient || typeof internalApiClient.post !== 'function') {
    logger.error('[Webhook Processor - issueDebit] internalApiClient is undefined or not a valid client. Cannot issue debit.');
    throw new Error('Internal API client not configured or invalid for issuing debit.');
  }

  const debitEndpoint = `/internal/v1/data/users/${masterAccountId}/economy/debit`;
  const requestOptions = {
    headers: {
      'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB,
    },
  };
  // ... (logging and error handling) ...
  const response = await internalApiClient.post(debitEndpoint, payload, requestOptions);
  return response.data;
}
```

## Behavior on Debit Failure

-   The `generationRecord.status` is set to `payment_failed`.
-   The `generationRecord.statusReason` stores the error message from the debit attempt.
-   The generation output **is not delivered** to the user.
-   `NotificationDispatcher.js` will **not** attempt to send a notification for this generation.
-   A log entry is created detailing the failure, including `generationId`, `masterAccountId`, and the error.
-   If updating the record to `payment_failed` *also* fails, a critical error is logged, indicating potential need for manual intervention.

## Alignment with ADR-005

This implementation directly addresses the core requirements of ADR-005:

-   ✅ **Mandatory Debit on Delivery Completion**: Debit is attempted immediately after cost finalization for completed jobs handled by `webhookProcessor.js`.
-   ✅ **Webhook-Driven Finalization**: The `webhookProcessor.js` now orchestrates the debit.
-   ✅ **Transaction Recording**: This is handled by the `/economy/debit` internal API endpoint itself, as per ADR-005 (not explicitly implemented in `webhookProcessor.js` beyond calling the endpoint).
-   ✅ **Graceful Failure Handling**: If debit fails, the generation is marked `payment_failed` and not delivered.
-   The implementation uses the specified internal API endpoint (`POST /internal/v1/data/users/:masterAccountId/economy/debit`) and payload structure (`amountUsd`, `toolId`, `generationId`).
-   It uses the `internalApiClient` for all interactions.

## Out of Scope / Future Considerations

-   **`PointsService.js` Refactoring**: As per ADR-005, `PointsService.js` needs to be refactored to call the Internal API instead of direct DB access. This was out of scope for this specific task.
-   **Cost Previewing**: The optional cost previewing endpoint (`GET /internal/v1/tools/:toolId/costPreview`) is not implemented here.
-   **Migration of Legacy Balances**: The plan for legacy balances in `PointsService` is not addressed by this change.
-   **Test Stubs**: Updating test stubs for `webhookProcessor.js` and `notificationDispatcher.js` to reflect these changes is recommended as a follow-up. The ADR implies `internalApiClient` would have its own tests for the debit endpoint logic.

This handoff assumes that the internal debit API endpoint (`/internal/v1/data/users/:masterAccountId/economy/debit`) is already implemented and handles the actual deduction from `usdCredit` and creation of `transactionsDb` entries as specified in ADR-005. 