# ADR: Multichain Service Refactor – 2025-09-10

## Status
Accepted / Implemented

## Context
StationThis originally assumed a single Ethereum network (mainnet) for all on-chain
activity.  With upcoming Arbitrum/Base roll-outs we needed every API layer and core
service to resolve the proper `ethereumService` + `creditService` pair by `chainId`.

Key constraints
1. Preserve legacy aliases (`creditService`, `ethereumService`) for existing modules.
2. Webhook & REST entry points must specify chain deterministically (URL param,
   query, or body).
3. Only the **internal API** may touch the database (policy).  All callers adjusted.

## Decision
1. Core bootstrap now initialises **maps**
   ```js
   const ethereumServices = { [chainId]: new EthereumService() }
   const creditServices   = { [chainId]: new CreditService()  }
   ```
   plus legacy singletons pointing to `chainId = '1'`.
2. Helper exported:
   ```js
   const getChainServices = cid => ({
     creditService  : creditServices[cid] || legacyCredit,
     ethereumService: ethereumServices[cid] || legacyEth,
   })
   ```
3. API modules patched:
   * `pointsApi`, `actionsApi`, `webhookApi`, `referralVaultApi`  
     resolve services via `getChainServices` (default `'1'`).
4. Alchemy webhook route changed to `/webhook/alchemy/:chainId?` (optional param).
5. `foundationConfig.js` now exposes per-chain `FOUNDATION_ADDRESSES` **and**
   `CHARTER_BEACON_ADDRESSES` helpers.
6. `SaltMiningService` rebuilt to load beacon address + defer bytecode dependency.
7. `CreditService` receives `saltMiningService` + `webSocketService` via deps.
8. Contracts index keyed by chainId strings (`'1'`, `'11155111'`, …).

## Consequences
* New chains can be activated by adding RPC env var + addresses in
  `foundationConfig.js`; no code changes.
* Legacy callers untouched.
* Referral-vault endpoints now operational cross-chain once CreditService per
  chain is initialised.

## Implementation Log
- **2025-09-10 10:15**  Added maps & helper in `core/services/index.js`.
- **2025-09-10 11:20**  Patched `pointsApi` for chain-aware purchase flow.
- **2025-09-10 12:05**  Refactored `webhookApi` route `alchemy/:chainId?`.
- **2025-09-10 13:40**  Rewrote `SaltMiningService` loader; removed raw bytecode
  requirement.
- **2025-09-10 14:10**  Boot sequence order fixed – create `saltMiningService`
  before iterating chains.
- **2025-09-10 14:45**  Contracts map updated; mainnet/sep test addresses added.
- **2025-09-10 15:00**  End-to-end dev start verified; Telegram platform alive.

---
*Author: multichain-upgrade squad*
