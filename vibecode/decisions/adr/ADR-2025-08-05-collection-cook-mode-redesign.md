# ADR-2025-08-05: Collection Cook Mode Redesign

## Context
The legacy “collection mode” in `archive/deluxebot` allowed users to generate NFT collections from a trait tree, review the outputs, and export them.  
While feature-rich, the implementation tightly coupled Telegram bot handlers, generation logic, and state persistence.  
Key limitations discovered during code audit:

1. **Single-Workflow Constraint** – `startCooking` injects exactly one `workflowType` per collection.  The new platform supports arbitrary Spell graphs ending in any terminal tool.
2. **Monolithic Handler** – `CollectionCook` owns queueing, trait randomisation, status cache, approval UI, and export orchestration, making it hard to extend or unit-test.
3. **Global Mutable State** – Globals such as `studio`, `lobby`, `flows`, and `waiting` couple Discord/Telegram runtimes with business logic, preventing reuse on web and future platforms.
4. **Ad-hoc Persistence** – Cook state is stored in a single `globalStatus` document, limiting concurrent cooks and atomicity guarantees.
5. **Export Pipeline Coupling** – Export code mixes DB updates, ZIP streaming, and chat interaction; no reuse for new Cloudflare-based delivery.
6. **No Formal Contracts** – No explicit interface between generation service, piece reviewer, and exporter.

Meanwhile the refactored core introduces:
* **Spells** – user-authored DAGs of tools with typed inputs/outputs.
* **Service Layer** – event-driven jobs decoupled from platform adapters.
* **Tool Registry** – declarative tool metadata enabling composition.

We need a fresh design that embraces these capabilities while preserving proven ideas: trait conflict resolution, cook state machine, user review loop, and batched exporting.

## Decision
1. **Split Responsibilities into Services**
   * `CookOrchestratorService` – owns the finite-state machine (Idle → Cooking → Paused → Completed → Exported).  Receives commands via REST/WebSocket; emits domain events (PieceQueued, PieceGenerated, PieceReviewed...).
   * `TraitEngine` – pure module housing selection, conflict resolution, and parameter templating (prompts, images, numeric hyper-parameters).
   * `CookJobStore` – lightweight queue using a MongoDB `cook_jobs` collection with Change-Stream listeners. Each job document carries a `spellId`, `traitSelection`, and user context.
   * `ReviewService` – surfaces generated pieces to platform adapters; persists decisions back to DB.
   * `ExportService` – transforms approved pieces into metadata packages and pushes them to Cloudflare R2; returns public base URI.

2. **Spell-or-Tool Powered Generation**
   * Each collection points to either a `spellId` **or** a single `toolId`.  This keeps the barrier low for simple usage while still enabling advanced DAGs.
   * The orchestrator detects which pathway is used:
        * **Spell** – Validate that the graph ends in a single output node.
        * **Tool** – Look up the tool definition in the `ToolRegistry` and wrap it as a single-node spell internally.
   * Generation jobs therefore always execute through the unified `ExecutionClient`, but the payload can originate from a full spell graph or an auto-wrapped tool call.
   * Trait values may target **any parameter** of the tool/spell, not just prompt strings.  Example: for an `/effect` image-to-image tool the trait tree can swap out the `input_image` parameter to iterate over a user-supplied image set.

3. **Event-Sourced Persistence**
   * Use an append-only `cook_events` collection; read models (current status, progress) are projected by `CookProjectionUpdater`.
   * Enables reliable resumption and platform-agnostic listeners (e.g., email notifier).

4. **Platform-Adapter Contracts**
   * Define `CookUIPort` interface with methods: `showControlPanel`, `updateProgress`, `presentPiece`, `showExportLink`.
   * Discord, Telegram, and Web implement the port; orchestrator remains unaware of UI details.

5. **Stateless Worker Containers**
   * Generation workers receive everything through the job payload: spell DAG, trait selections, configHash.  No shared globals.

6. **Export via Cloudflare**
   * When a cook reaches `Completed`, `ExportService` uploads images + JSON to R2 and pins to gateway.  A signed URL is sent back through `CookUIPort`.

7. **Backwards Compatibility Layer**
   * Legacy Telegram bot routes delegate to new orchestrator through an adapter so existing users can finish ongoing cooks.

## Consequences
+ **Extensibility** – Any future tool chain (e.g., video, audio) becomes eligible for collection generation.
+ **Resilience** – Crashes only replay events; no lost state.
+ **Multi-Platform** – Same core logic available on web dashboard, Discord, and Telegram without duplication.
+ **Observability** – Event stream allows real-time dashboards and analytics.
− **Initial Complexity** – Requires event bus, custom Mongo-backed queue, and multiple projections.
− **Data Migration** – Must migrate existing `globalStatus.cooking` into event stream on first run.

## Implementation Plan

### Phase-oriented Roadmap
| Phase | Goal |
|-------|------|
|0 – Scaffolding|Create `cook_events` & `cook_jobs` collections, register `/internal/cook` API namespace, spin up job-worker process watching Change Streams|
|1 – Core Services|Implement `TraitEngine`, `CookJobStore`, `CookOrchestratorService`, `CookProjectionUpdater`|
|2 – Web Integration|Public API routes under `/api/v1`, plain-JS web pages & optional WebSocket broadcaster|
|3 – Review Loop|`ReviewService` endpoints + front-end gallery for approve/reject|
|4 – Export Stub|`ExportService` that emits metadata to local disk (Cloudflare hook later)|

### Mongo Collections
```js
// cook_events (append-only)
{ _id, collectionId, userId, type, payload, ts }

// cook_jobs (queue)
{ _id, status: 'queued'|'running'|'done'|'failed',
  spellIdOrToolId, userContext, collectionId, userId,
  attempt, createdAt, updatedAt }

// cook_status (projection)
{ _id:{collectionId,userId}, state, generationCount, targetSupply,
  lastGenerated, queued, approved, rejected, updatedAt }
```

### Service Modules (src/core/services/cook)
* `TraitEngine.js` – selection, conflict resolution, parameter templating.
* `CookJobStore.js` – Mongo queue helper with `enqueue`, `watch`, `markDone/Failed`.
* `CookOrchestratorService.js` – FSM exposing `startCook`, `pauseCook`, `resumeCook`, `approvePiece`, `rejectPiece`.
* `CookProjectionUpdater.js` – rebuilds & updates `cook_status` via event stream.
* `ReviewService.js` – convenience wrappers for listing & updating piece status.
* `ExportService.js` – metadata packaging to disk / Cloudflare R2.

### Internal API Contracts
```
POST /internal/cook/start        { collectionId, userId, spellId?, toolId? }
POST /internal/cook/pause        { collectionId, userId }
POST /internal/cook/resume       { collectionId, userId }
POST /internal/cook/approve      { pieceId,  userId }
POST /internal/cook/reject       { pieceId,  userId }
GET  /internal/cook/status       ?collectionId=&userId=
```

### External (Web) API
```
POST /api/v1/collections/:id/cook/start
GET  /api/v1/collections/:id/cook/status
POST /api/v1/pieces/:pieceId/approve
POST /api/v1/pieces/:pieceId/reject
```

### Worker Skeleton
```js
CookJobStore.watch(async job => {
  try {
    const output = await ExecutionClient.run(job.spellIdOrToolId, job.userContext);
    appendEvent('PieceGenerated', { collectionId:job.collectionId, … });
    await CookJobStore.markDone(job._id);
  } catch(e) {
    await CookJobStore.markFailed(job._id);
    appendEvent('GenerationFailed', { error:e.message, … });
  }
});
```

### Web-Front End (No React)
* `public/js/cook.js` – fetch helpers & DOM updates.
* New HTML templates in `src/platforms/web/client/collections/` for progress modal & review gallery.

This plan satisfies all constraints: API-first, web-first, Mongo-only dependencies, no external queue library, and cleanly slots into the existing layered architecture.

## Alternatives Considered
1. **Incremental Refactor of `CollectionCook`** – Faster but preserves monolith and single-workflow limitation.
2. **Third-Party NFT Engine** (e.g., HashLips) – Would offload trait logic but introduces dependency hell and loses tight spell integration.
3. **Keep Manual Exports** – Avoids Cloudflare work but continues large ZIP uploads via chat, which are brittle for >1 GB collections.

We chose full redesign to align with the layered architecture and spells vision, unlocking long-term flexibility despite higher upfront cost. 