# Sandbox Connection System

Handles the visual and logical links between node outputs and inputs.

## Structure

| File | Responsibility |
|------|---------------|
| `manager.js` | CRUD + persistence of Connection objects (stored in `localStorage`, pushes to history stack) |
| `interaction.js` | User gesture layer: click-drag to start a connection, validates drop targets |
| `drawing.js` | Calculates Bézier / straight-line SVG paths and re-paints on pan / zoom |
| `validation.js` | Type-compatibility checks (e.g. `image` → `image`) |
| `anchors.js` | DOM helpers to find port positions for drawing |
| `index.js` | Re-exports helpers for convenience |

Connections are persisted so that the workspace can be accurately reconstructed on reload. 