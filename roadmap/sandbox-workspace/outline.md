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
- 2025-09-04: Front-end Save/Load buttons + WorkspaceTabs component with auto-save, slim snapshot, CSS component `workspaceSuite`. Basic multi-workspace switching working.
- 2025-09-05: Removed undo/redo history from `state.js`; `pushHistory` now persists immediately, `undo/redo` no-op. `removeToolWindow` now calls `persistState` to prevent ghost windows. Verified via console:
  * Created three demo workspaces (img, txt, audio) -> saved
  * Reloaded page as guest with `?workspace=` param for each slug; canvases loaded correctly
  * Switched tabs; observed `sandbox_connections` and `sandbox_tool_windows` keys update per tab, no history pollution
  * Removed windows; ensured they did not reappear after reload.
- 2025-09-08: Tab UX & Guest Access completed.
  * Added WorkspaceTabs close button (hover '×'), blank-tab isolation, localStorage + in-memory reset.
  * Silent autosave, clipboard alert only on first manual save.
  * CSS: tab close hover, z-index layering over modals.
  * Public snapshot view: middleware bypass for `GET /api/v1/workspaces/:slug` and root route, auto-load slug for tab 0.
  * Guest flow verified – no onboarding/connect prompts block view; exec APIs 401 as expected.
  * Close Tab removes tab & persists state; cannot close last tab.
Status: MVP feature COMPLETE – ready for demo.
