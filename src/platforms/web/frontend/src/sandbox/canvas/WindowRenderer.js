import { Component, h } from '@monygroupcorp/microact';
import { CostDisplay } from '../components/windows/CostDisplay.js';
import { VersionSelector } from '../components/windows/VersionSelector.js';

/**
 * WindowRenderer — renders a single window from state.
 *
 * Purely props-driven. No internal state except UI toggles.
 * Position comes from props (win.x, win.y), set as inline style.
 * Anchors are part of the render tree — not imperatively attached.
 *
 * Props:
 *   win              — window state object { id, type, x, y, tool, spell, ... }
 *   selected         — boolean, whether this window is in the selection set
 *   bodyContent      — array of vnodes for the window body (provided by parent)
 *   onDragStart      — (windowId, offsetX, offsetY) => void
 *   onClose          — (windowId) => void
 *   onAnchorDragStart — (windowId, outputType, event) => void
 *   onVersionChange  — (windowId, index) => void
 */

const ANCHOR_EMOJI = {
  image: '\uD83D\uDDBC\uFE0F',
  text: '\uD83D\uDCDD',
  audio: '\uD83C\uDFB5',
  video: '\uD83C\uDFAC',
};

const CONNECTABLE_TYPES = ['text', 'image', 'video', 'audio'];

function normalizeType(t) {
  if (t === 'string' || t === 'textany') return 'text';
  if (Array.isArray(t)) return t[0];
  return t;
}

export class WindowRenderer extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.win !== newProps.win
        || oldProps.selected !== newProps.selected
        || oldProps.bodyContent !== newProps.bodyContent;
  }

  _onHeaderMouseDown(e) {
    // Don't start drag if clicking buttons/inputs
    if (e.target.closest('button, input, textarea, select, a')) return;
    e.stopPropagation();
    const rect = e.currentTarget.closest('.nw-root').getBoundingClientRect();
    this.props.onDragStart?.(
      this.props.win.id,
      e.clientX - rect.left,
      e.clientY - rect.top
    );
  }

  _onOutputAnchorDown(e, outputType) {
    e.stopPropagation();
    e.preventDefault();
    this.props.onAnchorDragStart?.(this.props.win.id, outputType, e);
  }

  _getTitle() {
    const { win } = this.props;
    if (win.type === 'spell') return win.spell?.name || 'Spell';
    if (win.type === 'upload') return 'Upload';
    if (win.type === 'collection') return win.collection?.name || 'Collection';
    return win.tool?.displayName || 'Tool';
  }

  _getOutputType() {
    const { win } = this.props;
    return win.tool?.metadata?.outputType || win.tool?.category?.split('-').pop() || 'text';
  }

  _getInputAnchors() {
    const { win } = this.props;
    const schema = win.tool?.inputSchema || {};
    return Object.entries(schema)
      .filter(([, p]) => CONNECTABLE_TYPES.includes(normalizeType(p.type)))
      .sort((a, b) => {
        const order = k => k === 'input_prompt' ? 0 : k === 'input_image' ? 1 : 2;
        return order(a[0]) - order(b[0]);
      })
      .map(([key, param]) => ({
        key,
        type: normalizeType(param.type),
        connected: win.parameterMappings?.[key]?.type === 'nodeOutput',
      }));
  }

  static get styles() {
    return `
      /* Visual chrome lives in toolWindow.css — these styles handle
         renderer-specific positioning and connection anchor interaction. */
      .nw-root {
        position: absolute;
        z-index: var(--z-node);
        pointer-events: auto;
      }

      /* ── Output anchor (right side) ─────────────── */
      .nw-anchor-output {
        position: absolute;
        right: -8px;
        top: 50%;
        transform: translateY(-50%);
        width: 8px;
        height: 8px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border-hover);
        cursor: crosshair;
        z-index: 5;
        user-select: none;
        transition:
          background  var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease),
          transform    var(--dur-micro) var(--ease);
      }
      .nw-anchor-output:hover {
        background: var(--accent);
        border-color: var(--accent);
        transform: translateY(-50%) scale(1.5);
      }

      /* ── Input anchors (left side) ──────────────── */
      .nw-anchors-input {
        position: absolute;
        left: -8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 5;
      }
      .nw-anchor-input {
        width: 8px;
        height: 8px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border-hover);
        cursor: crosshair;
        user-select: none;
        transition:
          background  var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease),
          transform    var(--dur-micro) var(--ease);
      }
      .nw-anchor-input--connected {
        background: var(--accent-dim);
        border-color: var(--accent-border);
      }

      /* Highlight all input anchors while a connection drag is in progress */
      [data-connecting-type] .nw-anchor-input {
        border-color: var(--border-hover);
        cursor: crosshair;
      }

      /* Accent highlight when anchor type matches dragged output type */
      [data-connecting-type="image"] .nw-anchor-input[data-type="image"],
      [data-connecting-type="text"]  .nw-anchor-input[data-type="text"],
      [data-connecting-type="video"] .nw-anchor-input[data-type="video"],
      [data-connecting-type="audio"] .nw-anchor-input[data-type="audio"] {
        background: var(--accent-dim);
        border-color: var(--accent-border);
        box-shadow: 0 0 0 2px var(--accent-glow);
        transform: scale(1.4);
        cursor: crosshair;
      }

      /* Dim source window's output anchor while dragging */
      [data-connecting-type] .nw-anchor-output { opacity: 0.4; }
    `;
  }

  render() {
    const { win, selected, bodyContent, onClose, onVersionChange } = this.props;
    const cls = `nw-root${selected ? ' selected' : ''}`;
    const style = `left:${win.x}px;top:${win.y}px`;
    const outputType = this._getOutputType();
    const inputAnchors = this._getInputAnchors();

    return h('div', { className: cls, style, id: win.id },

      // Corner bracket spans for complete four-corner selection indicator
      // (::before/::after pseudo-elements cover top-left and bottom-right;
      //  these spans cover top-right and bottom-left)
      h('span', { className: 'nw-bracket-tr' }),
      h('span', { className: 'nw-bracket-bl' }),

      // Header (drag handle)
      h('div', { className: 'nw-header', onmousedown: this.bind(this._onHeaderMouseDown) },
        h('span', { className: 'nw-title' }, this._getTitle()),
        h(CostDisplay, { windowId: win.id, initialCost: win.cost }),
        win.outputVersions?.length > 0
          ? h(VersionSelector, {
            versions: win.outputVersions,
            currentIndex: win.currentVersionIndex ?? -1,
            onVersionChange: (idx) => onVersionChange?.(win.id, idx),
          }) : null,
        h('button', { className: 'nw-close', onclick: () => onClose?.(win.id) }, '\u00D7')
      ),

      // Output anchor (right side)
      h('div', {
        className: 'nw-anchor-output',
        'data-type': outputType,
        onmousedown: (e) => this._onOutputAnchorDown(e, outputType),
      }, ANCHOR_EMOJI[outputType] || '\uD83D\uDCC4'),

      // Input anchors (left side)
      inputAnchors.length > 0
        ? h('div', { className: 'nw-anchors-input' },
          ...inputAnchors.map(a =>
            h('div', {
              key: a.key,
              className: `nw-anchor-input${a.connected ? ' nw-anchor-input--connected' : ''}`,
              'data-type': a.type,
              'data-param': a.key,
              title: `${a.key} (${a.type})`,
            }, ANCHOR_EMOJI[a.type] || '\uD83D\uDCC4')
          )
        ) : null,

      // Body content (provided by parent)
      h('div', { className: 'nw-body' },
        ...(Array.isArray(bodyContent) ? bodyContent : bodyContent ? [bodyContent] : [])
      )
    );
  }
}
