# Smart Contracts

> Full Solidity source, tests, and technical documentation are available in the open-source repo:
> **[github.com/lifehaverdev/credit-vault](https://github.com/lifehaverdev/credit-vault)**

---

## Overview

NOEMA's on-chain accounting is powered by **CreditVault** — a single shared contract that receives deposits, tracks user credit balances, and serves as the canonical destination for all ETH and token contributions.

```
CreditVault — 0x00000001152D633eb2AC3Cf91eac9994aEEFc021 (Ethereum Mainnet, Base)
```

CreditVault is live on mainnet and Base. The source and technical documentation are in the open-source repo linked above.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| `points` | Off-chain credits issued when a deposit is confirmed |
| `deposit` | Any ETH or token transfer to the CreditVault address |

For flow diagrams, event specifications, and security notes, see the README in the repository.

---

## Design Philosophy

NOEMA operates a **trusted-backend model**: the server coordinates credit issuance and workflow execution, while on-chain logs provide an irrefutable audit trail. This approach keeps gas costs predictable while preserving transparency — users can verify all credit movements on-chain at any time.

---

## Limitations and Roadmap

- Deposits are one-way; withdrawals require admin coordination
- Additional chain deployments (Arbitrum, Sanko) are planned
- Formal security audit and bug-bounty program are scheduled

---

For implementation details, explore the Solidity tests in the repository.
