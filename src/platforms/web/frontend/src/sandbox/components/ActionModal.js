import { Component, h } from '@monygroupcorp/microact';

const CATEGORIES = [
  { type: 'image',  label: 'image',  category: 'text-to-image' },
  { type: 'sound',  label: 'sound',  category: 'text-to-audio' },
  { type: 'text',   label: 'text',   category: 'text-to-text'  },
  { type: 'movie',  label: 'movie',  category: 'text-to-video' },
];

const EFFECT_CATEGORIES = [
  { type: 'image', label: 'image',   outputType: 'image' },
  { type: 'text',  label: 'caption', outputType: 'text'  },
  { type: 'video', label: 'video',   outputType: 'video' },
  { type: 'audio', label: 'sound',   outputType: 'audio' },
];

/**
 * ActionModal — the click-to-create popup that appears when clicking the canvas.
 *
 * Three-level interaction:
 *   1. Root: upload | create
 *   2. Create → category grid (image / sound / text / movie)
 *   3. Category → tool list for that category
 *
 * Tool clicks call window.sandboxCanvas.addToolWindow(tool, workspacePosition).
 * Upload calls uploadToStorage(file) then window.sandboxCanvas.addUploadWindow(url, pos).
 *
 * Props:
 *   visible          — boolean
 *   x, y             — screen coords for fixed positioning
 *   workspacePosition — { x, y } in canvas workspace coords
 *   onClose          — () => void
 */
export class ActionModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // 'root' | 'categories' | 'tools'
      view: 'root',
      mode: null,             // 'create' | 'effect'
      selectedCategory: null,
      tools: [],
    };
    this._fileInput = null;
  }

  didMount() {
    this._esc = (e) => { if (e.key === 'Escape' && this.props.visible) this.props.onClose?.(); };
    document.addEventListener('keydown', this._esc);
    this.registerCleanup(() => document.removeEventListener('keydown', this._esc));
    this.subscribe('sandbox:availableTools', (tools) => {
      this.setState({ tools: [...tools] });
    });
    // Pick up tools already in memory
    const shared = window.__sandboxState__?.availableTools;
    if (shared?.length) this.setState({ tools: [...shared] });
  }

  // Reset to root view when modal re-opens
  shouldUpdate(oldProps, newProps) {
    if (!oldProps.visible && newProps.visible) {
      this.setState({ view: 'root', mode: null, selectedCategory: null });
    }
    return true;
  }

  _close() {
    this.props.onClose?.();
  }

  // ── Navigation ────────────────────────────────────────────

  _showCategories(e) {
    e.stopPropagation();
    this.setState({ view: 'categories', mode: 'create' });
  }

  _showEffectCategories(e) {
    e.stopPropagation();
    this.setState({ view: 'categories', mode: 'effect' });
  }

  _hasRequiredImageInput(tool) {
    const schema = tool.inputSchema || {};
    return Object.values(schema).some(p => p.type === 'image' && p.required);
  }

  _getToolOutputType(tool) {
    if (tool.metadata?.outputType) return tool.metadata.outputType;
    const cat = tool.category || '';
    if (cat === 'video') return 'video';
    if (cat === 'audio' || cat === 'text-to-audio') return 'audio';
    if (cat === 'image-to-text' || cat === 'interrogate') return 'text';
    return 'image';
  }

  _selectEffectTool(tool, e) {
    e.stopPropagation();
    const canvas = window.sandboxCanvas;
    if (canvas) canvas.addEffectWindow(tool, this.props.workspacePosition);
    this._close();
  }

  _createPrimitive(outputType, e) {
    e.stopPropagation();
    const canvas = window.sandboxCanvas;
    if (canvas) canvas.addPrimitiveWindow(outputType, this.props.workspacePosition);
    this._close();
  }

  _addUploadNode(e) {
    e.stopPropagation();
    const canvas = window.sandboxCanvas;
    if (canvas) canvas.addUploadWindow(null, this.props.workspacePosition);
    this._close();
  }

  _selectCategory(cat, e) {
    e.stopPropagation();
    this.setState({ view: 'tools', selectedCategory: cat });
  }

  _back(e) {
    e.stopPropagation();
    if (this.state.view === 'tools') {
      this.setState({ view: 'categories', selectedCategory: null });
    } else {
      this.setState({ view: 'root', selectedCategory: null, mode: null });
    }
  }

  // ── Tool creation ─────────────────────────────────────────

  _selectTool(tool, e) {
    e.stopPropagation();
    const canvas = window.sandboxCanvas;
    if (canvas) canvas.addToolWindow(tool, this.props.workspacePosition);
    this._close();
  }

  // ── Upload ────────────────────────────────────────────────

  _showUpload(e) {
    e.stopPropagation();
    this.setState({ view: 'upload', uploadError: null });
  }

  async _handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.setState({ uploadError: 'Only images are supported.' });
      return;
    }

    this.setState({ uploading: true, uploadError: null });
    try {
      const url = await uploadToStorage(file);
      const canvas = window.sandboxCanvas;
      if (canvas) {
        const { mode, selectedEffectTool } = this.state;
        if (mode === 'effect' && selectedEffectTool) {
          canvas.addEffectWindow(selectedEffectTool, url, this.props.workspacePosition);
        } else {
          canvas.addUploadWindow(url, this.props.workspacePosition);
        }
      }
      this._close();
    } catch (err) {
      this.setState({ uploading: false, uploadError: err.message });
    }
  }

  // ── Rendering ─────────────────────────────────────────────

  static get styles() {
    return `
      /* Radial menu root — centered on click point */
      .am-root {
        position: fixed;
        z-index: var(--z-radial);
        pointer-events: none;
        transform: translate(-50%, -50%);
      }
      .am-root.active { pointer-events: auto; }

      .am-svg { overflow: visible; display: block; }

      /* Donut segments */
      .am-segment {
        fill: var(--surface-2);
        stroke: var(--border);
        stroke-width: 1;
        cursor: pointer;
        transition: fill var(--dur-micro) var(--ease), stroke var(--dur-micro) var(--ease);
      }
      .am-segment-group:hover .am-segment {
        fill: var(--accent-dim);
        stroke: var(--accent-border);
      }

      /* Labels inside segments */
      .am-label {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        fill: var(--text-label);
        pointer-events: none;
        transition: fill var(--dur-micro) var(--ease);
        dominant-baseline: middle;
        text-anchor: middle;
      }
      .am-segment-group:hover .am-label { fill: var(--accent); }

      /* Anchor (small inner-ring) segments */
      .am-segment--anchor {
        fill: var(--surface-3);
        stroke: var(--border);
        stroke-width: 1;
      }
      .am-segment-group--anchor:hover .am-segment--anchor {
        fill: var(--accent-dim);
        stroke: var(--accent-border);
      }
      .am-label--anchor {
        font-size: 13px;
        letter-spacing: 0;
        text-transform: none;
      }
      .am-segment-group--anchor:hover .am-label--anchor { fill: var(--accent); }
      .am-anchor-icon { color: var(--text-label); transition: color var(--dur-micro) var(--ease); }
      .am-segment-group--anchor:hover .am-anchor-icon { color: var(--accent); }

      /* Center escape circle */
      .am-center {
        fill: var(--surface-3);
        stroke: var(--border);
        stroke-width: 1;
        cursor: pointer;
        transition: fill var(--dur-micro) var(--ease);
      }
      .am-center:hover { fill: var(--surface-2); }

      /* Tools list panel */
      @keyframes amToolsFadeUp {
        from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)); }
        to   { opacity: 1; transform: translate(-50%, -50%); }
      }
      .am-tools-panel {
        position: fixed;
        z-index: var(--z-radial);
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        width: 420px;
        transform: translate(-50%, -50%);
        animation: amToolsFadeUp var(--dur-trans) var(--ease) forwards;
      }
      .am-tools-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-3);
      }
      .am-tools-back {
        background: none;
        border: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .am-tools-back:hover { color: var(--text-secondary); }
      .am-tools-title {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .am-tools-list {
        max-height: 360px;
        overflow-y: auto;
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .am-tool-item {
        background: none;
        border: none;
        border-bottom: var(--border-width) solid var(--border);
        border-right: var(--border-width) solid var(--border);
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-align: left;
        padding: 10px 12px;
        cursor: pointer;
        line-height: 1.4;
        transition: background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .am-tool-item:nth-child(2n) { border-right: none; }
      .am-tool-item:nth-last-child(-n+2) { border-bottom: none; }
      .am-tool-item:hover {
        background: var(--accent-dim);
        color: var(--accent);
      }
      .am-tool-item--primitive {
        color: var(--text-label);
      }
      .am-tool-item--primitive:hover {
        background: var(--accent-dim);
        color: var(--accent);
      }
      .am-tools-empty {
        padding: 12px;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
      }
    `;
  }

  render() {
    const { visible, x, y } = this.props;
    if (!visible) return h('div', { className: 'am-root' });

    const { view, mode, selectedCategory, tools } = this.state;

    // Tools view: too many items for radial — render as scrollable panel
    if (view === 'tools') {
      const isEffect = this.state.mode === 'effect';
      const filtered = isEffect
        ? tools.filter(t => this._hasRequiredImageInput(t) && this._getToolOutputType(t) === selectedCategory?.outputType)
        : tools.filter(t => t.category === selectedCategory.category);
      // For the text category on create path, prepend a plain text primitive option
      const isText = !isEffect && selectedCategory.type === 'text';
      return h('div', {
        className: 'am-tools-panel',
        style: `left:${x}px;top:${y}px`,
        onclick: (e) => e.stopPropagation(),
      },
        h('div', { className: 'am-tools-header' },
          h('button', { className: 'am-tools-back', onclick: (e) => this._back(e) }, '←'),
          h('span', { className: 'am-tools-title' }, selectedCategory.label),
        ),
        (!isText && filtered.length === 0)
          ? h('div', { className: 'am-tools-empty' }, 'no tools')
          : h('div', { className: 'am-tools-list' },
            isText
              ? h('button', {
                  className: 'am-tool-item am-tool-item--primitive',
                  key: '__text-primitive',
                  title: 'Plain text input — no generation, anchors directly',
                  onclick: (e) => this._createPrimitive('text', e),
                }, 'Text Input')
              : null,
            ...filtered.map(tool =>
              h('button', {
                className: 'am-tool-item',
                key: tool.toolId || tool.displayName,
                title: tool.description || tool.displayName,
                onclick: isEffect
                  ? (e) => this._selectEffectTool(tool, e)
                  : (e) => this._selectTool(tool, e),
              }, tool.displayName)
            )
          )
      );
    }

    const polar = (r, a) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    const size = 76 * 2;
    const cv = 76;

    // Root view: two-ring radial — outer ring for main actions, inner ring for quick anchors
    if (view === 'root') {
      const MAIN_OUTER = 72, MAIN_INNER = 46;
      const ANCH_OUTER = 42, ANCH_INNER = 26;
      const ANCH_SPAN = Math.PI * 80 / 180; // 80°

      const mainItems = [
        { label: 'effect', fn: (e) => this._showEffectCategories(e) },
        { label: 'create', fn: (e) => this._showCategories(e) },
      ];
      // Top = angle -π/2 (y negative in screen coords), bottom = π/2
      // Upload uses an inline image-frame icon; text uses 'T'
      const renderImageIcon = (cx, cy) => [
        h('rect', { x: cx - 5, y: cy - 3.5, width: 10, height: 7.5, rx: 1,
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'pointer-events': 'none' }),
        h('polyline', { points: `${cx - 3.5},${cy + 3} ${cx - 0.5},${cy + 0.5} ${cx + 1.5},${cy + 2} ${cx + 3.5},${cy - 0.5}`,
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'pointer-events': 'none' }),
        h('circle', { cx: cx - 2, cy: cy - 1, r: 1.2,
          fill: 'currentColor', stroke: 'none', 'pointer-events': 'none' }),
      ];
      const anchorItems = [
        { title: 'upload', angle: -Math.PI / 2, fn: (e) => this._addUploadNode(e), renderIcon: renderImageIcon },
        { icon: 'T', title: 'text', angle: Math.PI / 2, fn: (e) => this._createPrimitive('text', e) },
      ];

      const mainStart = Math.PI / 2; // effect on left, create on right
      const mainStep = Math.PI;

      const mainPath = (i) => {
        const a0 = mainStart + i * mainStep + 0.03;
        const a1 = mainStart + (i + 1) * mainStep - 0.03;
        const o0 = polar(MAIN_OUTER, a0), o1 = polar(MAIN_OUTER, a1);
        const i0 = polar(MAIN_INNER, a1), i1 = polar(MAIN_INNER, a0);
        return `M ${o0.x} ${o0.y} A ${MAIN_OUTER} ${MAIN_OUTER} 0 0 1 ${o1.x} ${o1.y} L ${i0.x} ${i0.y} A ${MAIN_INNER} ${MAIN_INNER} 0 0 0 ${i1.x} ${i1.y} Z`;
      };

      const anchorPath = (centerAngle) => {
        const a0 = centerAngle - ANCH_SPAN / 2 + 0.04;
        const a1 = centerAngle + ANCH_SPAN / 2 - 0.04;
        const o0 = polar(ANCH_OUTER, a0), o1 = polar(ANCH_OUTER, a1);
        const i0 = polar(ANCH_INNER, a1), i1 = polar(ANCH_INNER, a0);
        return `M ${o0.x} ${o0.y} A ${ANCH_OUTER} ${ANCH_OUTER} 0 0 1 ${o1.x} ${o1.y} L ${i0.x} ${i0.y} A ${ANCH_INNER} ${ANCH_INNER} 0 0 0 ${i1.x} ${i1.y} Z`;
      };

      return h('div', {
        className: 'am-root active',
        style: `left:${x}px;top:${y}px`,
        onclick: (e) => e.stopPropagation(),
      },
        h('svg', { className: 'am-svg', width: size, height: size, viewBox: `${-cv} ${-cv} ${size} ${size}` },
          // Outer ring: effect / create
          ...mainItems.map((item, i) => {
            const lp = polar((MAIN_OUTER + MAIN_INNER) / 2, mainStart + (i + 0.5) * mainStep);
            return h('g', {
              className: 'am-segment-group',
              key: item.label,
              onclick: this.bind((e) => { e.stopPropagation(); item.fn(e); }),
            },
              h('path', { className: 'am-segment', d: mainPath(i) }),
              h('text', { className: 'am-label', x: lp.x, y: lp.y }, item.label),
            );
          }),
          // Inner ring: image-frame icon (upload) / T (text)
          ...anchorItems.map((item) => {
            const lp = polar((ANCH_OUTER + ANCH_INNER) / 2, item.angle);
            const iconEl = item.renderIcon
              ? h('g', { className: 'am-anchor-icon', 'pointer-events': 'none' }, ...item.renderIcon(lp.x, lp.y))
              : h('text', { className: 'am-label am-label--anchor', x: lp.x, y: lp.y }, item.icon);
            return h('g', {
              className: 'am-segment-group am-segment-group--anchor',
              key: item.title,
              title: item.title,
              onclick: this.bind((e) => { e.stopPropagation(); item.fn(e); }),
            },
              h('path', { className: 'am-segment am-segment--anchor', d: anchorPath(item.angle) }),
              iconEl,
            );
          }),
          h('circle', {
            className: 'am-center',
            cx: 0, cy: 0, r: 12,
            onclick: this.bind((e) => { e.stopPropagation(); this._close(); }),
          }),
        )
      );
    }

    // Categories view: standard radial with back + category items
    let items = [];
    if (view === 'categories') {
      const catList = this.state.mode === 'effect'
        ? EFFECT_CATEGORIES.filter(c => tools.some(t => this._hasRequiredImageInput(t) && this._getToolOutputType(t) === c.outputType))
        : CATEGORIES.filter(c => c.type === 'text' || tools.some(t => t.category === c.category));
      items = [
        { label: 'back', fn: (e) => this._back(e) },
        ...catList.map(c => ({ label: c.label, fn: (e) => this._selectCategory(c, e) })),
      ];
    }

    const n = Math.min(items.length, 5);
    if (n === 0) return h('div', { className: 'am-root active', style: `left:${x}px;top:${y}px` });

    const outerR = 72, innerR = 28;
    const angleStep = (2 * Math.PI) / n;
    const startAngle = n === 2 ? Math.PI / 2 : -Math.PI / 2 - angleStep / 2;

    const segmentPath = (i) => {
      const a0 = startAngle + i * angleStep + 0.03;
      const a1 = startAngle + (i + 1) * angleStep - 0.03;
      const o0 = polar(outerR, a0), o1 = polar(outerR, a1);
      const i0 = polar(innerR, a1), i1 = polar(innerR, a0);
      const large = angleStep > Math.PI ? 1 : 0;
      return [
        `M ${o0.x} ${o0.y}`,
        `A ${outerR} ${outerR} 0 ${large} 1 ${o1.x} ${o1.y}`,
        `L ${i0.x} ${i0.y}`,
        `A ${innerR} ${innerR} 0 ${large} 0 ${i1.x} ${i1.y}`,
        'Z',
      ].join(' ');
    };

    const labelPos = (i) => {
      const a = startAngle + (i + 0.5) * angleStep;
      return polar((outerR + innerR) / 2, a);
    };

    return h('div', {
      className: 'am-root active',
      style: `left:${x}px;top:${y}px`,
      onclick: (e) => e.stopPropagation(),
    },
      h('svg', {
        className: 'am-svg',
        width: size,
        height: size,
        viewBox: `${-cv} ${-cv} ${size} ${size}`,
      },
        ...items.slice(0, n).map((item, i) => {
          const lp = labelPos(i);
          return h('g', {
            className: 'am-segment-group',
            key: item.label,
            onclick: this.bind((e) => { e.stopPropagation(); item.fn(e); }),
          },
            h('path', { className: 'am-segment', d: segmentPath(i) }),
            h('text', { className: 'am-label', x: lp.x, y: lp.y }, item.label),
          );
        }),
        h('circle', {
          className: 'am-center',
          cx: 0, cy: 0, r: 12,
          onclick: this.bind((e) => { e.stopPropagation(); this._close(); }),
        }),
      )
    );
  }
}
