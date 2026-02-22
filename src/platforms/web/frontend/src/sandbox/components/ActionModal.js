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
      .act-modal {
        position: fixed; z-index: 500;
        background: rgba(10,10,10,0.92); backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
        padding: 8px; min-width: 160px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        animation: act-fadein 0.1s ease;
      }
      @keyframes act-fadein { from { opacity: 0; transform: scale(0.95) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }

      .act-row { display: flex; gap: 6px; }
      .act-col { display: flex; flex-direction: column; gap: 4px; }

      .act-btn {
        background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px; color: #ccc; padding: 8px 14px; cursor: pointer;
        font-size: 13px; transition: all 0.15s; text-align: left; font-family: inherit;
      }
      .act-btn:hover { background: rgba(255,255,255,0.14); color: #fff; border-color: rgba(255,255,255,0.2); }

      .act-back {
        background: none; border: none; color: #666; cursor: pointer;
        font-size: 11px; padding: 2px 4px; margin-bottom: 4px; text-align: left;
        font-family: inherit;
      }
      .act-back:hover { color: #aaa; }

      .act-tools { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; min-width: 200px; }
      .act-tool-btn {
        background: rgba(255,255,255,0.05); border: 1px solid transparent;
        border-radius: 5px; color: #ccc; padding: 6px 10px; cursor: pointer;
        font-size: 12px; text-align: left; font-family: monospace; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .act-tool-btn:hover { background: rgba(255,255,255,0.1); color: #fff; border-color: rgba(255,255,255,0.1); }
      .act-tools-empty { color: #555; font-size: 12px; padding: 8px; }

      .act-upload-area {
        padding: 20px 16px; text-align: center; color: #888; font-size: 13px;
        border: 1px dashed rgba(255,255,255,0.2); border-radius: 6px;
        cursor: pointer; min-width: 200px;
      }
      .act-upload-area:hover { border-color: rgba(255,255,255,0.4); color: #ccc; }
      .act-upload-error { color: #f66; font-size: 12px; margin-top: 4px; }
      .act-uploading { color: #888; font-size: 12px; text-align: center; padding: 8px; }
    `;
  }

  _renderRoot() {
    return h('div', { className: 'act-row' },
      h('button', { className: 'act-btn', onclick: (e) => this._showUpload(e) }, 'upload'),
      h('button', { className: 'act-btn', onclick: (e) => this._showCategories(e) }, 'create')
    );
  }

  _renderCategories() {
    return h('div', { className: 'act-col' },
      h('button', { className: 'act-back', onclick: (e) => this._back(e) }, '← back'),
      h('div', { className: 'act-row' },
        ...CATEGORIES.map(c =>
          h('button', {
            className: 'act-btn',
            key: c.type,
            onclick: (e) => this._selectCategory(c, e),
          }, c.label)
        )
      )
    );
  }

  _renderTools() {
    const { selectedCategory, tools } = this.state;
    const filtered = tools.filter(t => t.category === selectedCategory.category);

    return h('div', { className: 'act-col' },
      h('button', { className: 'act-back', onclick: (e) => this._back(e) }, `← ${selectedCategory.label}`),
      filtered.length === 0
        ? h('div', { className: 'act-tools-empty' }, 'No tools in this category.')
        : h('div', { className: 'act-tools' },
          ...filtered.map(tool =>
            h('button', {
              className: 'act-tool-btn',
              key: tool.toolId || tool.displayName,
              onclick: (e) => this._selectTool(tool, e),
              title: tool.description || tool.displayName,
            }, tool.displayName)
          )
        )
    );
  }

  _renderUpload() {
    const { uploading, uploadError } = this.state;

    if (uploading) {
      return h('div', { className: 'act-col' },
        h('div', { className: 'act-uploading' }, 'Uploading...')
      );
    }

    return h('div', { className: 'act-col' },
      h('button', { className: 'act-back', onclick: (e) => this._back(e) }, '← back'),
      h('div', {
        className: 'act-upload-area',
        onclick: (e) => { e.stopPropagation(); this._fileInput?.click(); },
        ondragover: (e) => { e.preventDefault(); e.stopPropagation(); },
        ondrop: (e) => { e.preventDefault(); e.stopPropagation(); this._handleFile(e.dataTransfer.files[0]); },
      }, 'Drop image or click to upload'),
      h('input', {
        type: 'file',
        accept: 'image/*',
        style: 'display:none',
        ref: (el) => { this._fileInput = el; },
        onchange: (e) => this._handleFile(e.target.files[0]),
      }),
      uploadError ? h('div', { className: 'act-upload-error' }, uploadError) : null
    );
  }

  render() {
    const { visible, x, y } = this.props;
    if (!visible) return h('div', { style: 'display:none' });

    const { view } = this.state;
    const style = `left:${x}px;top:${y}px`;

    return h('div', { className: 'act-modal', style },
      view === 'root'       ? this._renderRoot()       :
      view === 'categories' ? this._renderCategories() :
      view === 'tools'      ? this._renderTools()      :
      view === 'upload'     ? this._renderUpload()     :
      null
    );
  }
}
