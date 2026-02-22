# Sandbox Migration Handoff

## What Was Done

The sandbox (~26K LOC visual node editor) was fully migrated from vanilla JS served via `client/index.html` to a microact SPA route. **Phase 4 (tool windows + canvas) is complete.** The old vanilla window system has been replaced by a reactive SandboxCanvas component.

**Branch:** `feature/microact-frontend`

### Architecture

```
Sandbox.js (microact page, boot orchestrator)
  ├── SandboxHeader       → nav links open SpellsModal, CookModal, ModsModal (all microact)
  │   └── AccountDropdown → HistoryModal, ApiKeysModal, VaultModal, BuyPointsModal
  ├── WorkspaceTabs       → save/load/switch workspaces
  ├── SandboxCanvas       → reactive canvas (zoom/pan/lasso, windows, connections, execution)
  │   ├── WindowRenderer  → purely props-driven window chrome (header, anchors, close)
  │   ├── ToolWindowBody  → window body variants (tool, spell, upload)
  │   ├── ConnectionLayer → SVG connection lines between anchors
  │   └── ConnectionDropPicker → contextual tool picker on anchor drop
  ├── Sidebar             → renders tools from store, calls canvas.addToolWindow()
  ├── CostHUD             → exchange rates, denomination cycling
  ├── MintSpellFAB        → shows on 2+ selection, emits openSpellsModal event
  └── ActionModal         → 3-level picker (root/categories/tools/upload) at click point
```

### Boot Sequence (Sandbox.js `_boot()`)
1. `_loadAuth()` — ensure CSRF token + user core
2. `initStore()` — reactive store init
3. `initializeTools()` — fetch tool registry → `eventBus.emit('sandbox:availableTools', tools)`
4. `SandboxCanvas` mounts: restores windows/connections from localStorage, init WebSocket, exposes `window.sandboxCanvas`

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/Sandbox.js` | Top-level page, boot orchestrator |
| `frontend/src/sandbox/store.js` | Reactive store wrapping state.js |
| `frontend/src/sandbox/canvas/SandboxCanvas.js` | Core canvas: state, drag, zoom/pan, execution |
| `frontend/src/sandbox/canvas/WindowRenderer.js` | Window chrome — header, anchors, close button |
| `frontend/src/sandbox/canvas/ToolWindowBody.js` | Window body — tool params/results, spell, upload |
| `frontend/src/sandbox/canvas/ConnectionLayer.js` | SVG connection lines between output→input anchors |
| `frontend/src/sandbox/canvas/ConnectionDropPicker.js` | Contextual tool picker when anchor dropped on canvas |
| `frontend/src/sandbox/io.js` | Tool registry fetch, `uploadToStorage()` |
| `frontend/src/sandbox/executionClient.js` | HTTP execution API calls |
| `frontend/src/sandbox/node/websocketHandlers.js` | WebSocket message routing + completion promises |
| `frontend/src/sandbox/ws.js` | WebSocket singleton |
| `frontend/src/sandbox/state.js` | Shared state with `window.__sandboxState__` |
| `frontend/src/sandbox/subgraph.js` | Subgraph serialization (used by MintSpellFAB) |
| `frontend/src/sandbox/components/windows/ParameterForm.js` | Parameter input widgets |
| `frontend/src/sandbox/components/windows/ResultDisplay.js` | Output rendering (image/text/video) |
| `frontend/src/sandbox/components/windows/CostDisplay.js` | Cost estimate chip in window header |
| `frontend/src/sandbox/components/windows/VersionSelector.js` | Output version switcher |
| `frontend/src/sandbox/components/Modal.js` | Base overlay + Loader + ModalError |
| `frontend/src/sandbox/components/ModalKit.js` | Shared UI kit (8 components) |
| `frontend/src/lib/api.js` | fetchJson, postWithCsrf, fetchWithCsrf |
| `frontend/src/lib/format.js` | Shared formatting (formatUnits, shortenAddress, etc.) |

---

## Migrated Modals (Phase 3 — Complete)

All 4 large modals + 2 smaller modals migrated from vanilla innerHTML/DOM to microact components.

| Component | File | Replaces | LOC |
|-----------|------|----------|-----|
| **VaultModal** | `VaultModal.js` | ReferralVaultDashboardModal + ReferralVaultModal | ~350 |
| **SpellsModal** | `SpellsModal.js` | SpellsMenuModal (1882 LOC) | ~620 |
| **BuyPointsModal** | `BuyPointsModal.js` | BuyPointsModal IIFE (1488 LOC) | ~530 |
| **CookModal** | `CookModal.js` | CookMenuModal (3139 LOC) | ~650 |
| **TraitTreeEditor** | `TraitTreeEditor.js` | TraitTreeEditor (375 LOC) | ~260 |
| **ModsModal** | `ModsModal.js` | ModsMenuModal shell | ~89 |
| **ModelBrowser** | `ModelBrowser.js` | ModsMenuModal browse tab | ~523 |
| **TrainingStudio** | `TrainingStudio.js` | ModsMenuModal train tab (4867 LOC total) | ~1305 |

**Total:** ~4327 LOC microact replacing ~11,751 LOC vanilla.

### Shared UI Kit (ModalKit.js)

| Component | Props | Purpose |
|-----------|-------|---------|
| **CopyButton** | `text, label` | Click-to-copy with "Copied!" feedback |
| **AsyncButton** | `onclick, label, loading, disabled, variant` | Button with spinner during async ops |
| **EmptyState** | `icon, message, action, onAction` | Centered empty state with CTA |
| **ConfirmInline** | `message, onConfirm, onCancel` | Inline yes/no (replaces browser `confirm()`) |
| **TabBar** | `tabs, active, onChange` | Horizontal tab switcher |
| **SearchBar** | `value, placeholder, onInput, onSearch` | Input + search button |
| **TagPills** | `tags, active, onSelect` | Scrollable filter pills |
| **Badge** | `label, variant` | Small status label |

### Trigger Architecture

```
SandboxHeader
  ├── "cast" nav → state.showSpells → h(SpellsModal)
  ├── "cook" nav → state.showCook   → h(CookModal)
  └── "mod"  nav → state.showMods   → h(ModsModal)

AccountDropdown
  ├── "Referral Vaults" → state.showVaults    → h(VaultModal)
  ├── "Get More Points" → state.showBuyPoints → h(BuyPointsModal)
  ├── "History"         → state.showHistory   → h(HistoryModal)
  └── "API Keys"        → state.showApiKeys   → h(ApiKeysModal)

MintSpellFAB
  └── click → eventBus.emit('openSpellsModal', { subgraph })
      → SandboxHeader listens → opens SpellsModal in create mode
```

---

## SandboxCanvas: How It Works

### State Shape

```js
{
  windows: [{ id, type, x, y, tool, spell, cost, parameterMappings,
              outputVersions, currentVersionIndex, currentOutput, status }],
  connections: [{ id, fromWindowId, outputType, toWindowId, toParam }],
  viewport: { x, y, scale },
  activeConnection: null | { fromWindowId, outputType, startX, startY, currentX, currentY },
  pendingAnchorDrop: null | { fromWindowId, outputType, workspacePos, screenX, screenY },
  isDraggingCanvas: false,
  draggingWindowId: null,
  selectedWindowIds: Set,
}
```

### Public API (window.sandboxCanvas)

```js
canvas.addToolWindow(tool, workspacePos)    // add tool window at position
canvas.addSpellWindow(spell, workspacePos)  // add spell window at position
canvas.addUploadWindow(url, workspacePos)   // add upload window with image
canvas.screenToWorkspace(screenX, screenY) // convert screen → workspace coords
```

### Execution Flow

1. User clicks "Run" in `ToolWindowBody`
2. `SandboxCanvas._executeWindow(windowId)` called
3. Resolves parameter values (direct or from connected window outputs)
4. Calls `executionClient.executeToolWindow(tool, params, generationId)`
5. `generationCompletionManager.createCompletionPromise(generationId)` sets up WS wait
6. WebSocket `generationUpdate` → `resolveCompletionPromise(generationId, result)` fires
7. Canvas updates window state with result image/text/etc

### Connection System

- Drag from output anchor (right side) → canvas tracks `activeConnection` in state
- `data-connecting-type` attr on canvas root → CSS highlights compatible input anchors
- Drop on input anchor → connection created, `parameterMappings` updated on target window
- Drop on empty canvas → `pendingAnchorDrop` set → `ConnectionDropPicker` renders
- `ConnectionDropPicker` shows only tools with compatible input params, auto-connects on select

### Canvas Persistence

```js
// Auto-save on every state change
localStorage.setItem(`sandbox_canvas_${workspaceId}`, JSON.stringify({ windows, connections }))

// Restored at boot via loadCanvasState()
```

---

## Critical Knowledge

### The Module Graph Split

**Important:** Two separate module graphs exist at runtime.

1. **Vite-bundled** — `frontend/src/**` compiled by Vite into `dist/assets/`
2. **Raw ESM** — `client/src/sandbox/**` served as-is from Express at `/sandbox/`

The `state.js` bridge uses `window.__sandboxState__` as shared backing storage so both graphs share the same data. **All mutations must be in-place** (`.push()`, `.splice()`, `.length = 0`) — never reassign with `=`.

**Note:** With Phase 4 complete, the Vite graph no longer imports from `/sandbox/` except via `node/websocketHandlers.js` (still uses `ws.js` for the WS singleton). The raw ESM graph is mostly vestigial now.

### Microact Limitations

- **Components cannot return `null` from `render()`** — returns crash createElement. Use `h('div', { style: 'display:none' })` instead.
- **Components cannot return arrays from `render()`** — must have single root element.
- **`h()` does NOT inject children into component `props`** — always pass content via explicit props (e.g., `content: [...]` for Modal).
- **`h()` filters `null`/`false`/`true` from children** — but objects with null `.type` crash.
- **Imperative DOM children get wiped on re-render** — use `shouldUpdate() { return false; }` for containers that have imperatively-added children.
- **Component `subscribe(event, fn)`** — hooks into eventBus with auto-cleanup on unmount.
- **CSS class names are global** — use prefixed class names (e.g., `nw-`, `sc-`, `mk-`, `cdp-`) to avoid collisions.

### Dev Workflow

- `scripts/run-dev.sh` — Express `:4000` + Vite `:5173` with HMR
- `scripts/run-dev-prod.sh` — Express `:4000` with built dist (no HMR)
- Visit `app.localhost:5173` for sandbox (HMR), `localhost:5173` for marketing
- Vite proxies `/api`, `/ws`, `/sandbox`, `/js`, `/images` to Express

---

## What's Left

### Remaining Migration Steps

1. **Production build validation** — run `vite build`, verify no errors, deploy to staging
2. **Main server validation** — smoke test on production server: create windows, run tools, connect anchors, save/restore workspaces
3. **Bug fixes pass** — execution result delivery edge cases, connection drag UX polish, window positioning
4. **Style overhaul** — "2000s web aesthetic, TBD". Extract hardcoded colors into CSS custom properties for theme-ability.

### Other Items

- **OnboardingOverlay** — component exists but disabled. Old step modules need migration or the overlay needs its own step components.
- **Notification toast system** — `showNotification` is missing. Needed as shared infrastructure.
- **`client/src/sandbox/` cleanup** — once WS handlers are migrated, the `/sandbox/` Express static route and `window.__sandboxState__` bridge can be removed.
- **Responsive design pass** — canvas currently desktop-only.

### Known Issues

- `app.localhost:5173` may not work in all browsers (subdomain DNS). Falls back to `app.localhost:4000`.
- The `run-dev.sh` has a race condition where Vite starts before Express is ready. Non-blocking but causes initial proxy errors.
- CostHUD exchange rate fetch may fail if backend isn't fully up.
