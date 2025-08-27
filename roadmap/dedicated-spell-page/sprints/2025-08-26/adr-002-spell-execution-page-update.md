# ADR-2025-08-26: Spell Execution Page – Phase&nbsp;4-6 Consolidation

## Context
The original ADR (2025-07-30) established the vision, API surface, and phased rollout for a dedicated spell-execution page under `/spells/:slug`.  Since then the backend phases 0-3 have been **implemented** and partially deployed.  Front-end work (Phase 4) and final QA/documentation (Phases 5-6) remain outstanding.  New insights gathered during backend integration and from the *Sandbox Window Streaming* initiative (see `roadmap/sandbox-window-overhaul/adr/ADR-016-spell-execution-streaming.md`) warrant an **update** to the UX flow, API shape, and observability hooks before we proceed.

Key changes since the previous ADR:
1. **Streaming over SSE** is now the preferred transport for execution progress (mirrors Sandbox overhaul).
2. The payments team finalised the **invoice-token flow**, replacing two separate `prepare-spell` / `confirm` endpoints with a single idempotent `POST /api/v1/payments/invoice`.
3. **SpellStatsService** now refreshes tool-cost averages every **15 min** (down from hourly) and exposes a cache-invalidating webhook for manual triggers.
4. SEO requirements mandate public OpenGraph tags for shareability – requires an unauthenticated *metadata pre-render* endpoint at `/spells/:slug/og`.

## Decision
We will consolidate the remaining phases into one coordinated delivery batch (Phases 4-6) with the following adjustments:

* **Transport**: Use **Server-Sent Events (SSE)** at `GET /api/v1/spells/:slug/stream?creditTxId=<id>` to push `executionStarted`, `stepUpdate`, `executionFinished` events.  The endpoint reuses the existing WebSocket publisher internally but exposes them as text/event-stream for browsers without WS permissions.
* **Payments**: Replace the `prepare-spell` / `confirm` pair with `POST /api/v1/payments/invoice { spellSlug, asset } → { invoiceId, costPts, expiry }`.  The returned `invoiceId` doubles as a short-lived JWT token passed to the execute and stream endpoints for auth.
* **Execution**: `POST /api/v1/spells/cast { slug, invoiceId, context }` starts the run and returns `{ creditTxId, runId }`.
* **Public Metadata**: Add `GET /api/v1/spells/:slug/meta` (no auth) which includes pre-computed `avgCostPtsCached`, inputs schema, and OpenGraph fields.
* **Frontend**: Build a **Vanilla JS** (no framework) page in `public/js/spell-execute.js` that:
  1. Fetches metadata & renders input form.
  2. Calls `payments/invoice` then `spells/cast`.
  3. Opens SSE stream and updates progress UI.
  4. Renders outputs gallery on completion.
* **Observability**: Emit `spellExecutionError` alongside `Started/Finished` and add run-duration histogram in Prometheus.
* **SEO**: Pre-render HTML with proper OpenGraph tags via `og` route; use `<link rel="canonical">` for duplication avoidance.

## Alternatives Considered
1. **Keep WebSockets** – blocked by some corporate firewalls; SSE is less likely to be dropped and easier to polyfill.
2. **Two-step payment flow** (prepare/confirm) – more network round-trips and state to track; invoice-token encapsulates both steps and reduces race conditions.
3. **React micro-frontend** – heavier bundle (~45 KB gzip) than Vanilla + htmx (~8 KB).  Since the page is simple we opt for minimal dependencies.

## Consequences
* **Pros**
  * Reduced latency: single invoice call + SSE streaming.
  * Simpler state management on the client.
  * Better SEO and shareability.
* **Cons / Risks**
  * SSE limits to one-way traffic; cannot accept client pings (mitigated by reconnect logic).
  * JWT invoice token introduces expiry edge-cases.
  * Replacing endpoints is a breaking change; we need deprecation banner for preview users.

## Implementation Log
*2025-08-26* — Document created.  Further notes to be appended during development.
