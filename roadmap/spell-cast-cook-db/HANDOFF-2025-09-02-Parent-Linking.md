# HANDOFF: 2025-09-02 - Spell Cast & Cook Execution Parent Linking

## High-Level Goal
To refactor the `generationOutputs` collection for robustness and introduce dedicated parent collections (`casts`, `cooks`) to reliably track multi-step spell executions and multi-piece collection cooks.

## State of the System (Before)
- `generationOutputs` documents were inconsistent; many were stuck in `pending` status.
- Key metrics like `durationMs` and `pointsSpent` were not reliably stored.
- `deliveryStatus` was confusing (`pending`, `skipped`, `failed`).
- Spell and Cook executions were tracked with ad-hoc metadata fields and separate `cook_events` tables, making aggregation and progress tracking difficult.

## Accomplishments (What We Did)

### Phase 1: `generationOutputs` DB Audit & Refactor
1.  **Schema Enrichment**: Updated `generationExecutionApi.js` to ensure all newly created `generationOutputs` include:
    *   `toolDisplayName`: A human-readable name for the tool used.
    *   `durationMs`: Calculated automatically in `generationOutputsDb.js` when a record reaches a terminal status (`success`, `failed`, etc.).
    *   `pointsSpent` & `protocolNetPoints`: Now defaults to `0` if not specified.
    *   `deliveryStatus`: Set to `skipped` if no notification platform is used, otherwise `pending`.
2.  **Delivery Status Vocabulary**: Updated `notificationDispatcher.js` to use a clearer `sent` / `dropped` vocabulary for delivery outcomes.
3.  **Backfill**: Created and ran a backfill script (`scripts/analysis/generation_outputs_audit.js --backfill`) that successfully updated **1,376** legacy records with the new fields.

### Phase 2: Spell Cast & Cook Execution Foundation
1.  **Finalized Naming & Schemas**:
    *   Established the new parent collections: `casts` (for spell runs) and `cooks` (for cook runs).
    *   Renamed the existing `cook_collections` to `collections`.
    *   Created new DB service classes: `src/core/services/db/castsDb.js` and `src/core/services/db/cooksDb.js`.
2.  **Database Migration**:
    *   Created and executed a migration script (`scripts/migrations/2025_09_rename_cook_collections.js`) to rename the MongoDB collection.
    *   Updated `src/core/services/db/index.js` to instantiate and export the new `casts` and `cooks` DB services.
3.  **Internal API Endpoints**:
    *   **Casts**: Added `POST /casts` and `PUT /casts/:castId` endpoints to `src/api/internal/spells/spellsApi.js` to create and update spell cast documents.
    *   **Cooks**: Added `PUT /cooks/:cookId` to `src/api/internal/cookApi.js` for progress updates and modified `POST /start` to create the parent `cook` document.
4.  **Parent Document Creation**:
    *   `WorkflowExecutionService.js` now ensures a `cast` document is created via the internal API at the start of a spell run.
    *   `CookOrchestratorService.js` now ensures a `cook` document is created at the start of a cook run.
5.  **Linking `generationOutputs` to Parents**:
    *   `generationExecutionApi.js` was modified to read `castId` and `cookId` from the execution metadata and save them as top-level fields on the `generationOutput` document. This creates the crucial link.
6.  **Real-time UI Data**:
    *   `websocketHandlers.js` now includes `castId` and `cookId` in the `generationUpdate` and `generationProgress` payloads, allowing the front-end to track progress without requiring UI changes.

## Current Status & Immediate Next Step
The full foundation is in place. Parent documents (`casts` and `cooks`) are created, and every `generationOutput` is correctly linked to them.

**The final missing piece is to update the parent documents as their child generations complete.**

The immediate next step is to modify `WorkflowExecutionService.js` and `CookOrchestratorService.js` to make `PUT` requests to the new internal API endpoints to update the status, aggregate costs, and append `generationIds` to the parent `cast` and `cook` documents.
