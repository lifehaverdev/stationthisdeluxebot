# Handoff – Chain-Aware Buy Points Modal

**Date:** 2025-08-26

## Change Summary
1. Added foundationConfig.js – central source of Foundation contract addresses keyed by chainId.
2. Refactored contracts index to consume foundationConfig instead of env var.
3. External API: new /points/supported-chains route exposing available deployments.
4. BuyPointsModal.js:
   • Fetches supported chains on init.
   • Warns immediately if user is on unsupported chain.
   • Custom alert lists valid chains and triggers wallet_switchEthereumChain (+ addEthereumChain fallback).
   • Wallet/chain banner added at top of modal.
   • chainChanged listener keeps UI in sync.
5. Sprint log updated (Day 4 complete).

## Affected Files
- src/core/services/alchemy/foundationConfig.js
- src/core/contracts/index.js
- src/api/external/index.js
- src/platforms/web/client/src/sandbox/components/BuyPointsModal/buyPointsModal.js
- roadmap/chain-aware-token-config/sprints/2025-08-25/SprintLog.md
- roadmap/master-outline.md (new module row)

## Follow-Ups
- Add mainnet Foundation address to foundationConfig after deployment.
- Remove debug console logs from tokenConfig once stable.
- Consider e2e test: open modal on unsupported chain, ensure alert shows.

---
