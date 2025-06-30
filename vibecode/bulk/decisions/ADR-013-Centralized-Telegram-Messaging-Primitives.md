# ADR-013: Centralized Telegram Messaging Primitives

## Context
We are frequently encountering `400 Bad Request` errors from the Telegram API. This is caused by unescaped special characters in messages sent to the user, a violation of the `MarkdownV2` formatting rules.

The current practice of manually calling an `escapeMarkdownV2` utility before sending messages is applied inconsistently across the codebase. This ad-hoc approach is error-prone and has led to bugs, such as the one documented in `HANDOFF-2025-06-13`. Furthermore, our platform-specific modules (e.g., menu managers) directly use low-level `node-telegram-bot-api` methods like `bot.sendMessage()`. This creates tight coupling and makes systemic changes, like enforcing universal markdown escaping, difficult to implement and maintain.

## Decision
We will introduce a dedicated messaging utility module at `src/platforms/telegram/utils/messaging.js`. This module will provide a higher-level API for all message-sending operations within the Telegram platform.

This utility will export a set of wrapper functions, including but not limited to:
- `sendEscapedMessage(bot, chatId, text, options)`
- `editEscapedMessageText(bot, chatId, messageId, text, options)`
- `sendPhotoWithEscapedCaption(bot, chatId, photo, options)`

These functions will encapsulate the core logic for:
1.  Accepting the `bot` instance and standard Telegram API parameters.
2.  **Automatically applying `escapeMarkdownV2`** to the message `text` or `caption`.
3.  Invoking the corresponding low-level `bot` method (e.g., `bot.sendMessage`).
4.  Parsing all outgoing messages with the `parse_mode: 'MarkdownV2'`.

All existing and future code within the Telegram platform that sends messages to a user must be refactored to use this new messaging utility. Direct calls to `bot.sendMessage`, `bot.editMessageText`, etc., will be disallowed.

## Consequences

### Positive
-   **Bug Elimination**: Systematically eliminates markdown escaping errors, improving platform stability.
-   **Code Consistency**: Enforces a single, standardized way to send messages, improving readability and maintainability.
-   **Centralized Logic**: Creates a single point of control for message-sending logic, simplifying future enhancements (e.g., logging, analytics, feature flagging).
-   **Improved Abstraction**: Decouples feature logic (menus, commands) from the specifics of the Telegram API implementation.

### Negative
-   **Refactoring Overhead**: Requires a one-time effort to audit and refactor all existing message-sending call sites.

## Alternatives Considered

1.  **Middleware on the `bot` Instance**: We considered intercepting all outgoing messages at the `node-telegram-bot-api` client level. This was rejected because it offers poor granularity. Some messages might not require escaping or could use a different parse mode. The chosen solution provides explicit, predictable control at the call site.
2.  **Relying on Developer Discipline**: Continuing with the status quo of manual escaping was deemed unacceptable, as it has already proven to be an unreliable source of bugs.
3.  **Base Class for Managers**: We considered creating a `BaseMenuManager` class with built-in messaging methods. This was rejected as being too narrow; it wouldn't cover messaging needs outside of menu managers and would introduce unnecessary inheritance complexity. A standalone utility is more flexible and universally applicable. 