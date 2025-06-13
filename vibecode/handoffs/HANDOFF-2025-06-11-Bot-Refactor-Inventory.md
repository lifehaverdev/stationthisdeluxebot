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

-   [ ] **`set_`**: Route to `settingsMenuManager.js`.
-   [ ] **`spell_`**: Route to `spellMenuManager.js`.
-   [ ] **`mods:`** / **`mods_store:`**: Route to `modsMenuManager.js`.
-   [ ] ***`mods:` (Duplicate): There is a second, buggy `mods:` handler that incorrectly calls `handleModsCommand`. Ensure this is removed.***
-   [ ] **`collection:`**: Create `collectionMenuManager.js` and move inline logic for `view`, `edit`, `delete`, etc.
-   [ ] **`train:`**: Move inline logic for `view`, `submit`, `delete` into `trainModelCommand` or a new manager.
-   [ ] **`rate_gen:`**: Move rating logic into a new `deliveryMenuManager.js` or `generationManager.js`.
-   [ ] **`hide_menu`**: Move to `deliveryMenuManager.js`.
-   [ ] **`view_gen_info:`**: Move complex generation/spell view logic to `deliveryMenuManager.js`.
-   [ ] **`view_spell_step:`**: Move spell step view logic to `deliveryMenuManager.js` or `spellMenuManager.js`.
-   [ ] **`restore_delivery:`**: Move logic to restore the original generation message to `deliveryMenuManager.js`.
-   [ ] **`tweak_gen:`**: Move tweak initiation logic to a new `tweakManager.js`.
-   [ ] **`tweak_gen_menu_render:`**: Move tweak menu rendering logic to `tweakManager.js`.
-   [ ] **`tweak_apply:`**: Move the large tweak application/dispatch logic to `tweakManager.js`.
-   [ ] **`rerun_gen:`**: Move the large rerun logic to `tweakManager.js` or `deliveryMenuManager.js`.
-   [ ] **`admin_mod_approve:`** / **`admin_mod_reject:`**: Move to `modsMenuManager.js` (already done) or a new `adminManager.js`.
-   [ ] **`admin_mod_approve_private:`**: Move to `modsMenuManager.js` (already done) or `adminManager.js`.
-   [ ] **`train_`**: Route to `trainingMenuManager.js`.

### `on('message')` Reply Handlers to Refactor

-   [ ] **`settings_param_edit`**: Route to `settingsMenuManager.js`.
-   [ ] **`tweak_param_edit`**: Move logic for updating pending tweaks into `tweakManager.js`.
-   [ ] **`mod_import_url`**: Move LoRA import logic into `modsMenuManager.js`.
-   [ ] **`training_name_prompt`**: Route to `trainingMenuManager.js`.
-   [ ] **`spell_create_name`**: Route to `spellMenuManager.js`.
-   [ ] **`spell_param_value`**: Route to `spellMenuManager.js`.
-   [ ] ***Dynamic Commands (Non-Reply): The logic that checks `commandRegistry.findDynamicCommandHandler` for non-reply text messages needs to be moved to its own `DynamicCommandDispatcher`.***

### `onText` Command Handlers to Refactor

The logic for these is mostly clean, but the handlers themselves should be registered from their respective managers.

-   [ ] **/settings**: Register from `settingsMenuManager.js`.
-   [ ] **/mods**: Register from `modsMenuManager.js`.
-   [ ] **/collections**: Register from `collectionMenuManager.js`.
-   [ ] **/train**: Register from `trainingMenuManager.js`.
-   [ ] **/status**: Create `statusManager.js` and register from there.
-   [ ] **/spells**: Register from `spellMenuManager.js`.
-   [ ] **/cast**: Move large inline handler to `spellMenuManager.js` and register from there.
-   [ ] ***`/clear_my_chat_commands`***: Move this temporary admin command to a new `adminManager.js`. 