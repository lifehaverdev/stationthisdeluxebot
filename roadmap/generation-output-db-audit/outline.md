# Generation Output DB Audit & Refactor — Outline

## Problem Statement
Generation outputs are the core aggregate of our application, yet many documents remain in `pending` state, lack reliable duration & cost fields, and follow inconsistent schemas between normal, cook-mode, and spell executions. This undermines analytics, delivery status tracking, and cost estimation.

## Vision
Unify and harden the `generationOutputs` collection so every execution (generation, cook batch, spell) is:
1. Persisted with a consistent, versioned schema
2. Transitioned through well-defined status states (pending → processing → success/failed/cancelled)
3. Enriched with accurate duration & cost metrics for real-time estimation and billing
4. Auditable across environments with automated cleanup of stray test records

## Acceptance Criteria
- ≥ 95 % of new generation documents reach a terminal status within 5 minutes of external webhook delivery
- Duration (ms) and cost (USD) fields populated on ≥ 99 % of completed records
- Scripted audit report highlights lingering `pending` docs (< 1 % older than 24 h)
- Cook-mode & spell executions stored in sibling collections or discriminated sub-types with zero schema conflicts
- ADR & migration scripts merged; master docs updated
- Every generation output linked to a cook or spell has the appropriate `cookExecutionId` / `spellCastId` foreign key populated

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Audit Script | Produce analytics script & baseline report | 2025-09-02 |
| Schema Proposal | Draft new schema / versioning strategy | 2025-09-04 |
| Migration Plan | Backfill & migrate existing records | 2025-09-07 |
| Refactor Implementation | Update code to use new schema & status flow | 2025-09-10 |
| Metrics Dashboard | Add duration & cost KPIs to admin UI | 2025-09-12 |

## Dependencies
- ComfyUI Deploy service webhooks
- Cook & Spell execution services
- MongoDB aggregations performance
- Cost estimation library

## Proposed Data Model Updates
1. **generationOutputs** (remains central)
   • New optional FK fields: `cookExecutionId`, `spellCastId`  
   • Ensure **exactly one** of these or neither is present per record.
2. **cooks** (collection)
   • Stores one document per *cook definition* – parameters, metadata, target collection size, randomness rules.  
   • `_id` = `cookId`.
3. **cookExecutions** (collection)
   • One document per *user-initiated cook run* (may span hours).  
   • Fields: `cookId`, `initiatorAccountId`, `status`, `startedAt`, `completedAt`, `generationIds[]`, aggregated `costUsd`, etc.
4. **spells** (collection)
   • Master definition of a spell: ordered tool list, variable bindings, preview images, etc.
5. **spellCasts** (collection)
   • One document per cast/run.  
   • Fields: `spellId`, `initiatorAccountId`, `status`, `startedAt`, `completedAt`, `generationIds[]`, aggregated `costUsd`, etc.

GenerationOutputs therefore always point “up” to their parent cook execution *or* spell cast, enabling reliable aggregation and UI stitching.

### Implementation Notes
- Use MongoDB ObjectId references; add indexes on `cookExecutionId` and `spellCastId` for quick look-ups.
- Keep schemas versioned via `schemaVersion` field to enable future migrations.

## Implementation Tasks
1. **Generation Completion Handler**
   - Compute `durationMs = responseTimestamp - requestTimestamp` and persist.
   - Ensure numeric `pointsSpent` and `protocolNetPoints` are always included (default `0`).
   - Copy `toolDisplayName` from Tool Registry onto the generationOutput at creation.
   - Set initial `deliveryStatus`:
     • `skipped` if `notificationPlatform === "none"`
     • `pending` otherwise.

2. **Notifier Service**
   - On successful delivery → `deliveryStatus = "sent"`, add `deliveryTimestamp`.
   - On all retries exhausted → `deliveryStatus = "dropped"`, add `deliveryError` and `deliveryAttempts`.

3. **Indexes & Migration**
   - Add compound index `{ toolDisplayName: 1, requestTimestamp: -1 }`.
   - Backfill existing records: calculate `durationMs`, populate missing `pointsSpent`, and set `deliveryStatus` based on platform.

4. **Schema Versioning**
   - Introduce `schemaVersion` field (start at `2`) for new writes; legacy docs assumed `1`.

5. **Tests & Metrics**
   - Unit tests for handler to verify fields.
   - Update admin dashboard to chart average `durationMs` & total `pointsSpent` per tool weekly.
