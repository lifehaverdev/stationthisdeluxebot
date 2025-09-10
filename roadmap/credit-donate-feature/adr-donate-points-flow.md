# ADR: Introduce One-Tx “Donate” Path for Points Purchases

**Status:** Draft ☐ / Proposed ☑ / Accepted ☐ / Superseded ☐ / Deprecated ☐  
**Date:** 2025-09-08  
**Authors:** Protocol & Credits Team  
**Epic:** Points Economy  
**Module:** credit-donate-feature  

---

## 1. Context
The existing points purchase workflow uses `contribute()` then a backend-triggered `commit()`; the user pays gas twice and we carry withdrawable collateral risk. The Foundation contract already exposes a `Donation` event that represents an irrevocable transfer to platform custody requiring **only one transaction**.

## 2. Decision
We will add an alternative “Donate & Get More Points” path that:
1. Executes a **single** on-chain `donate()` call from the user wallet.
2. Emits the `Donation` event.
3. Grants the user a **higher funding rate** (`donationFundingRate`) defined per token in `tokenConfig.js`.
4. Has **no withdrawal option**; this irreversibility is clearly disclosed in the UI.
5. Uses the same WebSocket channel (`pointsDepositUpdate`) with `deposit_type = TOKEN_DONATION` so the existing modal flow can handle confirmation.
6. Extends backend APIs:
   - `POST /api/v1/points/quote` adds `mode` param (`contribute` default | `donate`).
   - `POST /api/v1/points/purchase` respects mode and returns either `{approvalTx, depositTx}` (contribute) or `{donationTx}` (donate).
7. **CreditService** path:
   - Webhook handler listens for `Donation` events, bypasses the unconfirmed-balance/commit logic and credits immediately.
   - Ledger rows store `deposit_type = TOKEN_DONATION`; points credited use `donationFundingRate`.
8. Analytics events added to track deal uptake.

## 3. Consequences
+ **Pros**
  • Better UX (1 tx).  
  • Marketing lever: more points.  
  • Lower contract carry risk.

− **Cons**
  • Irreversible: risk of user confusion → mitigated with confirm dialog + info popover.  
  • Smart-contract audits for donate path gas & edge-cases.

## 4. Alternatives Considered
1. Auto-convert small contributions to commit lazily – rejected (hidden gas fee, still two txs).
2. Prompt backend to call donate on behalf of user – rejected (custody/security).

## 5. Implementation Notes
• FE: add toggle/banner in Quote step; new colour accent to highlight extra points.  
• BE: extend `tokenConfig` with `donationFundingRate`; fallback to `fundingRate` if missing.  
• DB: add enum value `TOKEN_DONATION`; existing schema already stores deposit_type string.

## 6. Roll-out Plan
1. Ship to staging behind feature flag.  
2. A/B test banner copy.  
3. Gradual production rollout once monitoring shows stability.

## 7. Open Issues
- Accurate gas estimation for donate vs contribute (gas stipend differs).  
- Minimum/maximum donation caps?  
- Refund policy if mistake occurs (edge-case).  

---

*Implementation Log will be appended as work progresses.*
