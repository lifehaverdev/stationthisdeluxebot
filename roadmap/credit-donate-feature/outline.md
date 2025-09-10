# Credit-Donate Feature Roadmap

**Created:** 2025-09-08

---

## 1. Problem Statement
Current points purchase flow uses the `contribute` function, which:
1. Requires two on-chain txs (contribute ➜ commit)
2. Makes the user pay gas twice and wait for backend confirmation
3. Leaves collateral withdrawable – increasing platform carry risk

We want to introduce an alternative `donate` path that:
• Requires only **one** transaction
• Irrevocably transfers funds to platform custody (no future withdrawal)
• Allows us to offer a *better* funding rate & reduced fees

Goal: Surface this as a compelling “deal” in the Buy Points modal while keeping the original contribute path available.

---

## 2. Success Criteria
- Front-end: Users see a clear option to switch to “Donate & get more points”.
- Back-end: `CreditService` detects on-chain `DonationRecorded` events (or equivalent) and credits points automatically without a second tx.
- Economic: Funding-rate table extended (tokenConfig) with `donationFundingRate` ≥ current fundingRate.
- UX: Completion rate for donate path ≥ 30% after release (tracked via analytics).

---

## 3. User Stories
| # | As a … | I want … | So that … |
|---|---------|---------|-----------|
| 1 | Points buyer | to see how many extra points I get if I donate | I can choose the best value |
| 2 | Risk officer | donations isolated from withdrawal liability | platform carry risk shrinks |
| 3 | DevOps | same websocket `pointsDepositUpdate` flow | minimal FE change |

---

## 4. Contract & Event Changes
- **Already present**: `event Donation(address funder, address token, uint256 amount, bool isNFT, bytes32 metadata);`
- We’ll listen for this `Donation` event (no commit step required).
- Params mapping: `funder → user`, `token`, `amount`, ignore `metadata` for now.
- No smart-contract change needed; update ABI in BE & FE bundles if not current.
- Contribution path remains unchanged.

Open Questions:
1. Do we reuse `ContributionRecorded` with a flag or add new event?
2. Fee handling: still reimburse gas or waive entirely?

---

## 5. Backend (`CreditService`) Impact
- Add webhook handling for donations.
- Skip unconfirmed-balance read & on-chain commit – treat as CONFIRMED instantly.
- Funding-rate lookup chooses `donationFundingRate`.
- New ledger `deposit_type = "TOKEN_DONATION"`.

---

## 6. Front-end (`buyPointsModal.js`) Flow
1. User reaches **Quote** step.
2. If donate supported for selected asset ➜ show "Get +X% more points by donating" banner with [ℹ︎].
3. Clicking “Accept deal” triggers `fetchQuote({mode:'donate'})`.
4. Review step shows boosted numbers; CTA text changes to “Donate & Buy Points”.
5. `initiatePurchase()` decides between contribute vs donate and constructs tx accordingly.

Modal Additions:
- Toggle/button to switch modes.
- Info popover explaining irreversibility.

---

## 7. API Changes
- `/api/v1/points/quote` accepts `mode` = `contribute` | `donate` (default contribute).
- `/api/v1/points/purchase` returns `donationTx` when mode=donate.

---

## 8. Economics & TokenConfig
```
TOKEN_CONFIG[address] = {
  symbol, decimals,
  fundingRate: 0.7,          // contribute
  donationFundingRate: 0.8,  // donate (example)
}
```
If `donationFundingRate` absent, fall back to existing `fundingRate`.

---

## 9. Analytics / Telemetry
- Track modal impressions, deal accept clicks, completion, drop-offs.
- Split-test banner copy after GA.

---

## 10. Risks
- User misunderstanding irreversibility → add confirm dialog.
- Contract gas estimation differences.
- Ledger/accounting divergence if donation mis-classified.

---

## 11. Milestones & Owners
| Date | Milestone | Owner |
|------|-----------|-------|
| 09-08 | Outline + ADR draft | PM/Protocol Team |
| 09-10 | Contract audit of donate flow | Solidity Lead |
| 09-12 | BE design PR (CreditService, API) | Backend Lead |
| 09-14 | FE design prototype & UX copy | Frontend Lead |
| 09-18 | End-to-end staging demo | QA |
| 09-20 | Production rollout | DevOps |

---

## 12. Open Questions
- Shall we auto-opt-in small deposits to donate?
- Marketing incentives (extra points, badge, leaderboard)?
- Minimum/maximum caps for donations?

---

## 13. Reference Docs
- `AGENT_COLLABORATION_PROTOCOL_v3.md`
- Existing `CreditService` flow diagrams
- Smart-contract spec v2.1

---

## 14. Implementation Task Board

| ID | Description | Status |
|----|-------------|--------|
| donate-tokenconfig | Extend `tokenConfig.js` to add `donationFundingRate` per token and helper `getDonationFundingRate()` | completed |
| quote-api-update | Update `/api/v1/points/quote` to accept `mode` param and use `donationFundingRate` for donate mode | completed |
| purchase-api-update | Update `/api/v1/points/purchase` to return `donationTx` and skip approval/commit flow for donate mode | completed |
| purchase-service-donate | Backend purchase service builds donation transaction payload (`donate()`) | completed |
| creditservice-donation | `CreditService` handles `Donation` event, immediate CONFIRMED ledger, uses `donationFundingRate` | completed |
| ws-notify-donate | WebSocket notification for donation confirmations/failures | completed |
| fe-modal-update | Front-end `buyPointsModal.js`: deal banner/toggle, info popover, quote(mode), purchase path | completed |
| abi-refresh | Refresh ABI bundles (FE & BE) to include donate() + Donation event | cancelled |
| tests-creditservice | Unit tests for `CreditService` donation flow | pending |
| tests-api | Integration tests for `/quote` and `/purchase` donate mode | pending |
| tests-e2e | Cypress E2E: user completes donate flow and sees receipt | completed |
| docs-update | Update user docs & roadmap statuses | in_progress |
| rollout-plan | Feature flag, staging rollout, monitoring hooks | pending |
