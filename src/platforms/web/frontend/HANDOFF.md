# Sandbox Migration Handoff

## What Was Done

The sandbox (~26K LOC visual node editor) was migrated from vanilla JS served via `client/index.html` to a microact SPA route. The old code still works via runtime ESM imports while chrome UI is now microact components.

**Branch:** `feature/microact-frontend`
**Commit:** `e2a811b` — sandbox migration to microact SPA — phases 0-6

### Architecture

```
Sandbox.js (microact page, boot orchestrator)
  ├── SandboxHeader       → nav links open modals via lazy shells
  │   └── AccountDropdown → HistoryModal, ApiKeysModal as children
  ├── WorkspaceTabs       → save/load/switch workspaces
  ├── Canvas DOM
  │   ├── viewport.js     → imperative zoom/pan/lasso (60fps, no setState)
  │   └── Tool windows    → old vanilla ToolWindow classes via windowManager
  ├── Sidebar             → renders tools from store, creates windows on click
  ├── CostHUD             → exchange rates, denomination cycling
  ├── MintSpellFAB        → shows on 2+ node selection
  └── ActionModal         → upload/create at click point
```

### Boot Sequence (Sandbox.js `_boot()`)
1. Load `state.js` + `connections/index.js` at runtime
2. Create viewport (zoom/pan/lasso on canvas DOM)
3. WindowManager: load tools, restore windows from localStorage
4. Sandbox `init()`: fetch interceptor, session keepalive, paste handler
5. ExecutionService: WebSocket connect + generation handlers
6. Wire reload helper for workspace switching
7. Recover pending generations

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/Sandbox.js` | Top-level page, boot orchestrator |
| `frontend/src/sandbox/store.js` | Reactive store wrapping state.js |
| `frontend/src/sandbox/viewport.js` | Zoom/pan/touch/lasso controller |
| `frontend/src/sandbox/windowManager.js` | Tool loading, window restore/reload |
| `frontend/src/sandbox/execution.js` | WebSocket + generation tracking |
| `frontend/src/sandbox/components/Modal.js` | Base overlay (all modals use this) |
| `frontend/src/sandbox/components/modals.js` | Lazy loaders for 4 large vanilla modals |
| `client/src/sandbox/index.js` | Fetch interceptor, paste handler (100 LOC) |
| `client/src/sandbox/state.js` | Shared state with `window.__sandboxState__` |

---

## Critical Knowledge

### The Module Graph Split

**The most important thing to understand:** Two separate module graphs exist at runtime.

1. **Vite-bundled** — `frontend/src/**` compiled by Vite into `dist/assets/`
2. **Raw ESM** — `client/src/sandbox/**` served as-is from Express at `/sandbox/`

These are loaded by the browser as separate module graphs. An `import` from one graph gets a **different module instance** of state.js than an import from the other.

**Solution:** `state.js` uses `window.__sandboxState__` as shared backing storage. Both graphs' exports point to the same arrays/sets. **All mutations must be in-place** (`.push()`, `.splice()`, `.length = 0`) — never reassign with `=`.

**If you add new state to state.js:** Add it to the `_shared` object at the top of state.js, initialize the export from `_shared`, and use setter functions that mutate in place.

### Microact Limitations

- **Components cannot return `null` from `render()`** — returns crash createElement. Use `h('div', { style: 'display:none' })` instead.
- **Components cannot return arrays from `render()`** — must have single root element.
- **`h()` filters `null`/`false`/`true` from children** — but objects with null `.type` crash.
- **Imperative DOM children get wiped on re-render** — if a microact-managed container has children added imperatively, the diff will remove them. Use `shouldUpdate() { return false; }` or render empty containers and ensure no re-renders touch them.
- **Component `subscribe(event, fn)`** — hooks into eventBus with auto-cleanup on unmount. Use this for cross-component communication.

### Cross-Graph Communication

- **eventBus** (from `@monygroupcorp/microact`) — true singleton, works across both graphs. Best for notifications.
- **`window.__sandboxState__`** — shared state object, works across both graphs. Best for data.
- **Store subscriptions** — only work within the Vite-bundled graph. Don't rely on them for `/sandbox/` → frontend notifications.
- **Dynamic imports with `@vite-ignore`** — use `import(/* @vite-ignore */ '/sandbox/' + 'file.js')` to load sandbox modules at runtime. The string concatenation prevents Vite from trying to resolve them.

### Dev Workflow

- `scripts/run-dev.sh` — Express `:4000` + Vite `:5173` with HMR
- `scripts/run-dev-prod.sh` — Express `:4000` with built dist (no HMR)
- Visit `app.localhost:5173` for sandbox (HMR), `localhost:5173` for marketing
- Vite proxies `/api`, `/ws`, `/sandbox`, `/js`, `/images` to Express

---

## What's Left

### 4 Large Modals (still vanilla, loaded via lazy shells)

These work but are unmigrated. Each should be decomposed into sub-components:

| Modal | LOC | Decomposition |
|-------|-----|--------------|
| **SpellsMenuModal** | 1882 | SpellsList, SpellEditor, SpellMarketplace, SpellCreator |
| **CookMenuModal** | 3139 | CookList, CookDetail (overview/traits/analytics), ExportJobs |
| **ModsMenuModal** | 4867 | ModsBrowser, TrainingDash, TrainingWizard, DatasetManager |
| **BuyPointsModal** | 1488 | AssetSelector, AmountInput, ReviewStep, TxStatus, Receipt |

**Approach:** Use the Modal base component. Each sub-view is a separate component. State is local to the modal (no store needed). API calls use `fetchWithCsrf`/`fetchJson` from `lib/api.js`. WebSocket via `websocketClient` from `sandbox/ws.js`.

**Key concern:** These modals call into `/sandbox/` functions (createToolWindow, createSpellWindow, etc.). Use dynamic imports with `@vite-ignore` to cross the module boundary, same pattern as Sidebar and ActionModal.

### Other Items

- **OnboardingOverlay** — component exists but disabled. Old step modules need migration or the overlay needs its own step components.
- **ReferralVaultDashboardModal** — still a vanilla IIFE. Small (~200 LOC), straightforward migration.
- **Tool window components** — the vanilla ToolWindow/SpellWindow classes work but are the eventual target for Phase 4 of the original plan. Massive effort, defer until modals are done.
- **`client/src/sandbox/` cleanup** — once all components are migrated, this directory can be deleted and everything bundled by Vite. The `/sandbox/` Express static route and `window.__sandboxState__` bridge can be removed.

### Known Issues

- `app.localhost:5173` may not work in all browsers (subdomain DNS). Falls back to `app.localhost:4000`.
- The `run-dev.sh` has a race condition where Vite starts before Express is ready. Non-blocking but causes initial proxy errors.
- CostHUD exchange rate fetch may fail if backend isn't fully up.
