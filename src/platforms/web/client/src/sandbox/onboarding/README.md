# Sandbox On-boarding Flow

Provides a product-led tour for first-time visitors.

## Key Modules

| File / Dir | Purpose |
|------------|---------|
| `onboarding.js` | Orchestrates the onboarding sequence, persists progress in `localStorage` so it only runs once per user |
| `steps/` | Individual step modules, each exporting `show()` / `hide()` functions for modularity |
| `styles/` | CSS scoped to onboarding tooltips & dialogs |

The flow is lazy-invoked when the user first opens the sandbox; subsequent sessions skip straight to the workspace. 