import { Component, h } from '@monygroupcorp/microact';
import { uploadToStorage } from '../io.js';

const CATEGORIES = [
  { type: 'image',  label: 'image',  category: 'text-to-image' },
  { type: 'sound',  label: 'sound',  category: 'text-to-audio' },
  { type: 'text',   label: 'text',   category: 'text-to-text'  },
  { type: 'movie',  label: 'movie',  category: 'text-to-video' },
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
      // 'root' | 'categories' | 'tools' | 'upload'
      view: 'root',
      selectedCategory: null,
      tools: [],
      uploading: false,
      uploadError: null,
    };
    this._fileInput = null;
  }

  didMount() {
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
      this.setState({ view: 'root', selectedCategory: null, uploadError: null, uploading: false });
    }
    return true;
  }

  _close() {
    this.props.onClose?.();
  }

  // ── Navigation ────────────────────────────────────────────

  _showCategories(e) {
    e.stopPropagation();
    this.setState({ view: 'categories' });
  }

  _selectCategory(cat, e) {
    e.stopPropagation();
    this.setState({ view: 'tools', selectedCategory: cat });
  }

  _back(e) {
    e.stopPropagation();
    const prev = this.state.view === 'tools' ? 'categories' : 'root';
    this.setState({ view: prev, selectedCategory: null });
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
      if (canvas) canvas.addUploadWindow(url, this.props.workspacePosition);
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
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        fill: var(--text-label);
        pointer-events: none;
        transition: fill var(--dur-micro) var(--ease);
        dominant-baseline: middle;
        text-anchor: middle;
      }
      .am-segment-group:hover .am-label { fill: var(--accent); }

      /* Center escape circle */
      .am-center {
        fill: var(--surface-3);
        stroke: var(--border);
        stroke-width: 1;
        cursor: pointer;
        transition: fill var(--dur-micro) var(--ease);
      }
      .am-center:hover { fill: var(--surface-2); }

      /* Panel fallback — used for upload and tools list */
      .am-upload-panel {
        position: fixed;
        z-index: var(--z-radial);
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 14px;
        min-width: 220px;
        transform: translate(-50%, -50%);
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      .am-upload-back {
        background: none;
        border: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 0 0 10px 0;
        display: block;
      }
      .am-upload-back:hover { color: var(--text-secondary); }
      .am-upload-area {
        padding: 20px 16px;
        text-align: center;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        border: var(--border-width) dashed var(--border);
        cursor: pointer;
        transition: border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .am-upload-area:hover { border-color: var(--accent-border); color: var(--text-secondary); }
      .am-upload-error {
        color: var(--danger);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        margin-top: 6px;
      }
      .am-uploading {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        text-align: center;
        padding: 12px;
        text-transform: uppercase;
        letter-spacing: var(--ls-wide);
      }

      /* Tools list panel */
      .am-tools-panel {
        position: fixed;
        z-index: var(--z-radial);
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        min-width: 200px;
        max-width: 280px;
        transform: translate(-50%, -50%);
        animation: fadeUp var(--dur-trans) var(--ease);
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
        max-height: 240px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
      .am-tool-item {
        background: none;
        border: none;
        border-bottom: var(--border-width) solid var(--border);
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-align: left;
        padding: 8px 12px;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .am-tool-item:last-child { border-bottom: none; }
      .am-tool-item:hover {
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

    const { view, selectedCategory, tools, uploading, uploadError } = this.state;

    // Upload view: drag-drop requires panel, not radial
    if (view === 'upload') {
      return h('div', {
        className: 'am-upload-panel',
        style: `left:${x}px;top:${y}px`,
        onclick: (e) => e.stopPropagation(),
      },
        uploading
          ? h('div', { className: 'am-uploading' }, 'uploading...')
          : h('div', null,
            h('button', { className: 'am-upload-back', onclick: (e) => this._back(e) }, '← back'),
            h('div', {
              className: 'am-upload-area',
              onclick: (e) => { e.stopPropagation(); this._fileInput?.click(); },
              ondragover: (e) => { e.preventDefault(); e.stopPropagation(); },
              ondrop: (e) => { e.preventDefault(); e.stopPropagation(); this._handleFile(e.dataTransfer.files[0]); },
            }, 'drop image or click to upload'),
            h('input', {
              type: 'file', accept: 'image/*', style: 'display:none',
              ref: (el) => { this._fileInput = el; },
              onchange: (e) => this._handleFile(e.target.files[0]),
            }),
            uploadError ? h('div', { className: 'am-upload-error' }, uploadError) : null,
          )
      );
    }

    // Tools view: too many items for radial — render as scrollable panel
    if (view === 'tools') {
      const filtered = tools.filter(t => t.category === selectedCategory.category);
      return h('div', {
        className: 'am-tools-panel',
        style: `left:${x}px;top:${y}px`,
        onclick: (e) => e.stopPropagation(),
      },
        h('div', { className: 'am-tools-header' },
          h('button', { className: 'am-tools-back', onclick: (e) => this._back(e) }, '←'),
          h('span', { className: 'am-tools-title' }, selectedCategory.label),
        ),
        filtered.length === 0
          ? h('div', { className: 'am-tools-empty' }, 'no tools')
          : h('div', { className: 'am-tools-list' },
            ...filtered.map(tool =>
              h('button', {
                className: 'am-tool-item',
                key: tool.toolId || tool.displayName,
                title: tool.description || tool.displayName,
                onclick: (e) => this._selectTool(tool, e),
              }, tool.displayName)
            )
          )
      );
    }

    // Build items for radial segments — root and categories only
    let items = [];
    if (view === 'root') {
      items = [
        { label: 'upload', fn: (e) => this._showUpload(e) },
        { label: 'create', fn: (e) => this._showCategories(e) },
      ];
    } else if (view === 'categories') {
      items = [
        { label: 'back', fn: (e) => this._back(e) },
        ...CATEGORIES.map(c => ({ label: c.label, fn: (e) => this._selectCategory(c, e) })),
      ];
    }

    const n = Math.min(items.length, 5);
    if (n === 0) return h('div', { className: 'am-root active', style: `left:${x}px;top:${y}px` });

    const outerR = 72, innerR = 28;
    const angleStep = (2 * Math.PI) / n;
    const startAngle = -Math.PI / 2 - angleStep / 2;

    const polarToCartesian = (r, angle) => ({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    });

    const segmentPath = (i) => {
      const a0 = startAngle + i * angleStep + 0.03;
      const a1 = startAngle + (i + 1) * angleStep - 0.03;
      const o0 = polarToCartesian(outerR, a0);
      const o1 = polarToCartesian(outerR, a1);
      const i0 = polarToCartesian(innerR, a1);
      const i1 = polarToCartesian(innerR, a0);
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
      const r = (outerR + innerR) / 2;
      return polarToCartesian(r, a);
    };

    const size = (outerR + 4) * 2;
    const c = outerR + 4;

    return h('div', {
      className: 'am-root active',
      style: `left:${x}px;top:${y}px`,
      onclick: (e) => e.stopPropagation(),
    },
      h('svg', {
        className: 'am-svg',
        width: size,
        height: size,
        viewBox: `${-c} ${-c} ${size} ${size}`,
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
