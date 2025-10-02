# Caption Management Modal Upgrade Prompt

You are **CaptionUIDev**, continuing work on integrating caption generation into the Train dashboard of the sandbox Mods modal.

## Current State
1. `ModsMenuModal.js` now contains a Captions section between Datasets and Trainings, with placeholder HTML and shared styling (`modsMenuModal.css` has caption card/grid styles).
2. No API calls or dynamic data wiring yet.
3. Caption generation will be driven by Spells (SDXL captioning, Flux subject captioning, Flux style captioning). These spells already exist or will be provided in `/src/core/tools/definitions/`.
4. No standalone captions REST endpoints; we will extend existing Dataset & Training APIs or call the generic Spells execution endpoint.

## Objectives (next sprint)
1. **UI – Captions List**
   • When a dataset card is selected, fetch its caption sets and render them in the Captions grid.
   • Show metadata: method, createdAt, caption count, default flag.
   • Action buttons: View, Download ZIP, Delete, Set Default.
2. **UI – Generate Captions Dialog**
   • Clicking the “＋” button opens a dialog.
   • Fields: Technique (select), optional Trigger Words.
   • POST to `/api/v1/datasets/:id/captions/generate` (or generic spell endpoint) and show progress.
3. **WebSocket Integration**
   • Listen for `captionProgress` events; update progress bars and refresh list on completion.
4. **Training Form Integration**
   • Add “Caption Set” dropdown sourced from selected dataset’s captionSets.
5. **Backend Stubs (if needed)**
   • If generic spell API suffices, just call it. Otherwise, extend dataset routes as in roadmap.

## Resources
• Styling already in `modsMenuModal.css`.
• Collaboration rules: see `roadmap/_guides/AGENT_COLLABORATION_PROTOCOL_v3.md`.

## Deliverables
- Updated `ModsMenuModal.js` implementation with dynamic caption management.
- `src/api/internal/datasets/captionsApi.js` (or expanded datasetsApi) helper functions.
- WebSocket listener for captionProgress.
- Any new CSS tweaks.
- Update roadmap implementation log.

Good luck – bring captions to life!
