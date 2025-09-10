# Telegram Dress Rehearsal — Outline

## Problem Statement
Telegram platform fell behind during recent web-focused sprints. /status still relies on deprecated sessions; wallet connect, points purchase, and dynamic commands may be broken. We need full parity ahead of tonight’s launch demo.

## Vision
Bring Telegram bot to parity with web platform, providing seamless onboarding, wallet link, points purchase, and dynamic spell/cook command execution. Status command gives users live account progress without old session artifacts.

## Acceptance Criteria
- /status returns enhanced report for both new and existing users without errors
- New users can link wallet via bot and see address reflected in /status
- Users can purchase points through Telegram flow end-to-end
- Dynamic commands list loads and executes spells/cook tasks correctly
- All critical errors eliminated in logs

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Status Fix | Remove sessions, update /status | 2025-09-09 |
| Wallet Flow | Ensure wallet connect messages & API | 2025-09-09 |
| Points Purchase | Validate points purchase flow | 2025-09-09 |
| Dynamic Commands | Verify dynamic commands end-to-end | 2025-09-09 |
| QA & Demo | End-to-end testing & dress rehearsal | 2025-09-10 |

## Dependencies
- Internal API endpoints: users/find-or-create, users/{id}/status-report, wallets, points purchase.
- Bot payment provider setup.
