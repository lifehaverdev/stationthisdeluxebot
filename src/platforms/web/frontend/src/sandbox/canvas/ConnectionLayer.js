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

const ANCHOR_OFFSET_X_OUTPUT = 14;  // how far right of window edge
const ANCHOR_OFFSET_X_INPUT = -14;  // how far left of window edge
const DEFAULT_WINDOW_WIDTH = 300;
const DEFAULT_WINDOW_HEIGHT = 200;

export class ConnectionLayer extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.connections !== newProps.connections
        || oldProps.windows !== newProps.windows
        || oldProps.activeConnection !== newProps.activeConnection;
  }

  _getOutputAnchorPos(win) {
    if (!win) return { x: 0, y: 0 };
    const w = win.width || DEFAULT_WINDOW_WIDTH;
    const h = win.height || DEFAULT_WINDOW_HEIGHT;
    return { x: win.x + w + ANCHOR_OFFSET_X_OUTPUT, y: win.y + h / 2 };
  }

  _getInputAnchorPos(win, paramKey) {
    if (!win) return { x: 0, y: 0 };
    const h = win.height || DEFAULT_WINDOW_HEIGHT;
    // Stack input anchors vertically. For now, center them.
    // TODO: Calculate per-anchor Y offset based on parameter index
    return { x: win.x + ANCHOR_OFFSET_X_INPUT, y: win.y + h / 2 };
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

      /* Default connection — quiet, barely visible */
      .cl-path {
        fill: none;
        stroke: rgba(255,255,255,0.18);
        stroke-width: 1px;
        pointer-events: stroke;
        cursor: pointer;
        transition: stroke var(--dur-micro) var(--ease);
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

      /* Hover to remove */
      .cl-path:hover {
        stroke: var(--danger);
        stroke-width: 1.5px;
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
    const { connections, windows, activeConnection, onRemoveConnection } = this.props;

    const paths = (connections || []).map(conn => {
      const fromWin = windows.get(conn.fromWindowId);
      const toWin = windows.get(conn.toWindowId);
      if (!fromWin || !toWin) return null;

      const from = this._getOutputAnchorPos(fromWin);
      const to = this._getInputAnchorPos(toWin, conn.toInput);
      const d = this._bezier(from.x, from.y, to.x, to.y);

      return h('path', {
        key: conn.id,
        d,
        className: 'cl-path',
        style: 'pointer-events: stroke',
        onclick: (e) => { e.stopPropagation(); onRemoveConnection?.(conn.id); },
      });
    }).filter(Boolean);

    // Temp drag line
    let tempPath = null;
    if (activeConnection) {
      const fromWin = windows.get(activeConnection.fromWindowId);
      if (fromWin) {
        const from = this._getOutputAnchorPos(fromWin);
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
