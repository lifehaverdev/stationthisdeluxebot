# ADR-2025-09-01: Deprecate and Remove Session System

## Context
Our codebase contains two parallel “session” mechanisms:

1. **In-memory `SessionService`** – instantiated at runtime for point accounting and a few cache helpers. Data is never persisted; restart = wipe.
2. **Database & REST session stack** – `UserSessionsDB`, `userSessionsApi`, and related internal routes. No platform code hits these endpoints; the only consumer is an offline `session_analyzer.js` script that reconstructs sessions from the `history` collection.

The original goal (tracking user work in a dashboard and simplifying analytics) has been met elsewhere via the event history model. Maintaining two unused layers adds complexity and blocker errors (many execution paths now require `sessionId` they immediately discard).

## Decision
We will **remove the entire session system** (both in-memory and DB/REST) and refactor code paths that fabricate or expect `sessionId` to operate without it.

Key actions:
1. Delete `src/core/services/session.js`, `UserSessionsDB`, `userSessionsApi`, `session_analyzer.js`, and related archive/frontend helpers.
2. Replace calls that demand a live `sessionId` (e.g., Telegram `dynamicCommands`) with a lightweight UUID request-id (if needed for logs) or simply omit.
3. Drop all references to `sessionId` in internal/external API payloads.
4. Update PointsService to manage balances directly via DB + cache without SessionService.
5. Purge docs & READMEs mentioning “Session”.
6. Migrate historical session ADRs to _historical.

## Alternatives Considered
* **Fix and keep sessions** – requires heavy platform integration, offers marginal analytical value now that we log granular events. Not worth effort.
* **Keep only in-memory SessionService** – still resets on deploy and encourages hidden state; simpler to eliminate and lean on DB.
* **Keep only DB/REST sessions** – would need full bot+web wiring; again low ROI.

## Consequences
* Simplified service graph; fewer dead dependencies during startup.
* Lower cognitive overhead when onboarding contributors (no ghost session paths).
* PointsService will be updated to query DB for balances; may introduce slight latency which we’ll benchmark.
* Historical analytics will rely exclusively on `history` events (already in place).

## Implementation Log
* **2025-09-01** – Decision drafted following agent/user audit.
* TODO: Create sprint task list and PRs to delete code & refactor callers.
