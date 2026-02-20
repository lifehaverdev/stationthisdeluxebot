import { Component, h } from '@monygroupcorp/microact';

const APP_URL = window.location.hostname === 'localhost'
  ? 'http://app.localhost:4000'
  : 'https://app.noema.art';

export class Nav extends Component {
  render() {
    return h('nav', { className: 'site-nav' },
      h('a', { href: '/', className: 'nav-logo' }, 'noema'),
      h('div', { className: 'nav-links' },
        h('a', { href: '/pricing' }, 'Pricing'),
        h('a', { href: '/docs' }, 'Docs'),
        h('a', { href: APP_URL, className: 'nav-cta' }, 'Launch App')
      )
    );
  }
}
