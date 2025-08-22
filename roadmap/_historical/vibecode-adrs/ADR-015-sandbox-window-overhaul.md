> Imported from vibecode/decisions/adr/ADR-015-sandbox-window-overhaul.md on 2025-08-21

# ADR-015: Sandbox Window Overhaul

Date: 2025-08-20

## Context
The web-sandbox currently has four separate window modules (`toolWindow.js`, `spellWindow.js`, `CollectionTestWindow.js`, and `CollectionReviewWindow.js`).
Each copies large blocks of code to manage:

* DOM container creation & positioning
* Header rendering (title, drag, close)
* Parameter / form sections and "show more" toggles
* Execute / progress indicator logic
* Result rendering via `renderResultContent`

This duplication has led to 700 + line files that are error-prone, hard to test, and slow to extend.

Constraints we must respect:

* Plain ES modules – no React/Solid/TypeScript
* Vanilla CSS – no Tailwind or CSS-in-JS
* No formal test runner requirement (Jest, etc.)

## Decision
We will extract a **vanilla JavaScript window framework** and migrate all existing windows onto it.

### Core Abstractions
1. **`BaseWindow.js`**
   * Creates & mounts the outer `<div>` (`tool-window` class).
   * Renders a standard header (title, optional icon, drag-to-move, close btn).
   * Supplies helper methods: `mount()`, `destroy()`, `showError(msg)`, `setOutput(data)`, `addButton(icon,title,handler)`.
   * Emits/handles `CustomEvent`s so external modules (connections renderer, global state) stay decoupled.

2. **`ToolWindow.js`** — extends `BaseWindow`
   * Adds parameter-mapping UI, input/output anchors, version selector, and dependency-aware execution (`executeNodeAndDependencies`).

3. **`SpellWindow.js`** — extends `ToolWindow`
   * Adds spell-specific panels (exposed inputs, details, *explode spell*), plus spell execution via `/api/v1/spells/cast`.

4. **`CollectionTestWindow.js`** & **`CollectionReviewWindow.js`** — extend `BaseWindow`
   * Provide their specialist bodies (trait selectors & param overrides, or review controls) while inheriting header/drag/error/output behaviour.

### Shared Utilities
* `drag.js` – `enableDrag(element, handle)`
* `domHelpers.js` – `el(tag, props, …children)` to cut boilerplate
* `inputs.js` – factories for param/trait inputs and show-more buttons
* `state.js` – single source of truth for window list & connections with undo/redo & localStorage persistence

### CSS Strategy
* Keep existing `toolWindow.css` but rename to `window.css` and split into logical blocks using BEM-style classes (`.window__header`, `.window--fullscreen`).
* Dynamic sizing/coords stay inline (left/top written by JS); all thematic styling lives in CSS with optional CSS custom properties for future theming.

## Consequences
* ~2× reduction in code size across window modules.
* Faster onboarding & feature work (write a subclass, not a 700-line clone).
* Fewer regressions thanks to single implementation of drag, close, error, output rendering.
* Minimal runtime overhead (pure DOM; no framework bundle).

Risks:
* Migration touches critical sandbox functionality – a staged rollout is necessary.
* Possible CSS regressions when consolidating styles.

## Implementation Roadmap
| Phase | Target Date | Description |
|-------|------------|-------------|
| 0 | 2025-08-20 | ADR approved & merged |
| 1 | +2 days | Add `BaseWindow.js`, `drag.js`, `domHelpers.js`; *no behavioural change* – existing windows untouched |
| 2 | +5 days | Refactor `toolWindow.js` to extend `BaseWindow`; move shared helpers to utilities; verify full parity |
| 3 | +3 days | Introduce `ToolWindow.js`; migrate logic from `toolWindow.js`; ensure graph execution & version selector still work |
| 4 | +2 days | Refactor `spellWindow.js` to extend new `ToolWindow`; delete duplicate code |
| 5 | +2 days | Refactor `CollectionTestWindow.js` and `CollectionReviewWindow.js` to extend `BaseWindow` |
| 6 | +2 days | Consolidate CSS into `window.css`; remove inline styles where practical |
| 7 | +1 day  | Delete dead code, update documentation (`WEB_FRONTEND_NORTH_STAR.md`, sandbox README) |
| 8 | – | Future: optional keyboard shortcuts & theming via CSS vars |

Rollback Plan: keep old modules under `archive/legacy_window/` until Phase 5 passes manual QA.  A quick `import … from 'legacy_window'` toggle restores prior behaviour.

## Alternatives Considered
1. **Status-quo / copy-paste incremental fixes** — rejected; maintenance cost too high.
2. **Adopt a framework (React / Solid)** — violates current constraints (vanilla only).
3. **Switch to TypeScript for safer refactor** — also outside constraints.

Given the constraints, a lightweight in-house abstraction is the most pragmatic path forward.
