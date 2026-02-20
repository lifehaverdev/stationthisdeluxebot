import { Component, h } from '@monygroupcorp/microact';
import { dispatch } from '../store.js';

const CATEGORIES = [
  { type: 'image', label: 'image' },
  { type: 'sound', label: 'sound' },
  { type: 'text', label: 'text' },
  { type: 'movie', label: 'movie' },
];

/**
 * ActionModal — the click-to-create popup that appears when clicking the canvas.
 *
 * Shows upload + create buttons. Create expands to category submenu.
 * Category clicks delegate to showToolsForCategory in /sandbox/ module graph.
 * Upload delegates to the upload flow in /sandbox/io.js.
 *
 * Positioned via props.x / props.y (screen coordinates).
 * Controlled visibility: visible when props.visible is true.
 */
export class ActionModal extends Component {
  constructor(props) {
    super(props);
    this.state = { submenuOpen: false, uploadMode: false };
    this._showToolsForCategory = null;
    this._uploadFile = null;
    this._hideModal = null;
  }

  didMount() {
    this._loadSandboxFns();
  }

  async _loadSandboxFns() {
    try {
      const [toolSel, io, utils] = await Promise.all([
        import(/* @vite-ignore */ '/sandbox/' + 'toolSelection.js'),
        import(/* @vite-ignore */ '/sandbox/' + 'io.js'),
        import(/* @vite-ignore */ '/sandbox/' + 'utils.js'),
      ]);
      this._showToolsForCategory = toolSel.showToolsForCategory;
      this._uploadFile = io.uploadFile;
      this._hideModal = utils.hideModal;
    } catch (e) {
      console.error('[ActionModal] Failed to load sandbox modules:', e);
    }
  }

  _onCategory(type, e) {
    e.stopPropagation();
    this.setState({ submenuOpen: false });
    if (this._showToolsForCategory) {
      this._showToolsForCategory(type, e.clientX, e.clientY);
    }
    this.props.onClose?.();
  }

  _onUpload() {
    this.setState({ uploadMode: true });
  }

  _handleFile(file) {
    if (!file?.type.startsWith('image/')) return;
    if (this._uploadFile) {
      // uploadFile expects (file, modalEl, position) — we pass null for modalEl
      // since we handle the UI ourselves
      const pos = this.props.workspacePosition;
      this._uploadFile(file, null, pos);
    }
    this.props.onClose?.();
  }

  _cancelUpload() {
    this.setState({ uploadMode: false });
  }

  static get styles() {
    return `
      .act-modal {
        position: fixed; z-index: 500;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
        padding: 8px; display: flex; gap: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        animation: act-fadein 0.1s ease;
      }
      @keyframes act-fadein { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      .act-btn {
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px; color: #ccc; padding: 8px 14px; cursor: pointer;
        font-size: 13px; transition: all 0.15s; position: relative;
      }
      .act-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
      .act-sub {
        position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.9); border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 4px;
        min-width: 100px;
      }
      .act-sub-btn {
        background: none; border: 1px solid transparent; border-radius: 4px;
        color: #ccc; padding: 6px 12px; cursor: pointer; font-size: 12px;
        text-align: left; transition: all 0.15s;
      }
      .act-sub-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.1); color: #fff; }
      .act-upload-area {
        padding: 16px; text-align: center; color: #888; font-size: 13px;
        border: 1px dashed rgba(255,255,255,0.2); border-radius: 6px;
        cursor: pointer; min-width: 180px;
      }
      .act-upload-area:hover { border-color: rgba(255,255,255,0.4); color: #ccc; }
      .act-cancel { background: none; border: none; color: #666; cursor: pointer; font-size: 12px; margin-top: 6px; }
    `;
  }

  _renderUploadMode() {
    return h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:6px' },
      h('div', {
        className: 'act-upload-area',
        onclick: () => this._fileInput?.click(),
        ondragover: (e) => { e.preventDefault(); e.stopPropagation(); },
        ondrop: (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]); }
      }, 'Drop image or click'),
      h('input', {
        type: 'file', accept: 'image/*', style: 'display:none',
        ref: (el) => { this._fileInput = el; },
        onchange: (e) => this._handleFile(e.target.files[0])
      }),
      h('button', { className: 'act-cancel', onclick: this.bind(this._cancelUpload) }, 'Cancel')
    );
  }

  _renderButtons() {
    const { submenuOpen } = this.state;
    return [
      h('button', { className: 'act-btn', onclick: this.bind(this._onUpload) }, 'upload'),
      h('button', {
        className: 'act-btn',
        onclick: (e) => { e.stopPropagation(); this.setState({ submenuOpen: !submenuOpen }); }
      },
        'create',
        submenuOpen ? h('div', { className: 'act-sub' },
          ...CATEGORIES.map(c =>
            h('button', {
              className: 'act-sub-btn',
              key: c.type,
              onclick: (e) => this._onCategory(c.type, e)
            }, c.label)
          )
        ) : null
      )
    ];
  }

  render() {
    const { visible, x, y } = this.props;
    if (!visible) return h('div', { style: 'display:none' });

    const style = `left:${x}px;top:${y}px`;

    return h('div', { className: 'act-modal', style },
      ...(this.state.uploadMode ? [this._renderUploadMode()] : this._renderButtons())
    );
  }
}
