import { Component, h } from '@monygroupcorp/microact';

export class Footer extends Component {
  render() {
    return h('footer', { className: 'site-footer' },
      h('p', null, '\u00A9 2026 StationThis')
    );
  }
}
