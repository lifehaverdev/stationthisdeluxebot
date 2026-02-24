import { Component, h } from '@monygroupcorp/microact';

/**
 * Modal — reusable overlay base component.
 *
 * Props:
 *   onClose    — called when user closes (backdrop click, ESC, close button)
 *   title      — optional header text
 *   className  — additional class on the container
 *   wide       — if true, max-width: 720px instead of 520px
 *   content    — array of child vnodes to render inside the modal body
 *
 * NOTE: microact does not inject h() children into props. Always pass body
 * content via the `content` prop:
 *
 *   h(Modal, { onClose: () => ..., title: 'My Modal', content: [
 *     h('div', null, 'content here')
 *   ] })
 */
export class Modal extends Component {
  didMount() {
    this._escHandler = (e) => {
      if (e.key === 'Escape') this.props.onClose?.();
    };
    document.addEventListener('keydown', this._escHandler);
    this.registerCleanup(() => document.removeEventListener('keydown', this._escHandler));
  }

  _backdrop(e) {
    if (e.target === e.currentTarget) this.props.onClose?.();
  }

  static get styles() {
    return `
      .modal-overlay {
        position: fixed; inset: 0; z-index: var(--z-modal);
        background: var(--modal-bg);
        display: flex; align-items: center; justify-content: center;
        animation: modal-fadein var(--dur-trans) var(--ease);
      }
      @keyframes modal-fadein { from { opacity: 0; } to { opacity: 1; } }
      .modal-container {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        padding: 24px;
        max-width: 520px; width: 90%; max-height: 85vh;
        overflow-y: auto; position: relative;
        color: var(--text-primary);
        font-family: var(--ff-sans);
        animation: modal-slidein var(--dur-trans) var(--ease);
      }
      .modal-container--wide { max-width: 720px; }
      @keyframes modal-slidein { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } }
      .modal-close {
        position: absolute; top: 12px; right: 12px;
        background: none; border: var(--border-width) solid transparent;
        color: var(--text-label); font-size: var(--fs-lg);
        cursor: pointer; padding: 2px 7px; line-height: 1;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .modal-close:hover { color: var(--danger); border-color: var(--danger); }
      .modal-title {
        font-family: var(--ff-display);
        font-size: var(--fs-xl);
        font-weight: var(--fw-semibold);
        letter-spacing: var(--ls-tight);
        margin-bottom: 20px;
        color: var(--text-primary);
      }
      .modal-error {
        color: var(--danger);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        margin-bottom: 12px;
        padding: 8px 12px;
        background: var(--danger-dim);
        border-left: 2px solid var(--danger);
      }
    `;
  }

  render() {
    const { title, className, wide, onClose, content } = this.props;
    const containerClass = `modal-container${wide ? ' modal-container--wide' : ''}${className ? ' ' + className : ''}`;

    return h('div', { className: 'modal-overlay', onclick: this.bind(this._backdrop) },
      h('div', { className: containerClass },
        h('button', { className: 'modal-close', onclick: () => onClose?.() }, '\u00D7'),
        title ? h('div', { className: 'modal-title' }, title) : null,
        ...(Array.isArray(content) ? content : content ? [content] : [])
      )
    );
  }
}

/**
 * Loader — inline loading indicator with optional message/progress.
 *
 * Props:
 *   message  — text to show
 *   progress — 0-1 for progress bar (omit for spinner only)
 */
export class Loader extends Component {
  static get styles() {
    return `
      .mk-loader { text-align: center; padding: 24px; color: var(--text-secondary); }
      .mk-loader-spinner {
        width: 22px; height: 22px;
        border: 2px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: mk-loader-spin 0.8s linear infinite;
        margin: 0 auto 12px;
      }
      @keyframes mk-loader-spin { to { transform: rotate(360deg); } }
      .mk-loader-msg {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        margin-top: 8px;
        color: var(--text-label);
      }
      .mk-loader-bar { height: 2px; background: var(--surface-3); margin-top: 12px; overflow: hidden; }
      .mk-loader-fill { height: 100%; background: var(--accent); transition: width var(--dur-trans) var(--ease); }
    `;
  }

  render() {
    const { message, progress } = this.props;
    return h('div', { className: 'mk-loader' },
      h('div', { className: 'mk-loader-spinner' }),
      message ? h('div', { className: 'mk-loader-msg' }, message) : null,
      progress != null ? h('div', { className: 'mk-loader-bar' },
        h('div', { className: 'mk-loader-fill', style: `width:${Math.round(progress * 100)}%` })
      ) : null
    );
  }
}

/**
 * ModalError — styled error display for use inside modals.
 *
 * Props:
 *   message — error text (renders nothing if falsy)
 */
export function ModalError({ message }) {
  if (!message) return null;
  return h('div', { className: 'modal-error' }, message);
}
