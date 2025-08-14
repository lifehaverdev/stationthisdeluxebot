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


+### Dynamic Trait Generators (Numeric Ranges) — Deliverable (2025-08-13)
+
+Problem
+Users may need thousands of simple numeric trait values (e.g., `[[miladyid]]` as 0–9999) and cannot manually author one trait per value.
+
+Solution Overview
+- Add a Generated mode for categories in the trait tree. Categories can be Manual (existing list of traits) or Generated.
+- First generator type: numeric `range`.
+
+Schema additions (saved under `config.traitTree.categories[]`)
+```json
+{
+  "name": "miladyid",
+  "mode": "generated",
+  "generator": {
+    "type": "range",
+    "start": 0,
+    "end": 9999,
+    "step": 1,
+    "zeroPad": 0,
+    "uniqueAcrossCook": true,
+    "shuffleSeed": null
+  }
+}
+```
+
+Semantics
+- Range generates the sequence [start, end] inclusive using step.
+- `zeroPad` left-pads when substituted into strings (e.g., 0001).
+- `uniqueAcrossCook: true` ensures each piece in the cook uses a unique value until the set is exhausted. If supply exceeds set size, wrap or error per config (MVP: wrap=false → error).
+- `shuffleSeed` (optional) applies a stable shuffle to the sequence to avoid predictable ordering.
+
+Substitution
+- Values from generated categories are substituted anywhere `[[CategoryName]]` appears, same as manual traits. Example:
+  - Parameter value: `https://miladymaker.net/milady/[[miladyid]]`
+  - With `miladyid = 42` → `https://miladymaker.net/milady/42`
+
+UI/UX
+- TraitTreeEditor: Category Mode toggle (Manual | Generated). If Generated=Range, show fields: start, end, step, zeroPad, uniqueAcrossCook, shuffleSeed; show total count and a 5-item preview.
+- Test Window: For Generated categories, render a compact numeric input instead of a huge dropdown. Randomise picks a valid value; lock allows manual entry.
+- Overview: No change beyond existing parameter editing/substitution rules.
+
+Cook Orchestration
+- When starting a cook with `uniqueAcrossCook`, the orchestrator assigns values deterministically per piece index using the (optionally shuffled) range. No need to persist 10k trait rows; values are virtual.
+- Store assignment events (`CategoryValueAssigned`) to preserve provenance and resume accurately.
+- Queueing strategy: enqueue in chunks (e.g., 1k at a time) to avoid large bursts.
+
+Dry-run/Test
+- Test Window uses the same generator rules but does not reserve values. Users can type any valid value, or randomise.
+
+Performance & Storage
+- Do not materialise generated traits into the DB. Persist only the generator config. Projections compute counts on the fly.
+
+MVP Tasks
+1. TraitEngine: implement `generated: {type:'range'}` resolver (random selection for test; deterministic per-piece for cooks with optional shuffle).
+2. TraitTreeEditor: add Generated mode with Range fields, preview, count.
+3. CollectionTestWindow: render numeric input for generated categories; validate range.
+4. CookOrchestratorService: deterministic assignment across supply; emit assignment events; chunked enqueue.
+5. Validation: ensure supply ≤ generator cardinality when `uniqueAcrossCook` is true (or document wrap behavior once supported).
+
+Example
+```
+Category: miladyid → range(0..9999)
+Parameter: input_url = "https://miladymaker.net/milady/[[miladyid]]"
+```
+This yields 10,000 distinct inputs with unique IDs when cooked.

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
CollectionTestWindow.js opens centered on canvas, is draggable/closable/refreshable, shows trait selectors, renders required parameter inputs with optional behind “show more”, supports text overlay for prompts, and executes with progress/result.
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
408a| • Render required parameters as styled inputs; optional parameters behind a "show more" toggle.
408b| • Inputs initialize from collection `paramOverrides` merged with tool schema defaults; text fields support prompt overlay on focus.
408c| • Resolve `[[Category]]` placeholders in input values; auto-randomise unset trait dropdowns.
408d| • Validate required inputs before execution; then execute via the unified execution client and subscribe for progress.
408e| • On final output, render using resultContent helpers; images are clickable to open `imageOverlay.js` for full-size preview.
409|
409a|### Progress summary (2025-08-12 PM)
409b|• Generator picker switched to dropdown; name persists on navigation.
409c|• TraitTreeEditor now stores `value` not `prompt`; UI updated accordingly.
409d|• CollectionTestWindow: required/optional param UI with show-more, prompt overlay binding; sends defaults + overrides; substitutes trait `value`; randomise works; added Refresh, Close, drag.
409e|• WebSocket progress and result rendering integrated (image overlay supported).
409f|• Overview tab gained Delete button (with confirm) – new internal/external DELETE endpoints implemented and verified.
409g|• Bug fix: ensured generator & paramOptions reload on entering Detail view.
409h|

### Progress summary (2025-08-13)
Implemented since last checkpoint
- CookMenuModal
  - Start Cook wired to POST `/api/v1/collections/:id/cook/start` (proxies to internal). Sends `toolId`, `config.traitTree`, `config.paramOverrides`, `totalSupply`.
  - Overview param edits persist to `config.paramOverrides`.
  - TraitTreeEditor supports Generated (Range) categories with count/preview.
- CollectionTestWindow
  - Required/optional parameter inputs with show-more; prompt overlay; trait selectors.
  - Generated range support (numeric input, randomize, zeroPad when substituting).
  - Header buttons: Save (persists `config.paramOverrides`), Refresh, Close.
  - Execute runs tool via execution client with progress/result rendering.
- Backend
  - External start endpoint added; internal `/internal/v1/data/cook/start` accepts `traitTree` and `paramOverrides`.
  - Orchestrator uses `TraitEngine.selectFromTraitTree` with deterministic selection for generated ranges.
  - `TraitEngine` implements manual/weighted and generated range selection; zeroPad and optional shuffle mapping.

Next focus
- Orchestrator & Worker
  - Queue chunking across `totalSupply`, uniqueAcrossCook deterministic assignments, and `CategoryValueAssigned` events.
  - Worker consumption and status events end-to-end.
- Projections & Status
  - `CookProjectionUpdater` updates `cook_status`; wire `GET /internal/v1/data/cook/active` and surface in UI.
- Review & Export
  - Approve/reject endpoints and web UI; export stub to R2.
- Spells
  - Add spell picker and execution path parity.


### Current Blocker (2025-08-13): Start Cook enqueues but no tool execution in dev

Problem statement
- Starting a cook from `CookMenuModal.js` returns 200 and logs “Cook started (queued 1)”. However:
  - No subsequent POST to `/internal/v1/data/execute` is observed.
  - The Active Cooks section remains empty.

Observed logs (summarised)
- Start endpoint hit successfully:
  - `[CookAPI] Started cook. Queued 1 for collection <id> by user <userId>`
- Embedded worker ensured and started:
  - `[CookEmbeddedWorker] Starting cook job watcher in-process…` → `Watcher active.`
- Mongo change streams not permitted in current env (AtlasError code 8000):
  - `$changeStream is not allowed...`
- After adding polling fallback, no crash, but still no “Submitting job …” log and no request to `/internal/v1/data/execute`.
- Active cooks endpoint shows zero for user-scoped collections and falls back to a legacy collection without `userId` (not considered active for the authenticated user):
  - `[CookAPI] collections list for user <userId> -> 0`
  - `[CookAPI] Falling back to legacy collections without userId: 1`

What’s working
- External → internal routing for start is correct and includes `collectionId` and `userId`.
- CSRF/session/JWT path is validated; `req.user` is populated on external routes.
- Job enqueue to `cook_jobs` succeeds.

What’s not working
- In-process worker does not submit the queued job to `/internal/v1/data/execute` in this environment.
- Active cooks view relies on `cook_collections` filtered by `userId`, so legacy docs (without `userId`) do not appear as “active”.

Root-cause hypotheses
1) Watcher delivery not triggering submission
   - Change streams are disallowed; initial watcher crashed. A polling fallback was added, but there’s no evidence of the poller invoking the callback (no “Submitting job …” logs and no execute POST).
   - Possibility: the poller started after the job was already transitioned, or a race/marking inconsistency prevents detection.
2) Multiple ensure() calls vs single watcher
   - `ensure()` currently fires on each start call. While guarded by a `started` flag, we should confirm a single loop is active and not torn down.
3) Job shape or filters mismatch
   - Poller uses `{ status: 'queued' }` oldest-first. If any code marks the job `running` before the poll loop can claim (or if the job lacks expected fields), it might be skipped.
4) Execute pre-check fail not surfaced
   - If execute pre-check (points/wallet/model) failed synchronously, there would be error logs. None observed, which suggests the submission never happened.

Mitigations added so far
- Embedded worker auto-started from `/internal/v1/data/cook/start` to support single-process dev.
- `CookJobStore.watchQueued` now:
  - Falls back to polling if change streams aren’t available.
  - Switches to polling on change stream runtime error.
  - Uses `claimNextQueued()` for atomic pickup to avoid dupes.
- `/internal/v1/data/cook/active` implemented to surface active progress (queued/running/generated) when user-owned collections are present.

Gaps/risks
- Active cooks remain empty when collections were created earlier without `userId`. This blocks UI visibility but is orthogonal to execution.
- Embedded worker logging doesn’t currently print queue length or claimed job id on each poll; diagnosing poll behavior is slower without this instrumentation.

Proposed next steps
1) Instrumentation (low risk)
   - Add periodic debug in embedded worker: count of queued jobs and log when a job is claimed (`claimed job <_id>`), with backoff.
   - Log execute POST attempt payload keys (toolId, masterAccountId) and status code.
2) Hard “nudge” submission path (low risk)
   - After enqueue, optionally attempt a one-shot `claimNextQueued()` and submit immediately (guarded by env flag `COOK_IMMEDIATE_SUBMIT=true`) to verify end-to-end path in dev.
3) Active cooks robustness (medium)
   - For Active endpoint, derive active collectionIds from `cook_jobs` and `cook_events` for the authenticated user and join with `cook_collections` when available; otherwise include minimal status by `collectionId` even if the collection doc lacks `userId`.
4) Single watcher lifecycle (low)
   - Move `ensure()` from the start endpoint to service initialization with a single-process guard, to avoid per-request triggering.
5) Add `/internal/v1/data/cook/debug/queue` (dev-only)
   - Return counts and the next candidate job document for quick verification.

Exit criteria for this blocker
- Start Cook yields: Active Cooks shows the collection with queued/running counts, and a subsequent POST to `/internal/v1/data/execute` is observed within a few seconds in dev (without running a separate worker service).


### Progress summary (2025-08-13 late PM)
- Start Cook now immediately submits the first job in dev/single-process via a targeted claim-by-id path in `CookOrchestratorService`.
- Verified end-to-end submit to `/internal/v1/data/execute` with proper credit check and ComfyDeploy submission (Run ID observed).
- Webhooks not received in test environment; completion and scheduling rely on webhook path in production.
- Reduced log noise: embedded worker queue metrics gated behind a boolean; queue polling logs disabled by default. Kept a concise "[Cook] Submitted piece" info line.

Next steps
- Enable webhook endpoint in production and validate: `PieceGenerated` events, job markDone, and `scheduleNext` sequencing.
- Add preflight gating before enqueuing/submitting next pieces:
  - Points check (halt/emit `CookPaused` when insufficient)
  - Supply/cadence guard (respect `totalSupply`, optional backoff)
- Emit `CategoryValueAssigned` events for generated ranges (deterministic per piece) to support provenance and resume.
- Chunked enqueue and/or tuned `maxConcurrent` to smooth bursts once webhooks flow is confirmed.
- UI: surface concise active cook status from `cook_status` (queued/running/generated) and hide embedded worker metrics from logs in production.


### Course correction (2025-08-13 Night) — Remove worker; immediate-submission loop, tool-agnostic

Revised architecture (supersedes queue/worker portions above):
- Orchestrator-driven, no background worker
  - On Start Cook: orchestrator builds params (TraitEngine), enqueues logical piece index, and immediately submits via the unified execution endpoint. No dependency on change streams or a polling worker to progress.
  - On Completion: webhook (or immediate delivery for tools with `deliveryMode: 'immediate'`) updates the generation record, appends `PieceGenerated`, and the orchestrator schedules the next piece by immediately submitting it (until supply reached).
- Minimal preflight gating
  - Points/credit checks remain in the central execution path (internal `/execute`) for consistency across all tools.
  - Orchestrator performs a lightweight gate before submit: ensure `generatedCount < totalSupply`. This prevents runaway requests for finite collections.
- Tool-agnostic execution
  - Execution uses `ToolDefinition` contracts. Generators may deliver via webhooks or immediate responses. Orchestrator does not assume Comfy-specific webhooks; it reacts to the system’s standard “generation completed” signal.
  - Extend `ToolDefinition` as needed to support collection cooks (e.g., enriched `metadata` for provenance, confirmation of `deliveryMode`, and any per-tool hints helpful for batching or throttling).
- Provenance
  - Persist per-piece `selectedTraits` and the resolved parameter snapshot into `generation.metadata` (e.g., `{ collectionId, pieceIndex, selectedTraits, paramSnapshot }`) so we can reproduce and review/export later.

Mongo collections (revised):
- `cook_events` — append-only event stream (CookStarted, PieceQueued, PieceGenerated, CookCompleted, CookPaused/Halted).
- `cook_status` — projection updated from events for progress (state, queued, generated, approved/rejected, lastGenerated).
- Generation records — source of truth for outputs; flagged with collection metadata. No `cook_jobs` queue is required for progression.

Service modules (revised):
- `TraitEngine` — unchanged: selection, conflict resolution, templating (manual/weighted + generated ranges). Add explicit `selectedTraits` to generation metadata for each piece.
- `CookOrchestratorService` — owns FSM and immediate submission on Start + scheduleNext. Performs supply gating pre-submit and emits events.
- `CookProjectionUpdater` – unchanged: builds `cook_status` from `cook_events`.
- `ReviewService` / `ExportService` – unchanged interfaces; operate on stored generation records and collection metadata.

Deprecations:
- Remove “Stateless Worker Containers” and any polling/Change-Stream dependent embedded worker from the critical path.
- Remove reliance on `cook_jobs` as a live queue for progression. It may be kept only as an audit trail if desired, but is not required for scheduling.

Execution flow (revised):
1) Start Cook → Orchestrator validates supply, selects traits, resolves params, submits generation immediately.
2) Completion (webhook or immediate) → Update generation record, append `PieceGenerated`, spend points (central system), then orchestrator immediate-submits the next piece if supply remains.
3) When `generatedCount === totalSupply` and no running pieces → append `CookCompleted` and stop.

ToolDefinition alignment:
- Continue to rely on existing fields (`service`, `inputSchema`, `deliveryMode`, `costingModel`).
- Permit additional `metadata` needed for collection cooking (e.g., hints for param substitution, recommended throttle). No Comfy-specific assumptions embedded in the orchestrator.

Operational notes:
- Logs are kept minimal (single submit line per piece). No periodic polling logs. Webhook-less tools must deliver via the immediate path, which is already supported by `deliveryMode: 'immediate'`.
- UI status (e.g., 1/20) is driven by `cook_status` projection and generation records; scheduleNext submissions occur immediately after completion, without background workers.

