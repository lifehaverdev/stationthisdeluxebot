# Workspace Saving

StationThis Deluxe’s sandbox persists the current workspace so you can pick up right where you left off even after a refresh.

## How it works

1. The sandbox serialises **tool windows** and **connections** to JSON.
2. The JSON is written to two `localStorage` keys:
   - `sandbox_tool_windows`
   - `sandbox_connections`
3. On load, the sandbox re-hydrates this state and recreates the UI.

## Size limits & compression

Browsers cap `localStorage` at roughly **5 MB**; exceeding that quota throws `QuotaExceededError`.

The persistence layer now guards against over-sized payloads:

* Any string that looks like an in-memory **data-URI image** larger than **100 KB** is *truncated* and replaced with a summary object:
  ```json
  {
    "truncated": true,
    "mime": "image/png",
    "size": 793214
  }
  ```
* Non-data-URI outputs (e.g. remote URLs) are left intact.

Because we also keep a rolling `outputVersions` array for each window, the sanitiser walks the list and applies the same rule per version.

This keeps the saved workspace comfortably below 2 MB for the vast majority of use-cases.

## Error handling

`persistState()` now returns a **boolean** and surfaces failures to the user via a toast:

> "Failed to save workspace: <original message>"

All exceptions are logged to the console for debugging. The original browser error (`QuotaExceededError`, stringify cycles, etc.) is preserved in the toast so you are never left with a useless generic alert.

### Fallback: "Save As…" JSON download

If the error was quota-related the sandbox immediately offers a JSON download containing the full workspace so nothing is lost:

* A file named `sandbox-workspace-<timestamp>.json` is generated with pretty-printed JSON.
* You can later drag-and-drop or import this file to restore the session (import UI coming soon).

## Practical tips

* **Frequently hit Ctrl-S** – persistence is instant and cheap.
* If you plan on generating dozens of high-res images, consider cleaning up obsolete windows to keep the workspace lean.
* For archival or sharing, prefer the built-in JSON export as it is more portable than raw `localStorage`.

## API reference

```ts
persistState(): boolean
```

Returns `true` if the state was flushed to `localStorage` successfully, otherwise `false`.

---

_Last updated: 2025-09-22_
