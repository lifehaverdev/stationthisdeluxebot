# Dedicated Spell Page — Outline

## Problem Statement
Users cannot share or monetise a finished spell outside the heavy Sandbox workspace.

## Vision
A lightweight public page at `/spells/<slug>` where anyone can view metadata, fill inputs, pay, and execute a spell in real-time.

## Acceptance Criteria
- Public route `/spells/:slug` renders within <500 ms TTI
- Metadata, cost quote, and dynamic form load with a single API call
- Wallet connect + one-click payment integrated
- Execution progress streamed; output displayed
- Creator receives payout split via Referral Vault when applicable

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Backend API surface | GET metadata, GET quote, POST execute | 2025-08-22 |
| Frontend micro-page | HTML/CSS/JS rendering dynamic form | 2025-08-22 |
| Payment flow | Points top-up + charge endpoint | 2025-09-05 |
| Share & SEO | OpenGraph tags, copy-link button | 2025-09-05 |

## Dependencies
- ToolRegistry avg cost injection (completed)
- Payment service & wallet connector (operational)
