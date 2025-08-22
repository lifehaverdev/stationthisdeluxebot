# Collection Cook Mode — Outline

## Problem Statement
Legacy collection generator is a monolith tied to Telegram; we need a cross-platform, event-sourced cook orchestrator.

## Vision
Decoupled services (`CookOrchestrator`, `TraitEngine`, `Review`, `Export`) powered by spells/tools, surfaced via Web Sandbox modal and bot menus.

## Acceptance Criteria
- Cook creation, pause/resume, and cancel through Web UI & API
- Trait tree editor with generated ranges support
- Real-time progress and approve/reject gallery
- Export to Cloudflare R2 producing metadata + images bundle

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Core services & DB schema | cook_events, orchestrator, TraitEngine | 2025-08-22 |
| Web UI CookMenuModal MVP | Home list, create collection, start cook | 2025-08-29 |
| Review & Approve Loop | Piece gallery, hotkeys, API endpoints | 2025-09-05 |
| Export Pipeline | R2 upload, signed URL delivery | 2025-09-12 |

## Dependencies
- ExecutionClient & ToolRegistry (operational)
- CreditService improvements for per-piece charging
