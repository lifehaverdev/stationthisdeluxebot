# ADR-010: Core Ethereum Service

## Context
Following the decision in ADR-009 to create separate services for blockchain interaction and business logic, we need to specify the architecture of the `EthereumService`. This service will act as the single, centralized gateway for all interactions with the Ethereum blockchain. It must be robust, secure, and provide a clear, reusable API for other higher-level services, such as the `CreditService`.

The primary requirements are to connect to the blockchain, manage a signing wallet, and provide generic methods to read from and write to any smart contract.

## Decision
We will create a new `EthereumService` class located at `src/core/services/ethereumService.js`. This service will be built using the `ethers.js` library, the de-facto standard for Ethereum interaction in JavaScript environments.

### Responsibilities:
1.  **Connection Management**: Initialize and maintain a persistent connection to the Ethereum network via an Alchemy RPC endpoint.
2.  **Wallet Management**: Securely load a private key from environment variables to create a "signer" wallet instance. This wallet will be used to execute (sign and pay for) all on-chain transactions initiated by the application.
3.  **Contract Abstraction**: Provide a method to instantiate `ethers.Contract` objects using a given contract address and its Application Binary Interface (ABI).
4.  **Read Operations**: Offer a generic `read` method that can call any `view` or `pure` function on a smart contract and return the result.
5.  **Write Operations**: Offer a generic `write` method that can execute any state-changing function on a smart contract. This method will handle the full transaction lifecycle: building the transaction, estimating gas, signing it with the application's wallet, sending it to the network, and waiting for the transaction to be mined and confirmed.

### Proposed Service API:
```javascript
class EthereumService {
  /**
   * @param {object} config - Configuration object
   * @param {string} config.rpcUrl - The Ethereum RPC URL (from Alchemy)
   * @param {string} config.privateKey - The private key of the application's signer wallet
   */
  constructor(config);

  /**
   * Returns an ethers.js Contract instance.
   * @param {string} address - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @returns {ethers.Contract}
   */
  getContract(address, abi);

  /**
   * Executes a read-only (view/pure) contract function.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to call.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<any>} The result of the contract call.
   */
  async read(contractAddress, abi, functionName, ...args);

  /**
   * Executes a state-changing (write) contract function.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to execute.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<ethers.TransactionReceipt>} The transaction receipt after it's confirmed.
   */
  async write(contractAddress, abi, functionName, ...args);
  
  /**
   * Returns the underlying ethers.js Provider instance.
   */
  getProvider();

  /**
   * Returns the underlying ethers.js Signer instance.
   */
  getSigner();
}
```

### Configuration
The service will be configured using the following environment variables:
-   `ETHEREUM_RPC_URL`: The full HTTPS endpoint URL from Alchemy.
-   `ETHEREUM_SIGNER_PRIVATE_KEY`: The private key for the application's wallet.
- @param {string} config.chainId - The ID of the target chain (e.g., '1' for Mainnet, '11155111' for Sepolia).

### Gas Strategy
We will implement EIP-1559 for all transactions, allowing us to set different priority levels for the priority fee (tip) based on the transaction's urgency. This will help manage costs while ensuring critical transactions are processed quickly.

### Secure Private Key Management
We will use a secrets manager, such as HashiCorp Vault, to securely manage the Ethereum signer's private key. The key will be fetched at runtime and held only in memory, never written to disk.

### Error Handling
We will prepare specific error messages for different failure scenarios to inform users and alert admins. Transaction receipts will be captured and stored in a database for tracking and auditing purposes.

## Consequences
-   **New Dependency**: The `ethers` library will be added as a project dependency.
-   **Security**: The application's security posture will now critically depend on the secure handling of the `ETHEREUM_SIGNER_PRIVATE_KEY`. This environment variable must be managed with extreme care in all deployment environments.
-   **Abstraction Layer**: Creates a clean separation between raw blockchain logic and application business logic, making the rest of the codebase easier to manage and test.
-   **Testability**: The `EthereumService` can be easily mocked in tests for higher-level services like `CreditService`, allowing them to be tested without needing a live blockchain connection.

## Alternatives Considered
-   **`viem` library**: A newer, lightweight alternative to `ethers.js`. While promising, `ethers.js` is more mature, has a larger community, and more extensive documentation, making it a more robust choice for this foundational service.
-   **Direct `ethers.js` usage in every service**: Using `ethers.js` directly within `CreditService` and any other service that needs it. This was rejected as it would lead to code duplication (e.g., provider and signer setup) and tightly couple business logic to the `ethers.js` library, violating the principle of separation of concerns.

## Open Questions & Next Steps
1.  **Gas Strategy**: How should we handle gas price settings? Use ethers.js defaults, or implement a more advanced strategy (e.g., EIP-1559 `maxFeePerGas`) for cost and speed optimization?
2.  **Nonce Management**: While `ethers.js` handles nonce management automatically, should we consider building a manual override or a more robust management system for high-throughput scenarios to prevent stuck transactions?
3.  **Error Handling**: We need to define a comprehensive error handling and retry strategy. What happens if the RPC is down? What if a transaction is submitted but then dropped from the mempool? What if a transaction reverts?
4.  **Private Key Management**: For production, we must plan to move beyond environment variables to a more secure storage solution like AWS Secrets Manager, HashiCorp Vault, or an HSM.
5.  **Secrets Management Setup**: Configure HashiCorp Vault (or a similar service) to securely manage the Ethereum signer's private key.
6.  **Database Design**: Design a database schema to store transaction receipts and other relevant data for tracking and auditing. 