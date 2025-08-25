> Imported from vibecode/bulk/decisions/ADR-012-Telegram-Bot-Event-Router.md on 2025-08-21

# ADR-012: Telegram Bot Event Router

## Context

The primary Telegram bot logic file, `src/platforms/telegram/bot.js`, has grown to an unmanageable size (over 2000 lines). Its core complexity stems from two large, centralized event handlers: `bot.on('callback_query', ...)` and `bot.on('message', ...)`.

The `callback_query` handler is a deeply nested `if/else if` block that inspects the callback data prefix (`data.startsWith('...')`) to route the request to the appropriate logic. The `message` handler contains a large `switch` statement that routes replies based on a `context.type` retrieved from a `replyContextManager`.

This monolithic design makes the file a bottleneck for development. Adding or modifying features requires changing this central file, increasing the risk of merge conflicts and making the code difficult to reason about. The goal is to refactor `bot.js` to be under 500 lines and establish a more scalable architecture.

## Decision

We will implement a **Dispatcher/Router pattern** within `bot.js` to decentralize event handling. Instead of `bot.js` knowing about every feature's callbacks and reply contexts, feature managers will register their own handlers.

1.  **Introduce Handler Dispatchers**: Two dispatcher classes, `CallbackQueryDispatcher` and `MessageReplyDispatcher`, will be created.
    *   `CallbackQueryDispatcher` will map string prefixes (e.g., `'lora:'`, `'settings_:'`) to handler functions.
    *   `MessageReplyDispatcher` will map context types (e.g., `'lora_import_url'`, `'settings_param_edit'`) to handler functions.
    *   A `DynamicCommandDispatcher` will be added to handle non-reply text messages that map to dynamic commands (e.g., text prompts for image generation).

2.  **Standardize Feature Managers**: Each feature-specific manager will export a new `registerHandlers` function. This will be applied not just to existing large features, but also to the remaining inline logic in `bot.js`. The proposed structure includes:
    *   `settingsMenuManager.js`
    *   `modsMenuManager.js` (consolidating the deprecated `loraMenuManager.js`)
    *   `spellMenuManager.js`
    *   `trainingMenuManager.js`
    *   `collectionMenuManager.js` (for collection management)
    *   **A new `deliveryMenu/` subdirectory** will be created to house managers for actions performed on completed generations. This isolates post-delivery logic from the primary feature menus. It will contain:
        *   `infoManager.js` (for `view_gen_info:`, `view_spell_step:`, etc.)
        *   `rateManager.js` (for `rate_gen:`)
        *   `rerunManager.js` (for `rerun_gen:`)
        *   `tweakManager.js` (for all `tweak_*` callbacks and replies)
        *   `globalMenuManager.js` (for generic actions like `hide_menu`)
    *   **The existing `commands/` directory** will be used for simple, stateless, single-interaction commands (e.g., `/status`, `/help`). Complex, menu-driven features (`/train`, `/collections`) will be migrated from `commands/` to their respective managers in `components/`.

3.  **Registration at Startup**: During bot initialization in `bot.js`, it will iterate through the feature managers and call their `registerHandlers` function, passing the dispatcher instances. Each manager will then register its specific prefixes and context types.

4.  **Refactor `bot.js` Event Handlers**:
    *   The `on('callback_query')` block will be replaced with a single call to `callbackQueryDispatcher.handle(callbackQuery)`. The dispatcher will find the appropriate handler based on the data prefix and execute it.
    *   The `on('message')` block will be replaced with a call to `messageReplyDispatcher.handle(message, context)`. The dispatcher will find the handler based on the `context.type` and execute it.

This inverts the dependency: `bot.js` no longer depends on feature managers; instead, feature managers register their capabilities with `bot.js`.

## Consequences

*   **Pros**:
    *   **Decoupling**: `bot.js` becomes a simple orchestrator, ignorant of specific feature logic. Its line count will be drastically reduced.
    *   **Encapsulation**: All logic for a feature (its commands, callbacks, reply handlers) will be co-located within its own manager file (e.g., `loraMenuManager.js`).
    *   **Scalability & Maintainability**: Adding new commands or features no longer requires modifying the central `bot.js` file. This reduces cognitive overhead and minimizes merge conflicts.
    *   **Testability**: Individual feature managers can be unit-tested more easily in isolation.

*   **Cons**:
    *   **Initial Refactoring Effort**: Requires modifying `bot.js` and all relevant feature manager files to adopt the new pattern.
    *   **New Abstraction**: Developers need to understand the dispatcher pattern for future work. A new file for the dispatchers themselves will need to be created.

## Alternatives Considered

1.  **Status Quo (Monolithic Handlers)**: Rejected due to severe and worsening maintainability issues. The current state is untenable for future development.

2.  **Centralized Registry File**: An alternative was to create a single `handlerRegistry.js` file that maps all prefixes and context types to their handler functions. This would clean up `bot.js` but would centralize the routing logic in a different file, failing to achieve true encapsulation where feature logic lives entirely within its own module.

3.  **Full Event Emitter/Bus Library**: Using a dedicated library like `EventEmitter3`. This was considered overkill for the current scope. The proposed lightweight dispatcher pattern provides the necessary functionality with less complexity and fewer dependencies. 