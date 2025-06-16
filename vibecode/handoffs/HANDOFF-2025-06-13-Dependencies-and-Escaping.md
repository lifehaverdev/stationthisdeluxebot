# HANDOFF: 2025-06-13 - Refactor Dependencies and Markdown Escaping

## Work Completed
-   **Dependency Tracing**: Successfully traced the `internalApiClient` dependency from `app.js` through `initializePlatforms`, `initializeTelegramPlatform`, and `createTelegramBot`.
-   **Endpoint Correction**: Corrected the `baseURL` for the primary `internalApiClient` instance to use the `/internal/v1/data` path, resolving initial `404` errors.
-   **Initial Refactor**: Attempted to enforce a consistent dependency injection pattern in `settingsMenuManager.js` and `spellMenuManager.js` by removing direct `internalApiClient` imports.
-   **Payload Fix**: Corrected the spell creation request in `spellMenuManager.js` to include the required `creatorId` field.

## Current State
-   **BLOCKER: Settings command is broken**. The refactor in `settingsMenuManager.js` was incorrect. The call to `getMostFrequentlyUsedTools` is failing because the `internalApiClient` dependency is not correctly passed down, resulting in a `TypeError: Cannot read properties of undefined (reading 'get')`.
-   **BLOCKER: Telegram markdown escaping is fragile**. Creating a new spell fails when the confirmation message is sent (`✅ Spell "animedirect" created!`). The `!` character is not escaped, causing a `400 Bad Request` from the Telegram API. This indicates a systemic need for a robust escaping solution.
-   **Conclusion**: The core dependency injection problem is not fully resolved, and a new systemic issue with API communication has been revealed.

## Next Tasks
1.  **Create a Messaging Utility Wrapper**:
    -   Create a new utility, perhaps in `src/platforms/telegram/utils/messaging.js`.
    -   This utility will export wrapper functions (e.g., `sendEscapedMessage`, `editEscapedMessageText`).
    -   These functions will take the `bot` instance and message parameters, automatically apply `escapeMarkdownV2` to the text, and then call the underlying `bot` method.
    -   Refactor all menu managers (`settings`, `spells`, `mods`, etc.) to use this new utility for all user-facing messages.

2.  **Definitive Dependency Pipeline Refactor**:
    -   Conduct a full audit of the dependency flow, starting from `app.js`.
    -   Establish a single, canonical `dependencies` object.
    -   Ensure this *one* object is passed down through `initializePlatforms` -> `initializeTelegramPlatform` -> `createTelegramBot` -> `registerAllHandlers`.
    -   Refactor all menu manager `registerHandlers` functions to accept the `dependencies` object.
    -   Propagate the `dependencies` object to every internal function within the menu managers that requires a dependency (e.g., `buildMainMenu`, `handleSettingsCallback`). This will eliminate all ambiguity and fix the remaining `TypeError`.

## Open Questions
-   Should the new messaging utility be a class or a collection of standalone functions?
-   What is the complete, authoritative list of dependencies that need to be available in the menu managers? (Current estimate: `bot`, `logger`, `internalApiClient`, `toolRegistry`, `userSettingsService`, `modsService`, `spellsService`, `replyContextManager`). 