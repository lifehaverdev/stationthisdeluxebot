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

## Implementation Status (2025-08-05)

✔ Phase 0 – Scaffolding
  • `cook_events` & `cook_jobs` collections referenced (indexes auto-created).  
  • `CookJobStore` with Change-Stream watcher implemented.  
  • Internal Cook API (`/v1/data/cook`) exposes `/start`.  
  • Worker skeleton logs queued jobs.

▶ Phase 1 – Core Services (in progress)
  • `TraitEngine` ported (selection & templating).  
  • `CookOrchestratorService.startCook` generates first job & events.  
  • CookProjectionUpdater implemented and auto-initialized at service startup.  
  • CookMenuModal Home view + live polling + create-collection flow wired to `/api/v1/collections`.  
  • Mongo-backed `cook_collections` persistence via `CookCollectionsDB`.  
  • Internal & External Cook APIs implemented (`/internal/v1/data/cook/*`, `/api/v1/*`) including list/create/fetch.  
  • Detail view scaffolded in CookMenuModal with back navigation.  
  • Close button overlay + Esc work as expected.

## Roadmap to Full Implementation

1. **Backend REST Endpoints** (internal → external proxy) – Phase 1 DONE for list/create/fetch. Remaining:
   - `GET /internal/cook/active` → list active cook_status docs.
   - `GET /internal/collections` → user collections summary (id, name, supply, latest status).
   - `POST /internal/collections` → create collection (basic metadata).
   - `PUT /internal/collections/:id` → update metadata / config.
   - `DELETE /internal/cook/:collectionId` → cancel & delete cook.
   - `POST /internal/cook/:id/pause|resume` → state transitions.
   - `POST /internal/cook/:id/review/:pieceId` → approve / reject piece.

2. **CookMenuModal Enhancements** (partially done)
   - ✔ Close on overlay click / Esc.  
   - ✔ Live polling for active cooks / collections.  
   - ✔ Pause / resume / delete hooks (API stubs).  
   - ✔ Create-collection form + DB save.  
   - ☐ Tabbed Detail view (Overview | Pieces | Edit | Trait Tree | Export).  
   - ☐ Stats section (queued, generated, approved…).

3. **Collection Detail Modal**
   - Tabs with lazy loading; share code with existing modals for consistency.
   - Overview tab: Start/Pause/Resume buttons → orchestrator.
   - Pieces tab: infinite scroll thumbnails, approve/reject.
   - Edit tab: inputs for name/description, attach spell/tool, totalSupply.
   - Trait Tree tab: embed legacy editor UI (ported).

4. **Trait Tree Management** (next focus)  
   - Port trait tree editor component into sandbox as `TraitTreeEditor.js`.  
   - Save trait config to `collections.config.traitTree`.  
   - Add randomize & conflict-resolution preview.

5. **Test Window** (next focus)  
   - `collectionTestWindow.js` opens side canvas; allows generating a single piece using current trait selection.  
   - Utilises orchestrator in dry-run mode (no DB write).

6. **Controls & Stats**  
   - Wire Start / Pause / Resume buttons; show progress bars.  
   - Display generation counts, approve/reject metrics, points per gen.

7. **Metadata & Launch Stub**  
   - Editable collection metadata (description, supply, ticker).  
   - Ownership sharing & “Launch” (export) button placeholder.

8. **QA & E2E Tests**
   - Cypress/Playwright flows: start cook, approve some pieces, pause/resume, export.
   - Unit tests for TraitEngine edge cases.

Target completion: Phase 1 end-of-week; full UI parity + export within two additional sprints.

## Alternatives Considered
1. **Incremental Refactor of `CollectionCook`** – Faster but preserves monolith and single-workflow limitation.
2. **Third-Party NFT Engine** (e.g., HashLips) – Would offload trait logic but introduces dependency hell and loses tight spell integration.
3. **Keep Manual Exports** – Avoids Cloudflare work but continues large ZIP uploads via chat, which are brittle for >1 GB collections.

We chose full redesign to align with the layered architecture and spells vision, unlocking long-term flexibility despite higher upfront cost. 

## UI/UX Plan

### Web Sandbox Modal (CookMenuModal)
1. Home view
   • Top list of **Active Cooks** – each shows progress bar, pause/resume, delete icons.
   • Divider then **My Collections** grid – card per collection with status badge and "+" button to create new.
   • Footer bar with Help "?" button.

2. Collection Detail view
   • Tabs: Overview | Pieces | Edit | Trait Tree | Export.
   • Overview shows supply, progress, queued, buttons (Start/Pause, Review, Delete).
   • Pieces tab shows paginated thumbs with approve/reject.
   • Edit tab allows name, description, spell/tool mapping, workflow tweaks.
   • Trait Tree editor re-uses same UI from legacy trait menu but polished.

3. Trait Test Window
   • New `collectionTestWindow.js` node similar to `toolWindow.js` which pulls trait schema, lets user randomize/lock traits, preview prompt/image.

4. Piece Review Window
   • `collectionReviewWindow.js` node that loads next pending piece, approve/reject with hotkeys.

All components styled via existing modal/container CSS (`modsMenuModal.css` variants).

Telemetry events: `cook.view`, `cook.start`, `cook.pause`, `cook.approve`, etc.

These views will live under:
```
src/platforms/web/client/src/sandbox/components/
  CookMenuModal.js
  CollectionTestWindow.js
  CollectionReviewWindow.js
public/css/cookMenuModal.css
```

Telegram bot menu will mirror the same hierarchy with inline keyboards. 

### Design Note – Flexible Trait Values & Tool/Spell Binding (2025-08-11)

Problem: Legacy cook mode assumed a single *master prompt* string containing placeholders like `[[animal]]`.  Each trait category simply expanded to a prompt snippet.  In the refactored platform a cook might target **any** parameter of a tool or spell node – not just the text prompt – e.g. an image URL, a controlnet hint, or a numeric denoise strength.

Proposed schema additions (saved under `collection.config.traitTree`):
```json
{
  "categories": [
    {
      "name": "Animal",            // UI label
      "param": "prompt",           // name of the tool/spell input the value maps to
      "traits": [
        { "name": "Cat",  "value": "a cute cat", "rarity": 20 },
        { "name": "Dog",  "value": "a fluffy dog", "rarity": 20 },
        { "name": "Owl",  "value": "a wise owl",  "rarity": 10 }
      ]
    },
    {
      "name": "Input Image",        // could map to an image parameter
      "param": "input_image",
      "traits": [
        { "name": "Photo A", "value": "https://…/a.jpg" },
        { "name": "Photo B", "value": "https://…/b.jpg" }
      ]
    }
  ]
}
```

Implications:
1. **Category → Parameter binding** – Each category must specify which parameter it targets.  UI will expose a dropdown of available input names (derived from selected tool/spell).  If blank, treat as prompt replacement for backward-compat.
2. **Trait `value` field** – Replaces fixed `prompt`.  Free-text; semantics depend on parameter type.
3. **Rarity optional** – Default to uniform distribution when omitted.  UI: empty rarity cell = “common”.

### Workflow for Users
1. In *Edit* tab the user chooses a *generator*: either
   • Pick a Tool from Tool Registry, **or**
   • Pick an existing Spell they own.
2. Trait Tree tab shows available input parameters on the right; when creating a category the user links it to one parameter.
3. *Test Window* (`collectionTestWindow.js`):
   • Displays quick-pick dropdown for every category (randomise / lock).  
   • Runs orchestrator with the chosen trait values *without* writing cook events (dry-run flag).  
   • Shows the generated output.

### Next UI Tasks
1. Extend `TraitTreeEditor`:
   • Category row gains a “Param” select (populated once tool/spell chosen).  
   • Trait rows use “Value” instead of hard-coded prompt column.
2. Add *Edit* tab to Detail view: simple form to pick spell/tool and display Params list.
3. Implement `collectionTestWindow.js` (opens from Detail header) – uses dry-run API `/internal/cook/test`.
4. API: `POST /internal/cook/test` accepts `{ collectionId, userId, paramOverrides }` and returns generation output.

This design keeps the system future-proof for non-text inputs while preserving familiar random trait behaviour. 

### Revised Collection Detail UI (2025-08-12)

The Detail modal will be simplified to **two primary tabs** for MVP:

1. **Overview** – generation controls, high-level metadata and parameter editing.
2. **Trait Tree** – purely for metadata taxonomy (category → traits with name / value / rarity).  The tree is no longer coupled to the generator; it only supplies values that a user can reference with `[[category]]` placeholders inside any parameter value.

Overview layout wireframe
```
┌───────────────────────────────────────────────┐
│  ← Back          Cult Secretaries            ×│
├───────────────────────────────────────────────┤
│  overview  |  traitTree                      │
├───────────────────────────────────────────────┤
│  Description:   "My secretary cult…"   [edit]│
│  Total supply:  1000                     [edit]│
│                                               │
│  Generator:  Tool 📦  comfy-txt2img       [edit]│
│                                               │
│  Parameters                                   │
│    prompt:        "[[animal]] wearing [[outfit]]"   [edit]│
│    guidance:      7.5                          [edit]│
│    input_image:   (none)                       [edit]│
│                                               │
│  [ Test ]        [ Start Cook ]               │
└───────────────────────────────────────────────┘
```

Rules
* **Trait Tree is global** – categories exist regardless of which parameters reference them.
* Any parameter value can embed `[[CategoryName]]` tokens to be substituted at runtime.
* The *Test* button performs a dry-run using current parameter values (placeholders resolved).
* *Start Cook* validates supply & generator, then queues cook jobs.

Next tasks
1. Re-work Overview tab UI to render description, supply, generator pickers and parameter list (editable inline).
2. Move current generator selection UI from *edit* tab into Overview.
3. Update collection schema:
   ```
   config: {
     traitTree: …,
     generator: { type:'tool', toolId:'xyz' },
     paramOverrides: { prompt:"…", guidance:7.5, … }
   }
   ```
4. TraitTreeEditor remains unchanged except it no longer exposes param binding dropdown (drop it).
5. Implement `POST /internal/cook/test` to run dry-run.
6. Cook start endpoint uses `paramOverrides` + randomised traits when generating jobs. 

### Test Window UX (2025-08-12)

A dedicated sandbox window (`collectionTestWindow.js`) will open on the canvas when the user presses **Test** in the Overview tab. The collection modal closes to give workspace focus.

Window layout
```
┌───────────────────────────────────┐
│  Cult Secretaries · Test          │
├───────────────────────────────────┤
│  Animal   [ Cat ▼ ]               │
│  Outfit   [ Business suit ▼ ]     │
│  Background [ Forest ▼ ]          │
│                                   │
│  🎲  (randomise all)    Execute ▶ │
└───────────────────────────────────┘
```
Behavior
1. Dropdowns list all traits for each category (plus “— random —”).
2. Dice button selects random trait in every dropdown.
3. Execute: constructs `paramOverrides` by taking existing collection overrides and injecting selected trait values where `[[Category]]` placeholders appear.
4. Sends payload to new endpoint `POST /internal/cook/test` `{ collectionId, traitSelection }`.
5. Response mirrors normal generation result; window shows progress and final output using the same duplication logic as `toolWindow.js` execution.

If the generator is a spell, we execute the spell; if a tool, we run the tool directly.

The window persists so the user can run multiple trials without rebuilding selections.

Implementation order
1. Add `/internal/cook/test` and `/api/v1/collections/:id/test` endpoints (dry-run flag, no DB writes).
2. Create `collectionTestWindow.js` (fork of `toolWindow.js`):
   • Header shows collection name + “Test”.
   • Builds dropdowns from `traitTree.categories`.
   • Execute logic described above.
3. In CookMenuModal Overview, Test button closes modal and calls `createCollectionTestWindow(collection)` helper. 



Progress summary (2025-08-12)
Implemented since last checkpoint
CookMenuModal
Tabs reduced to Overview | Trait Tree.
Overview now shows editable Description, Total Supply, Generator, parameter overrides, Test & Start buttons.
Saving generator pulls full tool definition, populates parameter list, and persists config.generator / paramOverrides.
Trait Tree uncoupled from generator (metadata-only).
TraitTreeEditor
Param dropdown removed to reflect new separation.
Test Window
CollectionTestWindow.js opens centered on canvas, lists categories, allows randomise & Execute.
Executes selected tool via executionClient.execute, substitutes [[Category]] placeholders, shows progress/result (image or status).
ADR updated with:
Flexible trait values & generator binding schema.
Revised Detail UI layout.
Test Window UX spec and implementation checklist.
Outstanding / next tasks
Generator picker UI: replace prompt-for-toolId with a dropdown modal (reuse sandbox Action modal styles).
Fix generator name display (load displayName from collection.config on initial render).
Make Test Window draggable & center reliably; enhance result rendering (handle images array, error states).
Start Cook button: validate supply + generator, queue cook jobs.
Stats & progress in Overview.
Spell support (picker + execution path).
Export pipeline (metadata JSON + images).
**Test Window logic** – 
408a| • Gather current `paramOverrides` from collection.
408b| • Resolve `[[Category]]` placeholders with selected trait values (or auto-randomise when dropdown set to "— random —").
408c| • Fill in any missing parameters with defaults from tool input schema.
408d| • POST to `/internal/cook/test` with full payload, subscribe to websocket updates like `toolWindow.js`.
408e| • On final output, render using resultContent helpers; images clickable to open `imageOverlay.js` for full-size preview.

