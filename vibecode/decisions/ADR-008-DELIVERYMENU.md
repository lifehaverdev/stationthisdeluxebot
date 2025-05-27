# ADR-008: Interactive Generation Delivery Menu in Telegram

**Date**: DATE_PLACEHOLDER
**Status**: Proposed

## Context

Currently, when a generation (e.g., image, text, video) is delivered to a user in Telegram, it includes a basic inline keyboard with rating buttons (😻, 😹, 😿). This ADR proposes an enhancement to this menu to provide more interactive options for the user, allowing them to manage and iterate on their generations directly from the delivery message.

The existing `rate_gen` callback functionality has been successfully implemented, allowing users to rate generations, and these ratings are stored in `generationOutputsDb`.

## Decision

We will enhance the inline keyboard attached to generation delivery messages in Telegram with the following functionalities:

1.  **Rating (`rate_gen` - 😻, 😹, 😿)**:
    *   **Current State**: Users can rate a generation. Only the original command issuer can use these buttons.
    *   **Enhancement**: Allow any user in a group chat to rate a generation. The user specificity check in `bot.js` for callbacks will be modified to exclude `rate_gen` callbacks from this restriction in group chats. Individual ratings will still be tied to the `masterAccountId` of the user who clicked the button.

2.  **Hide Menu (`hide_menu` - Button: `-`)**:
    *   **Functionality**: Removes the entire inline keyboard from the message.
    *   **Implementation**: The `bot.js` callback handler for `hide_menu` will call `bot.editMessageReplyMarkup` with `null` or an empty `reply_markup`.

3.  **View Generation Info (`view_gen_info` - Button: `ℹ︎`)**:
    *   **Functionality**: Displays the parameters used for the specific generation in a new message in the same chat.
    *   **Implementation**:
        *   The `bot.js` callback handler for `view_gen_info` will parse the `generationId`.
        *   It will make an internal API call (e.g., to a new endpoint in `generationOutputsApi.js` or use the existing `GET /generations/:generationId`) to fetch the generation record, specifically its `requestPayload`.
        *   The parameters will be formatted neatly and sent as a new message in the chat.

4.  **Tweak Generation (`tweak_gen` - Button: `✎`)**:
    *   **Functionality**: Allows the user to modify the parameters of the original generation and rerun it.
    *   **Implementation**:
        *   The `bot.js` callback handler for `tweak_gen` will parse the `generationId`.
        *   Fetch the original generation record (including `serviceName` and `requestPayload`).
        *   Identify the `toolId` from `serviceName`.
        *   Direct the user to a tool parameter settings menu (similar to `/settings`, potentially reusing logic from `settingsMenuManager.js`).
        *   Pre-populate this menu with the values from the fetched `requestPayload`.
        *   The settings menu generated for `tweak_gen` should reply to the *original message that triggered the generation* (the user's command message).
        *   This menu will have an additional button (e.g., "Generate with these settings" or "Rerun Tweaked").
        *   Clicking this button will trigger a new generation using the (potentially modified) parameters, also replying to the original user command message.

5.  **Rerun Generation (`rerun_gen` - Button: `↻`)**:
    *   **Functionality**: Reruns the original generation. If an `input_seed` parameter was part of the original `requestPayload`, it should be iterated (e.g., incremented by 1) for the new generation.
    *   **Implementation**:
        *   The `bot.js` callback handler for `rerun_gen` will parse the `generationId`.
        *   Fetch the original generation record, specifically its `requestPayload` and `serviceName`.
        *   If `requestPayload.input_seed` exists and is a number, increment it. If it does not exist or is not a number, it can be ignored or a new random seed could be used if applicable to the tool.
        *   Trigger a new generation using the (potentially modified) `requestPayload` and original `serviceName`, replying to the original user command message.

## Consequences

*   **Pros**:
    *   Greatly improves user experience by providing more control and iteration capabilities directly from the generated content.
    *   Encourages further interaction and refinement of generations.
    *   Leverages existing systems (settings menu, internal API, DB) with extensions.
*   **Cons**:
    *   Increases complexity in `bot.js` callback handling.
    *   `tweak_gen` functionality will require careful integration with the settings menu logic and a clear UX flow.
    *   Requires new API endpoints or modifications if existing ones are not sufficient for fetching detailed generation data or triggering tweaked/reruns.
*   **Open Questions**:
    *   How will the "reply to original command message" be reliably achieved for `tweak_gen` and `rerun_gen` if the original message is old or not easily accessible in the current `callbackQuery` context? (The `message.reply_to_message` in the callback query often refers to the bot's own message with the inline keyboard, not the user's initial command. This needs careful handling, possibly by storing the initial command's `message_id` in `generationRecord.metadata.notificationContext`).

## Tech Stack

*   Node.js
*   `node-telegram-bot-api`
*   MongoDB (via `generationOutputsDb.js`)
*   Express.js (for `generationOutputsApi.js`)

## Alternatives Considered

*   **Separate Commands for Each Action**: Instead of an inline menu, users could use commands like `/tweak <generationId>` or `/info <generationId>`. This is less intuitive and discoverable than an inline menu.
*   **Simplified Menu**: A menu with fewer options, deferring more complex actions to commands. This reduces initial implementation effort but also reduces utility.

---
*Replace DATE_PLACEHOLDER with the current date when finalizing.* 