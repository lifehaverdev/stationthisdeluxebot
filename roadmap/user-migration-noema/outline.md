# User Migration to Noema DB — Outline

## Problem Statement
Legacy users stored in MongoDB with wallet connections and experience (exp) need to transition seamlessly to the new Noema database so they can continue creating via Telegram without disruption. Failure to migrate would result in loss of user accounts, balances, and trust.

## Vision
A one-time migration pipeline moves qualifying legacy users into Noema, creating `masterAccount`, `walletLink`, `telegramAccount`, and initial `creditLedger` records with points converted from exp. The process is transparent, idempotent, and fully audited.

## Acceptance Criteria
- Users with a connected Ethereum wallet and exp > 0 receive a new master account in Noema.
- Points are credited at a 1:1 ratio with exp (subject to ADR updates).
- Telegram account is linked to the master account.
- A credit ledger entry records the initial points grant with proper metadata.
- Migration script can be dry-run and is idempotent.
- Comprehensive logs and reports are generated.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Schema Analysis | Automated scripts generate legacy & Noema schema reports | 2025-09-05 |
| Mapping Definition | ADR finalizes field-mapping and conversion rules | 2025-09-07 |
| Migration Script | End-to-end migration implemented and unit-tested | 2025-09-10 |
| Dry-Run Verification | Backtesting dataset shows 100% success on staging | 2025-09-12 |
| Production Rollout | Migration executed with monitoring + fallback | 2025-09-15 |

## Dependencies
- Internal API endpoints for account creation and ledger crediting
- MongoDB access to legacy database
- Noema DB credentials and staging environment
