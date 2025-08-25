> Imported from vibecode/bulk/handoffs/HANDOFF-2025-05-07-NoemaDBServicesP2IntegrationPlan.md on 2025-08-21

# HANDOFF: 2025-05-07 (Noema DB Services - Phase 2 Integration Plan)

## Work Completed

1.  **All Noema DB Service Files Implemented:**
    *   Following the pattern established by `UserCoreDB.js`, all seven Noema database service JavaScript files have been created in `src/core/services/db/`:
        *   `userCoreDb.js` (pre-existing foundation)
        *   `userSessionsDb.js`
        *   `userEventsDb.js`
        *   `generationOutputsDb.js`
        *   `userEconomyDb.js`
        *   `userPreferencesDb.js`
        *   `transactionsDb.js`
2.  **DB Services Integrated into Core Services Index:**
    *   All newly created Noema DB service instances have been imported and exported from `src/core/services/db/index.js` under the `noema` namespace, making them available as `services.db.noema.*`.

## Current State

*   The complete Noema database service layer, providing dedicated interfaces for each Noema collection, is implemented and structurally integrated.
*   The application's core database connection (`initializeDatabase()` in `app.js`) and service initialization (`initializeServices()` in `app.js`) ensure these new DB services are instantiated and accessible.
*   The system is now ready for the integration of these Noema DB services into the broader application logic across all platforms (Telegram, Discord, Web, API).

## Next Tasks: Integrate Noema DB Services into Application Logic

The primary objective is to incrementally update relevant parts of the application (Telegram, Discord, Web, API platforms, and core services) to *use* the new Noema DB services for creating, reading, updating, and deleting data.

**Core Integration Principles:**
*   **Centralized Access:** Leverage the `services.db.noema.*` path for all Noema DB operations (e.g., `services.db.noema.userSessions`, `services.db.noema.userEvents`).
*   **`masterAccountId` and `sessionId` are Key:** Ensure these identifiers are consistently retrieved or established early in user interaction flows to be used in DB operations.

**Integration Plan by DB Service:**

1.  **`UserSessionsDB` (Session Management):**
    *   **Platform Entry Points (Bots, API, Web):** On initial user interaction, check for active sessions (`findActiveSessionsByUserAndPlatform`). If none, create one (`createSession`). Store and propagate the `sessionId`.
    *   **Activity Updates:** Call `updateLastActivity` on significant user actions.
    *   **Session End:** Implement `endSession` for logouts, explicit closures, or timeouts.

2.  **`UserEventsDB` (Event Logging):**
    *   **Widespread Integration:** Log key events (e.g., `session_started`, `command_executed`, `api_request`, `generation_requested`, `login_success`, `credits_debited`, `settings_changed`) using `logEvent`.
    *   **Contextual Data:** Ensure each event includes `masterAccountId`, `sessionId`, and relevant `eventData` as per `NOEMA_EVENT_CATALOG.md`.

3.  **`GenerationOutputsDB` (Generation Task Tracking):**
    *   **Pre-Generation:** Log a "request" event via `UserEventsDB` to obtain an `initiatingEventId`. Use this to `createGenerationOutput` with initial details.
    *   **Post-Generation:** Call `updateGenerationOutput` with the final status, results (`responsePayload`, `artifactUrls`), `costUsd`, `durationMs`, etc.

4.  **`UserEconomyDB` & `TransactionsDB` (Financial Operations):**
    *   **Combined Use for Economic Actions:**
        1.  Verify balance with `UserEconomyDB.findByMasterAccountId()` or `getBalance()`.
        2.  Record `balanceBeforeUsd`.
        3.  Adjust balance (`updateUsdCredit` or `updateExperience`) via `UserEconomyDB`.
        4.  Determine `balanceAfterUsd`.
        5.  Log the complete financial event using `TransactionsDB.logTransaction()`, including `amountUsd`, `balanceBeforeUsd`, `balanceAfterUsd`, and `relatedItems` (e.g., `generationId`, `eventId`).
    *   **Scope:** Paid features, credit/XP awards, generation costs. Consider helper functions for these atomic operations.

5.  **`UserPreferencesDB` (User-Specific Settings):**
    *   **Retrieval:** When features have configurable options, use `getPreferenceByKey()` to fetch user settings.
    *   **Updates:** When users modify settings (via UI or commands), use `setPreferenceByKey()` or `updatePreferenceByKey()`.

**Recommended Areas for Initial Code Review and Integration:**
*   `src/core/services/index.js`: Understand how existing services are structured and how they might consume `services.db.noema`.
*   `app.js`: Re-familiarize with the main service and platform initialization flow.
*   Platform-Specific Logic:
    *   Telegram: `src/platforms/telegram/dynamicCommands.js` and related handlers.
    *   Discord: Command handlers and interaction points.
    *   Web/API: `src/platforms/web/routes/` (especially API routes) and any relevant middleware (`src/platforms/web/middleware/`).
*   Core Business Logic: Files within `src/core/` that currently handle user data, session state, or event-like processing, which are candidates for refactoring to use Noema services.

## Changes to Plan
*   No deviations from the `REFACTOR_GENIUS_PLAN.md`. This integration phase is the planned successor to the DB service implementation.

## Open Questions
*   Which specific platform (Telegram, Discord, Web) or application feature should be the *first target* for integrating one or more Noema DB services as a pilot (e.g., start with `UserSessionsDB` integration on Telegram, or `UserEventsDB` for web API calls)?
*   Are there existing utility functions, middleware, or common points in the request lifecycle where `masterAccountId` and potentially an existing `sessionId` (if applicable from a legacy system) are identified? These could be key points for establishing Noema session context.
*   For the `TransactionsDB.logTransaction` method, it's crucial to confirm the precise sequence and source for `balanceBeforeUsd` and `balanceAfterUsd`. The current assumption is these will come from `UserEconomyDB` calls performed atomically with the credit/debit operation. 