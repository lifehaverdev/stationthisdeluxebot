# Spell Cast & Cook Parent Linking – Testing Log (2025-09-01)

## Scenario
Manually executed a two-step spell (`lazyoni`) via `/api/v1/spells/cast` from the web sandbox.

## Timeline (abridged)
1. `POST /api/v1/spells/cast` → 202 Accepted – spell orchestration began.
2. Internal events/session creation succeeded.
3. **Cast document created** with id `68b5f7913d6fc68ef985bd71`.
4. Step 1 executed immediately (LLM). Generation record `68b5f7913d6fc68ef985bd73` created.
5. `WorkflowExecution.continueExecution` attempted to `PUT /internal/v1/data/spells/casts/:castId` with payload `{ generationId, costDeltaUsd }`.
6. API returned **500**. Mongo driver threw `MongoInvalidArgumentError: Update document requires atomic operators`.
7. Spell continued to step 2 regardless; cook flow unaffected.

## Root Cause Analysis
Route implementation in `spellsApi` builds update doc like:
```js
const update = { updatedAt: new Date() };
if(generationId) update.$push = { stepGenerationIds: generationId };
if(costDeltaUsd!==undefined) update.$inc = { costUsd: costDeltaUsd };
if(status) update.status = status; // ← HERE – bare field assignment (no $set)
```
When **status** is omitted, update doc contains only `updatedAt` ‑ a non-atomic field, triggering Mongo’s error. (Mongo requires `$set`/`$push`/etc in update operators mode.)

## Fix Plan
1. Modify cast update route to place scalar fields inside `$set`, e.g.
```js
if(status) {
  update.$set = { ...update.$set, status };
  if(status==='completed') update.$set.completedAt = new Date();
}
update.$set = { ...update.$set, updatedAt: new Date() };
```
2. Re-test spell cast – expect 200 on cast update, `stepGenerationIds` populated, `costUsd` incrementing.

## Next Steps
- [ ] Patch `src/api/internal/spells/spellsApi.js` update handler.
- [ ] Re-run test to verify cast aggregation & completion.
- [ ] Observe cook flow once spell layer stable.
