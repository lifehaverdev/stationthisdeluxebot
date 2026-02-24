import { Component, h } from '@monygroupcorp/microact';

/**
 * ConnectionLayer — SVG overlay that renders all connections as bezier curves.
 *
 * Fully declarative: reads connections + window positions from props,
 * renders SVG <path> elements. No imperative DOM manipulation.
 *
 * Props:
 *   connections      — array of { id, fromWindowId, toWindowId, fromOutput, toInput, type }
 *   windows          — Map<windowId, { x, y, width, height, tool, ... }>
 *   activeConnection — { fromWindowId, outputType, mouseX, mouseY } | null (temp drag line)
 *   onRemoveConnection — (connId) => void
 */

// Fallback offsets used only when the DOM element can't be found yet
const FALLBACK_ANCHOR_OFFSET_OUTPUT = 4;  // right edge + half anchor width
const FALLBACK_ANCHOR_OFFSET_INPUT  = -4; // left edge - half anchor width
const FALLBACK_WINDOW_WIDTH  = 280;
const FALLBACK_WINDOW_HEIGHT = 180;

export class ConnectionLayer extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.connections !== newProps.connections
        || oldProps.windows !== newProps.windows
        || oldProps.activeConnection !== newProps.activeConnection;
  }

  // Read anchor center from the live DOM, converted to workspace coords.
  // getAnchorPos(windowId, type, paramKey?) is passed from SandboxCanvas.
  _getOutputAnchorPos(win, getAnchorPos) {
    if (!win) return { x: 0, y: 0 };
    if (getAnchorPos) {
      const pos = getAnchorPos(win.id, 'output');
      if (pos) return pos;
    }
    // Fallback: approximate from stored position + default size
    return {
      x: win.x + FALLBACK_WINDOW_WIDTH + FALLBACK_ANCHOR_OFFSET_OUTPUT,
      y: win.y + FALLBACK_WINDOW_HEIGHT / 2,
    };
  }

  _getInputAnchorPos(win, paramKey, getAnchorPos) {
    if (!win) return { x: 0, y: 0 };
    if (getAnchorPos) {
      const pos = getAnchorPos(win.id, 'input', paramKey);
      if (pos) return pos;
    }
    return {
      x: win.x + FALLBACK_ANCHOR_OFFSET_INPUT,
      y: win.y + FALLBACK_WINDOW_HEIGHT / 2,
    };
  }

  _bezier(fromX, fromY, toX, toY) {
    const dx = Math.abs(toX - fromX);
    const cpOffset = Math.max(50, dx * 0.4);
    return `M ${fromX} ${fromY} C ${fromX + cpOffset} ${fromY}, ${toX - cpOffset} ${toY}, ${toX} ${toY}`;
  }

  static get styles() {
    return `
      .cl-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }

      /* Default connection — quiet, barely visible. No pointer events (handled by hit path). */
      .cl-path {
        fill: none;
        stroke: rgba(255,255,255,0.18);
        stroke-width: 1px;
        pointer-events: none;
        transition: stroke var(--dur-micro) var(--ease), stroke-width var(--dur-micro) var(--ease);
      }

      /* Wide transparent hit area — forgiving click/hover target */
      .cl-path-hit {
        fill: none;
        stroke: transparent;
        stroke-width: 20px;
        pointer-events: stroke;
        cursor: pointer;
      }

      /* When hovering the hit path, style the adjacent visible path red */
      .cl-path-hit:hover + .cl-path,
      .cl-path-hit:hover ~ .cl-path {
        stroke: var(--danger);
        stroke-width: 1.5px;
      }

      /* Active / data-flowing connection — accent signal */
      .cl-path.active {
        stroke: var(--accent);
        stroke-width: 1.5px;
        stroke-dasharray: 6 6;
        animation: signalFlow 0.6s linear infinite;
      }

      /* In-progress connection being drawn */
      .cl-path.pending {
        stroke: var(--accent-border);
        stroke-width: 1px;
        stroke-dasharray: 4 4;
        animation: signalFlow 0.4s linear infinite;
      }

      /* Connector dots at endpoints */
      .cl-dot {
        fill: rgba(255,255,255,0.18);
        transition: fill var(--dur-micro) var(--ease);
      }
      .cl-dot.active { fill: var(--accent); }
    `;
  }

  render() {
    const { connections, windows, activeConnection, onRemoveConnection, getAnchorPos } = this.props;

    const paths = (connections || []).flatMap(conn => {
      const fromWin = windows.get(conn.fromWindowId);
      const toWin = windows.get(conn.toWindowId);
      if (!fromWin || !toWin) return [];

      const from = this._getOutputAnchorPos(fromWin, getAnchorPos);
      const to = this._getInputAnchorPos(toWin, conn.toInput, getAnchorPos);
      const d = this._bezier(from.x, from.y, to.x, to.y);

      // Two paths per connection: wide invisible hit area + visible thin line.
      // Hit must come first so the sibling selector (hit:hover + vis) targets the correct vis path.
      return [
        h('path', {
          key: conn.id + '-hit',
          d,
          className: 'cl-path-hit',
          onclick: (e) => { e.stopPropagation(); onRemoveConnection?.(conn.id); },
        }),
        h('path', { key: conn.id + '-vis', d, className: 'cl-path' }),
      ];
    });

    // Temp drag line
    let tempPath = null;
    if (activeConnection) {
      const fromWin = windows.get(activeConnection.fromWindowId);
      if (fromWin) {
        const from = this._getOutputAnchorPos(fromWin, getAnchorPos);
        const d = this._bezier(from.x, from.y, activeConnection.mouseX, activeConnection.mouseY);
        tempPath = h('path', { d, className: 'cl-path pending' });
      }
    }

    return h('svg', { className: 'cl-svg' },
      ...paths,
      tempPath
    );
  }
}
