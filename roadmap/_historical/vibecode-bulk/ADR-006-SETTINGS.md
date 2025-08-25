> Imported from vibecode/bulk/decisions/ADR-006-SETTINGS.md on 2025-08-21

# ADR-006: Tool Parameter Preferences & Settings API

## Status
Proposed

## Context

We are introducing cross-platform user settings for AI generation tools. Users will be able to view and modify parameter defaults on a per-tool basis (e.g., "ImageGen: CFG Scale = 7.0"). This will power platform-specific interfaces like `/settings` on Telegram and user customization on the Web UI.

Currently:
- Preferences are stored in `userPreferences.preferences[toolId]`.
- Tools are defined in `ToolRegistry`, with each having an `inputSchema` that lists parameter names, types, and default values.
- There is no mechanism to:
  - Validate user preferences against a tool schema.
  - Query the input schema for a tool via internal API.
  - Determine which tools a user has previously used.
  - Reset preferences for a specific tool.

## Decision

We will implement the following architectural elements:

### 1. 🧠 `UserSettingsService` (New Core Service)

A core service in `src/core/services/userSettingsService.js` to encapsulate the following:

- `fetchEffectiveSettings(masterAccountId, toolId)`
  - Merges `tool.inputSchema.default` and user preferences.
- `validatePreferences(toolId, preferenceObj)`
  - Validates param names, types against `ToolRegistry`.
- `savePreferences(masterAccountId, toolId, preferenceObj)`
  - Applies validated preferences via `internalApiClient`.

This service will be used by Telegram, Web UI, and internal API routes for consistent logic.

---

### 2. 🔧 Internal API Enhancements

**New Routes:**
- `GET /internal/v1/data/tools/:toolId/input-schema`
  - Returns `inputSchema` from `ToolRegistry.getToolById(toolId)`.
- `GET /internal/v1/data/users/:masterAccountId/used-tools`
  - Returns an array of unique `toolId`s extracted from the user's `generationOutputs`.
- `DELETE /internal/v1/data/users/:masterAccountId/preferences/:toolId`
  - Deletes a user’s preferences for that tool (calls `db.userPreferences.deletePreferenceKey`).

**Updated Routes:**
- `PUT /users/:masterAccountId/preferences/:toolId`
  - Will invoke `UserSettingsService.validatePreferences(...)` to enforce:
    - Only valid param names are accepted.
    - Types must match the declared `inputSchema`.

---

### 3. 🛠 Application of Preferences

Platform adapters (e.g., `dynamicCommands.js`) must:
- Fetch user preferences via `GET /preferences/:toolId`.
- Merge: `user input > user preference > inputSchema.default`.
- Pass merged values to `comfyuiService.submitRequest`.

This logic may be abstracted via `UserSettingsService.getResolvedInput(toolId, userInput, masterAccountId)`.

---

## Consequences

✅ Unified, validated preference system  
✅ Cross-platform reusability  
✅ Users can customize tool behavior and UX  
🚧 Adds schema enforcement responsibility to settings logic  
🚧 Introduces slight latency during preference fetch + merge during generation  
⚠️ Backward compatibility: legacy tools without `toolId` will not be supported  

## Alternatives Considered

- **Client-side merging only:** Would require every platform to replicate merging and validation logic.
- **Single flat preference object:** Loses per-tool granularity, fails to scale.

## Related ADRs

- ADR-002: Noema Core Data Schemas  
- ADR-003: Internal API for Noema Services  
- ADR-004: Tool Definition & Registry  
- ADR-005: Debit & EXP System

