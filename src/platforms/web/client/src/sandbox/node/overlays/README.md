# Node Overlays

Lightweight preview layers that can be mounted over a node window to show live output without opening an external modal.

## Current Overlays

| File | Description |
|------|-------------|
| `textOverlay.js` | Displays live text output over the node |
| `imageOverlay.js` | Displays a live image scaled to the parent node |

Each overlay should export `mount(nodeId, data)` and `unmount(nodeId)` to conform with the overlay manager in `node/index.js`. 