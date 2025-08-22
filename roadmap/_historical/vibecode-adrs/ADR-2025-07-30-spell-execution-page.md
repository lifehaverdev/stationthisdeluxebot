> Imported from vibecode/decisions/adr/ADR-2025-07-30-spell-execution-page.md on 2025-08-21

# ADR-2025-07-30: Dedicated Spell Execution Page

## Context
Currently, users run and iterate on their spells exclusively inside the Sandbox workspace (`/sandbox/index.js`).  This flow is perfect for authoring and experimentation, but it does **not** support easily sharing a finished spell with the wider internet:

1. There is no stable, public-facing URL that can be shared.
2. Visitors cannot see the spell’s required inputs or try it without loading the full Sandbox (heavy, confusing for non-creators).
3. There is no integrated on-chain quote / payment step, so spell creators cannot monetise their work.

The product team has identified a critical need for a **dedicated spell execution page** reachable under

```
https://noema.art/spells/<spell-slug>
```

that lets anyone:

* View spell metadata (author, description, image thumbnail).
* Provide the required inputs in a lightweight form.
* Receive a real-time cost quote based on historical average execution time of each component.
* Connect a wallet and pay the quoted fee.
* Receive the generated output(s) once execution completes.

This feature supports two strategic goals:

1. Enable creators to **monetise** their spells directly on the platform.
2. Encourage **viral sharing** – every spell effectively becomes a mini-landing-page that markets the platform.

## Decision
We will introduce a new top-level route and micro-frontend:

* **Route**: `GET /spells/:slug` served by the Web platform.
* **Frontend** (React/HTMX, TBD):
  * Fetch spell metadata from `GET /api/spells/:slug`.
  * Render a dynamic form based on the spell’s declared inputs.
  * On input change, call `POST /api/spells/:id/quote` to receive a gas/credit quote.
  * If the user is not authenticated or wallet-connected, prompt the built-in wallet connector.
  * After successful payment, call `POST /api/spells/:id/execute` and stream progress/results.
* **Backend** additions (Core → Alchemy Service):
  * `GET /api/spells/:slug` – returns spell JSON plus component graph meta.
  * ~~`POST /api/spells/:id/quote`~~ **(replaced – see below)**
  * **`GET /api/spells/:slug/quote` –** returns the latest cached quote (fallback to on-the-fly calculation if stale >1 h).  Public, no CSRF required.
  * **Automatic quote injection** – the `GET /api/spells/:slug` metadata response now inlines `avgCostPtsCached` and `avgRuntimeMsCached` so the first page load already shows an estimated cost without an extra network round-trip.
  * `POST /api/spells/:id/execute` – existing workflow runner; extend to accept prepaid credit reference.
* **Payments**: Re-use existing credit / wallet charging flow.  The quote step will reserve credits; unused credits are refunded on completion timeout/failure.
* **Incentive routing**: A configurable percentage of the paid points is forwarded to the spell creator.  If the creator has an active **Referral Vault**, payouts are deposited there; otherwise they default to the creator’s main balance.  This maximises creator upside while reinforcing the existing referral-based growth loop.
* **Point pre-purchase UX**: When a visitor lacks sufficient points, the UI prompts them to top-up with the *quoted cost + safety margin* in a single click before execution proceeds.
* **Data model**: Add `publicSlug` and `isPublic` fields to the `spells` table; ensure slugs are unique.
* **Analytics integration**: At service startup the `ToolRegistry` (or a dedicated `SpellStatsService`) scans the analytics DB for the last **N = 10** successful executions per component, calculates `avgRuntimeMs` and `avgCostPts`, and attaches those values to each tool definition.  The same job runs hourly in the background to keep numbers fresh; this removes the need for a separate long-running pipeline while still providing near-real-time quotes.

## Consequences
* **Pros**
  * Unlocks direct revenue for creators and for Noema (platform fee cut).
  * Lightweight page improves SEO and shareability compared to the full Sandbox.
  * Separation of authoring vs. consumption keeps UX focused.
* **Cons / Risks**
  * Exposes execution service to potentially higher, spiky load.
  * Accuracy of runtime/cost estimates depends on representativeness of the most recent runs; outliers may skew quotes.
  * New payment flow surface increases legal/compliance scope.

## Alternatives Considered
1. **Keep using Sandbox URLs** – Rejected; heavy load, poor onboarding, no payment.
2. **Static pre-rendered outputs** – Rejected; defeats purpose of interactive generative spells.
3. **Marketplace-style listing page only (no execution)** – Rejected; friction still too high, no viral “try now” experience.

---

*Status*: In Progress – Phase 1 completed (2025-07-30). 

## Implementation Plan (Phased)

### Phase 0 – Schema & Data Preparation
✅ **Completed 2025-07-30**
1. **DB migrations** (`scripts/migrations/2025_07_add_spell_public_slug.js`)
   * Add `publicSlug` (unique), `isPublic` and `avgCostPtsCached` to `spells` collection.
   * Create `spell_component_stats` collection for runtime history.
2. **Seed script** – back-fill `publicSlug` for existing spells.

### Phase 1 – Backend API Surface
✅ **Completed 2025-07-30**
* **Files touched**
  * `src/api/internal/spellsApi.js` – add:
    * `GET /spells/:slug` (metadata) – already exists, ensure public access.
    * `POST /spells/:id/quote`
    * `POST /spells/:id/execute`
  * `src/api/external/index.js` – expose new endpoints to web client.
  * `src/core/services/SpellsService.js` – implement `quoteSpell()` leveraging ToolRegistry stats.
  * `src/core/services/analytics/SpellStatsService.js` (new) – aggregation helpers.

Phase 1 backend endpoints **updated**:
Internal API (src/api/internal/spellsApi.js)
* **GET /internal/v1/data/spells/public/:slug/quote** – returns cached or freshly computed quote, no auth, no CSRF.
* Existing `quoteSpell()` logic moved to `SpellStatsService` and shared by both the hourly refresher and the on-demand GET route.
Core service (src/core/services/SpellsService.js)
* `getCachedQuote()` helper returns `{ totalCostPts, totalRuntimeMs, updatedAt }`.
* If cache older than 1 h, triggers recompute asynchronously and returns stale value with `x-data-stale: true` header.
External API (src/api/external/spellsApi.js)
* **GET /api/v1/spells/:slug/quote** proxies to the internal public quote route with no CSRF middleware applied (explicitly in router order).
* Frontend can therefore call it safely from a static page w/out session.
This completes Phase 1 of the ADR implementation and respects the “no direct DB access outside internal API” rule: all aggregation happens through the internal GenerationOutputs DB service.
Additionally, by caching `avgCostPtsCached` on the spell itself, the external metadata call already contains a ball-park price.  The separate quote route exists for up-to-the-second pricing but is optional for first-paint UX.

### Phase 2 – ToolRegistry Stats Injection
* **File** `src/core/services/tools/ToolRegistry.js`
  * On init, call `SpellStatsService.getAvgStats(toolId)` and attach `avgRuntimeMs` / `avgCostPts`.
  * Hourly `refreshStats()` scheduled via existing `TaskScheduler`.

Phase 2 – ToolRegistry stats injection is implemented.
Key additions:
src/core/services/analytics/SpellStatsService.js (NEW)
Computes average runtime & point-cost per tool from generationOutputs (last N=10 completed runs).
Caches results and exposes getAvgStats() and enrichToolRegistry().
startAutoRefresh() schedules an hourly refresh of ToolRegistry stats.
src/core/services/index.js
SpellStatsService imported and instantiated after DB services.
Immediately enriches ToolRegistry once, then sets hourly refresh.
Exposed as spellStatsService in the returned services map.
Tool definitions automatically gain avgRuntimeMs and avgCostPts fields at startup and are refreshed hourly—no changes to ToolRegistry code needed.
This fulfils ADR Phase 2: ToolRegistry now holds live average-cost/runtime hints for every tool, ready to be displayed or used for further pricing logic.

### Phase 3 – Payment & Incentive Flow
* **Files**
  * `src/core/services/alchemy/creditService.js`
    * Add `chargeSpellExecution(userId, spellId, quote)` returning `creditTxId`.
    * After success, route creator share: `routeReferralOrCreatorShare(spell.creatorId, amount)` using existing referral-vault helpers in `creditLedgerDb`.
  * `src/api/internal/pointsApi.js` – expose helper to top-up points from frontend.

Phase 3 – Payment & Incentive flow foundations are in place.
New logic inside CreditService:
chargeSpellExecution(payerAccountId, spellId, quote, creatorSharePct = 0.7)
 – Verifies user has sufficient on-chain credit (ledger deposits).
 – Deducts the quoted points from the user’s cheapest deposits first.
 – Looks up the spell to identify the creator.
 – Calculates creator share (default 70 %) and forwards it via the helper below.
 – Returns { creditTxId, pointsCharged } for the execution request to store/forward.
routeReferralOrCreatorShare(creatorAccountId, points, meta)
 – If the creator already has a referral vault, this will be extended in future to deposit there; for now it credits a reward entry directly to the creator.
 – Uses creditLedgerDb.createRewardCreditEntry so the share is visible in the ledger.
These methods leverage existing aggregation helpers (findActiveDepositsForUser, deductPointsFromDeposit, createRewardCreditEntry) and require no direct withdrawals, matching the “donate custody” model referenced in the contract.
Next integration steps (not yet coded):
Update spell-execution endpoint to call creditService.chargeSpellExecution() before running the workflow and pass the returned creditTxId downstream.
Extend the front-end execution flow to:
 • Fetch quote →
 • Check currentPoints < quote.totalCostPts → show top-up modal (handled separately) →
 • Call execute endpoint with the creditTxId.
With the core charging path in place, we’re ready to wire this into spells execution and then surface the UX (Phase 4).

### Phase 4 – Frontend Page & UX
* **Router update** `src/platforms/web/index.js` (or `client/src/router.js`) – add `'/spells/:slug'`.
* **New component** `src/platforms/web/client/src/pages/SpellExecutePage.js`:
  1. `useEffect` → fetch metadata.
  2. Render dynamic input form.
  3. “Estimate Cost” button hits `/api/spells/:id/quote`.
  4. If insufficient points → open existing BuyPointsModal with recommended amount.
  5. “Run Spell” button → `execute` endpoint; stream output; display results grid.
* **API helpers** `client/src/api/spells.js`.
* **Marketing share link** copy-to-clipboard.

### Phase 5 – Observability & QA
1. **Telemetry** – emit `spellExecutionStarted|Finished` events from backend.
2. **Playwright test** `vibecode/demos/spell_execution_page.spec.ts` – cover happy path.
3. **Load testing** script in `scripts/testing_helpers/run-spell-loadtest.js`.

### Phase 6 – Documentation & Launch
* Update public docs in `public/docs/content/spell-execution.md`.
* Add tutorial blogpost stub.

---
*ETA*: ~1 week dev elapsed time assuming 1 engineer. 
*Dependencies*: DB migration window, front-end build pipeline. 

## Implementation Notes (2025-07-31)

* While wiring the public spell endpoint, we discovered that the external route `/api/spells/:slug` must proxy to a **public** internal endpoint that bypasses internal-client auth.  Added:
  * `GET /internal/v1/data/spells/public/:publicSlug` (internal, no auth)
  * external route now calls this path.
* Restart required: file edits on `spellsDb.js` / `internal/spellsApi.js` need a full Node reload.  Incorrect 404s can appear if the process is hot-reloading inconsistently.
* The `spells` schema currently carries overlapping visibility flags:
  * `visibility` ("public/private/unlisted")
  * `permissionType` ("public/private/licensed")
  * `isPublic` (boolean) – added in July migration
  
  We now rely solely on `isPublic` + `publicSlug` for the shareable page.  Future clean-up: deprecate redundant fields or add a consistent resolver in `SpellsDB`. 

### Next Steps (2025-08-01)

1. **Quote on Creation**
   • When a new spell is saved (`POST /spells`) the backend must immediately compute a quote (avgCostPts + avgRuntimeMs) using `SpellStatsService.quoteSpell()` and persist the values on the spell document as `avgCostPtsCached`/`avgRuntimeMsCached`.
   • The create-spell flow fails hard if the quote cannot be generated (e.g. missing steps) – the spell has to be fixable before it can be minted.

2. **Slug Guarantee for Public Spells**
   • When a spell is toggled to `isPublic=true`, ensure `publicSlug` is set (defaults to primary `slug` if absent).
   • Validation rule: you cannot publish a spell without a `publicSlug` or cached quote.

3. **Spell-Execution Modal (Frontend)**
   UX sequence for visitors who are **not signed-in**:
   1. User clicks "Run Spell".
   2. Modal #1 – **Connect Wallet** using existing wallet-selector component.
   3. Modal #2 – **Choose Currency** (points, USDC, ETH, etc.) and show price from `avgCostPtsCached` converted client-side.
   4. Modal #3 – **Confirm Payment** (on-chain or internal points deduction). Once TX hash / points receipt confirmed, proceed.
   5. **Execution Progress** modal – live timer, per-step log stream via existing WebSocket events.
   6. **Result View** – final outputs + step artefacts; “Run Again” button resets state.

   All three modals reuse existing sandbox components (`BuyPointsModal`, `WalletConnectDialog`, `ResultContent`) with minimal styling tweaks.

4. **API surfaces**
   • `POST /api/v1/payments/prepare-spell` – body { spellSlug, paymentAsset } → returns quote, payment amount, invoiceId.
   • `POST /api/v1/payments/confirm` – body { invoiceId, txHash } → validates & reserves points, returns `creditTxId`.
   • `POST /api/v1/spells/cast` – body { slug, creditTxId, context } (no CSRF – secured via invoice token).

5. **Analytics update**
   After a successful run the execution service recomputes the rolling average for affected tools and updates all impacted spells’ cached values asynchronously. 