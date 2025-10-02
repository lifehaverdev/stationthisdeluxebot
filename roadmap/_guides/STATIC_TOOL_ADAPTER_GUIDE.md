# Integrating a New 3-rd Party Generation Service

This guide explains the fastest path to expose any external generation API (text, image, audio, etc.) through StationThis **as a first-class Tool** – complete with:

* cost/credit tracking
* database audit trail (`generationOutputs`)
* Notification pipeline (Delivery-menu on Telegram, Web-socket updates, etc.)
* Rerun / Rate / Tweak buttons

The pattern relies on the **Adapter architecture** shipped in Oct-2025.

---
## 1  Create / Extend an Adapter

All adapters live in `src/core/services/<provider>/<provider>Adapter.js` and must implement:

```ts
execute(inputs)          // for fast (<15 s) operations – returns ToolResult
startJob(inputs)         // (optional) launches async run, resolves {runId}
pollJob(runId)           // (optional) returns ToolResult|processing
parseWebhook(req)        // (optional) converts provider webhook → ToolResult
```

`ToolResult` shape:
```ts
{
  type: 'text' | 'image' | 'sound' | 'video',
  data:      // provider-specific but **normalised**
    { text: ["…"] }          // text responses
    { images: [{url}] }       // image responses
    { … }                     // etc.
  status: 'succeeded' | 'failed' | 'processing',
  costUsd?: number
}
```

👉 Normalise text outputs to **array** so the `telegramNotifier` can iterate.

Register the adapter once:
```js
const registry = require('../adapterRegistry');
registry.register('myprovider', myAdapter);
```

---
## 2  Define the Tool
Add `src/core/tools/definitions/<myTool>.js`:
```js
module.exports = {
  toolId: 'super-image',
  service: 'myprovider',        // MUST match registry key
  displayName: 'SuperImage',
  inputSchema: { prompt: {type:'string', required:true} },
  outputSchema: { image:{type:'string'} },
  costingModel: {
     rateSource: 'static',
     staticCost:{ amount: 0.05, unit:'request' }
  },
  deliveryMode: 'async',        // < 15 s? use 'immediate' instead
  metadata: {
    defaultAdapterParams:{ action:'image' }
  }
};
```

Key fields:
* **service** – links tool → adapter.
* **deliveryMode**
  * `immediate`  → API waits till finished (≤15 s) and inserts *completed* record.
  * `async`      → API returns 202 immediately; background poller or webhook finalises.
* **metadata.defaultAdapterParams** – merged into `inputs` before adapter call; great for things like `{action:'image'}` or default model.

---
## 3  Nothing Else!
The pipeline is automatic:

1. `generationExecutionApi` detects adapter & deliveryMode.
2. Inserts DB record – **always** (string primitive is the only exception).
3. Emits `generationUpdated`.
4. `notificationDispatcher` routes to platform → `telegramNotifier` / Web-socket.
5. Delivery-menu & audit trail just work.

---
## 4  Testing Checklist

1. `/reloadtools` (or restart) so ToolRegistry picks up new file.
2. Run the command on Telegram:
   * immediate path – should reply in chat within ≤15 s.
   * async path – should react with 👍 then deliver when ready.
3. Verify `generationOutputs` record:
   ```bash
   db.generationOutputs.find({toolId:'super-image'}).sort({_id:-1}).limit(1)
   ```
4. Check cost/points deducted.

---
## 5  Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Telegram shows *timeout of 15000 ms* but eventually delivers | `deliveryMode:'immediate'` call exceeding 15 s | switch to `async` OR raise Axios timeout |
| Delivery-menu arrives with no media | Adapter `ToolResult.data` not normalised (`images`, `text`) | wrap accordingly |
| No DB record | Make sure you didn’t shortcut with `stringService` path; adapter flow always inserts |

---
Happy hacking! 🎉
