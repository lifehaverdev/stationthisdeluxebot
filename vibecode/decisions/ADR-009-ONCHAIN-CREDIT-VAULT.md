# ADR-009: On-Chain Credit Vault Integration

## Context
The application requires a system to manage user credits for service payments. To ensure transparency, security, and decentralization, we need to use an Ethereum smart contract as the single source of truth for user account balances. This system must handle user deposits and withdrawals, triggered by on-chain events.

The core requirements are:
-   Track user credit balances on the Ethereum blockchain.
-   Use Alchemy webhooks to receive real-time notifications for on-chain `Deposit` events.
-   When a deposit occurs, the bot must verify the value of the deposit against a reliable price feed and then submit a confirmation transaction on-chain.
-   Users can initiate withdrawals either through the application (e.g., chat commands) or directly on-chain.
-   When a withdrawal is requested, the bot must verify the user's credit status and execute the withdrawal transaction on the smart contract.

## Decision
We will implement a new `CreditVaultService` within the application's core services. This service will encapsulate all logic for interacting with the on-chain credit vault contract.

### Deposit Flow:
1.  **Webhook Listener**: An API endpoint will be created to accept incoming POST requests from Alchemy webhooks, configured to watch for the `Deposit` event on our smart contract.
2.  **Trigger Service**: The webhook handler will parse the event payload and trigger the `CreditVaultService`.
3.  **Value Confirmation**: The `CreditVaultService` will query a Chainlink price feed to determine the real-world value (e.g., in USD) of the deposited asset (e.g., ETH or an ERC20 token).
4.  **On-Chain Confirmation**: After validating the value, the service will use a designated wallet to sign and submit a transaction to the smart contract, calling a function to officially credit the user's account.

### Withdrawal Flow:
1.  **Initiation**: A user can trigger a withdrawal via an in-app command or by calling a specific function on the smart contract.
2.  **Service Handling**: Both initiation methods will trigger the `CreditVaultService`.
3.  **Balance Check**: The service will check the user's available credit from the contract.
4.  **Execute Withdrawal**: The service will call the `withdrawTo` function on the contract, transferring the specified amount to the user's wallet.

## Consequences
-   **New Service**: A `CreditVaultService.js` will be created in `src/core/services/`.
-   **Wallet Management**: The application will require a securely managed Ethereum wallet (private key) to sign and send transactions. Initially, this will be managed via environment variables.
-   **External Dependencies**: The system will now depend on Alchemy for event notifications and a price feed oracle (e.g., Chainlink) for data.
-   **New API Endpoint**: A new route must be added to the web platform to handle incoming webhooks from Alchemy.
-   **User-Wallet Mapping**: A mechanism to link application user IDs to their corresponding Ethereum wallet addresses must be implemented, likely within our user database schema.
-   **Asynchronous Complexity**: The architecture will become more event-driven, requiring robust error handling, transaction monitoring, and potential retry logic for failed on-chain operations.

## Alternatives Considered
-   **Centralized Ledger**: Using our existing database to manage credits. This was rejected to prioritize the security, user ownership, and transparency that a blockchain-based solution provides.
-   **On-Chain Event Polling**: Continuously polling the blockchain for new events instead of using webhooks. This was rejected as it is less efficient, introduces latency, and increases infrastructure load compared to the real-time, push-based approach of webhooks.

## Open Questions & Next Steps
1.  **Contract Details**: What is the deployed address and the Application Binary Interface (ABI) for the credit vault smart contract?
2.  **Function Signatures**: What are the exact function names and parameters for confirming a deposit and executing a withdrawal (`withdrawTo`)?
3.  **Price Feed**: Which specific Chainlink price feed should be used? (e.g., ETH/USD, DAI/USD).
4.  **User Onboarding**: How will users link their Ethereum wallet address to their application account?
5.  **Security**: What are the long-term security protocols for managing the bot's signer wallet? (e.g., Hardware Security Module, multi-sig).
6.  **Gas Management**: How will gas fees for confirmation and withdrawal transactions be handled and paid for?
7.  **Error Handling**: What is the recovery strategy if a confirmation transaction fails? How do we notify the user or admin? 