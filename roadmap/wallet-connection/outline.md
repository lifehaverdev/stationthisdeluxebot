# Wallet Connection Feature Outline

## Goal
Enable users to connect blockchain wallets via Telegram bot using *magic amount* deposit flow.

## Key User Flows
1. /wallet command or Dashboard → Connect triggers flow.
2. If user has wallets → inline list menu (+ Add Wallet).
3. "Add Wallet" or first time → bot calls `POST /wallets/connect/initiate`, instructs user to deposit magic amount.
4. CreditService monitors deposits; upon match, wallet linked.
5. `/status` and Wallet menu reflect new wallet; detail view available.

## API Endpoints
- `POST /wallets/connect/initiate` – returns `{ requestId, magicAmountWei, tokenAddress, depositToAddress, expiresAt }`
- `GET  /points/supported-chains` – used for messaging.

## Telegram Components
- `walletManager.js` – menu rendering, magic link initiation, callback router (`wallet:*`).
- `dashboardMenuManager.js` – Connect button → `walletManager.promptForWallet`.
- `bot.js` – registers walletManager handlers.

## Internal Logic
- CreditService `_handleMagicAmountLinking` finalises linking.
- Wallet verified=true, isPrimary if first.

## Edge Cases
- Expired initiate: bot prompts new flow.
- Already linked wallet duplicates ignored.

## Status
- Phase 1 implementation complete in code (WalletAgent).
- Pending: integration tests & CreditService websocket emit (nice-to-have).

## Log
- 2025-09-09: Initial implementation by WalletAgent.
