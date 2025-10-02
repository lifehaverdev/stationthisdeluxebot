# Auto-Caption Integration Agent Prompt

You are **CaptionIntegrator**, an expert agent tasked with wiring up automatic caption generation for StationThis dataset training.

## Context
1. **Dataset imports** need textual captions for each image before FLUX LoRA training.
2. Repo already contains a production-ready caption tool definition:
   `src/core/tools/definitions/joycaption.js`
   • Interrogates an image via HuggingFace “Joy-Caption” space and returns a base description.
3. Existing *spell system* (see `src/core/services/WorkflowExecutionService.js` and workflow configs) can run chains of tools and LLM prompts.
4. Current manual spec mentions “clip, blip, etc.” placeholder logic; we want to replace that with real JoyCaption + ChatGPT post-processing.
5. Post-processing step must replace occurrences of the subject/style tokens with a user-supplied **trigger word** so captions teach the LoRA the right token.

## Objective
Create/repair the auto-caption pipeline so that when a new dataset is imported:
1. Each image without a `.txt` caption gets queued.
2. Worker calls JoyCaption tool to get base caption.
3. A ChatGPT (OpenAI) prompt rewrites the caption, ensuring **<TRIGGER_WORD>** is used consistently in place of the subject.
4. Final caption written to `<img>.txt` beside the image.
5. Status stored back in DB so TrainingOrchestrator sees the dataset ready.

## Tasks
1. Trace current dataset ingestion workflow; locate where missing-caption detection or placeholders happen.
2. Implement a **CaptionJob queue/worker** if not present, or extend existing TrainingOrchestrator pre-step.
3. Use `toolRegistry.execute('joycaption', { imageUrl })` (or appropriate call) to fetch caption.
4. Use OpenAI adapter (`src/core/services/openai/openAIAdapter.js`) to run prompt similar to:
   ```
   You are rewriting an image description for LoRA training. Replace references to the main subject with the exact word "<TRIGGER_WORD>" (all caps). Preserve important style details; keep ≤60 words.
   
   Original: "{joyCaption}"
   Rewritten:
   ```
5. Ensure prompt cost is charged to user’s points wallet (costing logic exists in tools layer).
6. Write `.txt` file; update DB field `captionsReady = true` when all images done.
7. Add retries & error logging.

## Deliverables
• New/updated worker/service code committed.
• README snippet or ADR describing pipeline.
• Demonstration: importing a dataset with 3 images results in 3 caption files and `captionsReady=true`.

## Constraints & Standards
• Keep to existing project architecture (services, workers, MongoService helpers).
• Use absolute paths in tooling scripts.
• Maintain user preference for minimal chatter; code comments okay but avoid verbose logs.
• Prefer batch operations where possible (JoyCaption supports 1-per-call; that’s fine).

Good luck – once this is in place, our training flow will be fully automated from dataset to LoRA model!
