# Sprint Log — Sandbox Window Overhaul

_Date: 2025-08-22_

## Status Summary
| Item | State |
|------|-------|
| ToolWindow refactor | ✅ functional & persisted |
| SpellWindow class mount | ✅ window appears |
| SpellWindow parameters & cast button | ✅ rendered |
| Spell execution | ❌ 400 "Missing spell slug" |

## Observations / Investigation
1. `SpellsMenuModal` logs correct spell name but `createSpellWindow` receives **undefined** for first argument.
2. Verified modal passes full object, but adapter log still prints `undefined` ⇒ likely multiple versions of `createSpellWindow` still in scope or bundler caching.
3. ToolWindow `register:false` path confirmed working; issue isolated to argument hand-off.

## Next Actions
- Add console trace inside `handleAddSpellToCanvas` to log `typeof spell`, JSON.stringify snippet.
- Verify no other `createSpellWindow` re-export masking the new one.
- If adapter path correct, inspect bundler path aliasing between `/node/spellWindow.js` and new `/window/SpellWindow.js`.

## Blockers
- Cannot fully test spell persistence & versioning until execution succeeds.

---
_Logged per AGENT_COLLABORATION_PROTOCOL v3_

### 2025-08-25 — Persist-refactor regressions

**Symptoms**
– Adding a spell from *SpellsMenuModal* logs:
```text
[SpellsMenuModal] Adding spell "<name>" to canvas.
[spellWindow.js] [ADAPTER] createSpellWindow → SpellWindow class undefined
```
and **no node appears**.

**Findings so far**
1. `createSpellWindow(spell, pos)` is invoked with the correct object; inside the adapter the `spell` param is fine, but `spell.slug` is `undefined` for some older spells, so the debug line prints `undefined`.  That alone should not block rendering.
2.  `SpellWindow` instance is created and `win.mount()` called, but the element never lands in `.sandbox-canvas` when the canvas does not yet exist (early modal use).  Result: node is appended to `<body>` and ends up hidden under the full-screen sandbox overlay.

**Work attempted**
– Refactored `BaseWindow.mount()` to relocate the element once the canvas appears.  Behaviour unchanged — still invisible.

**Hypothesis**
Relocation code fires before `.sandbox-canvas` is inserted (timing race).  Need MutationObserver or a post-`DOMContentLoaded` microtask to move windows after the canvas is re-parented by `index.js`.

**Next steps**
- Attach `MutationObserver` watching for `.sandbox-canvas` addition and move any orphaned `.tool-window` children.
- Alternatively, defer `mount()` until after `initState()` and canvas injection when creating windows from the modal.

---

### 2025-08-26 — SpellWindow persists again 🎉

**Issue**  Spell windows vanished immediately after creation due to placeholder model deletion in constructor.

**Fix**  Instead of `removeToolWindow(id)` we now overwrite the existing placeholder model:
```js
const existing = getToolWindow(id);
if (existing) {
  Object.assign(existing, serialize(), { element: el });
  persistState();
} else {
  _registerWindow();
}
```

Result: spell windows stay on canvas; execution/casting works. Removed all debug console logs.

**Next**  Clean up legacy adapter code and resume ADR-016 step-streaming tasks.

---
