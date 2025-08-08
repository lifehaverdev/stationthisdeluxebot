# HANDOFF: 2025-08-07 Sanbox Audit

## Work Completed
- Reviewed `WEB_FRONTEND_NORTH_STAR.md` principles and compared with current sandbox implementation.
- Listed actual directory contents of `src/platforms/web/client/src/sandbox` and key sub-directories (`node/`, `connections/`, `components/`, etc.).
- Cross-checked sandbox README **Directory-Level Map** against real file tree.
- Searched sandbox codebase for heavy client-side libraries (React, lodash, jquery, etc.).
- Sampled file sizes to identify potentially heavy modules delivered to client.

## Current State
1. **Lean Architecture Alignment**
   - No usage of React, Vue, jQuery, lodash or other large frameworks detected inside sandbox source.
   - Code is organised in small ES modules, relies on native DOM APIs → ✅ complies with North-Star “native-first” & “lean” principles.

2. **README vs Reality**
   The README is mostly accurate but missing several newer artefacts:
   - **Root level files not documented**: `executionClient.js`, `subgraph.js`.
   - **node/** extras: `resultContent.js`, `websocketHandlers.js`.
   - **components/** extras: `ModsMenuModal.js`, `BuyPointsModal/*`, `ReferralVaultDashboardModal/*`.
   - README component list is presented as snapshot (“…”) but directory diagram should be updated for clarity.

3. **Potential Bundle Bloat**
   - `BuyPointsModal` (≈24 KB) & `SpellsMenuModal` (≈26 KB) are the largest single files; they are imported un-gated and therefore included in initial bundle. README TODO (#13) suggests lazy-loading heavy modals — not yet implemented.
   - Image/CSS assets under `sandbox/style/` appear scoped & minimal; no oversized media shipped.

4. **Public JS Overlap**
   - `public/js/*` scripts serve marketing / landing pages; none import sandbox modules, so risk of duplication is low. Confirmed no `sandbox` references inside those bundled files.

5. **North-Star Checks**
   - ✔ Native DOM APIs, no virtual DOM.
   - ✔ Centralised state in `state.js` with explicit persistence.
   - ✔ Event bus style implemented through custom listeners; no heavy pub/sub lib.
   - ❗ **Performance Optimisation**: Large modals & onboarding code are still part of main bundle; consider code-splitting.

## Next Tasks
1. Update `sandbox/README.md` directory map & component list to include new files/modules.
2. Introduce dynamic `import()` or conditional script injection for rarely-used heavy components (`BuyPointsModal`, onboarding steps, etc.).
3. Evaluate tree-shaking & minification settings in build pipeline (not covered in this audit) to ensure unused exports are dropped.
4. Consider moving persistent state from `localStorage` → IndexedDB as per README TODO (size/performance).
5. Run bundle size snapshot (e.g. `source-map-explorer`) to quantify gains after lazy-loading.

## Changes to Plan
- None at architectural level; recommendations fit within existing North-Star principles.

## Open Questions
1. What is the current client build process / bundler (not present in repo)? Needed to scope code-splitting work.
2. Should marketing-site JS (`public/js/*`) eventually be migrated into `src/platforms/web/client` for single pipeline management?
3. Any planned feature additions that could justify introducing a lightweight component framework (e.g. lit-html) or stick to pure DOM? 