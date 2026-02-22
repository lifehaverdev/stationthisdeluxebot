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
      .conn-svg { position: absolute; inset: 0; pointer-events: none; overflow: visible; z-index: 2; }
      .conn-path { fill: none; stroke: rgba(255,255,255,0.5); stroke-width: 2; pointer-events: stroke; cursor: pointer; filter: drop-shadow(0 0 3px rgba(255,255,255,0.2)); transition: stroke 0.15s; }
      .conn-path:hover { stroke: rgba(255,100,100,0.8); stroke-width: 3; }
      .conn-path--temp { stroke: rgba(144,202,249,0.7); stroke-width: 2; stroke-dasharray: 8 4; pointer-events: none; animation: conn-flow 1s linear infinite; }
      @keyframes conn-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -12; } }
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
        className: 'conn-path',
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
        tempPath = h('path', { d, className: 'conn-path conn-path--temp' });
      }
    }

    return h('svg', { className: 'conn-svg' },
      ...paths,
      tempPath
    );
  }
}
