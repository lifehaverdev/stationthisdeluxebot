# Caption Spell Data Flow

This note captures the most recent failing caption run (Dec 11, 2025, 19:36:07 UTC) so future investigations have a concrete reference.

## Spell Steps

- **Step 1 – JoyCaption (`693b1d180e73a2cfa00c96aa`)**: seeds the subject description from the dataset image.
- **Step 2 – String rewrite (`693b1d240e73a2cfa00c96ac`)**: normalizes the JoyCaption output for the LLM.
- **Step 3 – ChatGPT (`693b1d260e73a2cfa00c96ae`)**: produces the final caption text (see below).

`stepGenerationIds` for the spell completion payload arrives in the same order: `[aa, ac, ae]`.

## Timeline Highlights

1. **14:36:06.847** – `/generations/693b1d260e73a2cfa00c96ae` updated; `WebSandboxNotifier` emits a `generationUpdate` containing the final caption text inside `payload.outputs.text`.
2. **14:36:07.106** – StepContinuator marks the spell finished and queues the spellCompletion notification.
3. **14:36:07.374** – Final PUT persists delivery metadata (`deliveryStrategy: spell_final`) but, due to write propagation lag, the `responsePayload.result` field is still empty on the subsequent GET the CaptionTaskService performs.
4. **14:36:07.422** – CaptionTaskService reads the generation documents via `/internal/v1/data/generations?_id_in=...` and logs “Caption missing …” even though the previous websocket payload already carried the finished text.
5. **14:36:07.766** – Additional PUTs eventually copy the ChatGPT response into `responsePayload.result`, but by then CaptionTaskService has already exhausted its retries and marks the caption task failed.

## Payload Fields

For generation `693b1d260e73a2cfa00c96ae`:

- **Immediate event (`generationUpdate`)**
  - `outputs.text`: `"This is a digital drawing of a chibi-style character ..."`
  - `spellId`: `68e01a3eeb26adaf366d532d`
  - `castId`: `693b1d180e73a2cfa00c96a8`
- **Database record (initial GET right after spellCompletion)**
  - `responsePayload`: missing `result` and `outputs`.
  - `deliveryStatus`: `sent`
  - `metadata.stepGenerationIds`: available.
- **Database record (after 14:36:07.766 PUT)**
  - `responsePayload.result`: populated with the ChatGPT text.

## Takeaways

- The websocket notification already holds the caption, but CaptionTaskService was only reading from the generation document, which lagged behind due to multiple `generationOutputsApi` PUTs.
- Metadata (`captionTask.datasetId`, `imageIndex`, `stepGenerationIds`) survived all three steps; the missing piece was consuming the `outputs.text` field from the event payload before the DB write landed.
- The fix wires that event snapshot directly into CaptionTaskService, keeps retrying with fresh GETs, and logs the exact fields inspected so that future engineers can quickly see whether the caption text was present in the in-memory event, the final step snapshot, or the persisted record.
- We now create an `in_progress` caption set as soon as the spell run starts and update each caption inside that set immediately, so `/datasets/:id/captions` reflects partial progress and the run can resume after a crash. When the last caption lands we simply flip the set to `completed` instead of inserting a brand-new copy.
