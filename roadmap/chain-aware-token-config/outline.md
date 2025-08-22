# Chain-aware Token Configuration & Network Enforcement — Outline

## Problem Statement
Currently, `TOKEN_CONFIG` is hard-coded for Ethereum mainnet addresses while our staging environment and early users operate on Sepolia. This mismatch can cause incorrect quotes, failed transactions, and potential loss of funds. As we expand to multiple chains (Mainnet, Sepolia, Base, Optimism), the system must dynamically reference the correct token addresses and enforce that users interact on supported networks.

## Vision
The platform automatically recognises a user’s connected chain, surfaces only the assets supported on that chain, and blocks or prompts users to switch if they are on an unsupported network. A single source of truth (`TOKEN_CONFIG`) will map supported tokens & NFTs per chainId, ensuring consistent funding rates, decimals, and icons across frontend and backend services.

## Acceptance Criteria
- The backend `TOKEN_CONFIG` supports at least Mainnet (1) and Sepolia (11155111) mappings.
- `/supported-assets` endpoint returns assets for the chainId provided by the client (header or query) and falls back to Mainnet.
- BuyPointsModal detects the user’s chain via `window.ethereum.chainId`.
- If the chain is unsupported, the UI prompts and can programmatically request a network switch.
- All transactions are blocked when the wallet is on an unsupported chain.
- Documentation and tests cover multi-chain logic.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Investigation | Audit current code paths & gather requirements | 2025-08-Sprint-1 |
| Config Refactor | Implement multi-chain `TOKEN_CONFIG` & helpers | 2025-08-Sprint-2 |
| Backend Integration | Update APIs & services to use new config | 2025-08-Sprint-2 |
| Frontend Enforcement | Chain detection, switch prompt, UI updates | 2025-08-Sprint-3 |
| Testing & QA | Automated tests + manual QA matrix | 2025-08-Sprint-3 |
| Launch | Deploy multi-chain support to prod | 2025-08-Sprint-4 |

## Dependencies
- MetaMask / WalletConnect network switch support on web client
- Updated addresses for each supported token on target chains
- Coordinated contract deployments (proxy & adapters) on each chain
