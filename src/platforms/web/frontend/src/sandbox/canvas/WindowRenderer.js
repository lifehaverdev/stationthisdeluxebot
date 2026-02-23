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

const CONNECTABLE_TYPES = ['text', 'image', 'video', 'audio', 'int', 'float'];

function normalizeType(t) {
  if (!t) return 'text';
  if (Array.isArray(t)) return normalizeType(t[0]);
  if (t === 'string' || t === 'textany') return 'text';
  if (t === 'integer') return 'int';
  if (t === 'number' || t === 'decimal') return 'float';
  return t;
}

// Minimal SVG glyphs — 10×10 viewBox, currentColor, stroke-based except video/default
function anchorIcon(type) {
  const s = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const svgProps = { viewBox: '0 0 10 10', style: 'width:8px;height:8px;flex-shrink:0;display:block' };

  switch (type) {
    case 'text':
      // T letterform
      return h('svg', svgProps, h('path', { ...s, d: 'M2 3h6M5 3v4' }));

    case 'image':
      // Frame + mountain peaks
      return h('svg', svgProps,
        h('rect', { x: '1', y: '1', width: '8', height: '8', rx: '1', ...s }),
        h('path', { ...s, d: 'M1.5 7.5L3.5 5L5.5 7L7 5.5L8.5 7.5' }));

    case 'video':
      // Solid play triangle
      return h('svg', svgProps, h('path', { fill: 'currentColor', stroke: 'none', d: 'M2.5 2L8 5L2.5 8Z' }));

    case 'audio':
      // Equaliser bars
      return h('svg', svgProps, h('path', { ...s, d: 'M2 8V5M4.5 8V2.5M7.5 8V4M9.5 8V6' }));

    case 'int':
      // # hash
      return h('svg', svgProps, h('path', { ...s, d: 'M3.5 2v6M6.5 2v6M1.5 4.5h7M1.5 6.5h7' }));

    case 'float':
      // Sine wave
      return h('svg', svgProps, h('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', d: 'M1 5C2 2.5 4 7.5 5 5S8 2.5 9 5' }));

    default:
      // Filled circle
      return h('svg', svgProps, h('circle', { cx: '5', cy: '5', r: '2.5', fill: 'currentColor', stroke: 'none' }));
  }
}

export class WindowRenderer extends Component {
  constructor(props) {
    super(props);
    this.state = { tapLabel: null };
  }

  shouldUpdate(oldProps, newProps, oldState, newState) {
    return oldProps.win !== newProps.win
        || oldProps.selected !== newProps.selected
        || oldProps.bodyContent !== newProps.bodyContent
        || oldProps.onWindowClick !== newProps.onWindowClick
        || oldProps.mobileConnecting !== newProps.mobileConnecting
        || oldState?.tapLabel !== newState?.tapLabel;
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

  _onHeaderClick(e) {
    // Ignore close button and other controls
    if (e.target.closest('button, input, textarea, select, a')) return;
    this.props.onWindowClick?.(this.props.win.id, { x: e.clientX, y: e.clientY });
  }

  _onOutputAnchorDown(e, outputType) {
    e.stopPropagation();
    e.preventDefault();
    this.props.onAnchorDragStart?.(this.props.win.id, outputType, e);
  }

  _onOutputAnchorTap(e, outputType) {
    e.preventDefault();
    e.stopPropagation();
    this.setState({ tapLabel: 'output' });
    this.props.onMobileConnectStart?.(this.props.win.id, outputType);
  }

  _onInputAnchorTap(e, paramKey) {
    e.preventDefault();
    e.stopPropagation();
    const { mobileConnecting } = this.props;
    if (mobileConnecting) {
      this.props.onMobileConnectComplete?.(this.props.win.id, paramKey);
      this.setState({ tapLabel: null });
    } else {
      this.setState({ tapLabel: this.state.tapLabel === paramKey ? null : paramKey });
    }
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

    // Actual output is the ground truth — use it when available
    const actualType = win.output?.type;
    if (actualType && actualType !== 'unknown') return normalizeType(actualType);

    // Declared metadata
    const declared = win.tool?.metadata?.outputType;
    if (declared) return normalizeType(declared);

    // Category heuristic: 'image-generation', 'image-edit', etc. → 'image'
    const category = win.tool?.category || '';
    if (category.includes('image'))  return 'image';
    if (category.includes('video'))  return 'video';
    if (category.includes('audio'))  return 'audio';

    return 'text';
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
        right: -7px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border-hover);
        border-radius: 2px;
        cursor: crosshair;
        z-index: 5;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-label);
        transition:
          background   var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease),
          color        var(--dur-micro) var(--ease),
          transform    var(--dur-micro) var(--ease);
      }
      .nw-anchor-output:hover {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--canvas-bg);
        transform: translateY(-50%) scale(1.25);
      }

      /* ── Input anchors (left side) ──────────────── */
      .nw-anchors-input {
        position: absolute;
        left: -7px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 5;
      }
      .nw-anchor-input {
        width: 14px;
        height: 14px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border-hover);
        border-radius: 2px;
        cursor: crosshair;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-label);
        transition:
          background   var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease),
          color        var(--dur-micro) var(--ease),
          transform    var(--dur-micro) var(--ease);
      }
      .nw-anchor-input--connected {
        background: var(--accent-dim);
        border-color: var(--accent-border);
        color: var(--accent);
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
      [data-connecting-type="audio"] .nw-anchor-input[data-type="audio"],
      [data-connecting-type="int"]   .nw-anchor-input[data-type="int"],
      [data-connecting-type="float"] .nw-anchor-input[data-type="float"] {
        background: var(--accent-dim);
        border-color: var(--accent-border);
        color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-glow);
        transform: scale(1.25);
        cursor: crosshair;
      }

      /* Dim source window's output anchor while dragging */
      [data-connecting-type] .nw-anchor-output { opacity: 0.4; }

      /* Mobile connecting: source window output anchor pulses */
      .nw-root--connecting .nw-anchor-output { opacity: 1 !important; }
      .nw-anchor-output--connecting {
        background: var(--accent) !important;
        border-color: var(--accent) !important;
        color: var(--canvas-bg) !important;
        animation: anchorPulse 900ms ease-in-out infinite;
      }
      @keyframes anchorPulse {
        0%, 100% { box-shadow: 0 0 0 0px var(--accent-glow); }
        50%       { box-shadow: 0 0 0 5px transparent; }
      }

      /* ── Anchor labels ───────────────────────────── */
      .nw-anchor-output {
        overflow: visible; /* already position:absolute — don't override */
      }
      .nw-anchor-input {
        position: relative;
        overflow: visible;
      }

      .nw-anchor-label {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        white-space: nowrap;
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        padding: 2px 5px;
        border-radius: 2px;
        pointer-events: none;
        opacity: 0;
        transition: opacity var(--dur-micro) var(--ease);
        z-index: 20;
      }

      /* Output anchor is on the right → label extends right */
      .nw-anchor-output .nw-anchor-label {
        left: calc(100% + 6px);
      }

      /* Input anchors are on the left → label extends left */
      .nw-anchor-input .nw-anchor-label {
        right: calc(100% + 6px);
      }

      .nw-anchor-output:hover .nw-anchor-label,
      .nw-anchor-input:hover .nw-anchor-label,
      .nw-anchor--label-active .nw-anchor-label {
        opacity: 1;
      }
    `;
  }

  render() {
    const { win, selected, bodyContent, onClose, onVersionChange, mobileConnecting } = this.props;
    const { tapLabel } = this.state;
    const isConnectSource = mobileConnecting?.fromWindowId === win.id;
    const cls = `nw-root${selected ? ' selected' : ''}${isConnectSource ? ' nw-root--connecting' : ''}`;
    const style = `left:${win.x}px;top:${win.y}px`;
    const outputType = this._getOutputType();
    const inputAnchors = this._getInputAnchors();
    const outputKey = 'output';

    return h('div', { className: cls, style, id: win.id },

      // Corner bracket spans for complete four-corner selection indicator
      // (::before/::after pseudo-elements cover top-left and bottom-right;
      //  these spans cover top-right and bottom-left)
      h('span', { className: 'nw-bracket-tr' }),
      h('span', { className: 'nw-bracket-bl' }),

      // Header (drag handle + click = select connected component)
      h('div', { className: 'nw-header', onmousedown: this.bind(this._onHeaderMouseDown), onclick: this.bind(this._onHeaderClick) },
        h('span', { className: 'nw-title' }, this._getTitle()),
        h(CostDisplay, { windowId: win.id, initialCost: win.totalCostUsd ? { usd: win.totalCostUsd, points: 0, ms2: 0, cult: 0 } : null }),
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
        className: `nw-anchor-output${tapLabel === outputKey ? ' nw-anchor--label-active' : ''}${isConnectSource ? ' nw-anchor-output--connecting' : ''}`,
        'data-type': outputType,
        onmousedown: (e) => this._onOutputAnchorDown(e, outputType),
        ontouchstart: (e) => this._onOutputAnchorTap(e, outputType),
      },
        anchorIcon(outputType),
        h('span', { className: 'nw-anchor-label' }, `${outputType}: output`)
      ),

      // Input anchors (left side)
      inputAnchors.length > 0
        ? h('div', { className: 'nw-anchors-input' },
          ...inputAnchors.map(a =>
            h('div', {
              key: a.key,
              className: `nw-anchor-input${a.connected ? ' nw-anchor-input--connected' : ''}${tapLabel === a.key ? ' nw-anchor--label-active' : ''}`,
              'data-type': a.type,
              'data-param': a.key,
              ontouchstart: (e) => this._onInputAnchorTap(e, a.key),
            },
              anchorIcon(a.type),
              h('span', { className: 'nw-anchor-label' }, `${a.type}: ${a.key}`)
            )
          )
        ) : null,

      // Body content (provided by parent)
      h('div', { className: 'nw-body' },
        ...(Array.isArray(bodyContent) ? bodyContent : bodyContent ? [bodyContent] : [])
      )
    );
  }
}
