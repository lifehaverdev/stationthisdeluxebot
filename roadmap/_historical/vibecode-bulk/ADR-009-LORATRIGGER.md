> Imported from vibecode/bulk/decisions/adr/ADR-009-LORATRIGGER.md on 2025-08-21

ADR-009: LoRA Trigger Word Resolution and Permission-Based Prompt Substitution

Date: 2025-05-28
Status: Draft / In Progress (Updated 2025-05-29 based on implementation discovery)

Context

LoRA models are trained and stored in our `loraModels` and `loraTrainings` collections (managed by `src/core/services/db/loRAModelDb.js` and a new `loraPermissionsDb.js` for permissions). Each model has one or more trigger words ("cognates") that can be detected in user prompts to activate the model during generation. However, these trigger words were previously stored in loose, legacy schemas and lacked a permission model, a mechanism for privatization, or enforcement of ownership. Some prior art for trigger translation exists in `archive/deluxebot/utils/models/loraTriggerTranslate.js`.

Now, with a complete migration to a new database schema and the consolidation of training images into a single GridFS bucket (`trainImages`), we are preparing to implement a new service: LoRA Trigger Substitution with Access Control.

This system must:

Detect trigger words in prompts.

Substitute those words with the appropriate `<lora:slug:weight>` syntax.

Enforce access controls and licensing restrictions.

Resolve conflicts where multiple models match a trigger.

Ensure auditability by logging both raw and substituted prompts.

Decision

We will implement a LoRA resolution pipeline that integrates memory mapping, slug substitution, and permission enforcement. This logic will be encapsulated in a new "LoRA Resolution Service" (or module) and invoked at a specific point in the request lifecycle.

**Integration Point:**
The primary integration point will be within the `prepareToolRunPayload` method of the `WorkflowsService` (located in `src/core/services/comfydeploy/workflows.js`).
This service will call the LoRA Resolution Service if the tool being processed has `tool.metadata.hasLoraLoader === true` (determined by `src/core/services/comfydeploy/workflowCacheManager.js`) and the request payload contains a recognized prompt field.

**Auditability:**
Before prompt modification, the original prompt will be stored in `generationRecord.metadata.rawPrompt`. The modified prompt will be part of `generationRecord.requestPayload`. Both are logged via `src/core/services/db/generationOutputsDb.js`.
*   The original, unmodified prompt string as provided by the user will be stored in `generationRecord.metadata.userInputPrompt`. This ensures that user-facing displays of the prompt (e.g., in history, tweak menus) reflect what the user actually typed. `generationRecord.metadata.rawPrompt` can be deprecated or used as an alias for `userInputPrompt` if desired, with `userInputPrompt` being the preferred field name moving forward.
*   The LoRA-processed prompt (containing `<lora:slug:weight>` syntax) will be stored in `generationRecord.requestPayload.input_prompt` (or the relevant prompt field for the target generation service) and is the version sent to the generation backend.

🔄 Trigger Word Resolution Pipeline (Executed by LoRA Resolution Service)

Trigger Word Map (In-Memory)
The LoRA Resolution Service, on startup and periodically, will build an in-memory map by calling a new internal API endpoint:
`GET /internal/v1/lora/trigger-map-data?userId=:userId` (optional `userId` for user-specific private models)
This endpoint will fetch all public LoRAs and relevant private LoRAs (based on `userId` if provided) from `loraModels` and `loraPermissions`, returning data structured for efficient trigger lookup:

{
  "yumemono": [modelId1, modelId2],
  "nightcore": [modelId3]
}

The map is built from:

loraModels.trigger (main trigger word)

loraModels.cognates.word (alternate trigger words mapped to their main trigger data)

Prompt Interception
When a prompt (e.g., "a cute yumemono girl") is received by the LoRA Resolution Service (from `WorkflowsService`):
The service splits the string and checks each token (including quoted phrases and respecting user-specified weights like `yumemono:0.6`) against its in-memory map.
User-provided `<lora:slug:weight>` tags should be respected and potentially take precedence over triggered LoRAs.

Model Lookup & Permission Enforcement (Handled by `GET /internal/v1/lora/trigger-map-data` and refined by LoRA Resolution Service)
The `trigger-map-data` API endpoint is responsible for pre-filtering LoRAs based on the requesting user's permissions by querying `loraModels` and `loraPermissions`.
The LoRA Resolution Service then applies the following conflict resolution logic for a given trigger word if multiple LoRAs are still candidates from the `trigger-map-data` response:

Fetch corresponding LoRA model records by ID

If multiple models match the same word:

If two are public, it's a data error (flag for admin)

If one is private and the user has permission (already factored by the API, but re-verified by service if needed), default to private

Else, fall back to public

Prompt Substitution
For each permitted match, replace the detected trigger word with the proper LoRA syntax.
Example: "a photo of a yumemono girl" becomes "a photo of a <lora:yumemono-lora:1> girl" (assuming `yumemono-lora` is the slug and default weight is 1, and the trigger word itself is replaced).
This is handled by the LoRA Resolution Service before returning the modified prompt to `WorkflowsService`, which then proceeds to `generationOrchestrator.js` and ultimately to the generation provider (e.g., ComfyUI).

Slug and Weight Handling

The LoRA's slug is used in the replacement syntax.

If the user specifies a weight (e.g., `yumemono:0.6` in the prompt), it's honored; otherwise, the model's `defaultWeight` is used.

📆 Permissions Schema (`loraPermissions` collection, managed by `loraPermissionsDb.js`)

{
  modelId: ObjectId("..."),
  masterAccountId: "user-123",
  grantedBy: "admin-456",
  permissionType: "purchase", // or "rental", "team", etc.
  grantedAt: ISODate("..."),
  expiresAt: ISODate("...") // optional
}

📂 Model Enhancements (New Fields in `loraModels` collection, managed by `loRAModelDb.js`)

{
  trigger: "yumemono",
  cognates: [
    { word: "dreamcore", replaceWith: "yumemono" },
    { word: "nightcore" }
  ],
  access: "public" | "private",
  ownerAccountId: "user-abc",
  collectionId: "nightpack-001", // optional group bundle
  ...
}

🔐 Enforcement Rules

No two public LoRAs may share the same trigger.

If both a public and a private model share a trigger, and the user has access to the private one, it is preferred.

If multiple private models match a word and the user has access to more than one, fallback priority is by updatedAt timestamp unless otherwise specified.

Unauthorized matches are not substituted, and a warning is optionally added to the response metadata.

Consequences

✅ Pros

Allows users to monetize and restrict their LoRAs while preserving UX

Establishes clean architecture for trigger word handling and enforcement

Enables grouping of LoRAs into saleable bundles via collectionId

Future extensibility for time-based rentals or marketplace purchases

❌ Cons

Increases the complexity of the prompt preprocessing phase

Requires additional memory footprint to hold the trigger map

Relies on consistent and sanitized trigger/cognate data — upstream tools must enforce this

Tech Stack

Node.js

MongoDB (GridFS, collections: `loraModels`, `loraTrainings`, `loraPermissions`)

Internal memory map (maintained in the LoRA Resolution Service)

Invocation within `WorkflowsService` (`src/core/services/comfydeploy/workflows.js`)

Internal HTTP APIs for data fetching.

**Internal API Endpoints:**

*   `GET /internal/v1/lora/trigger-map-data`
    *   Query Parameters: `userId` (masterAccountId, optional).
    *   Action: Fetches LoRA data from `loraModels` (public models, and private models if `userId` is provided and has permissions via `loraPermissions`). Structures data optimally for the LoRA Resolution Service to build its trigger map. This includes `modelId`, `slug`, `trigger`, `cognates`, `defaultWeight`, `accessType`, `ownerAccountId`, `updatedAt`.
    *   Response: JSON object mapping triggers/cognates to lists of potential LoRA model details.
*   (Supporting APIs for CRUD operations on `loraModels` and `loraPermissions` will also exist for administrative purposes, e.g., `POST /internal/v1/lora/models`, `GET /internal/v1/lora/permissions`, etc.)

Open Questions
How do we surface denied trigger usage to the user (silently drop, log, or inform)?

Should we allow users to override trigger matches with syntax like "no lora for this"?

Do we cache the loraPermissions check result per user per session?

What is the best format for defining `replaceWith` in more complex cognitive substitutions?

*   **Prompt Syntax Clarification:** Confirm the exact output of substitution. E.g., does "trigger" become "<lora:slug:1>" or 
"<lora:slug:1> trigger"? (Standard is replacement).
    *   *Clarification:* The trigger word is replaced as per ADR (e.g., "trigger" becomes `<lora:slug:1> triggerWordForReplacement`). The crucial point for user experience is that the *original* prompt as typed by the user will be stored in `generationRecord.metadata.userInputPrompt`. The LoRA-processed version is what's stored in `generationRecord.requestPayload.input_prompt` (or the equivalent field for the generation service) and sent to the backend.
*   **User-Provided LoRA Tags:** How to handle manually entered `<lora:slug:weight>` tags? (Validation, permissions, precedence over 
triggers).
*   **Identifying Prompt Field in Payload:** How will `WorkflowsService.prepareToolRunPayload` reliably identify the prompt field(s) 
across diverse tools? (Standard names, or tool definition metadata).
*   **`userId` Availability:** Confirm `masterAccountId` is available in `WorkflowsService.prepareToolRunPayload`.
*   **Trigger Map Refresh Strategy:** How and when does the LoRA Resolution Service refresh its map? (Startup, periodic, webhook).
*   **Error Handling for Unresolved/Denied Triggers:** How to report to user/log if a trigger cannot be resolved or is denied 
permission?
*   **Preview Image Linking for Triggered LoRAs:** How can UIs show preview images for LoRAs that *would be* applied by triggers? 
(Requires simulating resolution or access to resolved data).
*   **Performance of `trigger-map-data` API:** For users with many private LoRAs, will the response be too large? Consider alternative 
strategies if so (e.g., more targeted API calls on trigger match).

#answers
1. We must inform the user when they've used a trigger they aren't allowed to, which looks different on each platform, but we allow their generation to go through without the LoRA applied.
2. The syntax to override a LoRA match is to use weight zero. So if the trigger was `yumemono`, in the prompt they would say `yumemono:0.0`.
3. Yes, excellent point. But sessions aren't locally stored in memory either, so if it's a database check either way... we will have to optimize this later. Let's continue with permission check results every prompt.
4. Cognate is supposed to be simple.
5. Prompt syntax clarification: the trigger becomes `<lora:slug:1> trigger`.
6. We can allow this for now, but ultimately we will have to surveil it because that would allow someone to access a private LoRA; we must police.
7. The prompt field is always named `input_prompt`.
8. The trigger map will be refreshed periodically.
9. The method of notifying users about unresolved triggers will depend on the platform; a simple alert suffices.
10. We have to overhaul our LoRA exploratory menu, which will have previews.
11. We can revamp later after we have our first pass.

Alternatives Considered

Embedding permission arrays directly in the loraModels document❌ Rejected due to scalability concerns with thousands of users and dynamic access control

Using a regex-based trigger detector with fuzzy matching❌ Rejected for now; exact word match is simpler and safer until stricter matching logic is in place

ADR created 2025-05-28 to define the LoRA prompt resolution and permission infrastructure.

