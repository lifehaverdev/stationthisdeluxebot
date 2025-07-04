# HANDOFF: 2025-07-03 — Buy Points Modal North Star

## Codebase Architecture & Implementation Rules
- **API-Only Data Access:** All data access from the web client must go through internal API endpoints, never direct database calls. The web client communicates only with external API endpoints, which in turn call internal APIs.
- **Component Organization:** All UI components must be placed under `@/components` (i.e., `src/platforms/web/client/src/sandbox/components`). Subfolders are encouraged for logical grouping.
- **Asset Management:** All images and assets for this modal must be placed in `public/images/sandbox/components`.
- **VANILLA JAVASCRIPT CSS HTML ONLY -- NO REACT

## Backend Integration & API Contracts
The Buy Points modal relies on three backend modules:
- **creditService.js:** Handles the full lifecycle of credit (points) deposits, including both token and NFT deposits, funding rate logic, off-chain accounting, and transaction status/receipts.
- **priceFeedService.js:** Fetches real-time price and metadata for tokens (ERC20, ETH), used for quoting points per amount.
- **nftPriceService.js:** Fetches floor price for NFT collections, used for quoting points per NFT deposit.

To support the modal, the following external API endpoints must be exposed (all frontend calls go through these):
- **GET /api/external/points/supported-assets** — Returns a list of supported tokens (address, symbol, name, decimals, icon, funding rate) and NFTs (address, name, funding rate, icon).
- **POST /api/external/points/quote** — Given a token or NFT and amount/tokenId, returns a real-time quote: `{ points, fundingRate, price, fees, breakdown }`.
- **POST /api/external/points/purchase** — Initiates a purchase (token or NFT deposit), returns transaction data for the wallet, approval info, and contract address.
- **GET /api/external/points/tx-status?txHash=...** — Returns transaction status, receipt, and points credited.

**NFT Deposit Support:**
- The modal supports NFT deposits: user selects a supported NFT collection and tokenId, receives a quote (using floor price and funding rate), and initiates the deposit. The flow and APIs mirror the token deposit process.

All API endpoints are implemented as external APIs (for the web client), which call internal APIs that use the above backend modules. No direct DB access from the frontend.

## Goal
Design and implement a best-in-class Buy Points modal for the sandbox web app, supporting seamless, multi-currency, web3-native point purchases with clear user feedback and robust transaction handling.

---

## User Flow & UI Requirements

### 1. **Currency Selection**
- Display a collection of buttons for supported coins, organized by funding rate:
  - **Top Level:** MS2, CULT
  - **Second Level:** USDC, USDT, ETH, WETH
  - **Third Level:** MOG, PEPE, SPX6900
  - **Custom Coin:** Button to pay with a custom coin (user inputs contract address or symbol)

### 2. **Amount Input & Quote**
- After selecting a currency, user inputs the amount they want to spend.
- System fetches the current price and outputs how many points the user would receive for that amount (real-time quote).

### 3. **Review & Confirmation**
- Once satisfied, user clicks 'Buy Points'.
- Show a final review modal with an itemized list:
  - Coin spent
  - Fees taken for gas
  - Fees taken for funding rate
  - Total points purchased
- Include a 'Purchase' button to confirm.

### 4. **Transaction Handling**
- On confirmation, initiate the transaction:
  - If the user has a smart wallet (per latest EIP), attempt a coupled transaction (approve + deposit in one step if possible).
  - If not, queue two transactions:
    - First: Approve the coin for spending
    - Second: Call the deposit() function on the contract
  - If ETH native, queue a direct ETH transfer to the smart contract.
- Monitor the transaction(s) and provide real-time status updates.
- Alert the user when the transaction is confirmed.
- Show the transaction receipt and allow the user to close the modal or await confirmation.

---

## UX Best Practices
- Use clear, step-by-step modals for each phase (select, input, review, transact, receipt).
- Provide instant feedback for errors, pending states, and success.
- Make all coin addresses and transaction hashes copyable.
- Ensure the modal is mobile-friendly and keyboard accessible.
- Show real-time conversion rates and update quotes as the user changes input.
- For custom coins, validate input and provide helpful error messages.

---

## North Star
This document is the north star for the Buy Points modal. All implementation, design, and backend integration should align with this flow and UX vision to ensure a seamless, powerful, and user-friendly point purchasing experience for all users.

## Implementation Progress (as of 2025-07-03)
- **External API endpoints** for the Buy Points modal have been created in `src/api/external/pointsApi.js` and registered in `src/api/external/index.js`, protected by session or API key authentication.
- **Internal API endpoints** have been created in `src/api/internal/pointsApi.js` and registered in `src/api/internal/index.js` using the established factory pattern and dependency injection.
- The **/supported-assets**, **/quote**, **/purchase**, and **/tx-status** endpoints are all implemented and functional.
- The **/tx-status** endpoint uses real data from the credit ledger and blockchain (not mocks), returning accurate status and receipt information for any transaction hash.
- The backend is now ready for frontend integration and further refinement.

## Next step:
Implement the `/quote` endpoint to provide real-time point purchase quotes for tokens and NFTs. 