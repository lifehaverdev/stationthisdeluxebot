# Sandbox Workspace — Outline

## Problem Statement
Currently, sandbox canvases are persisted only to `localStorage`, limiting users to a single-device experience and preventing easy knowledge sharing. Users cannot:
1. Save multiple named versions of their workspace.
2. Share a workspace via URL with colleagues or broader community.
3. Re-open work across devices or after clearing browser data.

## Vision
Introduce server-side persisted *Workspaces* that can be created, saved, loaded, and shared via a unique slug/ID. A Workspace captures the full sandbox state (tool windows, positions, connections, spell & tool parameter mappings, output versions). Key capabilities:
* Save current canvas to the cloud (anonymous or authenticated).
* Load any workspace by ID, including via `?workspace=<id>` URL parameter.
* Public read-only access; owners can edit and re-save.
* Tab UI on canvas to switch between multiple loaded workspaces.
* Back-end powered by `WorkspaceDB` (extends `BaseDB`) with internal API; external API exposes read endpoints & authenticated write endpoints.

## Acceptance Criteria
- User can click “Save Workspace” → receives sharable link `/sandbox?workspace=<id>`.
- Navigating to that link loads the exact canvas state (even if not signed-in).
- Authenticated user sees “My Workspaces” list and can delete or update.
- Canvas UI shows tabs for each open workspace; switching tabs hot-swaps state without reload.
- API rate-limits unauthenticated writes; max 10MB per workspace.
- Unit tests cover DB model schema and API validation rules.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| DB Layer  | Implement `WorkspaceDB` CRUD + ttl index | 2025-09-09 |
| Internal API | Protected routes under `/api/internal/workspaces` | 2025-09-10 |
| External API | Public routes under `/api/v1/workspaces` (create/read) | 2025-09-12 |
| Frontend Save/Load | Buttons & modal, POST/GET via external API | 2025-09-15 |
| Routing Support | `?workspace=` param auto-loads | 2025-09-15 |
| Tab UI | Multi-workspace tabs with close, rename | 2025-09-17 |
| Docs & ADR | Update master docs, write ADR + handoff | 2025-09-18 |

## Dependencies
- `BaseDB` queue & monitoring utilities.
- Auth middleware for protected endpoints.
- Existing sandbox state serialization logic.
- Rate-limit & storage quota utilities (for anonymous users).

## Implementation Log
- 2025-09-04: WorkspaceDB created with CRUD, internal & external API routers mounted.
