# Contributing Guide

Welcome!  We use **Docs-as-Code** to keep architecture, roadmap, and code in sync.

## Quick Start
1. Fork & clone the repo
2. Create a branch: `git checkout -b feature/your-change`
3. Commit using conventional commits (`feat:`, `fix:`, etc.)
4. Open a PR with the roadmap tag in the title (see below)

## Roadmap Tag Convention
Every PR title **must** start with a roadmap tag:
```
[roadmap:<epic>/<module>] Your descriptive title
```
Examples:
* `[roadmap:api/route-refactor] feat: support JWT auth headers`
* `[roadmap:telegram-bot/delivery-menu] fix: incorrect rate limit`

If your change doesn’t correspond to an existing module, add a row to the appropriate table in `roadmap/master-outline.md` *before* opening the PR.

## Keeping Docs in Sync
* After coding, update the **Status** column for the affected module (e.g., `In Progress` → `Completed`).
* If you made a design decision, append notes to the **Implementation Log** section of the relevant ADR (or create a new ADR using the template).

CI will warn you if the roadmap tag is missing or incorrect.

## Code Style & Lint
* JavaScript: StandardJS (no semicolons)
* CSS: BEM-ish class naming, 2-space indent

Run `npm run lint && npm test` before pushing.

## Thank You!
Your contributions help StationThis stay open, transparent, and fun. ❤️
