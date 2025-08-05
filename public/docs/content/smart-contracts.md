# Smart Contracts – Foundation & CharteredFund

> The full Solidity source, tests and technical docs live in our open-source repo:  
> **[github.com/lifehaverdev/credit-vault](https://github.com/lifehaverdev/credit-vault)**  

---

## Overview

NOEMA’s on-chain accounting is powered by a **hub-and-spoke custody system**:

* **Foundation (hub)** – Holds assets, maintains a global custody ledger, and deploys user-owned spokes.  
* **CharteredFund (spoke)** – Optional per-user vault that mirrors all events to Foundation for a unified audit trail.

The contracts are upgradeable (ERC-1967 UUPS) and currently live on **Sepolia testnet**.

```
Foundation – 0x011528b1d5822B3269d919e38872cC33bdec6d17 (Sepolia)
```

Production deployments will follow once audits are complete.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| `userOwned` | Liquid balance a user can withdraw (`requestRescission`) |
| `escrow`    | Funds formally committed by backend for workflow execution |
| Admin NFT   | Ownership of Miladystation #598 controls upgrade and emergency functions |

For flow diagrams, event specs and security notes, check the README in the repo.

---

## Why Not Trustless?

We deliberately operate a **trusted-backend model**: the server coordinates credit issuance and workflow execution, while on-chain logs provide irrefutable audit trails. This trade-off lets us keep gas costs predictable while preserving transparency.

---

## Limitations & Roadmap

* **NFT deposits** are one-way for now; rescission of ERC-721s requires admin intervention.  
* Multi-chain deployments (Base, Arbitrum, Sanko) planned after mainnet launch.  
* Formal audit and bug-bounty program slated for Q4-2025.

---

**Want to dive deeper?** Read the [full README](https://github.com/lifehaverdev/credit-vault) or explore the Solidity tests for implementation details. 