# ADR-008: Spell & Cast System for Tool Chaining

**Date**: 2024-07-26

**Status**: Proposed (Revision 2)

## Context

The bot possesses a `ToolRegistry` of discrete tools, each with a defined set of inputs and a specific output type (e.g., text-to-image, image-to-image). Users have expressed a desire to perform more complex tasks by creating workflows that chain these tools together. A primary use case is using the image output from a text-to-image tool like `/make` as the direct input for an image-to-image tool like `/effect`.

This revision expands the initial proposal to treat "Spells" as first-class, shareable assets rather than private user preferences. This architectural shift enables a "Spell Store" where users can browse, use, and eventually publish or sell their creations, creating a more powerful and engaging ecosystem, analogous to the existing LoRA marketplace.

## Decision

We will implement a "Spell & Cast" system, introducing two new user-facing commands, a new core service for orchestration, new database collections, a new API, and a new Telegram UI component.

### 1. New Commands

-   **`/spell`**: This command will trigger a Telegram menu interface allowing users to access their personal "Spellbook" (for creating and managing their own spells) and a "Spell Store" (for browsing and acquiring public spells).
-   **`/cast <spell_slug> [parameter_overrides]`**: This command will execute a pre-configured Spell, identified by its unique, shareable slug. The system will verify the user has permission to cast the spell before execution. Users can optionally provide parameter overrides directly in the command for dynamic execution.

### 2. New Core Components

-   **`SpellsService` (`src/core/services/SpellsService.js`)**: Manages the CRUD operations for Spells (creating, reading, updating, deleting). It will interact with the database to store and retrieve spell definitions.
-   **`WorkflowExecutionService` (`src/core/services/WorkflowExecutionService.js`)**: This new service will be the engine for the `/cast` command. It will be responsible for the stateful, sequential execution of tools within a Spell. It will manage the context (inputs/outputs) between steps and orchestrate the entire workflow.
-   **`SpellMenuManager` (`src/platforms/telegram/components/spellMenuManager.js`)**: Modeled after the existing `SettingsMenuManager`, this component will manage the entire UI flow for the `/spell` command, including both the private Spellbook and the public Spell Store.
-   **`SpellsDB` (`src/core/services/db/spellsDb.js`)**: A new database service, analogous to `LoRAModelsDB`, to manage the persistence of all spell documents in a dedicated `spells` collection.
-   **`SpellPermissionsDB` (`src/core/services/db/spellPermissionsDb.js`)**: A new database service, analogous to `LoRAPermissionsDB`, to manage user access rights for licensed or purchased spells.

### 3. Data Storage and Model

Spells will be stored in a new, dedicated `spells` MongoDB collection, making them independent of individual users and enabling a centralized, browsable registry. This is a change from the original proposal of storing them in the `userPreferences` collection.

#### `spells` Collection Data Model

Each document in the `spells` collection will represent a single, unique spell. Its schema will be modeled after the `loraModels` collection to support discovery, ownership, and monetization.

```json
{
  "_id": "ObjectId",
  "slug": "string",             // Globally unique, generated from name (e.g., "epic-landscape-vfx-ab12cd")
  "name": "string",             // User-facing display name
  "description": "string",      // A brief explanation of what the spell does
  "creatorId": "ObjectId",      // FK to Users._id - the original author
  "ownedBy": "ObjectId",        // FK to Users._id - the current owner (can be transferred)
  
  "steps": [
    {
      "stepId": 1,
      "toolId": "comfy-0d129bba-1d74-4f79-8808-a4e8a8a79fcf",
      "parameters": {
        "input_prompt": "a beautiful landscape",
        "input_cfg": 7.5
      },
      "outputMappings": {
        "result": {
          "targetStepId": 2,
          "targetParameter": "input_image"
        }
      }
    }
  ],
  
  // Discovery & Usage
  "tags": ["string"],
  "usageCount": "number",
  "rating": { "avg": "number", "count": "number" },

  // Visibility and Access Control
  "visibility": "'public' | 'private' | 'unlisted'",
  "permissionType": "'public' | 'private' | 'licensed'",

  // Marketplace
  "monetization": {
    "priceUSD": "number",
    "forSale": "boolean",
    "licenseTerms": "string"
  },

  // Moderation
  "moderation": {
    "status": "'pending_review' | 'approved' | 'rejected'",
    "flagged": "boolean",
    "issues": ["string"],
    "reviewedBy": "ObjectId",
    "reviewedAt": "Date"
  },

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### `spellPermissions` Collection Data Model
To manage access for non-public spells, a `spellPermissions` collection will track entitlements.

```json
{
  "_id": "ObjectId",
  "spellId": "ObjectId",        // FK to Spells._id
  "userId": "ObjectId",         // FK to Users._id
  "licenseType": "string",      // "purchase" | "staff_grant" | etc.
  "priceCents": "number",
  "grantedBy": "ObjectId",
  "grantedAt": "Date"
}
```

### 4. New API Endpoints
A new set of internal API endpoints will be created under `/api/v1/spells` to manage CRUD operations for spells and their permissions. This replaces the previous plan to place spell endpoints under the user preferences API.

### 5. High-Level Execution Flow (`/cast`)

1.  User executes `/cast epic-landscape-vfx`.
2.  The `telegram/bot.js` handler invokes a new `SpellsService`.
3.  The `SpellsService` looks up the spell by its slug in the `spells` collection.
4.  It verifies the user has permission to execute the spell (checking for public visibility or an entry in `spellPermissions`).
5.  If authorized, it invokes `WorkflowExecutionService.execute(spell, context)`.
6.  The service creates a parent `WorkflowExecution` record to track the entire chain.
7.  **Step 1**: The service executes tool 1 (`/make`). The result (image URL) is not sent to the user but is saved and associated with the parent execution record.
8.  **Step 2**: The service retrieves the image URL from step 1's output and uses it as the `input_image` for tool 2.
9.  **Final Step**: This is the last step, so the `WorkflowExecutionService` calls `TelegramNotifier` with the final result and the original user context.

### 6. High-Level UI Flow (`/spell`)

The `SpellMenuManager` will provide a multi-faceted interface:
-   **Main Menu**: Choose between "My Spellbook" and "Spell Store".
-   **My Spellbook**:
    -   List spells created by or owned by the user.
    -   Provide an interface for creating a new spell.
    -   For each owned spell, allow editing its steps, name, description, and publishing/monetization settings.
-   **Spell Store**:
    -   Browse and search all `public` spells.
    -   View details, ratings, and example outputs for a spell.
    -   "Acquire" a spell (either for free if public, or through a purchase flow if monetized).
-   **Spell Creation**: The UI will guide the user through chaining tools, configuring default parameters, and defining input/output mappings between steps.

## Consequences

### Positive

-   **Massive Feature Enhancement**: Unlocks complex, customized image generation pipelines.
-   **Reusable Architecture**: The `WorkflowExecutionService` is a powerful, abstract component. The `SpellsDB` and API leverage the proven, robust architecture from the LoRA system.
-   **Community & Engagement**: A public Spell Store fosters community, sharing, and friendly competition.
-   **Monetization for Creators**: Enables power users to create and sell valuable, high-quality workflows.

### Negative / Risks

-   **Increased Complexity**: The introduction of two new database collections, a new API, and more complex UI/permission logic adds significant overhead compared to the original proposal.
-   **Error Handling**: A failure in any step of the chain must be handled gracefully. The `WorkflowExecutionService` must be able to report which step failed and why.
-   **UI/UX Challenge**: Designing an intuitive menu system for creating complex chains and browsing a store on Telegram is challenging.
-   **Security**: Monetized or private spells introduce the need for robust permission checking at every point of execution.

This ADR outlines a clear path forward for this high-impact feature. The proposed components leverage and extend the existing architecture, ensuring a consistent and maintainable implementation. 