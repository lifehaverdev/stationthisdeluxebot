# HANDOFF: 2025-05-18 - ADR-005 Debit, Notification Flow & EXP Integration Implementation

## Work Completed (Since last conceptual handoff for ADR-005)

1.  **Implemented Debit Logic in Webhook Processor**:
    *   `src/core/services/comfydeploy/webhookProcessor.js` was updated to:
        *   Fetch the `generationRecord` upon ComfyUI job completion.
        *   Calculate `costUsd` based on `runDuration` and `costRate` (from `generationRecord.metadata.costRate`).
        *   Update the `generationRecord` to `status: 'completed'` and include the calculated `costUsd`.
        *   Construct a debit payload using a `buildDebitPayload` helper function. This payload now includes:
            *   Top-level fields: `amountUsd`, `description`, `transactionType: "generation_debit"`.
            *   Nested `relatedItems` object containing: `toolId`, `generationId`, `run_id`.
        *   Call the internal debit API (`/v1/data/users/:masterAccountId/economy/debit`) via an `issueDebit` helper function. The endpoint path was corrected to prevent issues with the API client's base URL.
        *   If debit succeeds, the flow continues.
        *   If debit fails, the `generationRecord.status` is updated to `payment_failed`.
2.  **Implemented EXP Update Logic in Webhook Processor**:
    *   Following a successful debit in `src/core/services/comfydeploy/webhookProcessor.js`:
        *   `costUsd` is converted to `pointsSpent` using a predefined conversion rate (`usdPerPoint = 0.000337`).
        *   A `PUT` request is sent to `/internal/v1/data/users/${masterAccountId}/economy/exp` with `expChange: pointsSpent` and a descriptive message.
        *   Successful EXP updates are logged.
        *   Failures in the EXP update are logged as warnings and are non-blocking, ensuring they do not prevent generation delivery.
3.  **Ensured `toolId` and other critical data in Generation Records**:
    *   `src/platforms/telegram/dynamicCommands.js` was updated to:
        *   Correctly include `toolId` within `generationParams.metadata.toolId`.
        *   Ensure `costRate` is saved within `generationParams.metadata.costRate` (for the webhook processor).
        *   Ensure `notificationContext` is saved within `generationParams.metadata.notificationContext` (for the notification dispatcher).
        *   Include all API-required top-level fields in `generationParams` for successful generation record creation: `initiatingEventId`, `requestPayload`, and `deliveryStatus: 'pending'`.
4.  **Updated Notification Dispatcher**:
    *   `src/core/services/notificationDispatcher.js` was confirmed/updated to filter out `generationRecord`s with `status: 'payment_failed'`, preventing notifications for unpaid generations.
5.  **Iterative Debugging & API Schema Discovery**:
    *   Through log analysis and iterative fixes, the precise payload requirements for both the generation creation API (`/generations`) and the debit API (`/economy/debit`) were identified and implemented.

## Current State & Demonstration

The standardized debit enforcement flow, including EXP point updates, as described in [ADR-005-Standardized-Debit-Accounting.md](mdc:vibecode/decisions/ADR-005-DEBIT.md) is now **fully implemented and operational** for ComfyUI generations triggered via the Telegram platform.

*   **Demonstration of Success**: The latest execution logs (specifically for `RunID: 86b8c940-0c78-4f12-8504-1c06f9a76b89` / `GenerationID: 682a0a0fc43f0910ac287fc9`, and subsequent test runs with EXP enabled) show the complete successful flow:
    1.  Generation record created with all necessary fields.
    2.  ComfyUI job completion.
    3.  Webhook processor calculates cost.
    4.  Generation record updated to `completed` with `costUsd`.
    5.  **Debit API call successful** with the correct payload structure.
    6.  **EXP update call successful** (or gracefully handled on non-blocking failure).
    7.  **Notification successfully dispatched** to the user.

    *(A link to these specific logs or a log snippet would ideally be here if the system supported embedding them directly in the handoff. For now, this description refers to the logs reviewed during the implementation session.)*

## Key Files Changed Summary

*   **`src/core/services/comfydeploy/webhookProcessor.js`**:
    *   Modified `buildDebitPayload` to align with the `/economy/debit` API's expected schema (top-level `amountUsd`, `description`, `transactionType`; other IDs under `relatedItems`).
    *   Corrected `debitEndpoint` path in `issueDebit`.
    *   Ensures `costRate` is read from `generationRecord.metadata.costRate`.
    *   **Added logic to calculate and issue EXP updates via `/economy/exp` API after successful debit, with non-blocking error handling.**
*   **`src/platforms/telegram/dynamicCommands.js`**:
    *   Modified `generationParams` to:
        *   Place `costRate` into `metadata.costRate`.
        *   Place `notificationContext` into `metadata.notificationContext`.
        *   Include required top-level fields: `initiatingEventId`, `requestPayload`, `deliveryStatus`.
        *   Ensure `toolId` is correctly placed in `metadata.toolId`.
*   **`src/core/services/notificationDispatcher.js`**:
    *   Verified logic to ignore `payment_failed` generations (no code changes in the last steps, but behavior confirmed).

## Alignment with ADR-005

This implementation now fully aligns with the core requirements of ADR-005 regarding debiting and associated processing:

-   ✅ **Mandatory Debit on Delivery Completion**: Achieved.
-   ✅ **Webhook-Driven Finalization**: Achieved.
-   ✅ **Transaction Recording**: Achieved (via the `/economy/debit` API call).
-   ✅ **Canonical Source of Balance**: Upheld by using the economy API.
-   ✅ **Graceful Failure Handling**: Implemented (debit failure leads to `payment_failed` status and no delivery).
-   The implementation uses the specified internal API endpoint and the now-validated payload structure.
-   **EXP updates** are now integrated post-debit as an auxiliary, non-blocking process.

## Next Tasks (Beyond this Handoff)

*   **Review other platform adapters**: If other platforms (e.g., Web UI, Discord) create generation records, they must also be updated to include all necessary fields in `generationParams` (e.g., `toolId` in metadata, `costRate` in metadata, `initiatingEventId`, `requestPayload`, `deliveryStatus`, `notificationContext` in metadata) to ensure consistency with this flow.
*   **Test Stubs**: Update test stubs for `webhookProcessor.js`, `dynamicCommands.js`, and `notificationDispatcher.js` to reflect these changes (including EXP updates) and cover the successful debit/EXP/notification paths, as well as failure scenarios.
*   Address items from the original "Out of Scope / Future Considerations" section of ADR-005 (e.g., `PointsService.js` refactoring) as per the overall project plan.

## Open Questions

*   None directly arising from this completed implementation. The debit and EXP API schemas are now clear through iterative discovery and documentation.

This concludes the work for implementing and verifying the ADR-005 debit, notification flow, and EXP integration for Telegram-initiated ComfyUI generations. 