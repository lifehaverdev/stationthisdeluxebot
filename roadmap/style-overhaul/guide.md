# Frontend Style Overhaul — Collaboration Guide

This guide defines **how human contributors and LLM agents collaborate** to evolve the vanilla-CSS styling system.

---
## 1. Workflow Overview
1. Human selects a feature/UI element needing style work.
2. Human copies relevant DOM snippet (HTML) and contextual CSS rules (if any) into chat.
3. Agent returns a **console script** (`styleInspector(selectorOrElement)`) that:
   - Logs computed styles & source file origins.
   - Highlights CSS variables used / missing.
   - Suggests token or utility class mappings.
4. Human runs the script in the browser dev-console, pastes the output back.
5. Agent proposes CSS refactor patch (edits to `.css` files) plus any doc/token updates.
6. Human reviews/merges, visually verifies, and reports results.
7. Loop until acceptance criteria met.

---
## 2. Console Script Contract
- Provided as plain JS; no build step.
- Must work in Chrome, Firefox, Safari.
- Accepts **selector string** _or_ **DOM element**.
- Outputs structured info:
  ```json
  {
    "selector": "#btn-primary",
    "computed": { "color": "rgb(255, 255, 255)", ... },
    "matchedRules": [
      { "property": "color", "value": "var(--clr-primary-text)", "file": "base.css:37" },
      ...
    ],
    "unmappedProperties": ["box-shadow", "transition"]
  }
  ```
- Should **not** mutate DOM.

---
## 3. CSS Conventions
1. **Design Tokens** live in `variables.css`.
2. **Base Layer**: element resets & core layout in `base.css`.
3. **Component Layer**: one file per atomic component under `style/components/`.
4. **Utilities Layer**: single-purpose classes under `style/utils/`.
5. Never declare colors / sizes directly—use tokens.
6. Prefer custom properties over pre-processors.

---
## 4. Doc Updates
- Every code change must update this guide or ADR logs if conventions shift.
- Keep outline milestones updated.

---
## 5. Tips
- Use `:where()` selector specificity trick to keep base rules low.
- Leverage `@layer` once browser support stabilises.
- Run `npm run dev:watch-css` (todo) for live reload.
