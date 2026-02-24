import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader } from './Modal.js';
import { TabBar } from './ModalKit.js';
import { fetchJson } from '../../lib/api.js';
import { ModelBrowser } from './ModelBrowser.js';
import { TrainingStudio } from './TrainingStudio.js';

const TAB = { BROWSE: 'browse', TRAIN: 'train' };

/**
 * ModsModal — shell component for the Mods menu.
 *
 * Renders a TabBar (Browse / Train) and delegates to
 * ModelBrowser or TrainingStudio based on the active tab.
 *
 * Props:
 *   onClose — close handler
 */
export class ModsModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tab: TAB.BROWSE,
      userId: null,
      userLoading: true,
    };
  }

  didMount() {
    this._esc = (e) => { if (e.key === 'Escape') this.props.onClose?.(); };
    document.addEventListener('keydown', this._esc);
    this.registerCleanup(() => document.removeEventListener('keydown', this._esc));
    this._fetchUserId();
  }

  async _fetchUserId() {
    try {
      const data = await fetchJson('/api/v1/user/dashboard');
      this.setState({ userId: data.masterAccountId, userLoading: false });
    } catch {
      this.setState({ userLoading: false });
    }
  }

  _switchTab(tab) {
    this.setState({ tab });
  }

  // ── Render ───────────────────────────────────────────────

  _renderBody() {
    const { tab, userId, userLoading } = this.state;

    const tabs = [
      { key: TAB.BROWSE, label: 'Browse' },
      { key: TAB.TRAIN, label: 'Train' },
    ];

    if (userLoading) {
      return h('div', null,
        h(TabBar, { tabs, active: tab, onChange: this.bind(this._switchTab) }),
        h(Loader, { message: 'Loading...' })
      );
    }

    const content = tab === TAB.BROWSE
      ? h(ModelBrowser, { userId })
      : h(TrainingStudio, { userId, onClose: this.props.onClose });

    return h('div', null,
      h(TabBar, { tabs, active: tab, onChange: this.bind(this._switchTab) }),
      content
    );
  }

  static get styles() {
    return `
      .mm-shell { min-height: 300px; }
    `;
  }

  render() {
    return h(Modal, {
      onClose: this.props.onClose,
      title: 'Mods',
      wide: true,
      content: [
        h('div', { className: 'mm-shell' }, this._renderBody())
      ],
    });
  }
}
