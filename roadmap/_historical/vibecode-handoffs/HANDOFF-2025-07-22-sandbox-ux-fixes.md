> Imported from vibecode/handoffs/HANDOFF-2025-07-22-sandbox-ux-fixes.md on 2025-08-21

# HANDOFF: 2025-07-22 – Sandbox UX Fixes

## Work Completed
- Performed an architectural review of the web-sandbox (index.js, state.js, node/, canvas/, connections/).
- Mapped out zoom/pan, dragging, selection, connection and execution workflows.
- Collected six UX pain-points reported by the user (listed below).

## Current State
1. **Inaccurate Dragging** – Window movement is scaled (≈ 0.5×) relative to cursor travel. Root cause likely the interaction between element‐level translate offsets in `drag.js` and the global workspace transform.
2. **Connection Lines Overlays** – Permanent `.connection-line` elements are still visible when an `imageOverlay` or `textOverlay` modal is open, cluttering the view.
3. **Result Overwrite** – Re-executing a tool window removes the previous output; users lose history. Desired behaviour: spawn a *new* window (offset by, e.g., 40 px) for each execution.
4. **Post-delivery Rating** – After a generation completes the window should lock and surface rating options (👍 / 👎 / ⭐ etc.), mirroring the Telegram `deliveryMenu` implementation.
5. **Prompt Field Editing** – Only some parameters invoke the large `textOverlay`; all prompt-like inputs should open it.
6. **Anchor-locking Resize Glitch** – When parameter mappings are created the two nodes snap/resize together. Need to decouple anchor layout from DOM flow so windows remain independent.

## Next Tasks
| # | Fix | Owner | Key Files | Acceptance Test |
|---|-----|-------|-----------|-----------------|
| 1 | Normalise drag delta so window moves 1:1 with cursor. Likely replace translate logic with workspace→screen conversion used elsewhere. | FE | `node/drag.js`, `index.js` | Drag a window 500 px ‑ it follows precisely. |
| 2 | Hide `.connection-line.permanent` when any overlay (`.image-overlay`, `.text-overlay`) is visible. | FE | `connections/drawing.js`, `overlays/*` | Open image overlay – no lines visible; close – lines re-appear. |
| 3 | Refactor execution path: on Execute create `createToolWindow` copy (with history push) before running. Offset by `(origin.x+40, origin.y+40)`. | FE | `node/toolWindow.js` | Execute same node twice – two result nodes visible. |
| 4 | Add “delivered” state: disable inputs, replace Execute btn with rating UI (reuse Telegram `deliveryMenu` logic). Persist rating to API. | FE + BE | `node/resultContent.js`, `telegram/components/deliveryMenu/*` | Generation completes – rating buttons appear, POST /rating returns 200. |
| 5 | Extend `bindPromptFieldOverlays` paramNames list OR mark params with `type:"longtext"` in schema and bind dynamically. | FE | `overlays/textOverlay.js`, `parameterInputs.js` | All prompt/ instruction fields open overlay. |
| 6 | Remove CSS flex/width coupling in `anchors.js` & ensure drag bounding boxes ignore anchor alignment. | FE | `anchors.js`, CSS | Create mapping – windows keep their size; no forced resizing. |

### Sequencing
1. Issue 1 fix first – baseline for reliable positioning.
2. Issue 3 requires stable dragging; do after 1.
3. Issue 2 & 5 are small scoped – parallel.
4. Issue 4 needs design & API; tackle post-UI fixes.
5. Issue 6 cleanup after others (could affect layout during testing).

## Changes to Plan
None – aligns with existing North-Star objective of production-quality sandbox.

## Open Questions
- Desired offset distance for new execution windows (default 40 px?)
- Rating UI: simple 👍/👎 or 1-5 stars?
- Should rating be optional or mandatory before next execution?
- Any analytics events to emit on each fix?

---
*Prepared following the guidelines in `AGENT_COLLABORATION_PROTOCOL.md`.* 