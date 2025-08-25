> Imported from vibecode/bulk/decisions/ADR-008-DELIVERYMENU.md on 2025-08-21

# ADR-008: Interactive Generation Delivery Menu in Telegram

**Date**: 2025-05-28
**Status**: Implemented

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
    *   **Functionality**: Reruns the original generation with a new random seed. The `↻` button on a specific message updates its text to show a count of how many times it has been pressed (e.g., "↻1", "↻2"). A newly delivered generation message will have a fresh "↻" button (effectively count 0).
    *   **Implementation**:
        *   The `bot.js` callback handler for `rerun_gen` parses `generationId` and a `pressCount` from the `callback_data` (e.g., `rerun_gen:generationId:pressCount`). The initial `pressCount` is `0`.
        *   The `input_seed` in the `requestPayload` is replaced with a new random number for the new generation.
        *   The original message containing the pressed button has its keyboard updated:
            *   The button's text is changed to `↻{newPressCount}`.
            *   The button's `callback_data` is updated to `rerun_gen:generationId:{newPressCount}`.
        *   A new generation is triggered, replying to the original user command message. The overall lineage depth (how many times a generation chain has been rerun) is tracked in the new generation's metadata (`metadata.rerunCount`), separate from the button's display count.
        *   The initial "Rerun" button on a newly delivered image message must be set up with `text: "↻"` and `callback_data: "rerun_gen:{newGenerationId}:0"` by the notification/delivery mechanism.

## Consequences

*   **Pros**:
    *   Greatly improves user experience by providing more control and iteration capabilities directly from the generated content.
    *   Encourages further interaction and refinement of generations.
    *   Leverages existing systems (settings menu, internal API, DB) with extensions.
    *   Clear visual feedback on button interaction.
*   **Cons**:
    *   Increases complexity in `bot.js` callback handling and initial button generation logic.
    *   `tweak_gen` functionality will require careful integration with the settings menu logic and a clear UX flow.
*   **Open Questions**:
    *   How will the "reply to original command message" be reliably achieved for `tweak_gen` and `rerun_gen` if the original message is old or not easily accessible in the current `callbackQuery` context? (This has been addressed by storing `telegramMessageId` and `telegramChatId` in `generationRecord.metadata` and using these for replies).

## Tech Stack

*   Node.js
*   `node-telegram-bot-api`
*   MongoDB (via `generationOutputsDb.js`)
*   Express.js (for `generationOutputsApi.js`)

## Alternatives Considered

*   **Separate Commands for Each Action**: Instead of an inline menu, users could use commands like `/tweak <generationId>` or `/info <generationId>`. This is less intuitive and discoverable than an inline menu.
*   **Simplified Menu**: A menu with fewer options, deferring more complex actions to commands. This reduces initial implementation effort but also reduces utility.

---
*ADR updated 2025-05-28 to reflect implemented `rerun_gen` behavior.* 