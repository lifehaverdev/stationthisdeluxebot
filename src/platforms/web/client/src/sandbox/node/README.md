# Sandbox Node Subsystem

This directory contains all logic related to **windows** – draggable, connect-able UI nodes representing tools or spells on the canvas.

## File Overview

| File | Purpose |
|------|---------|
| `toolWindow.js` | Generic tool node implementation: parameters, execution controls, output slots |
| `spellWindow.js` | Wrapper that visualises a saved multi-step workflow in a single window |
| `resultContent.js` | Renders execution results inside a node (text, image, audio, etc.) |
| `parameterInputs.js` | Generates dynamic parameter forms based on each tool’s schema |
| `websocketHandlers.js` | Listens for server-side WebSocket events (progress / results) and updates the corresponding node |
| `drag.js` | Mouse/touch drag-move logic with grid snapping |
| `anchors.js` | Utilities to create & manage DOM anchors used by the connection system |
| `overlays/` | Lightweight preview overlays (text/image) that can be mounted over a node |
| `index.js` | Barrel file that initialises overlay handlers and re-exports helpers |

All modules avoid heavy dependencies and interact with the DOM directly, consistent with the **Web Frontend North Star** guidelines. 