# ADR-007: Telegram Inline Keyboard Menu for User Settings

## Status
Proposed

## Context

With the `UserSettingsService` and `ToolRegistry` in place (as per ADR-006 and ADR-004 respectively), users can have per-tool, per-user preferences. The `HANDOFF-2025-05-22-SETTINGS-API-TELEGRAM-UX.md` document outlines the need to create a user-friendly interface on Telegram for managing these settings. This ADR defines the design and flow for a menu-based system using Telegram's inline keyboards to achieve this, setting a precedent for future menu-driven interactions on the platform.

The simple command-based approach (`/set <tool> <param> <value>`) is still considered valuable and can be implemented in parallel or for other platforms like Discord, but this ADR focuses on the interactive menu for Telegram.

## Decision

We will implement a multi-level inline keyboard menu system for managing user settings on Telegram. This system will reside in the `src/platforms/telegram/components/` directory.

### 1. Triggering the Menu
- The user initiates the settings flow by sending the `/settings` command.
- In group chats, the command can be addressed to the bot (e.g., `/settings@stationthisbot`).

### 2. Main Settings Menu (Level 1)
- **Message Text:** "`<Username>`'s stationthisbot settings" (where `<Username>` is the user's Telegram username).
- **Inline Keyboard Layout:**
    - Row 1: [ "Preferences" ] (Leads to global/general preferences - TBD, placeholder for now)
    - Row 2: [ "All Tools" ] (Leads to a paginated list of all available tools)
    - Row 3..N-1: Dynamically populated with the user's most frequently used tools.
        - Two buttons per row, e.g., [ Tool A ], [ Tool B ]
        - If an odd number of frequent tools, the last one takes a full row.
        - The number of frequent tools displayed here will be limited (e.g., to 4-6 tools).
    - Row N: [ "NVM" ] (Closes the settings menu)

### 3. Tool Listing Menu (Level 2 - "All Tools")
- **Message Text:** "Select a tool to configure its settings:"
- **Inline Keyboard Layout:**
    - Dynamically populated with all available tools from `ToolRegistry`, likely paginated.
        - One tool per row for clarity or two per row.
    - Navigation Row: [ "<< Prev" (if applicable) ], [ "Back" ], [ "Next >>" (if applicable) ]
    - Last Row: [ "NVM" ]

### 4. Tool-Specific Settings Menu (Level 2 - Direct from Main, or Level 3 from "All Tools")
- **Trigger:** User selects a specific tool button.
- **Message Text:** The `description` field of the selected `ToolDefinition` (from `ToolRegistry`).
- **Inline Keyboard Layout:**
    - Dynamically populated with buttons for each input parameter defined in the tool's `inputSchema`.
        - One parameter button per row, displaying `InputField.name` (e.g., [ "seed" ], [ "cfg_scale" ]).
        - Consider displaying the current effective value alongside the parameter name if feasible, e.g., [ "Seed: 12345" ].
    - Navigation Row: [ "Back" ] (Returns to Main Settings Menu or All Tools Menu)
    - Last Row: [ "NVM" ]

### 5. Parameter Editing Menu (Level 3 or 4)
- **Trigger:** User selects a specific parameter button from the Tool-Specific Settings Menu.
- **Message Text:** A prompt to provide the new value for the selected parameter. This prompt should include:
    - The parameter name.
    - Its expected type (e.g., "number", "text", "boolean").
    - Any specific constraints or guidance (e.g., "Please reply with a number for the seed value.").
    - The current value could also be displayed here for context.
- **User Interaction:**
    - The bot sends the message with the prompt and an inline keyboard with "Back" and "NVM" options.
    - The bot then waits for the user to send a new message (a reply) containing the desired value for the parameter.
- **Value Submission & Navigation:**
    - Upon receiving the user's reply, the system will:
        1.  Attempt to parse and validate the value against the parameter's `inputSchema` (type, constraints).
        2.  If valid, call `UserSettingsService.savePreferences(masterAccountId, toolId, { [paramName]: value }, telegramApiKey)`.
        3.  Send a confirmation message (e.g., "Setting for `paramName` updated to `value`.").
        4.  Automatically navigate the user back to the Tool-Specific Settings Menu for the current tool, displaying the updated list of parameters (ideally reflecting the new value).
        5.  If invalid, send an error message with guidance and keep the user in the Parameter Editing Menu to try again.
- **Inline Keyboard Layout:**
    - Navigation Row: [ "Back" ] (Returns to Tool-Specific Settings Menu)
    - Last Row: [ "NVM" ]

### 6. "Preferences" Submenu (Placeholder)
- This ADR primarily focuses on tool settings. The "Preferences" button on the main menu is a placeholder for future global settings (e.g., notification preferences, default platform behavior) and its detailed flow is TBD.

### 7. General Navigation Buttons & Callback Handling
- **"Back" Button:** Navigates the user to the previous menu level.
- **"NVM" (Nevermind) Button:** Closes the entire settings interface by deleting the bot's settings message.
- **User-Specific Callbacks:** All inline button callbacks will be user-specific. The bot will verify that the `callbackQuery.from.id` matches the `callbackQuery.message.reply_to_message.from.id` (the original command issuer). Clicks from other users will be ignored.
- **Callback Data Strategy:**
    - To ensure statelessness and allow menus to function correctly even after extended periods, `callback_data` will be self-contained.
    - The prefix `set_` will be used for all settings-related callbacks.
    - `toolId`s (assumed to be reasonably short and persistent, e.g., "make", "effect") will be used directly as `TOOLKEY` in `callback_data`.
    - Parameter names might have prefixes like "input_" stripped for brevity in `callback_data` if necessary.
    - Example `callback_data` structures:
        - Main Menu & Navigation: `set_main`, `set_prefs`, `set_all_tools_PGNUM`, `set_nvm`
        - Back Navigation: `set_back_main`, `set_back_all_tools_PGNUM`, `set_back_toolparams_TOOLKEY`
        - Tool Selection: `set_viewtool_TOOLKEY` (e.g., `set_viewtool_make`)
        - Parameter Selection: `set_param_TOOLKEY_PARAMNAME` (e.g., `set_param_make_seed`)

### Implementation Notes:
-   State management for the *menu's visual appearance* (which menu is currently shown) is handled by editing the message with new text and a new keyboard. The `callback_data` itself provides the necessary context for the *next* action without relying on server-side session state for menu logic.
-   Referencing menu generation logic from the deprecated codebase might provide insights or reusable patterns.
-   A new directory `src/platforms/telegram/components/` will house the menu generation and handling logic.
-   Callback query data has size limitations (64 bytes). The `set_` prefix and direct use of short `toolId`s and parameter names are designed to respect this limit.
-   **Fetching "most frequently used tools"**: The mechanism to determine and fetch this list needs to be defined. It might involve querying `generationOutputs` or a similar collection by `masterAccountId`, aggregated and sorted by `toolId` usage. This is a TBD implementation detail.

## Consequences

### Positive:
-   Provides a highly interactive and user-friendly way to manage settings on Telegram.
-   Improves discoverability of tool parameters and their current values.
-   Establishes a reusable pattern for menu-based interactions on Telegram.
-   Leverages existing `UserSettingsService` and `ToolRegistry`.

### Negative/Challenges:
-   More complex to implement compared to simple command-based settings.
-   Requires robust state management for multi-level menu navigation.
-   Callback query data has size limitations, which needs to be managed for complex state.
-   Generating dynamic menus and handling callbacks can be intricate.

## Alternatives Considered

1.  **Command-Based Settings Only:** Using only commands like `/set <tool> <param> <value>`. While simpler and still valuable, it's less discoverable and interactive for novice users. This approach will likely still be implemented for power users or other platforms.
2.  **Single Deeply Nested Menu:** A single message that gets edited repeatedly with very deep nesting. Rejected for poorer UX compared to distinct menu messages/levels.

## Related Handoffs/ADRs
- `HANDOFF-2025-05-22-SETTINGS-API-TELEGRAM-UX.md`
- `ADR-004-Tool_Definition_and_Registry.md`
- `ADR-006-Tool_Parameter_Preferences_&_Settings_API.md`

## Open Questions (from Handoff) Addressed or To Be Addressed
-   **Preferred flow for `/settings` to select a tool?** This ADR defines a hybrid approach: list most frequent tools directly, provide an "All Tools" option for others.
-   **`UserSettingsService.deletePreferences` method?** This ADR acknowledges that a "Reset to Defaults" option is a likely future enhancement for the tool-specific menu, which would utilize such a service method.
-   **Detail level for displaying current settings?** This ADR suggests displaying the current effective value on the Tool-Specific Settings Menu (e.g., [ "Seed: 12345" ]) and again in the Parameter Editing Menu prompt. This enhances usability.
-   **Fetching "most frequently used tools"**: The mechanism to determine and fetch this list needs to be defined. It might involve querying `generationOutputs` or a similar collection by `masterAccountId`, aggregated and sorted by `toolId` usage. This is a TBD implementation detail. 