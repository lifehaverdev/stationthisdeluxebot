# ADR-2025-10-03: Caption Flow Clarification in Mods Menu

## Context
Intern work accidentally introduced the idea of a separate **Captions** root tab and bespoke `/captions/generate` endpoint. In reality:

1. Captions are integral to training and therefore belong inside the **Train** tab workflow.
2. Caption generation already leverages our existing **spell execution** system via `/spells/cast`; no new REST surface is needed.
3. A training run **must** consume a *captioned* dataset. Hence the user journey is strictly:

```
Dataset → Caption → Training
```

## Decision
1. Remove the obsolete `captions` root-level tab and its related `captionDash` view from `ModsMenuModal.js`.
2. Keep caption management UI *inside* the **Train** tab.
3. Replace the temporary `/datasets/:id/captions/generate` call with a client-side helper that POSTs to `/spells/cast` with the appropriate spell ID (configured per caption method) for each image in the dataset.
4. Update validation: the **New Training** form disallows selection of datasets that have zero compatible captions.
5. Documentation—roadmap, ADRs, sprint logs—updated to reflect the correct flow.

## Consequences
• Clearer UX; users naturally progress dataset → caption → training.  
• API surface simplified (no orphan caption endpoints).  
• Future work: fetch spell catalogue for captioning methods, progress reporting via websocket remains unchanged.

## Implementation Log
**2025-10-03**  
• Added this ADR.  
• Comment cleanup in `ModsMenuModal.js` removing the rogue tab/view.  
• Follow-up tasks drafted for next sprint (see roadmap).
