# ADR-2025-09-16 – API Guide Demonstration Script & Docs Update

## Status
Accepted – 2025-09-16

## Context
Developers integrating with StationThis Deluxe Bot require concrete examples for core API functions. Existing documentation lacks actionable demos and relies on scattered references.

## Decision
1. Create `scripts/api-guide-demo.js` – a Node.js CLI script accepting a command argument (`connect-wallet`, `check-account`, `request-generation`).
2. Use `node-fetch` to perform HTTP requests. Environment variable `API_BASE` chooses API host (default `http://localhost:3000`).
3. Pretty-print responses; exit non-zero on error.
4. Add comprehensive examples to `public/docs/content/api.md`, grouping by function, including cURL snippets matching the demo script.
5. Keep docs entry id `api` in `docs-manifest.json` unchanged to avoid nav impact.

## Consequences
+ Simplifies onboarding for third-party developers.
+ CLI script doubles as automated test of endpoint uptime.
− Slight maintenance overhead when API evolves.

## Implementation Log
- 2025-09-16: Outline created, tasks logged.
