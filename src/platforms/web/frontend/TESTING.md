# Frontend Migration — Testing Procedure

Sequential test plan. Each tier depends on the previous passing. Stop at first failure, fix, then continue.

## Tier 0: Does it compile?

**Goal:** Vite can bundle everything without import errors.

```bash
cd src/platforms/web/frontend && npx vite build --mode development 2>&1 | head -50
```

- [ ] Build completes without errors
- [ ] No "Could not resolve" import errors
- [ ] No circular dependency warnings that break the build

If build fails: the error message will show exactly which import path is broken. Fix that import, rebuild.

---

## Tier 1: Does it load?

**Goal:** The app renders in the browser without console errors on page load.

1. Start dev server: `scripts/run-dev.sh`
2. Open `app.localhost:5173` in browser
3. Open DevTools Console

- [ ] Page loads without white screen
- [ ] SandboxHeader renders (logo, cast/cook/mod nav links, account button)
- [ ] Canvas area renders (dark grid background)
- [ ] Sidebar renders (tool categories)
- [ ] CostHUD renders (bottom corner)
- [ ] No red errors in console (warnings OK)
- [ ] No "Failed to fetch" errors for `/api/v1/tools/registry`

**Common failures at this tier:**
- Import path typo → "Failed to resolve module"
- Missing export → "does not provide an export named"
- state.js initialization error → white screen
- CSS class collision → visual glitch but still renders

---

## Tier 2: Do modals open?

**Goal:** All 6 migrated modals open and display content.

### Header modals (SandboxHeader)
- [ ] Click "cast" → SpellsModal opens with "My Spells" tab
- [ ] Click "cook" → CookModal opens with collections
- [ ] Click "mod" → ModsModal opens with Browse/Train tabs
- [ ] All 3 close on ESC, backdrop click, and × button

### Account modals (AccountDropdown)
- [ ] Click account button → dropdown opens
- [ ] "Referral Vaults" → VaultModal opens, lists vaults
- [ ] "Get More Points" → BuyPointsModal opens, shows asset selection
- [ ] "History" → HistoryModal opens
- [ ] "API Keys" → ApiKeysModal opens
- [ ] All close correctly

**Common failures at this tier:**
- Modal `content` prop not passed → empty modal (just close button)
- AsyncButton `label` prop missing → buttons with no text
- API 404 → error message in modal (check backend is running)

---

## Tier 3: Can windows be created?

**Goal:** Tool windows mount on the canvas and render parameters.

### Tool window from Sidebar
- [ ] Click a tool in the sidebar → window appears on canvas
- [ ] Window has header (tool name), parameters, execute button
- [ ] Window is draggable (grab header, move)
- [ ] Window close button works (× removes it)
- [ ] Parameters render correctly (text inputs, dropdowns for enums)
- [ ] "show more" toggle reveals optional parameters

### Spell window
- [ ] Open SpellsModal → select a spell → "Add to Canvas"
- [ ] SpellWindow appears with exposed input fields
- [ ] If spell is private/inaccessible → locked state shows (🔒)

### Upload window
- [ ] Trigger upload (drag image to canvas or through ActionModal)
- [ ] Upload window appears with file input and canvas area
- [ ] Can select file → preview renders

**Common failures at this tier:**
- windowManager doesn't mount component → nothing appears
- Anchor attachment fails → window renders but no connection dots
- State registration fails → window appears but isn't tracked
- Drag not working → `WindowDrag.js` handle not found (check `.tw-header` selector)

---

## Tier 4: Do connections work?

**Goal:** Users can draw connections between windows and they persist.

- [ ] Create two tool windows (e.g., text-to-image + upscaler)
- [ ] Drag from output anchor (right side emoji) of first window
- [ ] Temporary line appears during drag
- [ ] Drop on input anchor (left side emoji) of second window
- [ ] Permanent connection line renders between windows
- [ ] Second window shows "connected" indicator on the parameter
- [ ] Dragging a window → connection line follows (redraws)
- [ ] Click connection line → removes it
- [ ] Connection persists after page reload (localStorage)

**Common failures at this tier:**
- Anchors not rendering → `_attachAnchors()` failed
- `startConnection` not imported → anchor clicks do nothing
- Connection lines don't redraw on drag → `scheduleRenderAllConnections` not called in `onDragEnd`
- Cycle detection fails → can connect window to itself

---

## Tier 5: Does execution work?

**Goal:** Running a tool produces output displayed in the window.

### Tool execution
- [ ] Create a tool window, fill in required params
- [ ] Click "Execute" → button shows loading state
- [ ] Progress message appears ("Executing...", then status updates)
- [ ] Result renders (image/text/video depending on tool)
- [ ] Cost display updates after execution
- [ ] Version selector shows new version
- [ ] Switch to previous version → params/output restore

### Chain execution
- [ ] Connect tool A output → tool B input
- [ ] Execute tool B → confirmation prompt for chain (2 nodes)
- [ ] Both execute in order, B uses A's output
- [ ] Both show results

### Spell execution
- [ ] Add spell to canvas, fill exposed inputs
- [ ] Click "Cast Spell" → loading state
- [ ] Step progress updates (if multi-step spell)
- [ ] Final output renders

**Common failures at this tier:**
- ExecutionService not initialized → "Failed to load modules"
- WebSocket handlers not registered → execution starts but never completes
- Output polling misses update → stuck on "Executing..."
- Cost tracking broken → cost shows 0 after execution

---

## Tier 6: Do collection operations work?

**Goal:** The cook/review/cull/revive flow works end-to-end.

### Collection test window
- [ ] Open CookModal → select a collection → "Test" button
- [ ] CollectionTestWindow opens with trait selectors
- [ ] Select traits, click Execute → result renders

### Collection review window
- [ ] From CookModal → "Review" button on a collection
- [ ] ReviewWindow opens → "Start Reviewing" button
- [ ] Pieces load with image + trait info
- [ ] Accept/Reject buttons work → next piece loads
- [ ] Sync status badge shows pending count → "All synced"

### Collection cull window
- [ ] From CookModal → "Cull" button
- [ ] CullWindow opens with supply stats
- [ ] Keep/Exclude buttons work
- [ ] Delta indicator updates
- [ ] `collection:cull-updated` event dispatches (check other windows refresh)

### Collection revive window
- [ ] From CookModal → "Revive" button
- [ ] ReviveWindow loads excluded pieces
- [ ] Keep/Skip buttons work
- [ ] Pagination loads more pieces

**Common failures at this tier:**
- ReviewService flush fails → decisions don't sync
- 429 backoff not working → rapid clicking causes errors
- Cull stats endpoint returns unexpected shape
- Revive cursor pagination breaks on empty result

---

## Tier 7: Workspace persistence

**Goal:** State survives page reload and workspace switching.

- [ ] Create several windows with connections
- [ ] Execute a tool (get output)
- [ ] Hard reload page (Cmd+R)
- [ ] All windows restore in correct positions
- [ ] Connections restore (lines redraw)
- [ ] Output shows "Load Image/Text" button → click → output renders
- [ ] Cost display preserved

### Workspace switching
- [ ] Open WorkspaceTabs → save current workspace
- [ ] Switch to a different workspace (or create new)
- [ ] Canvas clears, new workspace loads
- [ ] Switch back → original workspace restores

**Common failures at this tier:**
- state.js `persistState()` not called → nothing saved
- Serialization error (circular ref, too large) → save silently fails
- `initState()` doesn't read localStorage → windows don't restore
- Connection rendering after restore → lines in wrong positions

---

## Tier 8: MintSpellFAB

**Goal:** Selecting nodes and minting a spell works.

- [ ] Create 2+ tool windows
- [ ] Select both (lasso or Ctrl+click)
- [ ] MintSpellFAB appears at bottom ("Mint as Spell")
- [ ] Click FAB → SpellsModal opens in Create view
- [ ] Subgraph steps are pre-populated
- [ ] Fill name, save → spell created
- [ ] New spell appears in My Spells list

---

## Quick Smoke Test (5 minutes)

If you're short on time, this covers the critical revenue path:

1. Page loads ✓
2. Click "cast" → SpellsModal opens ✓
3. Click a tool in sidebar → window appears on canvas ✓
4. Fill params, click Execute → result appears ✓
5. Create second window, connect them → chain works ✓
6. Open account → "Get More Points" → BuyPointsModal opens ✓
7. Reload page → windows restore ✓
