# Smart Contracts

> Full Solidity source, tests, and technical documentation are available in the open-source repo:
> **[github.com/lifehaverdev/credit-vault](https://github.com/lifehaverdev/credit-vault)**

---

## Overview

NOEMA's on-chain accounting is powered by a hub-and-spoke custody system:

- **Foundation (hub)** — holds assets, maintains a global custody ledger, and deploys user-owned spokes
- **CharteredFund (spoke)** — an optional per-user vault that mirrors all events to Foundation for a unified audit trail

Both contracts are upgradeable (ERC-1967 UUPS) and currently live on **Sepolia testnet**.

```
Foundation — 0x011528b1d5822B3269d919e38872cC33bdec6d17 (Sepolia)
```

Production deployment follows once audits are complete.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| `userOwned` | Liquid balance a user can withdraw via `requestRescission` |
| `escrow` | Funds formally committed by the backend for workflow execution |

For flow diagrams, event specifications, and security notes, see the README in the repository.

---

## Design Philosophy

NOEMA operates a **trusted-backend model**: the server coordinates credit issuance and workflow execution, while on-chain logs provide an irrefutable audit trail. This approach keeps gas costs predictable while preserving transparency — users can verify all credit movements on-chain at any time.

---

## Limitations and Roadmap

- NFT deposits are currently one-way; rescission of ERC-721s requires admin intervention
- Multi-chain deployments (Base, Arbitrum, Sanko) are planned after mainnet launch
- Formal security audit and bug-bounty program are scheduled for Q4 2025

---

For implementation details, explore the Solidity tests in the repository.
