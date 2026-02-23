import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { fetchJson } from '../../lib/api.js';

export class HistoryModal extends Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: null, data: null, timeUnit: 'month', offset: 0 };
  }

  didMount() { this._fetch(); }

  async _fetch() {
    this.setState({ loading: true, error: null });
    try {
      const { timeUnit, offset } = this.state;
      const data = await fetchJson(`/api/v1/user/history?timeUnit=${timeUnit}&offset=${offset}`);
      this.setState({ data, loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  _nav(action) {
    const { timeUnit, offset, data } = this.state;

    if (action === 'prev') {
      this.setState({ offset: offset + 1 });
    } else if (action === 'next' && offset > 0) {
      this.setState({ offset: offset - 1 });
    } else if ((action === 'zoom-in' || action === 'zoom-out') && data) {
      const dayDiff = this._dayDiff(data.endDate);
      const end = new Date(data.endDate);
      const now = new Date();

      const TRANSITIONS = {
        'zoom-in': { month: ['week', Math.floor(dayDiff / 7)], week: ['day', dayDiff] },
        'zoom-out': {
          day: ['week', Math.floor(dayDiff / 7)],
          week: ['month', (now.getFullYear() - end.getFullYear()) * 12 + (now.getMonth() - end.getMonth())]
        }
      };

      const t = TRANSITIONS[action]?.[timeUnit];
      if (t) this.setState({ timeUnit: t[0], offset: t[1] });
      else return;
    } else {
      return;
    }
    this._fetch();
  }

  _dayDiff(endDateStr) {
    const now = new Date(); const end = new Date(endDateStr);
    return Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())) / 86400000);
  }

  static get styles() {
    return `
      .history-nav { display: flex; gap: 8px; align-items: center; margin: 12px 0; }
      .history-nav button { background: #222; border: 1px solid #444; color: #ccc; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
      .history-nav button:disabled { opacity: 0.3; cursor: default; }
      .history-nav button:not(:disabled):hover { background: #333; }
      .date-range { font-size: 16px; color: #888; }
      .history-summary { margin: 12px 0; font-size: 17px; }
      .history-details ul { list-style: none; padding: 0; }
      .history-details li { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #222; font-size: 16px; }
    `;
  }

  render() {
    const { loading, error, data, timeUnit, offset } = this.state;

    let body;
    if (loading) {
      body = h(Loader, { message: 'Loading history...' });
    } else if (data) {
      const start = new Date(data.startDate).toLocaleDateString();
      const end = new Date(data.endDate).toLocaleDateString();
      body = h('div', null,
        h('div', { className: 'history-nav' },
          h('button', { onclick: () => this._nav('prev') }, '\u2190'),
          h('button', { onclick: () => this._nav('zoom-out'), disabled: timeUnit === 'month' }, '\u2212'),
          h('span', { className: 'date-range' }, `${start} \u2013 ${end}`),
          h('button', { onclick: () => this._nav('zoom-in'), disabled: timeUnit === 'day' }, '+'),
          h('button', { onclick: () => this._nav('next'), disabled: offset === 0 }, '\u2192')
        ),
        h('div', { className: 'history-summary' },
          h('p', null, h('strong', null, 'Total Spent: '), `${data.totalSpent.toFixed(4)} points`),
          h('p', null, h('strong', null, 'Most Used: '), data.mostUsedTool)
        ),
        h('div', { className: 'history-details' },
          h('h4', null, 'Tool Breakdown'),
          h('ul', null, ...(data.toolBreakdown || []).map(t =>
            h('li', { key: t.tool },
              h('strong', null, t.tool),
              h('span', null, `Uses: ${t.count} | Spent: ${t.spent.toFixed(4)}`)
            )
          ))
        )
      );
    }

    return h(Modal, { onClose: this.props.onClose, title: 'Usage History', content: [
      ModalError({ message: error }),
      body
    ] });
  }
}
