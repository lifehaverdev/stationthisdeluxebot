import { Component, h } from '@monygroupcorp/microact';
import { getAppUrl } from '../lib/urls.js';
import { Sigil } from '../sandbox/components/Sigil.js';

export class Landing extends Component {
  _onEnter(e) {
    e.preventDefault();
    const root = e.currentTarget.closest('.lp-root');
    if (root) {
      root.classList.add('exiting');
      setTimeout(() => { window.location.href = getAppUrl(); }, 300);
    } else {
      window.location.href = getAppUrl();
    }
  }

  static get styles() {
    return `
      .lp-root {
        position: fixed;
        inset: 0;
        background: var(--canvas-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      /* Sigil watermark — centered behind content */
      .lp-sigil {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: var(--text-primary);
        pointer-events: none;
      }

      .lp-main {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 48px;
      }

      .lp-headline {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .lp-wordmark {
        font-family: var(--ff-display);
        font-size: clamp(56px, 8vw, 96px);
        font-weight: var(--fw-bold);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0;
        line-height: 1;
        animation: fadeIn var(--dur-entry) var(--ease) 0.1s both;
      }

      .lp-tagline {
        font-family: var(--ff-sans);
        font-size: var(--fs-md);
        font-weight: var(--fw-light);
        color: var(--text-secondary);
        letter-spacing: var(--ls-wide);
        margin: 0;
        animation: fadeIn var(--dur-entry) var(--ease) 0.25s both;
      }

      .lp-nav {
        display: flex;
        align-items: center;
        gap: 16px;
        animation: fadeIn var(--dur-entry) var(--ease) 0.4s both;
      }

      .lp-nav-link {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-label);
        text-decoration: none;
        padding: 6px 14px;
        border: var(--border-width) solid var(--border);
        transition:
          color       var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease);
      }
      .lp-nav-link:hover {
        color: var(--text-secondary);
        border-color: var(--border-hover);
      }

      .lp-nav-cta {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--accent);
        background: var(--accent-dim);
        border: var(--border-width) solid var(--accent-border);
        padding: 6px 20px;
        cursor: pointer;
        transition:
          background   var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease);
      }
      .lp-nav-cta:hover {
        background: rgba(0,223,200,0.2);
        border-color: var(--accent);
      }

      /* Transition out — landing dissolves into sandbox */
      .lp-root.exiting {
        animation: fadeIn var(--dur-panel) var(--ease) reverse forwards;
        pointer-events: none;
      }
    `;
  }

  render() {
    return h('div', { className: 'lp-root' },
      h(Sigil, { size: 480, opacity: 0.04, className: 'lp-sigil' }),
      h('main', { className: 'lp-main' },
        h('div', { className: 'lp-headline' },
          h('h1', { className: 'lp-wordmark' }, 'NOEMA'),
          h('p',  { className: 'lp-tagline'  }, 'Composable Generative Studio.'),
        ),
        h('nav', { className: 'lp-nav' },
          h('a', { href: '/docs', className: 'lp-nav-link' }, 'Documentation'),
          h('button', { className: 'lp-nav-cta', onclick: this.bind(this._onEnter) }, 'Enter Console'),
        ),
      ),
    );
  }
}
