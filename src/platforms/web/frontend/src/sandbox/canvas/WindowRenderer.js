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
      .nw-root {
        position: absolute;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 8px;
        min-width: 280px;
        max-width: 400px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        z-index: 10;
      }
      .nw-root:hover { border-color: #444; }
      .nw-root--selected { border-color: #90caf9; box-shadow: 0 0 0 2px rgba(144,202,249,0.3); }

      .nw-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.03);
        border-bottom: 1px solid #333;
        border-radius: 8px 8px 0 0;
        cursor: grab;
        user-select: none;
      }
      .nw-header:active { cursor: grabbing; }
      .nw-title { font-weight: 600; font-size: 13px; color: #e0e0e0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nw-close { background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 2px 6px; border-radius: 4px; line-height: 1; }
      .nw-close:hover { color: #fff; background: rgba(255,255,255,0.08); }

      .nw-body { padding: 12px; max-height: 500px; overflow-y: auto; }

      .nw-anchor-output {
        position: absolute;
        right: -16px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 16px;
        cursor: crosshair;
        z-index: 5;
        padding: 4px;
        border-radius: 50%;
        background: #222;
        border: 1px solid #444;
        line-height: 1;
        user-select: none;
      }
      .nw-anchor-output:hover { border-color: #90caf9; background: #2a2a3a; }

      .nw-anchors-input {
        position: absolute;
        left: -16px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 5;
      }
      .nw-anchor-input {
        font-size: 14px;
        padding: 3px;
        border-radius: 50%;
        background: #222;
        border: 1px solid #444;
        line-height: 1;
        user-select: none;
        transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
      }
      .nw-anchor-input--connected { border-color: #90caf9; background: #1a1a2e; }

      /* Highlight all input anchors while dragging a connection */
      [data-connecting-type] .nw-anchor-input {
        border-color: rgba(255,255,255,0.35);
        background: #2a2a2a;
        cursor: crosshair;
      }

      /* Stronger highlight when the anchor type matches the dragged output type */
      [data-connecting-type="image"] .nw-anchor-input[data-type="image"],
      [data-connecting-type="text"]  .nw-anchor-input[data-type="text"],
      [data-connecting-type="video"] .nw-anchor-input[data-type="video"],
      [data-connecting-type="audio"] .nw-anchor-input[data-type="audio"] {
        border-color: #90caf9;
        background: #1a2035;
        box-shadow: 0 0 0 3px rgba(144,202,249,0.25), 0 0 8px rgba(144,202,249,0.2);
        cursor: crosshair;
      }

      /* Dim the source window's own output anchor while dragging so it reads as "in use" */
      [data-connecting-type] .nw-anchor-output {
        opacity: 0.5;
      }
    `;
  }

  render() {
    const { win, selected, bodyContent, onClose, onVersionChange } = this.props;
    const cls = `nw-root${selected ? ' nw-root--selected' : ''}`;
    const style = `left:${win.x}px;top:${win.y}px`;
    const outputType = this._getOutputType();
    const inputAnchors = this._getInputAnchors();

    return h('div', { className: cls, style, id: win.id },

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
