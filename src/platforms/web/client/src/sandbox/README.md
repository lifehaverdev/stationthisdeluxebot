# Sandbox Interface – Architecture & Component Guide

This document gives a deep-dive overview of the **Sandbox** found in `src/platforms/web/client/src/sandbox`.  The sandbox is an in-browser, node-based workspace that lets users compose *tools* (atomic actions) and *spells* (saved multi-step workflows) via drag-and-drop, connect their inputs/outputs visually, and execute them.

> If you are new to the front-end of StationThis, read this file end-to-end before making changes.  It captures the current mental model so you don’t have to reverse-engineer the code from scratch.

---

## 1. Runtime Life-Cycle

1. **HTML loads** a minimal `sandbox-content` wrapper with an empty `.sandbox-canvas` div.
2. `index.js` fires on **`DOMContentLoaded`** and orchestrates boot-strapping:
   • `initState()` – zeroes global state & restores persisted windows / connections from `localStorage`.
   • **Canvas**: sets up pan/zoom & grid background; exposes helper fns on `window.sandbox`.
   • **Sidebar**: collapsed by default, populated later by `renderSidebarTools()`.
   • **Tool registry** loaded from `/api/v1/tools/registry` → stored via `setAvailableTools()`.
   • Restored windows are re-hydrated (`createToolWindow`/`createSpellWindow`) and then `renderAllConnections()` paints SVG / div lines between them.
   • Global listeners: lasso selection, click-to-open *action modal*, undo/redo hot-keys, etc.

At this point the workspace is fully interactive.

---

## 2. Directory-Level Map

```
sandbox/
├─ index.js                ← entry point / orchestrator
├─ state.js                ← single-source-of-truth (SSOT) for sandbox state
├─ canvas.js               ← pan / zoom helpers & background grid
├─ io.js                   ← networking (tool registry, file uploads)
├─ subgraph.js             ← helper to traverse tool/spell graph
├─ executionClient.js      ← lightweight client-side ExecutionClient proxy
├─ toolSelection.js        ← sidebar & context menus for creating tools
├─ utils.js                ← shared small utilities
│
├─ node/                   ← **Node / Window subsystem**
│   ├─ toolWindow.js       ← generic tool window implementation
│   ├─ spellWindow.js      ← wrapper for saved spell windows
│   ├─ resultContent.js    ← output rendering per-result type
│   ├─ parameterInputs.js  ← dynamic form generation for tool params
│   ├─ websocketHandlers.js← handles WS events for node updates
│   ├─ drag.js, anchors.js ← behaviour helpers
│   ├─ overlays/           ← live preview overlays (text / image)
│   └─ index.js            ← exports + overlay bootstrap
│
├─ connections/            ← visual & logical linking of node outputs → inputs
│   ├─ manager.js          ← CRUD & persistence of Connection objects
│   ├─ interaction.js      ← user gestures (click-drag to connect)
│   ├─ drawing.js          ← painting straight/curved lines on canvas
│   ├─ validation.js       ← simple type compatibility checks
│   └─ anchors.js          ← DOM anchor utilities
│
├─ components/             ← stand-alone UI widgets used inside the sandbox
│   ├─ SpellsMenuModal.js
│   ├─ ModsMenuModal.js
│   ├─ MintSpellFAB.js
│   ├─ AccountDropdown.js
│   ├─ historyModal.js
│   ├─ image.js
│   ├─ BuyPointsModal/
│   ├─ ReferralVaultModal/
│   └─ ReferralVaultDashboardModal/
│
├─ onboarding/             ← product-led tour shown on first visit
│   └─ steps/…             ← modular step definitions
│
├─ style/                  ← vanilla CSS (scoped by convention)
└─ README.md               ← you are here
```

---

## 3. Global State (`state.js`)

`state.js` exposes *plain JS variables* and helper fns instead of React/Vue stores.  Key pieces:

• `availableTools`            – array fetched from backend registry.
• `activeToolWindows`         – array of live node windows (both tools & spells).  Persisted.
• `connections`               – array of `{ id, fromWindowId, toWindowId, type, … }`.
• `selectedNodeIds`           – `Set` of currently selected window IDs.
• `historyStack`, `redoStack` – simple immutable snapshots for undo/redo.
• UI flags: `activeModal`, `activeSubmenu`, `lastClickPosition`.

All write operations eventually call `persistState()` which serialises to two `localStorage` keys:
`sandbox_tool_windows` and `sandbox_connections`.

Undo/redo is snapshot-based (no patches) and limited to 50 steps for memory reasons.

---

## 4. Canvas & Viewport (`index.js`, `canvas.js`)

Pan/zoom is applied via CSS transforms on `.sandbox-canvas`:

```
translate(pan.x, pan.y) scale(scale)
```

Helpers `screenToWorkspace()`/`workspaceToScreen()` convert coordinates, ensuring that node window positions are stored **in workspace coordinates** (unaffected by zoom).

A subtle grid background scales with zoom (`background-size`), giving Figma-like feedback.  Mouse wheel + `ctrlKey` or two-finger pinch triggers zoom; middle-mouse/spacebar + drag pans.

---

## 5. Node / Window System (`node/`)

### 5.1 createToolWindow / createSpellWindow

Both functions:
1. Generate a unique DOM structure (`.tool-window` / `.spell-window`).
2. Attach drag-move via `drag.js`.
3. Add input & output **anchors** (`anchors.js`) used by connection system.
4. Register the instance in `activeToolWindows` and persist.

`spellWindow.js` additionally visualises steps & parameter mappings of the saved workflow.

### 5.2 Parameter Mapping

Each window stores a `parameterMappings` object.  When a permanent connection is created, `connections/manager.js` writes an entry such as:
```js
parameterMappings = {
  prompt: { type: 'nodeOutput', nodeId: 'node-123', outputKey: 'text' }
}
```
`toolWindow.js` renders this as a *“Connected”* chip next to the input.

---

## 6. Connection System (`connections/`)

1. **interaction.js** – watches `mousedown` on an output anchor; tracks mouse until release; calls `createPermanentConnection()`.
2. **manager.js** – pushes to history, updates `parameterMappings`, and appends to global `connections`.
3. **drawing.js** – computes bezier/straight lines between anchor centres and injects a `<svg><path>` (or styled `<div>`) into the DOM.  It also listens for window `transform` events to re-paint lines.
4. **validation.js** – ensures `image` → `image`, etc.

All connections are persisted so re-render on page load.

---

## 7. Sidebar & Tool Selection (`toolSelection.js`)

• Groups tools by `category` and renders filterable list.
• When user clicks a tool, calls `createToolWindow()` at *current canvas centre*.
• Also supplies context-aware *output → compatible inputs* modal (`showToolsForConnection`).

---

## 8. Action Modal & Create Sub-Menu (`index.js`)

A floating modal appears on background click, giving quick-actions:
* **Upload** – opens drag-n-drop for images → handled by `io.uploadFile()`.
* **Create** – shows emoji list (🖼️, 🎵, 📝, 🎬).  Each maps to a *creation category* → filtered tools list.

---

## 9. Components Snapshot

| Component | Purpose |
|-----------|---------|
| `AccountDropdown`            | Wallet connect, user switcher |
| `SpellsMenuModal`            | Browse & insert saved spells |
| `MintSpellFAB`               | Floating Action Button to save current selection as a new spell |
| `historyModal`               | Visualises undo/redo stack |
| `ReferralVaultModal/*`       | Referral program UX |

These components are *framework-less* class modules that mutate the DOM directly.

---

## 10. Onboarding Flow (`onboarding/`)

A multi-step guided tour triggered on first visit.  Each step module exports `show()` and `hide()` and registers itself with `onboarding.js` which keeps current index in `localStorage` so it only runs once per user.

---

## 11. Styling

All CSS lives in `style/`, grouped by component.  Variables (`variables.css`) define the colour scheme so new components stay consistent.  No CSS-in-JS is used to keep payload small.

---

## 12. Extending the Sandbox

1. **Add a new Tool backend definition** and expose it via `/api/v1/tools/registry`.
2. Implement **front-end parameter schema** (if needed) in `node/parameterInputs.js`.
3. The sandbox auto-fetches new tools on refresh – no further code required unless you need custom preview overlays.
4. For new overlay types, add a file in `node/overlays/` and call injection from `node/index.js`.

---

## 13. Gotchas & Tips

* **Coordinate space** – always store positions in **workspace** coords.  Use `screenToWorkspace()` helpers when reading mouse events.
* **Persist early** – any change that should survive reload *must* call `persistState()`.
* **Undo safety** – push to history *before* mutating state (`pushHistory()` in `manager.js`).
* **Large workflows** – 50 history snapshots × large JSON can blow up localStorage; watch the console warnings.
* **CSS isolation** – `.sandbox-` prefix everything to avoid bleeding into public site.

---

## 14. Open Questions / TODO

* Investigate moving state from `localStorage` to IndexedDB for size + performance.
* Lazy-load heavy modals (e.g. BuyPointsModal) to reduce initial bundle.
* Add hit-testing optimisation for lasso selection when many nodes are present.

---

**Happy hacking!** 