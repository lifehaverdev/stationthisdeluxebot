# Sandbox Node System — Clean Architecture

## The Problem We Hit

The vanilla system manages windows as imperative DOM nodes: create element, set styles, attach listeners, query children. When we wrapped this in microact components, every re-render risked losing imperative state (position, anchors, canvas overlays). The two paradigms fight each other.

## Design Principles

1. **State drives everything.** Windows, connections, positions, selections — all in one reactive store. Components render from state. No imperative DOM queries for data.
2. **Microact renders content.** Parameter forms, results, buttons, cost displays — all virtual DOM.
3. **CSS handles position.** Window coordinates are inline styles derived from state, not imperatively set.
4. **SVG handles connections.** One SVG overlay renders all connection lines declaratively from state. No div-rotation hacks.
5. **One drag system.** A single canvas-level drag controller handles window moves, connection draws, and lasso selection.
6. **Viewport is imperative.** Zoom/pan transforms stay as direct CSS for 60fps. But the transform values live in state so components can read them.

## Architecture

```
SandboxCanvas (microact component)
├── ViewportLayer (imperative zoom/pan CSS transform)
│   ├── WindowLayer (microact, renders all windows from state)
│   │   ├── ToolWindow[]
│   │   ├── SpellWindow[]
│   │   ├── CollectionWindow[]
│   │   └── UploadWindow[]
│   └── SVGConnectionLayer (microact, renders all connections from state)
│       ├── <path> per permanent connection
│       └── <path> for active drag connection (temp)
├── SelectionLayer (lasso overlay, selection highlights)
└── DragController (single handler: window drag, connection drag, lasso)
```

### Key Insight: Everything Renders From State

```javascript
// The entire canvas is a function of this state:
canvasState = {
  windows: Map<windowId, {
    id, type, tool/spell/collection,
    x, y,                          // workspace coordinates
    width, height,                 // for connection anchor positioning
    parameterMappings,
    output, outputVersions, currentVersionIndex,
    cost, executing, progress,
  }>,
  connections: Map<connId, {
    id, fromWindowId, toWindowId,
    fromOutput, toInput, type,
  }>,
  selection: Set<windowId>,
  viewport: { panX, panY, scale },
  activeConnection: { fromWindowId, outputType, mouseX, mouseY } | null,
  activeDrag: { windowId, offsetX, offsetY } | null,
  activeLasso: { startX, startY, endX, endY } | null,
}
```

When state changes → components re-render → DOM updates. No imperative DOM manipulation except viewport transforms.

## Components

### SandboxCanvas

The top-level microact component. Owns all state. Provides context to children.

```javascript
class SandboxCanvas extends Component {
  constructor(props) {
    super(props);
    this.state = {
      windows: new Map(),
      connections: new Map(),
      selection: new Set(),
      viewport: { panX: 0, panY: 0, scale: 1 },
      activeConnection: null,
      activeDrag: null,
    };
  }

  render() {
    const { windows, connections, viewport, activeConnection } = this.state;
    const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;

    return h('div', { className: 'sandbox-canvas-root',
      onmousedown: this.bind(this._onCanvasMouseDown),
      onwheel: this.bind(this._onWheel),
    },
      // Viewport transform container
      h('div', { className: 'sandbox-viewport', style: `transform: ${transform}` },

        // All windows — rendered from state
        ...[...windows.values()].map(win =>
          h(WindowRenderer, {
            key: win.id,
            window: win,
            selected: this.state.selection.has(win.id),
            onDragStart: (offsetX, offsetY) => this._startDrag(win.id, offsetX, offsetY),
            onParamChange: (key, value) => this._updateParam(win.id, key, value),
            onExecute: () => this._execute(win.id),
            onClose: () => this._removeWindow(win.id),
            onAnchorDragStart: (outputType) => this._startConnectionDrag(win.id, outputType),
          })
        ),

        // SVG connection layer — on top of windows
        h(ConnectionLayer, {
          connections: [...connections.values()],
          windows,
          activeConnection,
        })
      )
    );
  }
}
```

### WindowRenderer

Stateless component that renders a single window from state. No internal state — everything comes from props.

```javascript
class WindowRenderer extends Component {
  shouldUpdate(oldProps, newProps) {
    // Only re-render if the window data actually changed
    return oldProps.window !== newProps.window
        || oldProps.selected !== newProps.selected;
  }

  render() {
    const { window: win, selected, onDragStart, onClose } = this.props;
    const style = `left:${win.x}px; top:${win.y}px`;
    const cls = `node-window${selected ? ' node-window--selected' : ''}`;

    return h('div', {
      className: cls,
      style,
      id: win.id,
      onmousedown: (e) => {
        if (e.target.closest('.node-anchor')) return; // let anchor handler take it
        const rect = e.currentTarget.getBoundingClientRect();
        onDragStart(e.clientX - rect.left, e.clientY - rect.top);
      },
    },
      // Header
      h('div', { className: 'node-header' },
        h('span', null, win.tool?.displayName || win.spell?.name || 'Window'),
        h(CostDisplay, { cost: win.cost }),
        h('button', { className: 'node-close', onclick: onClose }, '×')
      ),

      // Output anchor (right side)
      h(OutputAnchor, {
        type: win.tool?.metadata?.outputType || 'text',
        onDragStart: this.props.onAnchorDragStart,
      }),

      // Input anchors (left side) — one per connectable parameter
      h(InputAnchors, {
        schema: win.tool?.inputSchema,
        mappings: win.parameterMappings,
        connections: this.props.connections,
      }),

      // Body content based on window type
      this._renderBody(win),
    );
  }

  _renderBody(win) {
    switch (win.type) {
      case 'tool': return h(ToolWindowBody, { window: win, ...this.props });
      case 'spell': return h(SpellWindowBody, { window: win, ...this.props });
      case 'collection': return h(CollectionWindowBody, { window: win, ...this.props });
      case 'upload': return h(UploadWindowBody, { window: win, ...this.props });
    }
  }
}
```

### ConnectionLayer (SVG)

Renders ALL connections as SVG paths. Declarative — no imperative line creation.

```javascript
class ConnectionLayer extends Component {
  render() {
    const { connections, windows, activeConnection } = this.props;

    const paths = connections.map(conn => {
      const fromWin = windows.get(conn.fromWindowId);
      const toWin = windows.get(conn.toWindowId);
      if (!fromWin || !toWin) return null;

      // Calculate anchor positions from window coordinates + dimensions
      const fromX = fromWin.x + fromWin.width;
      const fromY = fromWin.y + fromWin.height / 2;
      const toX = toWin.x;
      const toY = toWin.y + this._getInputAnchorY(toWin, conn.toInput);

      // Bezier curve for smooth connection
      const midX = (fromX + toX) / 2;
      const d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

      return h('path', {
        key: conn.id,
        d,
        className: 'connection-path',
        onclick: () => this._removeConnection(conn.id),
      });
    }).filter(Boolean);

    // Active drag connection (temp line following mouse)
    let tempPath = null;
    if (activeConnection) {
      const fromWin = windows.get(activeConnection.fromWindowId);
      if (fromWin) {
        const fromX = fromWin.x + fromWin.width;
        const fromY = fromWin.y + fromWin.height / 2;
        const toX = activeConnection.mouseX;
        const toY = activeConnection.mouseY;
        const midX = (fromX + toX) / 2;
        const d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
        tempPath = h('path', { d, className: 'connection-path connection-path--temp' });
      }
    }

    return h('svg', {
      className: 'connection-svg-layer',
      style: 'position:absolute;inset:0;pointer-events:none;overflow:visible',
    },
      ...paths,
      tempPath,
    );
  }
}
```

### DragController

A single system handles all drag interactions on the canvas. No per-element mousedown handlers that fight each other.

```javascript
// In SandboxCanvas:

_onCanvasMouseDown(e) {
  const { viewport } = this.state;

  // 1. Check if clicking on an anchor → start connection drag
  const anchor = e.target.closest('.node-anchor-output');
  if (anchor) {
    const windowId = anchor.closest('.node-window').id;
    const outputType = anchor.dataset.type;
    this._startConnectionDrag(windowId, outputType, e);
    return;
  }

  // 2. Check if clicking on a window header → start window drag
  const header = e.target.closest('.node-header');
  if (header) {
    const windowEl = header.closest('.node-window');
    const win = this.state.windows.get(windowEl.id);
    const rect = windowEl.getBoundingClientRect();
    // Convert screen coords to workspace coords
    const offsetX = (e.clientX - rect.left) / viewport.scale;
    const offsetY = (e.clientY - rect.top) / viewport.scale;
    this.setState({ activeDrag: { windowId: win.id, offsetX, offsetY } });
    document.addEventListener('mousemove', this._onDragMove);
    document.addEventListener('mouseup', this._onDragEnd);
    return;
  }

  // 3. Otherwise → start lasso or pan
  this._startLassoOrPan(e);
}

_onDragMove = (e) => {
  const { activeDrag, activeConnection, viewport } = this.state;

  if (activeDrag) {
    // Update window position in state → re-render moves the window
    const canvasRect = this._canvasEl.getBoundingClientRect();
    const x = (e.clientX - canvasRect.left) / viewport.scale - viewport.panX - activeDrag.offsetX;
    const y = (e.clientY - canvasRect.top) / viewport.scale - viewport.panY - activeDrag.offsetY;
    const windows = new Map(this.state.windows);
    const win = { ...windows.get(activeDrag.windowId), x, y };
    windows.set(win.id, win);
    this.setState({ windows });
    return;
  }

  if (activeConnection) {
    // Update temp connection endpoint → re-render moves the line
    const canvasRect = this._canvasEl.getBoundingClientRect();
    const mouseX = (e.clientX - canvasRect.left) / viewport.scale - viewport.panX;
    const mouseY = (e.clientY - canvasRect.top) / viewport.scale - viewport.panY;
    this.setState({
      activeConnection: { ...activeConnection, mouseX, mouseY }
    });
    return;
  }
}

_onDragEnd = (e) => {
  document.removeEventListener('mousemove', this._onDragMove);
  document.removeEventListener('mouseup', this._onDragEnd);

  if (this.state.activeDrag) {
    // Persist final position
    this._persistState();
    this.setState({ activeDrag: null });
    return;
  }

  if (this.state.activeConnection) {
    // Check if dropped on an input anchor
    const elem = document.elementFromPoint(e.clientX, e.clientY);
    const inputAnchor = elem?.closest('.node-anchor-input');
    if (inputAnchor) {
      this._createConnection(inputAnchor);
    }
    this.setState({ activeConnection: null });
    return;
  }
}
```

### Performance: Why This Works at 60fps

**Concern:** "setState on every mousemove will be slow."

**Answer:** Microact's diff is cheap for this case because:
- `shouldUpdate` on WindowRenderer skips windows that didn't move
- Only the dragged window's inline `style` changes → microact patches ONE attribute
- SVG path `d` attribute changes → microact patches ONE attribute
- No DOM creation/destruction during drag — just attribute updates

If performance is still an issue, we can:
- Use `requestAnimationFrame` to batch state updates during drag
- Use CSS `will-change: transform` on windows
- Skip the SVG layer during active drag and use a single temp `<path>` element

### Anchors

Anchors are part of the window's render tree — not imperatively attached after mount.

```javascript
class OutputAnchor extends Component {
  render() {
    const { type, onDragStart } = this.props;
    const emoji = ANCHOR_EMOJI[type] || '📄';
    return h('div', {
      className: 'node-anchor node-anchor-output',
      'data-type': type,
      onmousedown: (e) => {
        e.stopPropagation(); // prevent window drag
        onDragStart(type);
      },
    }, emoji);
  }
}

class InputAnchors extends Component {
  render() {
    const { schema, mappings } = this.props;
    if (!schema) return h('div', { style: 'display:none' });

    const anchors = Object.entries(schema)
      .filter(([, p]) => CONNECTABLE_TYPES.includes(normalizeType(p.type)))
      .map(([key, param]) => {
        const connected = mappings?.[key]?.type === 'nodeOutput';
        return h('div', {
          key,
          className: `node-anchor node-anchor-input${connected ? ' node-anchor--connected' : ''}`,
          'data-type': normalizeType(param.type),
          'data-param': key,
        }, ANCHOR_EMOJI[normalizeType(param.type)] || '📄');
      });

    return h('div', { className: 'node-anchors-input' }, ...anchors);
  }
}
```

### State Persistence

Same localStorage pattern as before, but cleaner because state is already a plain object:

```javascript
function persistCanvasState(state) {
  const serializable = {
    windows: [...state.windows.values()].map(w => ({
      ...w,
      // Strip non-serializable fields
      output: sanitizeOutput(w.output),
    })),
    connections: [...state.connections.values()],
  };
  localStorage.setItem('sandbox_state', JSON.stringify(serializable));
}

function loadCanvasState() {
  try {
    const raw = localStorage.getItem('sandbox_state');
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      windows: new Map(data.windows.map(w => [w.id, w])),
      connections: new Map(data.connections.map(c => [c.id, c])),
    };
  } catch { return null; }
}
```

### Execution Integration

ExecutionService updates state. Components react.

```javascript
async _execute(windowId) {
  // Mark as executing
  this._updateWindow(windowId, { executing: true, progress: 'Starting...' });

  try {
    const win = this.state.windows.get(windowId);
    const svc = getExecutionService();
    const output = await svc.executeNode(windowId, {
      onProgress: (msg) => this._updateWindow(windowId, { progress: msg }),
    });

    if (output) {
      this._updateWindow(windowId, {
        output,
        executing: false,
        progress: null,
        outputVersions: [...(win.outputVersions || []), output],
        currentVersionIndex: (win.outputVersions?.length || 0),
      });
    }
  } catch (err) {
    this._updateWindow(windowId, { executing: false, error: err.message });
  }
}

_updateWindow(id, updates) {
  const windows = new Map(this.state.windows);
  const win = { ...windows.get(id), ...updates };
  windows.set(id, win);
  this.setState({ windows });
}
```

## Migration Path

### Phase 1: SandboxCanvas + WindowRenderer + SVG connections
- New `SandboxCanvas` component replaces the current canvas setup
- Renders windows from state with inline positioning
- SVG connection layer replaces div-rotation lines
- Single DragController for all interactions

### Phase 2: Window body components
- Port ToolWindowBody, SpellWindowBody from existing ParameterForm + ResultDisplay
- These already work as microact components — just need to receive data as props

### Phase 3: Collection + Upload windows
- Port body content, already have microact components for these

### Phase 4: Remove old system
- Delete vanilla window classes, connection system, node/ directory
- Remove window.__sandboxState__ bridge
- Single module graph, single state source

## CSS Architecture

```css
.sandbox-canvas-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0a0a0a;
}

.sandbox-viewport {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  /* transform set by JS: translate + scale */
}

.node-window {
  position: absolute;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  min-width: 280px;
  max-width: 400px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}

.node-window--selected {
  border-color: #90caf9;
  box-shadow: 0 0 0 2px rgba(144,202,249,0.3);
}

.node-anchor-output {
  position: absolute;
  right: -14px;
  top: 50%;
  transform: translateY(-50%);
  cursor: crosshair;
  z-index: 5;
}

.node-anchors-input {
  position: absolute;
  left: -14px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 5;
}

.connection-svg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.connection-path {
  fill: none;
  stroke: rgba(255,255,255,0.6);
  stroke-width: 2;
  pointer-events: stroke;
  cursor: pointer;
  filter: drop-shadow(0 0 4px rgba(255,255,255,0.3));
}

.connection-path--temp {
  stroke: rgba(144,202,249,0.8);
  stroke-dasharray: 8 4;
  animation: connection-flow 1s linear infinite;
}

@keyframes connection-flow {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: -12; }
}
```

## What This Eliminates

| Old Pattern | New Pattern |
|------------|-------------|
| Imperative `document.createElement` for windows | Declarative `h()` from state |
| Imperative `el.style.left = ...` for position | Inline `style` from state in render |
| Div-rotation for connection lines | SVG `<path>` with bezier curves |
| Per-element mousedown handlers | Single canvas-level DragController |
| MutationObserver for late canvas mount | State-driven rendering (canvas always exists) |
| `window.__sandboxState__` bridge | Component state + store subscriptions |
| `generationIdToWindowMap` DOM refs | State lookup by windowId |
| `renderAllConnections()` imperative redraws | Reactive re-render from state changes |
| Version selector as imperative DOM | VersionSelector microact component (already built) |
| `persistState()` scattered everywhere | Single `_persistState()` in SandboxCanvas |
