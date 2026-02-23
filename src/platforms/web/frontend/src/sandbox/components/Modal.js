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
        position: fixed; inset: 0; z-index: 1000;
        background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        animation: modal-fadein 0.15s ease;
      }
      @keyframes modal-fadein { from { opacity: 0; } to { opacity: 1; } }
      .modal-container {
        background: #1a1a1a; border: 1px solid #333; border-radius: 12px;
        padding: 24px; max-width: 520px; width: 90%; max-height: 85vh;
        overflow-y: auto; position: relative; color: #e0e0e0;
        animation: modal-slidein 0.15s ease;
      }
      .modal-container--wide { max-width: 720px; }
      @keyframes modal-slidein { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
      .modal-close {
        position: absolute; top: 12px; right: 12px;
        background: none; border: none; color: #666; font-size: 24px;
        cursor: pointer; padding: 4px 8px; border-radius: 4px;
        line-height: 1;
      }
      .modal-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
      .modal-title { font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #fff; }
      .modal-error { color: #f44; font-size: 16px; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,68,68,0.1); border-radius: 6px; }
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
      .mk-loader { text-align: center; padding: 24px; color: #888; }
      .mk-loader-spinner {
        width: 24px; height: 24px; border: 2px solid #333; border-top-color: #888;
        border-radius: 50%; animation: mk-loader-spin 0.8s linear infinite;
        margin: 0 auto 12px;
      }
      @keyframes mk-loader-spin { to { transform: rotate(360deg); } }
      .mk-loader-msg { font-size: 16px; margin-top: 8px; }
      .mk-loader-bar { height: 4px; background: #222; border-radius: 2px; margin-top: 12px; overflow: hidden; }
      .mk-loader-fill { height: 100%; background: #90caf9; border-radius: 2px; transition: width 0.3s; }
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
