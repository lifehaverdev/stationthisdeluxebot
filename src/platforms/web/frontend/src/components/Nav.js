import { Component, h } from '@monygroupcorp/microact';
import { getAppUrl } from '../lib/urls.js';

export class Nav extends Component {
  render() {
    return h('nav', { className: 'site-nav' },
      h('a', { href: '/', className: 'nav-logo' }, 'noema'),
      h('div', { className: 'nav-links' },
        h('a', { href: '/pricing' }, 'Pricing'),
        h('a', { href: '/docs' }, 'Docs'),
        h('a', { href: getAppUrl(), className: 'nav-cta' }, 'Launch App')
      )
    );
  }
}
