# ADR-016: Spell Execution Streaming & UI Synchronisation

_Migrated on 2025-08-23 during Sandbox-Window overhaul sprint._

---

## Status
Draft – investigation in progress

## Context
Spell execution originally relied on long-running generation workflows which emit `generationProgress` / `generationUpdate` websocket events. Recent integration of instant tools (e.g. ChatGPT via `openaiService`) returns **immediate** `tool-response` events instead.  
Our new `SpellWindow` UI expects per-step updates to mark status, update progress bars, and render outputs. After the first instant step, the UI stalls because it doesn’t receive or map these fast events.

Observed behaviour:
• Backend logs show both steps executed successfully.  
• Browser console logs `tool-response` payload from websocket but `SpellWindow` stays in “Casting…” state.  
• Subsequent long-running generation (ComfyUI) continues but UI remains frozen.

## Decision Drivers
1. Maintain real-time UX: users should see each step’s output as soon as it’s ready.
2. Avoid polling; leverage existing websocket infrastructure.
3. Keep protocol backwards-compatible with legacy ToolWindow nodes.
4. Minimal changes to backend event format preferred.

## Considered Options
| Option | Pros | Cons |
|--------|------|------|
| A. Extend frontend handlers to fully support `tool-response` (map by `toolId` / `spellId`) | Smallest change; already half-implemented | Still two distinct event shapes; implicit ordering logic in UI |
| B. Standardise backend to always send `generation*` events, even for instant tools (wrap response) | Unified event contract | Requires backend changes across services; extra DB writes for trivial steps |
| C. Hybrid: backend sends lightweight `stepUpdate` with status+payload; UI listens to one event type | Clean protocol moving forward; flexible | Requires transitional shims; bigger refactor |

_Preliminary choice: **Option A** (extend frontend)_

Rationale: we can unblock user experience quickly by finalising `tool-response` mapping in `websocketHandlers.js`. Longer-term we may revisit a unified protocol (see Future Work).

## Consequences
• SpellWindow will display instant step outputs and progress correctly.  
• ToolWindow (single-tool) behaviour remains unchanged.  
• We must ensure every service that shortcuts to immediate reply still emits `tool-response` with at least `{ toolId, output, spellId? }`.

## Architecture Notes – 2025-08-25 Deep Dive

Below is the definitive reference on how spell execution moves data end-to-end.  It supersedes all earlier tribal knowledge and **must** stay in sync with code changes.

### 1.  Cast request
`/api/v1/spells/cast` ➜ `SpellsService.castSpell` ➜ `WorkflowExecutionService.execute`.

### 2.  Pre-step context
`pipelineContext` starts as `context.parameterOverrides` (user input).  The legacy alias `prompt → input_prompt` is applied once here for backwards compatibility.

### 3.  Building `stepInput`
Precedence (lowest → highest):

1.  `pipelineContext` – outputs of previous steps + user overrides
2.  `step.parameterMappings` – explicit wiring for this step (`static` / `nodeOutput`)
3.  `step.parameterOverrides` – legacy one-off overrides

No other magic defaults are injected.  If a required input is still `undefined` after this merge, it’s a spell-authoring error.

### 4.  Tool execution  & GenerationOutput
Dispatches to `/internal/v1/data/execute` which immediately creates a GenerationOutput row.  Delivery modes:

• **webhook** (ComfyDeploy etc.) – Job will finish asynchronously and fire `generationUpdated` later.
• **immediate** (OpenAI, Replicate audio etc.) – Response is available synchronously.  Implementation persists `{ responsePayload: { result } }` and triggers `continueExecution` directly.

### 5.  Dispatcher ➜ continueExecution
`NotificationDispatcher` (or the immediate path) supplies a **completed** GenerationOutput to `WorkflowExecutionService.continueExecution`.

`stepOutput` is *only* `record.responsePayload` (normalised so `text` is always present).  It is **not** the entire GenerationOutput – just the contractually agreed payload.

Output → input mapping rules:

1.  `step.outputMappings` from the spell json (explicit)
2.  Conventional `output_X → input_X` rename

The mapped values are added to `next_inputs`, then

```js
const nextPipelineContext = {
  ...pipelineContext,
  ...stepOutput,   // raw
  ...next_inputs   // canonicalised / mapped
}
```

No other fields are added.

### 6.  Spell completion
After the last step a final GenerationOutput with `toolId: spell-<slug>` is created so downstream notification logic remains unchanged.

---

## Plan of Attack (tracking in `sandbox-window-overhaul` sprint board)

1. **Runtime validation**  
   • Add a pre-flight check in `_executeStep` that logs (warn) if any required tool input is `undefined` after merge.  
   • Emit a structured metric `spell_missing_input` so we can alert.

2. **Spell linter**  
   • CLI script to statically analyse all spell JSON for unmapped required inputs.  
   • Hook into CI.

3. **Unified Websocket Event**  
   • Prototype a `stepUpdate` event that wraps both `tool-response` and `generationUpdate`.  
   • Front-end shim listens to both and normalises.

4. **Docs & ADR upkeep**  
   • Keep this Architecture Notes section current whenever we touch execution or mapping logic.  
   • Add a quick-start section to the spell authoring guide.

5. **Long-term**  
   • Explore eliminating `parameterOverrides` once all spells are migrated.

## Implementation Log
- 2025-08-23: draft created; added `handleToolResponse` stub & mapping logic (#commit TBD).
- 2025-08-25: Deep-dive debugging session – instant-tool chaining still failing.
  * Identified missing `responsePayload` persistence for immediate tools; added write-back & direct `continueExecution` call.
  * Normalised LLM outputs to `.text` in `WorkflowExecutionService`.
  * Added `data-tool-id` matching + drag fixes in front-end (`spellWindow.js`, `websocketHandlers.js`, `drag.js`).
  * Implemented `WorkflowCacheManager` singleton to stop ToolRegistry churn.
  * Introduced fire-and-forget `/spells/cast` (202) pattern.
  * Current blocker: `stepOutput` still empty when NotificationDispatcher resumes; suspect timing / context merge edge-case.
  * Files touched so far:
    - `src/core/services/WorkflowExecutionService.js`
    - `src/core/services/notificationDispatcher.js`
    - `src/core/services/Execute/*` (OpenAI & Comfy paths)
    - `src/core/services/comfydeploy/workflows.js`
    - `src/core/services/comfydeploy/workflowCacheManager.js`
    - `src/platforms/web/client/src/sandbox/node/websocketHandlers.js`
    - `src/platforms/web/client/src/sandbox/node/spellWindow.js`
    - `src/platforms/web/client/src/sandbox/node/drag.js`
    - `src/platforms/web/client/src/sandbox/window/{BaseWindow,ToolWindow}.js`
    - API routes: `src/api/external/spells/spellsApi.js`
  * Next actions: trace NotificationDispatcher timing, ensure `continueExecution` pipelineContext carries `.text`, evaluate moving to unified `stepUpdate` event.
- _Add updates here during investigation._

---

## Future Work
- Evaluate a unified `stepUpdate` websocket payload to replace both `tool-response` and `generation*`.
- Consider pushing progress/outputs through Server-Sent Events for better reconnection semantics.
