# ADR-2025-08-01: Unified Mods Menu & ComfyUI Model Discovery

## Context

The current mods browsing experience is fragmented:

1. **Telegram `ModsMenuManager`** only lists LoRAs recorded in our internal DB.
2. The **Web sandbox** lacks any dedicated UI for exploring or selecting models.
3. The **ComfyUI integration** (`src/core/services/comfydeploy/comfyui.js`) exposes LoRA lookup via DB entries but does **not** surface other model classes (checkpoints, upscalers, taggers, embeddings, VAE, etc.).
4. Checkpoint files live on Comfy-Deploy worker volumes and are not mirrored in our DB, so we have no authoritative list for UI selection or quoting.

With more workflows depending on diverse model assets, users must be able to:

* Browse all available **model categories** (LoRAs, checkpoints, upscalers, taggers …).
* See metadata (size, preview image, owner where relevant).
* Select, favourite, and purchase (where monetised) any model.

## Decision

1. **Introduce a _Model Discovery Service_ in `comfyui.js`**
   * Add a `listModels({ category })` method that queries the Comfy-Deploy Volumes endpoint `GET /volume/private-models` (and optionally merges `/api/search/model?provider=all`) to return an array of `{ path, sizeBytes, mtime, category }`.
   * Categories: `checkpoint`, `lora`, `upscale`, `tagger`, `embedding`, `vae`.
   * Cache responses for 10 min in memory (like `WorkflowCacheManager`).

2. **Persist Non-LoRA Model Metadata On-Demand**
   * We _do not_ migrate all checkpoint data into Mongo up-front.
   * When a model is first referenced (UI browse or workflow execution), we upsert a stub document in `modelsDb` with `{ name, category, source: 'comfy_fs', discoveredAt }`.
   * This keeps DB lean but lets us attach future analytics or ownership data.

3. **Create a _ModsMenuModal_ (Web) & extend _ModsMenuManager_ (Telegram)**
   * Factor a shared *ModelMenuCore* that provides category pagination, search and detail views; rendered differently for Web (HTML modal) and Telegram (inline-keyboard pages).
   * Categories appear as tabs: **Checkpoints · LoRAs · Upscalers · Taggers · …**
   * For LoRAs we continue to enrich with DB metadata (trainer, price, favourite status).
   * For checkpoints and other FS-only assets we show file metadata (size, SHA) and allow quick selection.

4. **Quote / Pricing Support**
   * `SpellsService.quoteSpell()` to call `ModelDiscoveryService.getModelStats()` so cost estimation can include checkpoint runtimes once we record them.

## Consequences

* Users have a single, consistent UI (web & Telegram) to browse **all** models.
* Backend gains an abstraction (`ModelDiscoveryService`) that decouples model enumeration from storage implementation.
* Minimal DB bloat: only touched models are stored.
* Requires Comfy-Deploy API update or worker-side helper endpoint/script.
* New caching layer must invalidate correctly on model deploy / delete events.

## Alternatives Considered

* **Import every checkpoint into Mongo at startup.** Rejected due to cold-start penalty & unnecessary data duplication.
* **Maintain separate menus per model type.** Would fragment UX and duplicate code.
* **Rely solely on front-end filesystem polling via WebSockets.** Not viable for Telegram clients and leaks internal paths. 

## Implementation Progress (2025-08-01)

* ✅ Added `ModelDiscoveryService` (see `src/core/services/comfydeploy/modelDiscoveryService.js`).
  * Pulls `/api/volume/private-models` (Volumes API) **and** `/api/search/model?provider=all` via existing ComfyUIService.
  * Scrapes `WorkflowCacheManager` enum inputs for additional model names.
  * Provides `listModels({ category, provider })` with optional filtering.
* 🔄 Next: expose this via ModsMenu (web & telegram) and cache results for 10-min TTL. 

### Progress Summary (2025-08-01 ‑ session)

1. **Model catalogue access**
   • Confirmed `/api/volume/private-models` returns 611 items (34 checkpoints, 284 LoRAs, 8 VAEs, 4 upscalers, 4 embeddings, plus misc dirs).  
   • Updated `scripts/comfyui_api_utils/listModels.js` to call this endpoint directly and print category counts & full listings.

2. **Combined discovery layer**  
   • Implemented `src/core/services/comfydeploy/modelDiscoveryService.js`  
     – Pulls private-volume list and search-API catalogue.  
     – Scrapes every `ComfyUIDeployExternalEnum` that looks like a *model selector* from `WorkflowCacheManager` to augment the list.  
     – Offers `listModels({ category, provider })` with checkpoint/lora/upscale/tagger/embedding/vae filters.  
     – Caches via WorkflowCacheManager, sharing the same initialisation path.

3. **Probe script**  
   • Updated `scripts/comfyui_api_utils/listModels.js` to use `ModelDiscoveryService` and accept optional category arg.  
   • Verified checkpoint listing works; lists 34 checkpoints from private volume.

4. **ADR updated** with implementation progress section.
5. **Web UI integration**  (2025-08-06)  
   • Implemented `ModsMenuModal` in web sandbox (`src/platforms/web/client/src/sandbox/components/ModsMenuModal.js`) with matching CSS.  
   • External API `/api/v1/models` hooked into modal; category counts and lists load from cache.  
   • Added nav link handler in `sandbox/index.js` to open modal.  
   • Next: selection callback will create appropriate nodes / parameters in canvas.

6. **Path-based filtering & DB LoRA integration** (2025-08-08)  
   • Internal Models API now filters by exact volume sub-folders: `checkpoints/`, `upscale_models/`, `embeddings/`, `vae/`, `controlnet/`, `clipseg/`.  
   • LoRA category now served from Mongo `loraModels` instead of filesystem.  
   • Eliminated expensive `WorkflowCacheManager` calls on each request by skipping workflow-enum scraping for /models routes.  
   • ModsMenuModal category list updated to: **checkpoint · lora · upscale · embedding · vae · controlnet · clipseg**.  
   • First load is now ~2 s vs 15 s previously; no more ToolRegistry spam.

7. **Favorites workflow shipped** (2025-08-08)
   • Added generic `modelFavorites` structure in `UserPreferencesDB` with per-category arrays and API endpoints.
   • Internal routes:`/internal/v1/data/users/:id/preferences/model-favorites` (GET/POST/DELETE).
   • External proxy routes:`/api/v1/user/me/preferences/model-favorites`.
   • `ModsMenuModal` now shows heart icons, fetches favorites, toggles state with CSRF protection and optimistic UI update.
   • Upsert conflict fixed (`preferences` path) – verified 200/304 responses and correct DB writes.

### Pain Points / Outstanding Issues

1. **LoRA detection**  
   • Search-API returns LoRA entries with `type:"loras"` and `save_path:"loras"`.  
   • Initial regex only matched singular `lora`; probes showed zero LoRA matches.  
   • Regex broadened (`/lora(s)?/`) – needs retest to confirm counts.

2. **Workflow enumeration latency**  
   • Scraping enums requires full `WorkflowCacheManager.initialize()` which fetches ~48 deployments and hundreds of workflow versions – several seconds & API calls.  
   • This is acceptable for server startup but sluggish for ad-hoc CLI probes.  
   • Consider persisting enum extraction into its own cache file or adding TTL-based memoisation in `ModelDiscoveryService`.

3. **Category classification**  
   • Some models (e.g., TAESD VAE approximations) don’t neatly fit checkpoint/LoRA naming conventions.  
   • Current heuristic uses `type` and `save_path`; may need refinements (embedding vs VAE vs misc).

4. **Serverless worker asset listing**  
   • `/api/assets` is not available on Modal serverless endpoints – cannot directly list files on disk.  
   • Relying on search catalogue + workflow enums is adequate for menu browsing but not for verifying local presence.

5. **Eventual menu integration**  
   • `ModsMenuModal` & `ModsMenuManager` still hard-code LoRA APIs; need injection of `ModelDiscoveryService`.  
   • UI pagination & search UX to be designed.

### Next Steps (planned)

1. **Canvas Integration** – When a model is selected the modal should:
   • For checkpoints / VAE / ControlNet etc.: inject a `StringSelector` input value in the active node or create a new *loader* node pre-wired.
   • For LoRA: call LoRA resolution service to map slug → trigger string and pre-insert into prompt window.

2. **Search & Pagination** – Add client-side search box and lazy loading for categories with >200 items (esp. LoRAs).

3. **Preview Metadata** – Fetch `GET /models/:category/:name/meta` to display size, SHA256 and sample image (once available).

4. **Caching** – Persist last successful `/models/stats` + category lists in localStorage with a 10 min TTL to avoid network calls while browsing.

5. **Permissions** – Hide private LoRAs unless the current user has access (requires `loraPermissions` check via internal API). 

### Planned Enhancements (2025-08-08)

The following improvements have been identified for the next iteration of the Mods Menu & Model Browser:

1. **Favorites Workflow**
   • ✅ Replaced the “+” add button with a *heart* icon throughout Web UI (telegram pending).
   • ✅ Clicking the heart toggles the model in the user’s *favorites* list, persisted via `UserPreferencesDB`.
   • ✅ Extended `UserPreferencesDB` and related APIs to support per-category favorites (`checkpoint`, `lora`, `vae`, `upscale`, `embedding`, `controlnet`, `clipseg`).

2. **LoRA Category Deep-Dive**
   • LoRAs need richer metadata (trainer, trigger words, price, favourite status) and dedicated pagination.
   • The LoRA section will fetch from `loraModels` collection instead of filesystem and allow filtering by tags, owner, and price tier.

3. **Model Detail View**
   • Selecting a model should open a detail panel/page showing description, preview samples, tags, ratings, size, SHA, and ownership info.
   • For LoRAs, include trigger phrases and training provenance.
   • Provide ‘Favourite’, ‘Purchase/Quote’, and ‘Insert into Canvas’ actions.

These items will be tackled in order, starting with the Favorites workflow. 

### LoRA Category Deep-Dive – Detailed Implementation Plan (2025-08-08)

**Goal**  
Provide a dedicated LoRA browser that supports server-side category filters, rich detail view, and feature parity across Web & Telegram.

```
Web / Telegram UI → External API (/api/v1/models/lora) → Internal API (/internal/v1/data/loras/…) → ModelDiscoveryService + loraModels DB
```

#### Implementation Checklist

1. **DB & Data Model**  
   • Add `category` enum field to `loraModels`.  
   • Back-fill existing documents; add compound index `{ category, checkpoint, priceUSD, tags }`.

2. **Service Layer**  
   • Extend `ModelDiscoveryService.listLoras({ category, checkpoint, tags, priceTier, sort, page, limit, userId })`.  
   • Cache results for 10 min keyed by full filter signature.

3. **Internal API**  
   • `/internal/v1/data/loras/list` accepts new query params (`category`, `tags`, `owner`, `priceTier`, `sort`).  
   • `/internal/v1/data/loras/:id` already returns favourites flag; ensure it now includes `category`.

4. **External API Gateway**  
   • Add `/api/v1/models/lora` that proxies to the internal list endpoint with identical query options.

5. **Telegram (`ModsMenuManager.js`)**  
   • Replace hard-coded `type_character` / `type_style` with dynamic category list from `/internal/v1/data/loras/categories`.  
   • Pass new filters to `/internal/v1/data/loras/list`.  
   • Detail view continues using `/loras/:id`.

6. **Web (`ModsMenuModal.js`)**  
   • Fetch categories on modal open to render sidebar tabs.  
   • On tab click call `/api/v1/models/lora?category=<tab>&…`.  
   • Implement search box + infinite scroll; show favourites heart, price, owner.

7. **Sorting & Popularity**  
   • Pre-compute 30-day usage counts into Redis key `loraPopular:<date>` surfaced via `sort=popular`.

8. **Testing**  
   • Unit: `modelDiscoveryService.spec.js`, `userPreferencesDb.spec.js`.  
   • Integration: extend `scripts/testing_helpers/run-tests.ps1` to spin up in-memory Mongo, insert sample data, and hit APIs.

9. **Roll-out Steps**  
   1. Deploy migration & indexes.  
   2. Deploy backend services.  
   3. Release Web assets.  
   4. Restart Telegram bot.  
   5. Monitor API logs & query performance. 