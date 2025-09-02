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
  constructor({ id, title, position = { x: 0, y: 0 }, classes = [], icon = '' }, { register = true } = {}) {
    this.id = id;
    this.position = position;
    // expose workspace coords for drag helpers
    this.workspaceX = position.x;
    this.workspaceY = position.y;
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
    this.body.append(this.errorEl, this.outputEl);

    // Register with global state if requested (subclasses may defer by passing register:false and calling this._registerWindow() later)
    if (register) {
      this._registerWindow();
    }
    // NOTE: Subclasses should call this.renderBody() *after* their own
    // initialization to avoid accessing unassigned fields here.
  }

  // Build draggable header with title and close button
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
   * Append the window element to DOM (defaults to sandbox canvas).
   * Subclasses may override to customise target.
   */
  mount(parent = '.sandbox-canvas') {
    const parentEl = typeof parent === 'string' ? document.querySelector(parent) : parent;
    if (parentEl) {
      parentEl.appendChild(this.el);
    } else {
      // Fallback to body and move later when canvas exists
      document.body.appendChild(this.el);
      // Move the window once .sandbox-canvas exists (may be injected later)
      const attemptRelocate = () => {
        const canvas = document.querySelector('.sandbox-canvas');
        if (canvas) {
          canvas.appendChild(this.el);
          return true;
        }
        return false;
      };

      // Try immediately after current task to cover fast canvas injection
      setTimeout(() => {
        if (attemptRelocate()) return;

        // Observe DOM changes until the canvas is added then move once
        const observer = new MutationObserver(() => {
          if (attemptRelocate()) {
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, 0);
    }
  }

  /**
   * Return a plain-object representation that is persisted to localStorage.
   * Subclasses should override to add their own fields but still call
   * `super.serialize()` to get common props.
   */
  serialize() {
    return {
      id: this.id,
      workspaceX: this.workspaceX,
      workspaceY: this.workspaceY,
      type: 'base'
    };
  }

  _registerWindow(pushHist = true) {
    // Dynamic import to avoid circular deps on first eval
    import('../state.js').then(({ addToolWindow, persistState, pushHistory }) => {
      // merge / upsert
      this.model = addToolWindow({ ...this.serialize(), element: this.el });
      if (pushHist) pushHistory();
      persistState();
    }).catch(console.error);
  }

  // When window is destroyed, remove from state
  destroy() {
    this.el.remove();
    import('../state.js').then(({ removeToolWindow, persistState, pushHistory }) => {
      pushHistory();
      removeToolWindow(this.id);
      persistState();
    });
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
