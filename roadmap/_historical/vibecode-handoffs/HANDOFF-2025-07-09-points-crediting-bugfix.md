> Imported from vibecode/handoffs/HANDOFF-2025-07-09-points-crediting-bugfix.md on 2025-08-21

# HANDOFF: 2025-07-09 Points Crediting Bugfix

## Summary
- Fixed a critical bug where users were quoted the correct number of points for deposits, but received nearly zero points after deposit processing.
- Centralized all token funding rates and decimals in a new shared config (`src/core/services/alchemy/tokenConfig.js`) to ensure consistency between quoting and crediting logic.
- Removed all protocol markup logic; the funding rate is now the only markup mechanism.
- Refactored both the quote API and CreditService to use the shared config.

## Root Cause Analysis
- The quote endpoint correctly calculated USD value as `amount * price * fundingRate`.
- The CreditService (actual crediting logic) calculated USD value as `amount * fundingRate`, **omitting the price**.
- This caused deposits to be credited as if 1 ETH = $1, resulting in users receiving almost no points.
- Additionally, funding rates and decimals were duplicated and could drift out of sync between the quote and crediting logic.

## What Was Changed
- Fixed the USD calculation in CreditService to always multiply the ETH amount by the current price before applying the funding rate.
- Created `src/core/services/alchemy/tokenConfig.js` as the single source of truth for token funding rates and decimals.
- Refactored both the quote API (`src/api/internal/pointsApi.js`) and CreditService (`src/core/services/alchemy/creditService.js`) to use the shared config.
- Removed all protocol markup logic and referral payout logic tied to markup.
- Added TODOs in all relevant files to ensure future changes use the shared config.

## Next Steps
- Monitor deposit/crediting flow to ensure users receive the correct number of points as quoted.
- Update or add regression tests to cover this bug.
- Continue to centralize any other token-related logic (e.g., icons, names) as needed.
- Document any further changes or edge cases in follow-up handoffs.

## Open Questions
- Are there any other places in the codebase where token funding rates or decimals are duplicated?
- Should we add a user-facing warning that actual points may vary slightly due to gas cost fluctuations?

---

**Contact:** AI Agent (see AGENT_COLLABORATION_PROTOCOL.md for escalation) 