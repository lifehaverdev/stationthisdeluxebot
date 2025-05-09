# ADR-003: Centralizing Noema DB Access via Internal API\n\n## Status\n\nProposed\n\n## Context\n\nFollowing the implementation of the foundational Noema database services (`userCore`, `userSessions`, `userEvents`, etc.) and a pilot integration into the Telegram `/status` command (`HANDOFF-2025-05-08-NoemaPilotIntegrationReflections.md`), several challenges and opportunities related to multiplatform architecture have emerged.\n\n1.  **Consistency Risk:** Directly accessing `services.db.noema.*` from each platform adapter (Telegram, Discord, Web) and potentially core workflows risks scattering DB interaction logic, leading to duplication and potential inconsistencies in how data is retrieved, validated, and updated across different user touchpoints.\n\n2.  **Security & Validation:** Business rules, authorization checks (e.g., ensuring sufficient funds before debiting), and critical sequences (e.g., updating economy + logging transaction) need to be enforced reliably. Implementing these consistently across multiple platform entry points is error-prone.\n\n3.  **Maintainability:** Changes to Noema DB schemas or core data access logic would require updates in numerous places if access is decentralized.\n\n4.  **RESTful Principles:** Adhering to REST principles (Client-Server separation, Statelessness, Uniform Interface) for internal communication can improve architectural clarity and robustness, even for an internally-facing API.\n\nThe pilot integration, while successful, involved significant debugging related to dependency injection and required direct calls to DB services from the Telegram command handler. This highlighted the need for a more robust pattern before integrating into complex, cost-incurring features.\n\n## Decision (Proposed for Discussion)\n\n**All application components (Platform Adapters, potentially Core Workflows) MUST interact with the Noema database collections (`userCore`, `userSessions`, etc.) exclusively through a dedicated Internal API layer (`src/api/internal/`).**\n\n*   Direct access to `services.db.noema.*` objects from `src/platforms/` or `src/core/workflows/` will be prohibited.\n*   The Internal API will expose RESTful endpoints representing the Noema data resources and operations.\n*   This API layer becomes the sole gatekeeper responsible for: \n    *   Interacting with the `services.db.noema.*` classes.\n    *   Enforcing data validation and business logic (e.g., balance checks).\n    *   Handling atomic sequences (e.g., economy updates + transaction logging).\n    *   Managing user/session context retrieval based on identifiers passed from the platforms.\n\n## Consequences\n\n### Positive:\n\n*   **Centralized Logic:** DB interaction logic, validation, and business rules are located in one place, improving consistency and maintainability.\n*   **Improved Security Boundary:** Platforms don't need direct DB credentials or access; they interact via a controlled API interface.\n*   **Enhanced Testability:** The Internal API layer can be tested independently.\n*   **Clearer Architecture:** Enforces separation of concerns between platform adaptation and core data services.\n*   **Consistency Across Platforms:** Ensures features behave identically regardless of the originating platform (Telegram, Discord, Web).\n\n### Negative/Challenges:\n\n*   **Increased Complexity:** Introduces an additional API layer that needs definition, implementation, and maintenance.\n*   **Performance Overhead:** Replacing direct service calls with local HTTP requests introduces some latency (though likely minimal for localhost calls).\n*   **API Contract Definition:** Requires careful design and documentation of the Internal API endpoints, request/response formats, and error handling.\n\n## Key Questions for Architectural Discussion\n\n1.  **API Endpoint Design:** What specific RESTful endpoints (URIs, HTTP methods, request/response bodies) are required to map the functionality of the seven Noema DB services? (e.g., `POST /internal/sessions`, `GET /internal/users/by-platform/{platform}/{id}`, `POST /internal/transactions`, etc.)

    **Preliminary Proposed Endpoints (prefix `/internal/v1/noema/`):**

    **1. User Core Service (`/users`)**
    *   `POST /users/find-or-create`: Creates/retrieves user by platform ID.
        *   Request: `{ platform: string, platformId: string, platformContext?: object }`
        *   Response: `{ masterAccountId: string, user: UserCoreObject, isNewUser: boolean }`
    *   `GET /users/{masterAccountId}`: Retrieves user core profile.
    *   `PUT /users/{masterAccountId}`: Updates user core profile.
    *   `GET /users/by-platform/{platform}/{platformId}`: Retrieves user by platform ID.
    *   Wallets:
        *   `POST /users/{masterAccountId}/wallets`: Adds a wallet.
        *   `PUT /users/{masterAccountId}/wallets/{address}`: Updates a wallet.
        *   `DELETE /users/{masterAccountId}/wallets/{address}`: Removes a wallet.
    *   API Keys:
        *   `POST /users/{masterAccountId}/apikeys`: Creates an API key.
        *   `GET /users/{masterAccountId}/apikeys`: Lists API keys.
        *   `PUT /users/{masterAccountId}/apikeys/{keyPrefix}`: Updates an API key.
        *   `DELETE /users/{masterAccountId}/apikeys/{keyPrefix}`: Deactivates/deletes an API key.

    **2. User Sessions Service (`/sessions`)**
    *   `POST /sessions`: Creates a new session.
        *   Request: `{ masterAccountId: string, platform: string, userAgent?: string, metadata?: object }`
        *   Response: `UserSessionObject`
    *   `GET /sessions/{sessionId}`: Retrieves session details.
    *   `PUT /sessions/{sessionId}/activity`: Updates session activity.
    *   `PUT /sessions/{sessionId}/end`: Ends a session.
        *   Request: `{ endTime?: date, endReason: string }`
    *   `GET /users/{masterAccountId}/sessions`: Lists user sessions.
    *   `GET /users/{masterAccountId}/sessions/active?platform={platform}`: Finds active user sessions by platform.

    **3. User Events Service (`/events`)**
    *   `POST /events`: Logs a new event.
        *   Request: `{ masterAccountId: string, sessionId: string, eventType: string, eventData: object, sourcePlatform: string, timestamp?: date }`
        *   Response: `UserEventObject`
    *   `GET /events/{eventId}`: Retrieves a specific event.
    *   `GET /users/{masterAccountId}/events`: Lists user events.
    *   `GET /sessions/{sessionId}/events`: Lists session events.

    **4. User Economy Service (`/economy`)**
    *   `GET /users/{masterAccountId}/economy`: Retrieves user economy record.
    *   `POST /users/{masterAccountId}/economy/credit`: Adds credit to user account.
        *   Request: `{ amountUsd: decimal, description: string, transactionType: string, relatedItems?: object, externalTransactionId?: string }`
        *   Response: `{ updatedEconomy: UserEconomyObject, transaction: TransactionObject }`
    *   `POST /users/{masterAccountId}/economy/debit`: Debits user account.
        *   Request: `{ amountUsd: decimal, description: string, transactionType: string, relatedItems?: object }`
        *   Response: `{ updatedEconomy: UserEconomyObject, transaction: TransactionObject }`
    *   `PUT /users/{masterAccountId}/economy/exp`: Updates experience points.
        *   Request: `{ expChange: long, description?: string }`

    **5. Transactions Service (`/transactions`)**
    *   `GET /transactions/{transactionId}`: Retrieves a specific transaction.
    *   `GET /users/{masterAccountId}/transactions`: Lists user transactions.

    **6. User Preferences Service (`/preferences`)**
    *   `GET /users/{masterAccountId}/preferences`: Retrieves all user preferences.
    *   `PUT /users/{masterAccountId}/preferences`: Updates user preferences.
        *   Request: `{ preferences: object }`
    *   `GET /users/{masterAccountId}/preferences/{preferenceScope}`: Retrieves preferences for a scope.
    *   `PUT /users/{masterAccountId}/preferences/{preferenceScope}`: Updates preferences for a scope.

    **7. Generation Outputs Service (`/generations`)**
    *   `POST /generations`: Logs a new generation task.
        *   Request: `{ masterAccountId: string, sessionId: string, initiatingEventId: string, serviceName: string, requestTimestamp?: date, requestPayload: object, metadata?: object }`
        *   Response: `GenerationOutputObject`
    *   `GET /generations/{generationId}`: Retrieves a generation output.
    *   `PUT /generations/{generationId}`: Updates a generation output.
        *   Request: Partial `GenerationOutputObject` (e.g., status, response, cost)
    *   `GET /users/{masterAccountId}/generations`: Lists user generation outputs.
    *   `GET /sessions/{sessionId}/generations`: Lists session generation outputs.

2.  **Context Propagation:** How will user context (`masterAccountId`, potentially `sessionId`) be securely and reliably passed from the originating platform request (e.g., Telegram message) to the relevant Internal API calls? (e.g., Opaque tokens generated after initial lookup? Passing platform IDs for lookup within each API call?)

    **Decision:** Initially, platform adapters will obtain `masterAccountId` (via `POST /users/find-or-create`) and `sessionId` (via `POST /sessions`). These identifiers will then be explicitly passed as path parameters or in request bodies for subsequent API calls. This approach (Option A) prioritizes simplicity, with the possibility of evolving to token-based context (Option B) later if needed.

3.  **Authentication/Authorization:** How will the Internal API differentiate and authorize requests originating from different internal sources (Telegram bot vs Discord bot vs Web backend)? Is trusting localhost sufficient, or is a simple internal API key/token needed?

    **Decision:** The internal API will run on localhost (or an internal-only network). For differentiation and an added layer of verification, a "Per-Client API Key" strategy (Option 3) will be used. Each internal client (e.g., Telegram adapter, Web backend) will have a unique API key, passed in a custom header (e.g., `X-Internal-Client-Key`). The API will validate this key and use it to identify the calling client, primarily for logging and potential future targeted policies.

4.  **Atomicity Implementation:** How will sequences requiring atomicity (e.g., `UserEconomyDB.updateUsdCredit` + `TransactionsDB.logTransaction`) be implemented within a single Internal API endpoint to ensure data integrity?

    **Decision:** Atomicity will be ensured by the internal API service layer. Dedicated API endpoints (e.g., `POST /users/{masterAccountId}/economy/debit`) will encapsulate sequences of operations. The API service method handling such an endpoint will use database transactions (e.g., MongoDB sessions with `session.withTransaction()`) to group multiple database writes (like updating user economy and logging a transaction) into a single atomic unit. If any part of the sequence fails, the entire transaction is rolled back.

5.  **Error Handling:** Define standard error responses and status codes for the Internal API.

    **Decision:** The API will use a standard JSON error response format: 
    `{ "error": { "code": "ERROR_CODE", "message": "Description.", "details": {}, "requestId": "uuid" } }`.
    Common HTTP status codes will be utilized (e.g., 200, 201, 400, 401, 404, 409, 422, 500). A global error handling middleware will ensure consistent error responses.

6.  **Workflow Interaction:** Should core workflows (`src/core/workflows/`) also use the Internal API, or can they retain direct access to `services` (excluding `services.db.noema`)? Using the API enforces the boundary but adds overhead.

    **Decision:** Yes, core workflows (`src/core/workflows/`) will use this internal Noema API for all interactions with Noema database services. This ensures consistency, centralized logic, and adherence to the API contract for all Noema data operations, including those related to costly procedures. While these workflows may have their own higher-level specialized logic or even their own internal APIs, their access to Noema data will be through the defined Noema internal API endpoints. Performance implications will be monitored.

7.  **Performance Impact:** Evaluate the potential performance impact of introducing internal HTTP calls for frequent operations.

8.  **Existing Internal API:** How does this integrate with the current structure in `src/api/internal/` (e.g., `status.js`)? Does the current `initializeAPI` pattern support this?

## Alternatives Considered

1.  **Direct DB Service Access (Current Pilot state):** Continue allowing platforms to call `services.db.noema.*` directly. Rejected due to risks of inconsistency, scattered logic, and difficulty enforcing rules across platforms.

2.  **Shared Core Logic Layer (Non-API):** Create shared functions within `src/core/` (e.g., `getUserContext(platform, id)`, `performDebit(masterAccountId, amount)`) that encapsulate DB calls, and have platforms call these functions. This reduces duplication but doesn't provide the same clear network boundary or strict enforcement as an API layer, and dependency injection can still be complex. 