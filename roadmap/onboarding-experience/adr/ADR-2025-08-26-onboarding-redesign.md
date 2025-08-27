# ADR-2025-08-26: Web Onboarding Redesign

## Context
The 2024 onboarding implementation (see `_historical/vibecode-adrs/ADR-2024-07-28-onboarding-experience.md`) established a modular system but left key UX gaps: no mobile support, broken workspace tour, missing new feature introductions (Spells, Cooks, Mods, Incentives, Referral Charters, MS2). Growth data shows a 45 % drop-off before first generation on mobile devices.

## Decision
Redesign the onboarding flow with:
1. Refactored engine that loads step definitions from a registry, supports conditional branching, and persists progress server-side.
2. Updated step sequence covering: value prop → user type → account dropdown (+buy points) → workspace action menu → all-tools sidebar → spells modal → cook wizard → mods/training → incentives → referral creation → MS2 CTA.
3. Mobile-aware tooltip placement and safe-area checks.
4. Removal of fragile canvas walk-through and anchor window steps.
5. Analytics events (`onboarding:step-start`, `onboarding:complete`).

## Alternatives Considered
- Patch existing steps only (would not solve mobile issues; still brittle).
- Replace onboarding with static documentation modal (low engagement, no interactivity).

## Consequences
+ Higher activation/retention, easier future step additions.
− Requires backend endpoint and additional testing across devices.

## Implementation Log
- 2025-08-26: Outline & ADR created; topics and tasks captured via TODO list.
