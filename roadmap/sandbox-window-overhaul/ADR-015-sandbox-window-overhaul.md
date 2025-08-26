# ADR-015: Sandbox Window Overhaul

_Migrated from `roadmap/_historical/vibecode-adrs/ADR-015-sandbox-window-overhaul.md` for active reference during the live refactor (2025-08-22)._  
_No technical changes; original decision text preserved._

---

> _The remainder is an exact copy of the historical ADR so contributors don’t have to jump folders while working._

## Context
The web-sandbox currently has four separate window modules (`toolWindow.js`, `spellWindow.js`, `CollectionTestWindow.js`, and `CollectionReviewWindow.js`).
Each copies large blocks of code to manage:

* DOM container creation & positioning
* Header rendering (title, drag, close)
* Parameter / form sections and "show more" toggles
* Execute / progress indicator logic
* Result rendering via `renderResultContent`

This duplication has led to 700 + line files that are error-prone, hard to test, and slow to extend.

Constraints:
* Vanilla ES Modules (no React / TS)
* Vanilla CSS
* No Jest requirement

## Decision
Extract a small window framework and migrate all windows onto it.

### Core Abstractions
1. **BaseWindow** – common shell
2. **ToolWindow** – parameters, execution, versioning
3. **SpellWindow** – tool window + spell-specific panels / execution
4. **Collection windows** – specialised subclasses

### Shared Utilities
`drag.js`, `domHelpers.js`, `inputs.js`, `state.js` (persistence + undo/redo)

### Roadmap (updated)
| Phase | Status |
|-------|--------|
| 1. Base utilities & BaseWindow | ✅ Done |
| 2. Refactor ToolWindow | ✅ Done |
| 3. Version selector & persistence | ✅ Done |
| 4. SpellWindow class + execution | ✅ Done |
| 5. Collection windows | ✅ Done |
| 6. Consolidate CSS | ✅ Done |
| 7. Cleanup & docs | 🔄 In progress |

---

(For full details, implementation considerations, and alternatives see the original ADR in `_historical`.  This copy exists only for convenience during the active sprint.)
