// src/platforms/web/client/src/sandbox/window/BaseWindow.js
// BaseWindow: shared shell for all sandbox windows (tool, spell, collection, etc.)

import { el, clear } from './domHelpers.js';
import { enableDrag } from './drag.js';

export default class BaseWindow {
  /**
   * @param {object} opts
   * @param {string} opts.id – unique id (caller must ensure uniqueness)
   * @param {string} opts.title – display title shown in header
   * @param {object} opts.position – { x, y } initial workspace coords
   * @param {string[]} [opts.classes] – extra CSS classes on root element
   * @param {string} [opts.icon] – optional emoji or char prefix
   */
  constructor({ id, title, position = { x: 0, y: 0 }, classes = [], icon = '' }) {
    this.id = id;
    this.position = position;
    this.title = title;
    this.icon = icon;

    // Root element
    this.el = el('div', {
      id,
      className: ['tool-window', ...classes].join(' '),
      style: {
        left: `${position.x}px`,
        top: `${position.y}px`,
      },
    });

    this.buildHeader();
    this.body = el('div', { className: 'window-body' });
    this.el.appendChild(this.body);

    // Placeholder for error + output containers
    this.errorEl = el('div', { className: 'window-error' });
    this.outputEl = el('div', { className: 'result-container' });
    this.el.append(this.errorEl, this.outputEl);

    // NOTE: Subclasses should call this.renderBody() *after* their own
    // initialization to avoid accessing unassigned fields here.
  }

  buildHeader() {
    const header = el('div', { className: 'tool-window-header' });
    this.header = header;

    const titleText = this.icon ? `${this.icon} ${this.title}` : this.title;
    const titleEl = el('div', { innerText: titleText, style: { fontWeight: 'bold' } });

    const closeBtn = el('button', { innerText: '×', className: 'close-button' });
    closeBtn.addEventListener('click', () => this.destroy());

    header.append(titleEl, closeBtn);
    this.el.prepend(header);

    enableDrag(this.el, header);
  }

  /**
   * Attach window to DOM (defaults to sandbox canvas).
   * @param {string|HTMLElement} [parent='.sandbox-canvas']
   */
  mount(parent = '.sandbox-canvas') {
    const parentEl = typeof parent === 'string' ? document.querySelector(parent) : parent;
    (parentEl || document.body).appendChild(this.el);
  }

  destroy() {
    this.el.remove();
    this.onClose?.();
  }

  // ---- helpers -----------------------------------------------------------
  showError(msg = '') {
    this.errorEl.textContent = msg;
    this.errorEl.style.display = msg ? 'block' : 'none';
  }

  setOutput(data) {
    clear(this.outputEl);
    if (!data) return;
    // defer to old renderer for now to maintain behaviour
    import('../node/resultContent.js').then(({ renderResultContent }) => {
      renderResultContent(this.outputEl, data);
    });
  }

  addButton({ label = '', title = '', onClick }) {
    const btn = el('button', { innerText: label, title });
    btn.addEventListener('click', onClick);
    this.header.appendChild(btn);
    return btn;
  }
}
