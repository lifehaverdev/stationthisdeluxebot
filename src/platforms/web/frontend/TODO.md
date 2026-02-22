# Frontend TODO

## Bugs
- [ ] Admin WalletGate forces re-sign on every visit even when JWT session exists. Should check session cookie first, only fall back to wallet NFT verification when unauthenticated. May need a `/api/v1/auth/session/check` endpoint or read from existing `/api/v1/auth/session/refresh`.

## Optimization
- [ ] Main bundle still 492KB — micro-web3 pulls in ethers. Consider lazy-loading the AuthModal (wallet connect) similar to how Admin is lazy-loaded.
- [ ] Admin chunk 506KB — chart.js is ~200KB. Consider lighter charting lib or lazy-loading individual chart components.
- [ ] Vite `manualChunks` config to split ethers into its own chunk shared between AuthModal and Admin.

## Polish
- [ ] Admin dashboard — port remaining sections from old code: free points dashboard, rankings table, active users table, business accounting, cost entry form, cost totals, deposit follow-up queue with full CRUD, deposit diagnostics (on-chain custody key check).
- [ ] Admin — replace `confirm()` / `prompt()` calls with proper microact modals.
- [ ] Admin — on-chain balance verification (reading Foundation contract custody keys for mismatch detection).
- [ ] Landing — port features auto-scroll/shuffle, cost badges from tool registry, reviews scroller, "used by" section.
- [ ] Docs — port tool detail expand/collapse toggle.
- [ ] Shared — notification toast system (currently `showNotification` is missing).
- [ ] Responsive design pass across all pages.
- [ ] Design system — establish the new aesthetic (earmarked as "2000s web aesthetic, TBD"). Extract hardcoded colors into CSS custom properties.

## Migration Progress

### Phase 3: Modal Migration — COMPLETE
All 4 large modals + 2 smaller modals migrated to microact:
- [x] VaultModal (ReferralVaultDashboard + creation flow merged)
- [x] SpellsModal (My Spells + Marketplace with cost quotes)
- [x] BuyPointsModal (5-step purchase wizard with Web3)
- [x] CookModal + TraitTreeEditor (collections, cooking, trait tree, analytics)
- [x] ModsModal = ModelBrowser + TrainingStudio (model browse, training wizard, dataset CRUD, captions)
- [x] ModalKit shared component library (8 reusable components)
- [x] Modal base `content` prop fix (microact h() children bug)
- [x] modals.js emptied — no more vanilla lazy loaders

### Phase 4: Tool Window Components — COMPLETE

#### Phase 4a: Foundation Layer — COMPLETE
- [x] ParameterForm — parameter inputs (text/number/select/connected/conditional)
- [x] ResultDisplay — output rendering (image/text/video/file/spell-multi-step)
- [x] VersionSelector, CostDisplay shared display components

#### Phase 4b: SandboxCanvas Migration — COMPLETE
- [x] SandboxCanvas — reactive canvas replacing viewport.js + windowManager.js + ExecutionService
- [x] WindowRenderer — props-driven window chrome (header, anchors, close)
- [x] ToolWindowBody — window body variants: tool, spell, upload
- [x] ConnectionLayer — SVG connection rendering
- [x] ConnectionDropPicker — contextual tool picker when anchor dropped on empty canvas
- [x] Sandbox.js rewritten — mounts SandboxCanvas, removed old boot sequence
- [x] Sidebar.js rewritten — calls canvas.addToolWindow() instead of old window manager
- [x] ActionModal.js rewritten — 3-level picker (categories/tools/upload)
- [x] io.js — added uploadToStorage(), initializeTools()
- [x] websocketHandlers.js — fixed resolveCompletionPromise outside toolWindowEl guard

#### Phase 4c: Old Code Removal — COMPLETE
- [x] Deleted viewport.js (replaced by SandboxCanvas zoom/pan)
- [x] Deleted execution.js (replaced by executionClient.js + websocketHandlers.js)
- [x] Deleted windowManager.js (replaced by SandboxCanvas state)
- [x] Deleted toolSelection.js (dead, replaced by ActionModal + ConnectionDropPicker)
- [x] Deleted anchors.js (dead, replaced by WindowRenderer anchor system)
- [x] Deleted connections/ directory (dead, replaced by ConnectionLayer)
- [x] Deleted node/index.js (dead, replaced by canvas.addToolWindow())
- [x] Deleted node/overlays/ (dead, spell editor inline in SpellWindowBody)
- [x] Deleted components/windows/ToolWindowComponent.js + SpellWindowComponent.js + UploadWindowComponent.js
- [x] Deleted components/windows/CollectionTestWindow.js + CollectionReviewWindow.js + CollectionCullWindow.js + CollectionReviveWindow.js + ReviewService.js
- [x] Deleted components/windows/WindowShell.js + WindowDrag.js + ExecutionService.js

### Remaining Migration Steps
- [ ] Production build validation — run `vite build`, verify no errors
- [ ] Main server validation — smoke test: create windows, run tools, connect anchors, save/restore
- [ ] Bug fixes pass — execution edge cases, connection drag polish, window positioning
- [ ] Style overhaul — 2000s web aesthetic, extract CSS custom properties

### Other
- [ ] OnboardingOverlay — disabled, needs step component migration
- [ ] Notification toast system — shared infrastructure needed
- [ ] `client/src/sandbox/` cleanup — remove /sandbox/ Express static route once WS handlers migrated
