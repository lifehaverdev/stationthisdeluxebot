# Status Snapshot & API Integration Notes

This document outlines relevant files, functions, and integration points for enhancing the `/status` command and building a shared status API.

## 🗂 Relevant Files

*   **`src/platforms/telegram/commands/statusCommand.js`**:
    *   **Summary**: Handles the `/status` command for Telegram. Currently shows generic app status (uptime, version). It already uses `internalApiClient` for user identification and session management. This is the primary integration point for adding user balance and live task display for Telegram.
*   **`src/platforms/discord/commands/statusCommand.js`**:
    *   **Summary**: Handles the `/status` command for Discord. Similar to the Telegram version, it shows generic app status. It can be updated in a similar way to the Telegram command.
*   **`src/api/internal/userEconomyApi.js`**:
    *   **Summary**: Provides internal API endpoints for user economy operations.
    *   Key Endpoint: `GET /users/:masterAccountId/economy` - Retrieves a user's full economy record, including `usdCredit` and `exp`.
*   **`src/core/services/db/userEconomyDb.js`**:
    *   **Summary**: Database service for user economy data. Contains logic to fetch and update `usdCredit`.
    *   Key Functions: `findByMasterAccountId(masterAccountId)`, `getBalance(masterAccountId)`.
*   **`src/api/internal/generationOutputsApi.js`**:
    *   **Summary**: Provides internal API endpoints for managing and tracking generation tasks/outputs.
    *   Key Endpoints:
        *   `POST /` (to log a new task)
        *   `GET /:generationId` (to get a specific task)
        *   `PUT /:generationId` (to update a task's status, cost, etc.)
        *   `GET /` (to list/query multiple generation outputs - can be filtered by user)
*   **`src/core/services/db/generationOutputsDb.js`**:
    *   **Summary**: Database service for generation task records. Stores status, cost, metadata, etc.
    *   Key Functions: `createGenerationOutput()`, `findGenerationById()`, `updateGenerationOutput()`, `findGenerationsByMasterAccount(masterAccountId)`, `findGenerationsByStatus(status)`.
*   **`src/api/internal/userCoreApi.js`**:
    *   **Summary**: Aggregates several user-related internal API endpoints.
    *   Key Endpoint: `GET /users/:masterAccountId/generations` - Retrieves all generation tasks for a given user by calling `db.generationOutputs.findGenerationsByMasterAccount()`. This is ideal for fetching user-specific tasks.
*   **`src/platforms/telegram/utils/internalApiClient.js`**: (and likely a similar one for Discord or a shared one)
    *   **Summary**: An Axios-based client for making requests to the internal APIs. Used by the Telegram `statusCommand.js`.

## ⚙️ Functions / Classes of Interest

*   **User Balance (`usdCredit`)**:
    *   `userEconomyApi.getMasterAccountId()` (helper within API to get `masterAccountId` from request)
    *   `userEconomyApi` `GET /users/:masterAccountId/economy` route handler.
    *   `userEconomyDb.findByMasterAccountId(masterAccountId)`: Fetches the full economy record.
    *   `userEconomyDb.getBalance(masterAccountId)`: Specifically returns `{ usdCredit, exp }`.
    *   The `usdCredit` field itself within the user economy record (typically a `Decimal128`).
*   **Generation Tasks (`generationRecord` / `live_status`)**:
    *   `generationOutputsApi` route handlers for `POST /`, `GET /:generationId`, `PUT /:generationId`.
    *   `userCoreApi` `GET /users/:masterAccountId/generations` route handler.
    *   `generationOutputsDb.createGenerationOutput(data)`: Creates a new task record. Status is often initially 'pending'.
    *   `generationOutputsDb.findGenerationById(id)`: Retrieves a single task.
    *   `generationOutputsDb.updateGenerationOutput(id, data)`: Updates task status, cost, progress (potentially in metadata or dedicated fields).
    *   `generationOutputsDb.findGenerationsByMasterAccount(masterAccountId)`: Retrieves all tasks for a user.
    *   `generationOutputsDb.findGenerationsByStatus(status)`: Can be used to find 'live' tasks (e.g., 'pending', 'running', 'processing').
    *   Task/Output Record Fields: `status` (e.g., 'pending', 'processing', 'success', 'failed'), `costUsd`, `requestTimestamp`, `responseTimestamp`, `metadata` (could contain progress info).
*   **Shared `internalApiClient`**:
    *   Located in `src/platforms/telegram/utils/internalApiClient.js`. This (or a shared equivalent) will be used to call the above APIs.

## 🔗 Possible Integration Points

*   **`src/platforms/telegram/commands/statusCommand.js` -> `handleStatusCommand` function**:
    1.  After successfully obtaining `masterAccountId`.
    2.  **Fetch User Balance**: Call `internalApiClient.get(\`/users/\${masterAccountId}/economy\`)`. Extract `usdCredit` from the response.
    3.  **Fetch Live Generation Tasks**: Call `internalApiClient.get(\`/users/\${masterAccountId}/generations\`)`.
        *   Filter the results for tasks with non-terminal statuses (e.g., `pending`, `processing`, `running`, or any status that isn't `success`, `failed`, `cancelled_by_user`, `timeout`).
        *   Collect relevant details: task ID (or a user-friendly name/summary from metadata), status, cost, progress (if available in metadata or from status).
    4.  Append this information to the message sent to the user.
*   **`src/platforms/discord/commands/statusCommand.js` -> `handleStatusCommand` function**:
    *   Similar integration steps as the Telegram command, adapting for Discord's interaction model (e.g., Embeds for rich display). It would also need to perform user identification to get `masterAccountId` first, likely via a similar internal API endpoint as Telegram's `find-or-create`.

## ⚠️ Refactor Opportunities

*   **Shared Status Logic / Internal API Endpoint**:
    *   **Current State**: The Telegram and Discord status commands currently fetch basic app status independently. User-specific data fetching (balance, tasks) would be added to each.
    *   **Opportunity**: Create a new **internal API endpoint**, e.g., `GET /users/:masterAccountId/status-report`.
        *   This endpoint would internally call the `userEconomyApi` for balance and the `generationOutputsApi` (or `userCoreApi` for generations) for live tasks.
        *   It would then consolidate this information into a single JSON response.
        *   The Telegram, Discord, and future Web status panels would then call this single endpoint.
    *   **Benefits**:
        *   Reduces code duplication in platform-specific command handlers.
        *   Provides a consistent data source for all platforms.
        *   Simplifies maintenance and future updates to the status report content.
*   **User Identification for Discord**:
    *   The Telegram `statusCommand.js` uses `POST /users/find-or-create` with `platform: 'telegram'` and `platformId`.
    *   Ensure a similar robust mechanism is in place or added for Discord within its `statusCommand.js` or as a shared utility if it needs to get `masterAccountId` to call the proposed `/status-report` endpoint.
*   **Standardized Task Progress**:
    *   While `generationOutputsDb` has a `status` field, detailed `progress` (e.g., percentage) might be in `metadata` or vary by generation type.
    *   If a consistent progress reporting mechanism is desired, consider standardizing how progress is stored and updated in `generationOutputsDb` records, possibly with a dedicated `progressPercent` field or a convention within `metadata`.
*   **Centralized API Client**:
    *   The `internalApiClient.js` is currently in the Telegram platform's utils. If not already planned, consider moving this to a core/shared location (e.g., `src/core/api/internalApiClient.js`) so all platforms and services can use a consistent, configured client for internal API communication.

This scan provides a strong foundation for implementing the enhanced status features. The key is leveraging the existing internal APIs for user data and generation tracking, and then deciding on the best approach for unifying this data for different platforms (either in each command handler or via a new dedicated internal status API endpoint). 