# Spell Cast & Cook Execution DB — Outline

## Problem Statement
Current spell and cook workflows rely on ad-hoc metadata fields inside `generationOutputs` and event tables (`cook_events`). There is no first-class collection storing:
1. Spell definition metadata and step list
2. Per-cast tracking of a spell run
3. Collection definition metadata (NFT collection) and trait tree
4. Per-cook tracking of piece generation progress

This makes it hard to aggregate costs, progress, failure states, and user-visible status.

## Vision
Introduce four collections (renamed):
1. `spells` – master definitions (editable)
2. `casts`  – one document per user-initiated spell run (FK → spellId)
3. `collections` – NFT collection definitions (rename of old `cook_collections`, editable)
4. `cooks` – one document per cook run (FK → collectionId)

A generationOutput may reference **both** `spellCastId` (`castId`) and `cookExecutionId` (`cookId`) when a spell is used as the generator inside a cook.

## Acceptance Criteria
- On spell start, a `spellCast` is created with status `running`; each step generationOutput links back via `spellCastId`.
- On cook start, a `cookExecution` is created; each generated piece’s generationOutput links via `cookExecutionId`.
- Dashboards can show % complete and total cost per spellCast / cookExecution.
- Backfill script links legacy generationOutputs based on existing metadata where possible.
- generationOutputs link via `castId` and/or `cookId` (both allowed).
- WebSocket progress handlers (`websocketHandlers.js`) and UI (`SpellWindow.js`, `CookMenuModal.js`, `SpellsMenuModal.js`) reflect live progress using the new IDs.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Schema & Indexes | Collections created, indexes in place | 2025-09-05 |
| Execution Hooks | CookOrchestrator & WorkflowExecution write parent docs and FK refs | 2025-09-08 |
| Aggregation API | Endpoints to fetch progress & cost summaries | 2025-09-10 |
| UI Surfaces | Admin dashboards show progress bars | 2025-09-12 |
| Migration | Backfill legacy records | 2025-09-13 |

## Dependencies
- GenerationOutputs collection (new fields already added)
- NotificationDispatcher for completion events

## Open Questions
- Should `collections` live in its own DB namespace (future marketplace)?
- Versioning strategy for `spells` (immutable vs draft states?)
