> Imported from vibecode/bulk/handoffs/HANDOFF-2025-05-30-LoRA-Prompt-UX-Fixes.md on 2025-08-21

# HANDOFF: 2025-05-30

## Work Completed

This session focused on refining the LoRA trigger resolution system (ADR-009) and improving the user experience by ensuring users see their original prompts, not the backend-modified ones. Several critical bug fixes were also implemented.

1.  **User-Facing Prompt Handling (ADR-009 Update & Implementation):**
    *   Updated ADR-009 to clarify that `generationRecord.metadata.userInputPrompt` will store the user's original typed prompt, while `generationRecord.requestPayload.input_prompt` will store the LoRA-processed prompt for the backend.
    *   Modified `src/platforms/telegram/bot.js`:
        *   `view_gen_info` callback now displays `metadata.userInputPrompt` if available.
        *   `tweak_gen` callback initializes `pendingTweaks` with `userInputPrompt` for editing.
        *   `tweak_apply` now saves the user's final tweaked prompt to `newGenerationRecord.metadata.userInputPrompt` and also uses it for `newGenerationRecord.requestPayload.input_prompt` (before any LoRA processing for the new generation).
        *   `rerun_gen` now correctly sources the user-facing prompt (preferring `metadata.userInputPrompt` from the parent, then `requestPayload.input_prompt`) and saves it to `newRerunRecord.metadata.userInputPrompt` and `newRerunRecord.requestPayload.input_prompt` (before LoRA processing).
    *   Modified `src/platforms/telegram/dynamicCommands.js`:
        *   Ensured that when a new generation is initiated by a dynamic command, the `actualUserInputPrompt` is correctly captured and stored in `generationMetadata.userInputPrompt`.
        *   The `requestPayload.input_prompt` for the initial generation record is also set to this `actualUserInputPrompt`.
        *   LoRA resolution warnings and applied LoRAs from `loraResolutionData` are now correctly added to `generationMetadata`.
    *   Modified `src/core/services/comfydeploy/workflows.js` (`prepareToolRunPayload`):
        *   This function now accepts the `userInputPrompt` as part of `userInputs`.
        *   If LoRA resolution occurs, the *original* `userInputPrompt` is preserved, and the `modifiedPrompt` from the LoRA service updates the `input_prompt` field that goes to ComfyUI.
        *   It returns `{ inputs: processedInputs, loraResolutionData: resultFromLoraService, originalUserInputPrompt: userInputs.input_prompt }`. The `dynamicCommands.js` then uses this `originalUserInputPrompt` to correctly populate `generationMetadata.userInputPrompt`.

2.  **LoRA Resolution Service (`loraResolutionService.js`) Fixes:**
    *   Corrected checkpoint filtering: Ensured `lora.checkpoint` field (e.g., 'SDXL', 'SD1.5') from the LoRA model document is correctly passed through `loraTriggerMapApi.js` and used for filtering in `loraResolutionService.js`.
    *   Made checkpoint string comparison case-insensitive during filtering.

3.  **Notification Dispatcher Fix (`dynamicCommands.js`):**
    *   Added `notificationContext` (with `platform`, `chatId`, `replyToMessageId`) to `generationMetadata` when new generations are created. This resolved an error in `NotificationDispatcher` ("Missing replyToMessageId").

4.  **Rerun Generation Event Logging Fix (`bot.js`):**
    *   Fixed an "Invalid initiatingEventId format" error during reruns.
    *   The `rerun_gen` callback handler now correctly logs a new `rerun_generation_request` user event.
    *   The `_id` of this new event is stored in `newEventIdForRerun` and is prioritized as the `initiatingEventId` for the new generation record, ensuring a unique and valid event link.

## Current State

*   The system now correctly distinguishes between user-typed prompts and LoRA-processed prompts, ensuring that user-facing displays (info, tweak menus) show the original input.
*   LoRA models are filtered based on their `checkpoint` compatibility with the tool's `baseModel` (e.g., 'SD1.5-XL' tools can use 'SD1.5' or 'SDXL' LoRAs).
*   Generation notifications should be dispatching correctly.
*   Rerunning generations should now correctly log their own user event and link to it, avoiding `initiatingEventId` conflicts.
*   The `tweak_apply` functionality also correctly logs its own user event.

## Next Tasks

*   Thorough end-to-end testing of the LoRA application flow with various prompt types, trigger words, cognates, and user-defined LoRA tags (`<lora:slug:weight>`).
*   Test edge cases for prompt handling in `tweak_apply` and `rerun_gen` to ensure `userInputPrompt` is always the one shown and edited.
*   Verify that LoRA resolution warnings (e.g., permission denied, trigger not found) are correctly surfaced to the user or logged as appropriate.
*   Review and test the "override LoRA with weight zero" functionality (`trigger:0.0`).

## Changes to Plan
*   No major deviations from the plan to implement ADR-009, but significant effort was spent on ensuring the user-facing prompt (`userInputPrompt`) was correctly handled throughout the generation lifecycle (initial creation, view, tweak, rerun). This was an emergent requirement for good UX.

## Open Questions
*   How should user-provided `<lora:slug:weight>` tags interact with automatically triggered LoRAs if they conflict (e.g., same LoRA slug, different weights, or different LoRAs for the same semantic meaning)? Current ADR-009 implies user tags might take precedence, but this needs explicit confirmation and testing. (Covered in ADR-009 #answers: "We can allow this for now, but ultimately we will have to surveil it because that would allow someone to access a private LoRA; we must police.") This policing aspect needs to be designed.
*   Confirm the desired behavior for LoRA resolution warnings: should they always be logged? Should some (like "trigger for private LoRA you don't own") be shown to the user? (Covered in ADR-009 #answers: "We must inform the user when they've used a trigger they aren't allowed to... a simple alert suffices"). The mechanism for this alert needs to be implemented per platform. 