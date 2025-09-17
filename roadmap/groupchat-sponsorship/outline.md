# Groupchat Sponsorship — Outline

## Problem Statement
Telegram group chats currently consume points individually per user, making communal usage inconvenient. There is no way for a single sponsor to fund the group’s usage, leading to friction for collaborative artwork generation.

## Vision
Allow a designated user to sponsor a Telegram group chat. When sponsored:
1. The group obtains its own `userCore` document with `accountType: 'group'` and `sponsorMasterAccountId`.
2. All generation requests in that chat charge the sponsor’s points automatically, while notification context continues to reply to the requesting user.
3. Group admins can set, change, or clear the sponsor via a new `/groupsettings` menu.

## Acceptance Criteria
- A sponsor can be assigned to a group via the internal groups API and Telegram `/groupsettings` flow.
- When sponsored, generations in the chat deduct points from the sponsor’s master account.
- If the sponsor’s balance is insufficient, generation fails with *INSUFFICIENT_FUNDS*.
- Telegram notifier delivers outputs and reactions exactly as today, unaffected by sponsorship.
- Un-sponsored groups continue to function with individual point deduction.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| DB & API | Add `accountType` and `sponsorMasterAccountId` fields, implement groups API | 2025-09-18 |
| Bot Commands | `/groupsettings` command & menu for admin | 2025-09-18 |
| Spend Logic | Modify `issueSpend` path to respect sponsor | 2025-09-19 |
| Tests & Docs | Unit / integration tests, update docs | 2025-09-19 |

## Dependencies
- Internal `userCoreDb` (reuse, no new collection).
- Points spend API (`/points/spend`).
- Telegram bot admin detection helper.
