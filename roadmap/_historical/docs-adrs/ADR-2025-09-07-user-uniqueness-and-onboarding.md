# ADR-2025-09-07 — User Uniqueness Enforcement & Web On-Boarding Flow

## Status
Accepted

## Context
Duplicate `userCore` documents were historically allowed when concurrent requests inserted the same Telegram ID or wallet address before look-ups completed.  In addition the Web front-end could open wallet flows before any `userCore` record existed, causing 500 errors.

## Decision
1. **Database-level uniqueness**
   * Unique indexes added:
     ```js
     db.userCore.createIndex({ 'platformIdentities.telegram': 1 }, { unique: true, sparse: true });
     db.userCore.createIndex({ 'wallets.address': 1 }, { unique: true, sparse: true });
     ```
2. **Service guards**
   * `UserCoreDB.addWallet` now normalises address → lowercase, uses `$addToSet`, and throws `Wallet address already exists` when conflict detected (including `E11000`).
   * `UserCoreDB.findOrCreateByPlatformId` switched to atomic **find-one-and-update with `upsert:true`** to avoid race conditions.
3. **API responses**
   * `POST /users/:id/wallets` returns **409 Conflict** with
     ```json
     { "error": { "code":"CONFLICT", "message":"Wallet address already exists.", "details":{"address":"0x…"}} }
     ```
4. **Web front-end onboarding**
   * `public/js/auth.js` introduces `ensureUserCore()` which runs after JWT validation, calling
     `POST /internal/v1/data/users/find-or-create` with `platform:'web'` and `platformId` = JWT `sub` or an anonymous UUID stored in `localStorage`.
   * The returned `masterAccountId` is cached and exposed via `window.auth.getMasterAccountId()`.
   * Wallet/points UI waits for profile initialisation; failure blocks the modal with an alert.

## Consequences
* Duplicate records for Telegram IDs or wallet addresses are now impossible; late-arriving inserts receive 409 instead of 500.
* All front-end wallet operations are guaranteed to have a valid `masterAccountId`.
* Migration scripts cleaned historical duplicates prior to index creation.

## Log / Implementation Notes
* Migration & index addition script: see `scripts/migrations/2025_09_user_uniqueness.js` (committed with this ADR).
* Deployed to staging 2025-09-07; no production incidents observed.
