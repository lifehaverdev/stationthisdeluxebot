# ADR-2025-09-05: Legacy User Migration to Noema DB

## Context
StationThis previously stored user data in multiple Mongo collections (`users_core`, `users_economy`, `users_preferences`). Users accrued **exp** (experience points) and many linked an Ethereum wallet via the bot. The new Noema DB introduces consolidated documents and a credit-ledger–based points economy. We need a deterministic one-off migration so loyal users retain their progress when the Telegram bot switches to Noema.

## Decision
We will execute an offline migration pipeline that:
1. **Targets** only legacy users whose `wallets` array contains at least one `{ type: 'CONNECTED_ETH', address: /^0x/ }` and whose `users_economy.exp > 0`.
2. For each target:
   | Legacy Source | New Collection | Field Mapping / Notes |
   |---------------|---------------|-----------------------|
   | `users_core.userId` | `masterAccount.platformIdentities.telegram` | As string |
   | `wallets` (ETH entries) | `masterAccount.wallets[]` | Copy `address`, mark `isPrimary` if `active===true` |
   | `users_economy.exp` | **Points grant** | `points = exp` (1:1) |
   | — | `creditLedger` | Insert entry: `{ type: 'MIGRATION_BONUS', points, ref: 'legacyExp', meta: { exp } }` |
   | — | `creditLedger` | Insert entry: `{ type: 'MIGRATION_INFO', detail: 'Auto-created from Mongo migration 2025-09-05' }` |
3. The migration script will POST to internal API endpoints: `/internal/masterAccounts`, `/internal/creditLedger`, `/internal/walletLinks` to create data; **no direct DB writes** outside internal API layer.
4. Non-qualifying users (no ETH wallet or exp <=0) will **not** be migrated.
5. The pipeline is idempotent: reruns skip accounts already present via `telegramId` or `wallet` unique constraints.

## Alternatives Considered
* Migrate all users regardless of wallet – rejected to minimise dormant data.
* Convert exp to USD credit – rejected; exp maps more naturally to points economy.
* Real-time migration on first login – rejected due to unpredictable traffic and API limits.

## Consequences
* 86 users (current count) will receive their accumulated exp as points at launch.
* Approximate points to be minted equals Σexp ≈ see extractor output (recalculated at runtime).
* Ledger provides full audit trail for compliance.
* Legacy DB can be retired after verification.

## Implementation Log
* 2025-09-05: Extractor script created, filtered to ETH wallets, produced 86 targets.
* 2025-09-05: Mapping rules approved in this ADR.
