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
  * `POST /api/spells/:id/quote` – calculates average runtime × pricing heuristic per component (requires new analytics table `spell_component_stats`).
  * `POST /api/spells/:id/execute` – existing workflow runner; extend to accept prepaid credit reference.
* **Payments**: Re-use existing credit / wallet charging flow.  The quote step will reserve credits; unused credits are refunded on completion timeout/failure.
* **Incentive routing**: A configurable percentage of the paid points is forwarded to the spell creator.  If the creator has an active **Referral Vault**, payouts are deposited there; otherwise they default to the creator’s main balance.  This maximises creator upside while reinforcing the existing referral-based growth loop.
* **Point pre-purchase UX**: When a visitor lacks sufficient points, the UI prompts them to top-up with the *quoted cost + safety margin* in a single click before execution proceeds.
* **Data model**: Add `publicSlug` and `isPublic` fields to the `spells` table; ensure slugs are unique.

## Consequences
* **Pros**
  * Unlocks direct revenue for creators and for Noema (platform fee cut).
  * Lightweight page improves SEO and shareability compared to the full Sandbox.
  * Separation of authoring vs. consumption keeps UX focused.
* **Cons / Risks**
  * Exposes execution service to potentially higher, spiky load.
  * New payment flow surface increases legal/compliance scope.

## Alternatives Considered
1. **Keep using Sandbox URLs** – Rejected; heavy load, poor onboarding, no payment.
2. **Static pre-rendered outputs** – Rejected; defeats purpose of interactive generative spells.
3. **Marketplace-style listing page only (no execution)** – Rejected; friction still too high, no viral “try now” experience.

---

*Status*: Proposed – awaiting discussion & approval. 