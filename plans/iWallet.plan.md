# iWallet.js Plan

## Current Purpose
`iWallet.js` handles all wallet-related functionality for the bot, including connecting wallets (Ethereum and Solana), verifying token transfers, managing wallet states, checking token balances, and handling crypto-related commands. It serves as the interface between blockchain operations and the Telegram bot.

## Exported Functions/Classes
- **Price-related functions**:
  - `getMS2Price()` - Gets MS2 token price with caching
  - `getETHPrice()` - Gets ETH price with caching
  - `getSOLPrice()` - Gets SOL price with caching
  
- **Balance-checking functions**:
  - `getSolanaWalletBalance(walletAddress)` - Get MS2 balance for SOL wallet
  - `getEthereumWalletBalance(walletAddress)` - Get MS2 balance for ETH wallet
  - `getNativeSolBalance(walletAddress)` - Get native SOL balance
  - `getNativeEthBalance(walletAddress)` - Get native ETH balance

- **Wallet management classes**:
  - `AbacusHelper` - Helper for updating UI state during wallet operations
  - `WalletHandler` - Main class handling wallet operations
    - `promptChainSelection()` - Prompts user to select blockchain
    - `handleChainSelection()` - Handles chain selection
    - `verifyWalletSetup()` - Verifies wallet setup process
    - `addWalletToUser()` - Adds wallet to user account
    - `addConnectedWallet()` - Adds directly connected wallet
    - `getUserAssets()` - Gets user's crypto assets

- **Utility functions**:
  - `getUserAssets(userId)` - Gets user's crypto assets
  - `ensureLegacyWalletMigration(user)` - Migrates legacy wallet data
  - `setActiveWallet(userId, walletAddress)` - Sets active wallet for user
  - `verifyTransfer(toAddress, fromAddress)` - Verifies crypto transfer
  - `handleSignUpVerification(message, expectedAmount)` - Handles verification

- **UI functions**:
  - `createChargeMessage(userId)` - Creates charge message UI
  - `createWalletsMessage(userId)` - Creates wallets UI message
  - `createWalletSwitchMenu(userId)` - Creates wallet switch UI

## Dependencies and Integrations
- Tightly coupled with Telegram bot API via message handling
- Blockchain integrations:
  - Ethereum via ethers.js
  - Solana via @solana/web3.js
- External APIs:
  - CoinGecko for price data
  - Alchemy for Ethereum data
- Internal dependencies:
  - `lobby` and `abacus` from bot module for state management
  - Database models for user data
  - `TutorialManager` from iStart.js
  - Various utility functions

## Identified Issues
- Tight coupling with Telegram-specific UI and message flows
- Directly references global state (`lobby`, `abacus`)
- Mixes blockchain logic with UI/message handling
- Complex verification flows embedded with UI generation
- Duplicate functionality between class methods and standalone functions
- Lacks clear separation between core wallet logic and platform-specific code
- Price cache implementation mixed with core functionality

## Migration Plan
1. Create `src/core/wallet/`:
   - `provider.js` - Abstract blockchain provider interfaces
   - `ethereum.js` - Ethereum-specific logic
   - `solana.js` - Solana-specific logic
   - `price.js` - Token price fetching and caching
   - `verification.js` - Transaction verification logic
   - `balance.js` - Balance checking logic

2. Create `src/integrations/telegram/wallet.js`:
   - Telegram-specific UI for wallet operations
   - Command handlers for wallet functionality
   - Message and callback handling

3. Implement `src/api/wallet.js`:
   - Internal API for wallet operations
   - Authentication and authorization
   - Interface for frontend applications

4. Suggested improvements:
   - Use a proper state management system for transaction tracking
   - Implement proper error handling and retry mechanisms
   - Store transaction verification data in database
   - Create testable, pure functions for core wallet logic
   - Implement proper logging and monitoring
   - Use dependency injection for external services 