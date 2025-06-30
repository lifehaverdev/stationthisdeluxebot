# Technical Summary: User Settings (Preferences) API

This document outlines the logic and integration points for managing user settings (preferences) for tool parameters, supporting features like a `/settings` command.

## 1. User Preferences Access & Storage

User preferences are primarily managed via the `userPreferences` Noema collection and its corresponding internal API.

**Key Files & Logic:**

*   **`src/api/internal/userPreferencesApi.js`**:
    *   Provides RESTful endpoints for managing user preferences.
    *   Mounted under `/internal/v1/data/users/:masterAccountId/preferences`.
    *   Relies on `db.userPreferences` (an instance of `UserPreferencesDB`).
    *   **Endpoints**:
        *   `GET /`: Retrieves all preferences for a user (`masterAccountId`). Returns `{}` if none.
            *   Calls `db.userPreferences.getAllPreferences(masterAccountId)`.
        *   `PUT /`: Updates/replaces the entire preferences object for a user.
            *   Request body: `{ preferences: { ... } }`
            *   Calls `db.userPreferences.updateOne(...)` with `$set: { preferences: ... }` and `upsert: true`.
        *   `GET /:preferenceScope`: Retrieves preferences for a specific scope (e.g., a `toolId`).
            *   `preferenceScope` is a path parameter.
            *   Calls `db.userPreferences.getPreferenceByKey(masterAccountId, scopeKey)`.
            *   Returns 404 if scope not found.
        *   `PUT /:preferenceScope`: Updates/replaces preferences for a specific scope.
            *   Request body: `{ /* settings for this scope */ }`
            *   Calls `db.userPreferences.setPreferenceByKey(masterAccountId, scopeKey, settingsObject)`.
            *   Ensures the user preferences document exists, creating one if necessary.

*   **`src/core/services/db/userPreferencesDb.js`**:
    *   Contains the database interaction logic for the `userPreferences` collection.
    *   `getAllPreferences(masterAccountId)`: Fetches the `preferences` object from the user's document.
    *   `getPreferenceByKey(masterAccountId, preferenceKey)`: Fetches `record.preferences[preferenceKey]`.
    *   `setPreferenceByKey(masterAccountId, preferenceKey, settingsObject)`: Updates `preferences.<preferenceKey>` using `$set`.
    *   `createUserPreferences(masterAccountId, initialPreferences = {})`: Creates a new preferences document.

*   **`vibecode/decisions/ADR-002-NoemaCoreDataSchemas.md`**:
    *   Defines the schema for the `userPreferences` collection:
        ```json
        {
          "bsonType": "object",
          "required": ["_id", "masterAccountId", "preferences", "createdAt", "updatedAt"],
          "properties": {
            "_id": { "bsonType": "objectId" },
            "masterAccountId": { "bsonType": "objectId" },
            "preferences": {
              "bsonType": "object",
              "description": "Keys are workflow/tool IDs (e.g., workflowId_A, tool_imageEnhance) or 'globalSettings'. Values are objects containing specific settings.",
              "additionalProperties": {
                "bsonType": "object",
                "additionalProperties": true
              }
            },
            "createdAt": { "bsonType": "date" },
            "updatedAt": { "bsonType": "date" }
          }
        }
        ```
    *   The `preferences` field is a flexible object where keys are typically `toolId`s (acting as `preferenceScope`) and values are objects containing the user's preferred parameters for that tool.

**Summary:**
User preferences are stored in a dedicated MongoDB collection (`userPreferences`). Each user has a document containing a `preferences` object. This object, in turn, contains sub-objects keyed by a `preferenceScope` (intended to be a `toolId`). These sub-objects hold the actual key-value pairs of saved parameters for that tool. The internal API (`userPreferencesApi.js`) provides GET and PUT methods to manage these preferences, both globally and per scope.

## 2. Tool Usage Tracking

Information about which tools a user has used is primarily available through the `generationOutputs` collection.

**Key Files & Logic:**

*   **`src/api/internal/generationOutputsApi.js`**:
    *   Manages `generationOutputs` records.
    *   `POST /internal/v1/data/generations`: Creates a new generation record. The request body includes an optional `metadata` object.
    *   `GET /internal/v1/data/generations`: Retrieves generation records. Can be filtered (e.g., by `masterAccountId`).

*   **`src/platforms/telegram/dynamicCommands.js`**:
    *   When a user invokes a tool-based command, this module prepares `metadataForGeneration`.
    *   This metadata explicitly includes `toolId: currentTool.toolId`.
    *   This object is then sent as `metadata` in the `POST /internal/v1/data/generations` request.
    *   Example snippet:
        ```javascript
        // Inside dynamicCommands.js command handler
        const metadataForGeneration = {
          // ... other fields
          toolId: currentToolId,
          costRate: currentTool.costingModel, // from ToolRegistry
          run_id: submissionResponse.run_id, // from comfyuiService.submitRequest
          notificationContext: { /* chatId, message_id, etc. */ }
        };
        // ...
        await internalApiClient.post('/v1/data/generations', {
          // ... other fields
          metadata: metadataForGeneration,
        });
        ```

*   **`src/core/services/comfydeploy/webhookProcessor.js`**:
    *   Retrieves `generationRecord`s by querying the internal API: `/v1/data/generations?metadata.run_id=${run_id}`.
    *   It then accesses `generationRecord.metadata.toolId` for processing (e.g., for debit logic).
        ```javascript
        const toolId = generationRecord.metadata?.toolId || generationRecord.toolId; // Fallback mentioned
        ```

*   **`vibecode/decisions/ADR-003-InternalAPIForNoemaServices.md`**:
    *   Defines the `POST /generations` endpoint for the Generation Outputs Service.
    *   Request schema includes `metadata?: object`. The `GenerationOutputObject` (response and stored data) will thus contain this `metadata`.

**Summary:**
Each time a user runs a tool via a platform like Telegram, a `generationOutputs` record is created. This record's `metadata` field stores the `toolId` of the tool used. To list previously used tools for a user, one would query the `generationOutputs` collection for records matching the user's `masterAccountId` and then extract the unique `toolId` values from the `metadata` of these records.

## 3. Tool Settings & Defaults

Tool input definitions (parameter names, descriptions, default values, types) are primarily sourced from the `ToolRegistry` and the underlying `ToolDefinition`s.

**Key Files & Logic:**

*   **`src/core/tools/ToolRegistry.js`**:
    *   A singleton service (`ToolRegistry.getInstance()`) that stores and provides access to `ToolDefinition` objects.
    *   `getToolById(toolId)`: Retrieves a specific `ToolDefinition`.
    *   `getAllTools()`: Retrieves all registered `ToolDefinition`s.
    *   Each `ToolDefinition` object contains an `inputSchema`.

*   **`vibecode/decisions/ADR-004-Tool_Definition_and_Registry.md`**:
    *   Defines the `ToolDefinition` schema, including:
        *   `toolId: string`
        *   `inputSchema: Record<string, InputField>`
        *   `InputField`:
            ```typescript
            type InputField = {
              name: string
              type: 'string' | 'number' | 'image' | 'video' | 'audio' | 'file' | 'boolean'
              required: boolean
              default?: any // <-- Key for default values
              description?: string
              advanced?: boolean
            }
            ```
    *   The `InputField.default` property is the designated place for specifying default values for tool parameters.
    *   The ADR explicitly mentions "Preference Mapping": "Each tool has well-defined input parameters... which will be used... To build /settings interfaces that are specific to that tool."

*   **`src/platforms/telegram/dynamicCommands.js`**:
    *   Accesses tools via `services.toolRegistry` (which should be an alias or wrapper for `services.workflows.getWorkflows()` that returns `ToolDefinition` compatible objects, or directly `ToolRegistry.getInstance().getAllTools()`).
    *   It inspects `tool.inputSchema` to determine how to handle inputs for Telegram commands.

*   **`src/core/services/comfydeploy/workflowCacheManager.js` (and related `WorkflowsService.js` implicitly):**
    *   The `summary.md` mentions `WorkflowCacheManager` and `WorkflowsService` use the `ToolRegistry`. These services are likely responsible for loading workflow definitions (e.g., from ComfyUI) and transforming them into `ToolDefinition` objects, including parsing their inputs to populate the `inputSchema` (and potentially `default` values from the workflow's structure).

**Summary:**
The `ToolRegistry` is the central source of truth for tool definitions. Each `ToolDefinition` contains an `inputSchema` which describes all input parameters for that tool. Each parameter (`InputField`) within the `inputSchema` can have a `default` property specifying its default value. This `default` value is what should be used if a user hasn't set a specific preference for that parameter.

## 4. Preference Updates

User preferences for tool parameters are updated via the `userPreferencesApi.js` endpoints.

**Key Files & Logic:**

*   **`src/api/internal/userPreferencesApi.js`**:
    *   `PUT /users/:masterAccountId/preferences/:preferenceScope`: This is the primary endpoint for updating settings for a specific tool.
        *   `:preferenceScope` would be the `toolId`.
        *   The request body should be an object containing the key-value pairs of parameters to save for that tool. For example, for a tool `imageGen` with parameters `prompt` and `cfg`:
            ```json
            // PUT /internal/v1/data/users/someMasterAccId/preferences/imageGen
            // Request Body:
            {
              "prompt": "user's default prompt",
              "cfg": 7.5
            }
            ```
        *   This API call will store this object under `preferences.imageGen` in the user's preference document.
    *   `PUT /users/:masterAccountId/preferences`: Can be used to update the entire preference object, but updating per scope is more targeted for tool settings.

*   **Validation**: The `userPreferencesApi.js` validates the presence and basic type of the incoming data but does **not** currently validate the *content* of the `settingsObject` against the tool's `inputSchema` from `ToolRegistry` (e.g., checking if parameter names are valid for the tool, or if types match). This is a potential **GAP/TODO**.

**Summary:**
To update a user's preference for a tool parameter, a client (like a `/settings` command handler) would make a `PUT` request to `/internal/v1/data/users/:masterAccountId/preferences/:toolId`, providing an object with the desired parameter overrides in the request body.

## 5. Integration Points & Relevant Routes

**Key Internal API Routes:**

*   **User Preferences:**
    *   `GET /internal/v1/data/users/:masterAccountId/preferences`
    *   `PUT /internal/v1/data/users/:masterAccountId/preferences`
    *   `GET /internal/v1/data/users/:masterAccountId/preferences/:toolId`
    *   `PUT /internal/v1/data/users/:masterAccountId/preferences/:toolId`
*   **Tool Definitions (via services that use ToolRegistry):**
    *   No direct API endpoint to get a single `ToolDefinition`'s `inputSchema` is explicitly listed, but platform adapters like `dynamicCommands.js` access this through `services.toolRegistry` (or `services.workflows.getWorkflows()`). A dedicated internal API endpoint could be useful.
*   **Tool Usage History:**
    *   `GET /internal/v1/data/generations?masterAccountId=:masterAccountId` (then process results to get unique `metadata.toolId`s).

**Platform Integration (e.g., Telegram `dynamicCommands.js`):**

*   `src/platforms/telegram/dynamicCommands.js`:
    *   Currently uses `ToolRegistry` to get tool definitions for command creation and input mapping.
    *   **GAP:** It does **not** currently fetch user-specific preferences for a tool to override default parameters or fill in missing *required* parameters if a user has saved them. When preparing `userInputsForTool`, it only considers the text/media provided in the current command interaction.

**Web UI (`/settings`):**

*   A hypothetical web UI for settings would:
    1.  Fetch all tools (or tools used by the user) to present a list.
    2.  For a selected tool, fetch its `ToolDefinition` (from `ToolRegistry` via an internal API or service call) to get its `inputSchema` (parameter names, types, descriptions, and importantly, **static defaults** from `InputField.default`).
    3.  Fetch the user's current preferences for that tool using `GET /internal/v1/data/users/:masterAccountId/preferences/:toolId`.
    4.  Merge the user's preferences over the tool's static defaults to display the current effective settings.
    5.  Allow the user to modify these settings.
    6.  On save, `PUT` the updated settings object to `/internal/v1/data/users/:masterAccountId/preferences/:toolId`.

## 6. Gaps, TODOs, and Suggestions

**Gaps & TODOs:**

1.  **Applying Preferences in Command Execution:**
    *   Platform command handlers (e.g., `dynamicCommands.js` for Telegram) currently do not fetch or apply user-saved preferences for tool parameters. They use the tool's static defaults or rely solely on user input with the command.
    *   **TODO:** Modify command handlers to:
        *   Fetch user preferences for the invoked `toolId` using `GET /internal/v1/data/users/:masterAccountId/preferences/:toolId`.
        *   Fetch the tool's `inputSchema` from `ToolRegistry`.
        *   Merge these: command input > user preference > tool default.
        *   Use the merged parameters when calling the tool service (e.g., `comfyuiService.submitRequest`).

2.  **Preference Validation Against Schema:**
    *   The `PUT .../preferences/:scope` endpoint does not validate the provided settings object against the `toolId`'s `inputSchema` from `ToolRegistry`.
    *   **TODO:** Enhance `userPreferencesApi.js` (or a service layer it calls) to fetch the `ToolDefinition` for the `preferenceScope` (if it's a `toolId`) and validate that parameter names and types in the request body are consistent with the tool's `inputSchema`. Reject invalid settings.

3.  **Listing Previously Used Tools:**
    *   While data is available in `generationOutputs`, there isn't a dedicated API endpoint to efficiently get a list of unique `toolId`s a user has previously used.
    *   **TODO (Optional Enhancement):** Consider adding an endpoint like `GET /internal/v1/data/users/:masterAccountId/used-tools` that returns a list of `toolId`s. This would simplify building a settings menu that only shows relevant tools.

4.  **Dedicated Endpoint for Tool Input Schema:**
    *   No direct internal API endpoint to fetch the `inputSchema` (including defaults, types, descriptions) for a specific `toolId`. This is needed by any settings UI.
    *   **TODO:** Add an endpoint like `GET /internal/v1/tools/:toolId/input-schema` (or similar) that leverages `ToolRegistry`.

**Suggestions for Telegram `/settings` Command Integration:**

1.  **Top-Level Menu (`/settings`):**
    *   Option A: List all available tools from `ToolRegistry` for which the user can set preferences.
    *   Option B (Better UX): List tools the user has previously used (requires implementing Gap/TODO #3 or client-side filtering of all tools vs user generation history).
    *   Option C: Categorize tools.
    *   Each tool in the list becomes a button leading to a tool-specific settings menu.

2.  **Tool-Specific Settings Menu (e.g., after user selects "ImageGen" tool):**
    *   Handler fetches `ToolDefinition` for "ImageGen" from `ToolRegistry` (via new endpoint Gap/TODO #4, or directly if in same service boundary).
    *   Handler fetches user's current preferences for "ImageGen" using `GET /internal/v1/data/users/:masterAccountId/preferences/ImageGen`.
    *   Display each parameter from `inputSchema`:
        *   Name: `InputField.name`
        *   Current Value: User's preference OR `InputField.default`.
        *   Description: `InputField.description`.
        *   Type: `InputField.type` (to guide input method if interactive).
    *   Provide buttons to "Change [ParameterName]".

3.  **Changing a Parameter:**
    *   Bot prompts user: "Current value for 'CFG Scale' is 7.0. Enter new value (number):"
    *   User replies with new value.
    *   Handler validates input based on `InputField.type`.
    *   On valid input, update the preferences:
        *   Fetch current scoped preferences (if any).
        *   Merge the new parameter value.
        *   `PUT` the entire updated settings object for that tool scope to `/internal/v1/data/users/:masterAccountId/preferences/:toolId`.

4.  **"Reset to Defaults" Option:**
    *   For a tool, allow users to clear their specific preferences for it.
    *   This could be done by `DELETE /internal/v1/data/users/:masterAccountId/preferences/:toolId` (if `userPreferencesApi` supports DELETE for a scope) or by `PUT`ting an empty object `{}` to that scope. The `userPreferencesDb.js` has `deletePreferenceKey`. An API endpoint would need to be added.

5.  **Abstraction:**
    *   Create a `UserSettingsService` or similar in `src/core/services/` that encapsulates the logic for:
        *   Fetching tool definitions (`ToolRegistry`).
        *   Fetching user preferences (`internalApiClient` for `userPreferencesApi`).
        *   Merging them to provide the "effective" settings for a tool.
        *   Validating and saving updated preferences.
    *   Platform adapters (Telegram, Web UI backend) would then call this service.

This structure will provide a robust way to manage tool-specific user preferences across platforms. 