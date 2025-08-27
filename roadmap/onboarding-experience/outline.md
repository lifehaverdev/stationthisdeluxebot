# Onboarding Experience — Outline

## Problem Statement
New users struggle to understand StationThis’s value and basic actions, leading to drop-offs. The current tutorial is outdated, mobile-unfriendly, and not extensible.

## Vision
A modular, mobile-friendly onboarding flow that quickly guides users through account setup, workspace basics, tool launching, spells, cooks, mods, incentives, referrals and MS2 purchase.

## Acceptance Criteria
- Completion rate ≥ 70 % on desktop, ≥ 60 % on mobile
- Works across viewport sizes without clipping
- Progress persists in `userPreferencesDb` (authed) or `localStorage` (guest)
- Each new feature can append a step via config only

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Flow Design | Copy, ordering, mobile placement rules | 2025-08-28 |
| Engine Refactor | Modular step registry + persistence | 2025-09-02 |
| Step Implementation | Build & test all defined steps | 2025-09-08 |
| Analytics Hook-up | Emit events to Amplitude/DB | 2025-09-10 |
| Docs & Handoff | ADR log, demo video, PR merged | 2025-09-12 |

## Dependencies
- userPreferencesDb API endpoint for onboarding progress
- Existing UI components: AccountDropdown, BuyPointsModal, Cast/Cook menus, Mods menu
