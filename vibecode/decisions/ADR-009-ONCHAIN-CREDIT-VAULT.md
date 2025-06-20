# ADR-009: On-Chain Credit and Ethereum Services

## Context
The application requires a system to manage user credits for service payments. To ensure transparency, security, and decentralization, we need to use an Ethereum smart contract as the single source of truth for user account balances. This system must handle user deposits and withdrawals, triggered by on-chain events.

The core requirements are:
-   Track user credit balances on the Ethereum blockchain using our smart contract.
-   Use Alchemy webhooks to receive real-time notifications for on-chain `Deposit` events and alchemy price feeds to determine accurate real time USD value.
-   When a deposit occurs, an event is emitted on chain that is captured and alerted to us via webhook. the bot must verify the value of the deposit against a reliable price feed and then submit a confirmation transaction on-chain, confirming the credit.
-   Users can initiate withdrawals either through the application (e.g., chat commands) or directly on-chain.
-   When a withdrawal is requested, the bot must verify the user's credit status and execute the withdrawal transaction on the smart contract based on reconciling the onchain vs offchain credit balance. (i.e. if a user deposits 200 dollars worth of MOG coin onto the credit vault, and they use 150 dollars worth of credit and ask to withdraw, we will give them their coins back in a ratio of the original value, this case 50 dollars worth price at time of deposit 1/4 of their deposit)

The scope also includes the foundational requirement of linking a user's in-app identity (e.g., Telegram user) to their on-chain identity (Ethereum wallet address). This is a prerequisite for any on-chain interaction.

## Decision
We will adopt a two-service architecture to separate blockchain interaction from business logic.

1.  **`EthereumService`**: A new low-level service responsible for all direct blockchain communications.
    *   **Responsibilities**: Manages the connection to an Ethereum node via Alchemy, securely handles the application's signer wallet, loads smart contracts via ABI, and provides generic, reusable functions for reading from and writing to the blockchain (e.g., `readContract`, `writeContract`). It will not contain any business-specific logic.

2.  **`CreditService`**: A new high-level service containing the specific business logic for the credit vault.
    *   **Responsibilities**: Manages the end-to-end credit lifecycle, including assessing collateral risk, confirming deposits, monitoring collateral value against user debt, executing on-chain liquidations, and triggering treasury management swaps.

### Credit Lifecycle and Risk Management
The `CreditService` manages a sophisticated lifecycle for user collateral, which extends far beyond simple deposits and withdrawals. It functions as a collateralized debt and risk management engine.

1.  **Ingestion & Onboarding (Credit Adding)**: This is the entry point for user funds.
    *   **Event Detection**: Monitors for `Deposit` (from the main vault) and `AccountDeposit` (from referral vaults) events.
    *   **Collateral Risk Assessment**: Before processing a deposit, the `TokenRiskEngine` is used to analyze the asset. It checks liquidity, volatility, and other on-chain metrics to determine if the token is acceptable collateral and at what liquidation threshold.
    *   **Value Calculation**: For an approved token, the `PriceFeedService` gets its real-time USD value.
    *   **On-Chain Custody**: The service executes a `confirmCredit` transaction on-chain. This is a critical step that moves the funds from user control to application control, collateralizing the credit we are about to issue.
    *   **Internal Credit Issuance**: The USD value is converted into internal points (e.g., 1 point = 1 second of A10G GPU time at a fixed USD rate) and added to the user's off-chain account balance.

2.  **Consumption & Monitoring (Credit Subtraction)**: This is the day-to-day operation.
    *   An internal API allows other services to deduct points as they are consumed (e.g., upon successful AI generation).
    *   The service continuously monitors the real-time value of the user's on-chain collateral against their outstanding (consumed) credit. If the collateral value drops perilously close to the value of the credit issued, a liquidation is triggered.

3.  **Settlement (Liquidation)**: This is the automated intervention to prevent system losses.
    *   When a liquidation threshold is breached (e.g., collateral value falls to 120% of debt), the service executes an on-chain transaction to seize the collateral, settling the user's debt.
    *   The user's internal point balance is zeroed out, and the `credit_ledger` is updated to reflect the settlement.

4.  **Asset Management (Post-Liquidation)**: This is the system's treasury management function.
    *   After seizing a volatile asset, the `CreditService` instructs the `DexService` to immediately swap the asset for a stablecoin (e.g., USDC) to eliminate further price risk to the treasury.

### Supporting Services
To handle this complexity, the `CreditService` relies on several new, specialized services:

-   **`TokenRiskEngine`**: Analyzes tokens to determine their viability as collateral. It checks on-chain liquidity depth on DEXs, price volatility, contract verification status, and other heuristics to generate a risk profile.
-   **`PriceFeedService`**: A dedicated service for fetching reliable, real-time token prices from sources like Alchemy or Chainlink.
-   **`DexService`**: An abstraction layer for interacting with a decentralized exchange protocol (e.g., Uniswap v3) to programmatically swap assets. The `DexService` provides read-only quotes and executes write transactions for swaps.

### Referral System via `VaultAccount` Sub-Contracts
To facilitate referral tracking, we will employ a factory pattern. The main `CreditVault` contract contains a `createVaultAccount` function, callable only by our backend. This function deploys a unique, secondary `VaultAccount` contract for each user who generates a referral link.

-   **Deterministic Addresses**: The creation uses `CREATE2`, allowing us to provide a `salt`. This enables the backend to "mine" a salt that results in a vanity contract address (e.g., starting with `0x1152...`) for easy on-chain identification.
-   **Deposit Tracking**: Deposits made to these `VaultAccount` addresses will emit their own `AccountDeposit` event. The `CreditService` will monitor for these events across all created vault accounts to attribute deposits to the correct referrer. The `credit_ledger` in the database will store which type of vault received the funds.

### User Wallet Linking Strategy
We will support two methods for linking user wallets to their application accounts, accommodating different platform capabilities:

-   **Signed Message (Sign-In with Ethereum - SiWE)**: This is the **primary and preferred** method, to be used on the web platform. It is a gasless, secure, and industry-standard way for users to prove ownership of a wallet by signing a message.
-   **"Magic Amount" Deposit (For non-browser clients like Telegram)**: As a fallback, users on platforms without direct wallet integration can be instructed to send a unique, small, random amount of a specific token to the vault. The service will monitor for this transaction to link the sender's address to the user's account.

To bridge the gap, a Telegram user will be given a unique, single-use link to our web app to perform the secure SiWE connection flow, associating their verified wallet with their Telegram ID.

### Gas Strategy
We will implement EIP-1559 for all transactions, allowing us to set different priority levels for the priority fee (tip) based on the transaction's urgency. This will help manage costs while ensuring critical transactions are processed quickly.

### Secure Private Key Management
We will use a secrets manager, such as HashiCorp Vault, to securely manage the Ethereum signer's private key. The key will be fetched at runtime and held only in memory, never written to disk.

## Consequences
-   **New Services**: Two services will be created: `EthereumService.js` and `CreditService.js` in `src/core/services/`.
-   **Wallet Management**: The application will require a securely managed Ethereum wallet (private key) to sign and send transactions. Initially, this will be managed via environment variables.
-   **External Dependencies**: The system will now depend on Alchemy for node access, event notifications, and its price feed API.
-   **New API Endpoint**: A new route must be added to the web platform to handle incoming webhooks from Alchemy.
-   **User-Wallet Mapping**: A mechanism to link application user IDs to their corresponding Ethereum wallet addresses must be implemented, likely within our user database schema.
-   **Asynchronous Complexity**: The architecture will become more event-driven, requiring robust error handling, transaction monitoring, and potential retry logic for failed on-chain operations.

## Alternatives Considered
-   **Centralized Ledger**: Using our existing database to manage credits. This was rejected to prioritize the security, user ownership, and transparency that a blockchain-based solution provides.
-   **On-Chain Event Polling**: Continuously polling the blockchain for new events instead of using webhooks. This was rejected as it is less efficient, introduces latency, and increases infrastructure load compared to the real-time, push-based approach of webhooks.
-   **New Internal Services**: `PriceFeedService`, `TokenRiskEngine`, and `DexService` must be designed, built, and maintained.
-   **Economic Risk**: The application's treasury is now directly exposed to market volatility from the collateral it holds and the smart contract risk of the DEXs it interacts with during asset swaps.
-   **Asynchronous Complexity**: The architecture becomes significantly more complex and event-driven, requiring robust error handling, transaction monitoring, and potential retry logic for all on-chain operations.

## Open Questions & Next Steps
1.  **Contract Details**: What is the deployed address and the Application Binary Interface (ABI) for the credit vault smart contract?
2.  **Function Signatures**: What are the exact function names and parameters for confirming a deposit and executing a withdrawal (`withdrawTo`)?
3.  **Price Feed**: Which specific Alchemy price feed endpoints should be used for the tokens we will support?
4.  **User Onboarding Flow**: We need to design the full UX for both the SiWE and "magic amount" flows. How do we clearly communicate the steps to the user on each platform?
5.  **Security**: What are the long-term security protocols for managing the bot's signer wallet? (e.g., Hardware Security Module, multi-sig).
6.  **Gas Management**: How will gas fees for confirmation and withdrawal transactions be handled and paid for?
7.  **Error Handling**: What is the recovery strategy if a confirmation transaction fails? How do we notify the user or admin?
8.  **Secrets Management Setup**: Configure HashiCorp Vault (or a similar service) to securely manage the Ethereum signer's private key.
9.  **Database Design**: Design a database schema to store transaction receipts and other relevant data for tracking and auditing.

## Alternatives Considered
-   **Simple Credit Model**: A model without liquidation or risk assessment where we take immediate ownership of any deposited asset. This was rejected as it would expose the system to unacceptable losses from volatile assets and offer a poor user experience.
-   **Centralized Ledger**: Using our existing database to manage credits. This was rejected to prioritize the security, user ownership, and transparency that a blockchain-based solution provides.
-   **On-Chain Event Polling**: Continuously polling the blockchain for new events instead of using webhooks. This was rejected as it is less efficient, introduces latency, and increases infrastructure load compared to the real-time, push-based approach of webhooks. 