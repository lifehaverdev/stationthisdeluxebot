# Handoff – Cook Spell Integration (2025-09-02)

## Change Summary

1. **Backend**
   - `CookOrchestratorService.js`
     - Deterministic `pieceKey` = `cookId:index` replaces legacy `cook_jobs` id.
     - Added `submitPiece()` helper to route spell casts via `/spells/cast` and tools via `/execute`.
     - Immediate-submit logic updated; removed all `cook_jobs` writes.
   - `cookApi.js` `/active` endpoint now counts completed generation outputs from `generationOutputs` (status `completed|success`, not rejected) – no more `cook_events`/`cook_jobs`.

2. **Database**
   - No new collections. `generationOutputs` documents now carry:
     ```
     metadata: {
       cookId,
       collectionId,
       pieceIndex,
       jobId: `${cookId}:${pieceIndex}`
     }
     ```

3. **Frontend**
   - `CookMenuModal` spell picker wired; cook start succeeds with spellId.
   - CollectionWindow review & test flows compatible with spell outputs.

## Testing Notes

| Scenario | Result |
|----------|--------|
| Start cook with spell | ✅ pieces queued & executed |
| Progress count updates | ✅ active cooks list reflects accepted pieces |
| Reject piece → re-appears | ✅ generationCount drops, cook re-listed |
| Cook completes (all accepted) | ✅ disappears from Active list |

## Follow-ups

- Improve CollectionWindow test view to render multi-step spell outputs.
- Polish CookMenuModal UX (completed section, badge).

## Contributors
- @lifehaver (integration)
- Agent (coding assist)
