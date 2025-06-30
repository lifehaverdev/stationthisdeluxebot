# ADR-001: Decoupled Notification System for Generation Outputs

## Context

The current implementation for handling ComfyDeploy webhooks involves the `webhookProcessor.js` service directly calling the `telegramNotifier` service to inform users about the status of their generation jobs. This approach presents several challenges:

*   **Tight Coupling:** The `webhookProcessor` is directly aware of and dependent on the `telegramNotifier`.
*   **Scalability:** Adding new notification channels (e.g., Discord, email, in-app notifications) would require modifying `webhookProcessor.js`, increasing its complexity and the risk of introducing errors.
*   **Separation of Concerns:** The responsibility of processing webhook data and the responsibility of notifying users are mixed within a single component.
*   **Resilience:** An error in the notification step could potentially impact or be conflated with the core webhook processing logic.

The opportunity is to refactor this into a more robust, scalable, and maintainable architecture by decoupling webhook processing from notification dispatch.

## Decision

We will implement a decoupled notification system with the following components and flow:

1.  **`webhookProcessor.js` Refinement:**
    *   Its sole responsibility will be to receive and validate ComfyDeploy webhooks, perform necessary calculations (e.g., `costUsd`), extract output data, and update the corresponding `generationRecord` in the database with the final status (`completed`, `failed`), status reasons, outputs, and cost.
    *   It will **not** directly call any notification services (e.g., `telegramNotifier`).

2.  **Enhanced `generationRecord`:**
    *   The `generationRecord` schema will be updated to include fields that manage and track the notification lifecycle. These fields will be populated when the generation job is initially created, based on the originating platform and user context.
        *   `notificationPlatform`: (e.g., `'telegram'`, `'discord'`, `'none'`)
        *   `notificationContext`: (e.g., `{ "chatId": "12345" }`, `{ "channelId": "67890", "userId": "abcde" }`)
        *   `deliveryStatus`: (e.g., `'pending'`, `'sent'`, `'failed'`, `'skipped'`)
        *   `deliveryTimestamp`: Timestamp of when the notification was successfully sent.
        *   `deliveryAttempts`: Number of times delivery has been attempted.
        *   `deliveryError`: Stores error information if the last delivery attempt failed.
    *   When `webhookProcessor.js` updates a `generationRecord` to a final state (`completed` or `failed`), `deliveryStatus` will typically be `'pending'` (if `notificationPlatform` is not `'none'`).

3.  **Notification Dispatch Service (New Component):**
    *   A new, independent service or system will be responsible for dispatching notifications.
    *   **Trigger:** This service will monitor `generationRecord`s that are ready for notification (e.g., `status` IN (`'completed'`, `'failed'`) AND `deliveryStatus === 'pending'`). This can be achieved through:
        *   Listening to database change streams (if supported and efficient).
        *   A message queue where `webhookProcessor.js` (or the service updating the `generationRecord`) places a message after a successful final update.
        *   Periodic polling of the database (less ideal for real-time, but simpler to implement initially).
    *   **Action:** Upon identifying a `generationRecord` requiring notification:
        1.  It will read `notificationPlatform` and `notificationContext`.
        2.  Based on the platform, it will invoke the corresponding notification service (e.g., call `telegramNotifier.sendMessage(context.chatId, message)`).
        3.  It will construct the appropriate message content based on the `generationRecord`'s status and outputs.
        4.  After attempting notification, it will update the `generationRecord` with the outcome:
            *   On success: `deliveryStatus: 'sent'`, `deliveryTimestamp: new Date()`.
            *   On failure: `deliveryStatus: 'failed'`, `deliveryError: '...'`, increment `deliveryAttempts`. (Retry logic could be incorporated here).

## Consequences

### Positive:
*   **Improved Modularity & Separation of Concerns:** `webhookProcessor.js` becomes simpler and focused. Notification logic is encapsulated in a dedicated service.
*   **Enhanced Scalability:** Adding new notification channels (Discord, email, etc.) involves creating a new handler/adapter within the Notification Dispatch Service and updating `notificationPlatform` options, without modifying the core `webhookProcessor.js`.
*   **Increased Resilience:** Failure in a specific notification dispatch (e.g., Telegram API is down) will be isolated and can be managed (e.g., retried) by the Notification Dispatch Service without affecting the processing of subsequent webhooks or the integrity of `generationRecord`s.
*   **Better Testability:** Each component (`webhookProcessor`, Notification Dispatch Service, individual notifiers) can be tested more easily in isolation.
*   **Centralized Notification Logic:** All notification-related operations and rules are managed in one place.
*   **Auditability:** The `generationRecord` will contain a clear history of notification attempts and outcomes.

### Negative/Considerations:
*   **Increased Complexity:** Introduces a new service/component (Notification Dispatch Service) that needs to be developed, deployed, and maintained.
*   **Potential Latency:** There might be a slight increase in the time between job completion and user notification due to the indirect flow (webhook -> DB update -> dispatcher polls/reacts -> notification sent) compared to a direct call, depending on the trigger mechanism chosen for the dispatcher.
*   **Data Consistency:** Care must be taken to ensure atomicity or idempotency if the `generationRecord` update by the dispatcher fails after a notification has already been sent (or vice-versa, though less likely with the proposed flow).
*   **Infrastructure:** Depending on the chosen trigger mechanism for the dispatcher (e.g., message queue, database triggers), there might be additional infrastructure requirements or considerations.

## Alternatives Considered

1.  **Direct Notification from `webhookProcessor.js` (Current/Previous Approach):**
    *   *Description:* The `webhookProcessor.js` directly calls the specific notifier service (e.g., `telegramNotifier`).
    *   *Why Not Chosen:* Leads to tight coupling, poor scalability for multiple notification channels, and mixes concerns, as detailed in the "Context" section.

2.  **In-Application Generic Event Bus:**
    *   *Description:* `webhookProcessor.js` (or the service that updates the `generationRecord`) emits a generic event (e.g., `generationCompletedEvent`) onto an in-application event bus. Notification services subscribe to these events.
    *   *Why Not Chosen (or rather, how the chosen solution can evolve from this):* This is a valid approach and shares many benefits with the chosen solution. The "Notification Dispatch Service" can be seen as a sophisticated, potentially externalized, version of such an event listener system. The chosen decision emphasizes a DB-centric approach for state (`deliveryStatus`), which is robust for retries and auditability, especially if the dispatcher is a separate process. An event bus could still be used to trigger the dispatcher *internally* after the primary DB update. The key difference is ensuring the notification state is reliably tracked in the DB.

This ADR formalizes the decision to proceed with the decoupled notification architecture. 