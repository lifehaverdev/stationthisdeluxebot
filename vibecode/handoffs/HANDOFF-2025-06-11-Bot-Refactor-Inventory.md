# HANDOFF: 2025-06-11 - Bot Refactor Inventory

## Work Completed

-   **ADR-012**: Created and approved the Architectural Decision Record for refactoring `bot.js` using a dispatcher pattern.
-   **Strategy**: Agreed on an incremental approach, building out the new modular structure before altering the existing `bot.js` file.

## Current State

-   `src/platforms/telegram/bot.js` is a monolithic file exceeding 2000 lines.
-   It contains two large, centralized event handlers for `callback_query` and `message` events, which are the primary targets for refactoring.
-   Numerous feature managers exist (e.g., `loraMenuManager.js`, `settingsMenuManager.js`) but `bot.js` is still responsible for routing events to them manually.
-   ***A global `pendingTweaks` object in `bot.js` holds state for the tweak feature. This state must be moved into the `tweakManager` when it is created.***

## Next Tasks

The primary task is to systematically move all routing logic out of `bot.js` and into the respective feature managers, which will then register their handlers with a central dispatcher. This document serves as the checklist for all logic to be migrated.

### `on('callback_query')` Handlers to Refactor

-   [ ] **`set_`**: Route to `settingsMenuManager.js`. (Handled in `bot.js`)
-   [ ] **`spell_`**: Route to `spellMenuManager.js`. (Handled in `bot.js`)
-   [ ] **`mods:`** / **`mods_store:`**: Route to `modsMenuManager.js`. (Handled in `bot.js`)
-   [ ] ***`mods:` (Duplicate):*** Ensure removal during refactor.
-   [ ] **`collection:`**: Create `components/collectionMenuManager.js` and move inline logic.
-   [ ] **`train:`**: Move inline `switch` logic to `components/trainingMenuManager.js`.
-   [ ] **`rate_gen:`**: Create `components/deliveryMenu/rateManager.js` and move logic.
-   [ ] **`hide_menu`**: Create `components/deliveryMenu/globalMenuManager.js` and move logic.
-   [ ] **`view_gen_info:`**: Create `components/deliveryMenu/infoManager.js` and move logic.
-   [ ] **`view_spell_step:`**: Move logic to `components/deliveryMenu/infoManager.js`.
-   [ ] **`restore_delivery:`**: Move logic to `components/deliveryMenu/infoManager.js`.
-   [ ] **`tweak_gen:`**: Create `components/deliveryMenu/tweakManager.js` and move logic.
-   [ ] **`tweak_gen_menu_render:`**: Move logic to `components/deliveryMenu/tweakManager.js`.
-   [ ] **`tweak_apply:`**: Move logic to `components/deliveryMenu/tweakManager.js`.
-   [ ] **`rerun_gen:`**: Create `components/deliveryMenu/rerunManager.js` and move logic.
-   [ ] **`admin_mod_approve:`** / **`admin_mod_reject:`**: Handled by `modsMenuManager.js`.
-   [ ] **`admin_mod_approve_private:`**: Handled by `modsMenuManager.js`.
-   [ ] **`train_`**: Route to `trainingMenuManager.js`. (Handled in `bot.js`)

### `on('message')` Reply Handlers to Refactor

-   [ ] **`settings_param_edit`**: Handled by `settingsMenuManager.js`.
-   [ ] **`tweak_param_edit`**: Move logic to `components/deliveryMenu/tweakManager.js`.
-   [ ] **`mod_import_url`**: Handled by `modsMenuManager.js`.
-   [ ] **`training_name_prompt`**: Handled by `trainingMenuManager.js`.
-   [ ] **`spell_create_name`**: Handled by `spellMenuManager.js`.
-   [ ] **`spell_param_value`**: Handled by `spellMenuManager.js`.
-   [ ] ***Dynamic Commands (Non-Reply):*** Move to a new `DynamicCommandDispatcher`.

### `onText` Command Handlers to Refactor

The logic for these is mostly clean, but the handlers themselves should be registered from their respective managers.

-   [ ] **/settings**: Handled by `settingsMenuManager.js`.
-   [ ] **/mods**: Handled by `modsMenuManager.js`.
-   [ ] **/collections**: Register from `components/collectionMenuManager.js` (and migrate logic from `commands/collectionsCommand.js`).
-   [ ] **/train**: Handled by `trainingMenuManager.js` (and migrate logic from `commands/trainModelCommand.js`).
-   [ ] **/status**: Use existing `commands/statusCommand.js` and register via CommandDispatcher.
-   [ ] **/spells**: Handled by `spellMenuManager.js`.
-   [ ] **/cast**: Handled by `spellMenuManager.js`.
-   [ ] ***`/clear_my_chat_commands`***: Create `components/adminManager.js` and move logic. 