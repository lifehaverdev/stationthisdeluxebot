import { Component, h } from '@monygroupcorp/microact';
import { shortHash, formatUnits, formatUsd, relativeTime } from '../../lib/format.js';
import * as adminApi from '../../lib/adminApi.js';

/**
 * User search + details panel.
 * Props: { wallet }
 */
export class UserSearch extends Component {
  constructor(props) {
    super(props);
    this.state = {
      query: '',
      searchType: '',
      results: [],
      selectedUser: null,
      loading: false,
      error: null,
    };
  }

  async search() {
    const { query, searchType } = this.state;
    if (!query.trim()) return;
    this.setState({ loading: true, error: null, selectedUser: null });
    try {
      const data = await adminApi.searchUsers(this.props.wallet, query, searchType);
      this.setState({ results: data.users || [], loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async selectUser(masterAccountId) {
    this.setState({ loading: true });
    try {
      const data = await adminApi.fetchUserDetails(this.props.wallet, masterAccountId);
      this.setState({ selectedUser: data, loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async handleAdjustPoints(e) {
    e.preventDefault();
    const form = e.target;
    const masterAccountId = this.state.selectedUser?.user?._id;
    if (!masterAccountId) return;

    const points = parseInt(form.querySelector('[name="points"]').value, 10);
    const description = form.querySelector('[name="description"]').value.trim();
    if (!description || isNaN(points) || points === 0) return;

    try {
      await adminApi.adjustUserPoints(this.props.wallet, masterAccountId, { points, description });
      const data = await adminApi.fetchUserDetails(this.props.wallet, masterAccountId);
      this.setState({ selectedUser: data });
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  static get styles() {
    return `
      .user-search-section {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .user-search-section h2 {
        margin-top: 0;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 1rem;
      }
      .search-bar {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }
      .search-bar input, .search-bar select {
        padding: 0.5rem;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .search-bar input { flex: 1; }
      .search-bar input:focus, .search-bar select:focus { border-color: var(--accent); outline: none; }
      .search-bar button {
        padding: 0.5rem 1rem;
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .search-bar button:hover { color: var(--accent); border-color: var(--accent); }
      .search-bar button:disabled { opacity: 0.4; cursor: default; }
      .search-result {
        padding: 0.5rem 0.75rem;
        background: var(--surface-3, var(--surface-2));
        margin-bottom: 0.35rem;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: var(--border-width) solid transparent;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .search-result:hover { border-color: var(--border); }
      .user-detail-section {
        background: var(--surface-1);
        padding: 1rem;
        margin-top: 1rem;
        border: var(--border-width) solid var(--border);
      }
      .user-detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .user-detail-card {
        background: var(--surface-2);
        padding: 0.75rem;
        border: var(--border-width) solid var(--border);
      }
      .user-detail-card strong {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        display: block;
        margin-bottom: 0.25rem;
      }
      .user-detail-card span {
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: 1.1rem;
      }
      .adjust-form {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        align-items: flex-end;
        margin-top: 0.75rem;
      }
      .adjust-form input {
        padding: 0.4rem;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .adjust-form input:focus { border-color: var(--accent); outline: none; }
      .adjust-form button {
        padding: 0.4rem 0.75rem;
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .adjust-form button:hover { color: var(--accent); border-color: var(--accent); }
    `;
  }

  renderUserDetail() {
    const user = this.state.selectedUser;
    if (!user) return null;

    const u = user.user || {};
    const balance = user.balance || {};

    return h('div', { className: 'user-detail-section' },
      h('h3', { style: { color: 'var(--text-primary)', marginTop: 0, fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-xs)', letterSpacing: 'var(--ls-wider)', textTransform: 'uppercase' } }, `User: ${shortHash(u._id || '')}`),
      h('div', { className: 'user-detail-grid' },
        h('div', { className: 'user-detail-card' },
          h('strong', null, 'Points Balance'),
          h('span', { style: { color: 'var(--accent)' } }, (balance.points || 0).toLocaleString())
        ),
        h('div', { className: 'user-detail-card' },
          h('strong', null, 'Total Spent'),
          h('span', null, (balance.totalSpent || 0).toLocaleString())
        ),
        h('div', { className: 'user-detail-card' },
          h('strong', null, 'Platform'),
          h('span', null, u.platform || 'web')
        ),
        h('div', { className: 'user-detail-card' },
          h('strong', null, 'Created'),
          h('span', null, u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A')
        )
      ),
      h('form', { className: 'adjust-form', onSubmit: this.bind(this.handleAdjustPoints) },
        h('input', { type: 'number', name: 'points', placeholder: 'Points (+/-)', required: true, style: { width: '100px' } }),
        h('input', { type: 'text', name: 'description', placeholder: 'Reason', required: true, style: { flex: 1, minWidth: '150px' } }),
        h('button', { type: 'submit' }, 'Adjust Points')
      )
    );
  }

  render() {
    const { results, loading, error } = this.state;

    return h('section', { id: 'users', className: 'user-search-section' },
      h('h2', null, 'User Search'),
      h('div', { className: 'search-bar' },
        h('input', {
          type: 'text',
          placeholder: 'Address, username, or account ID...',
          value: this.state.query,
          onInput: (e) => this.setState({ query: e.target.value }),
          onKeyDown: (e) => { if (e.key === 'Enter') this.search(); }
        }),
        h('select', {
          value: this.state.searchType,
          onChange: (e) => this.setState({ searchType: e.target.value })
        },
          h('option', { value: '' }, 'All'),
          h('option', { value: 'address' }, 'Address'),
          h('option', { value: 'username' }, 'Username'),
          h('option', { value: 'id' }, 'Account ID')
        ),
        h('button', { onClick: this.bind(this.search), disabled: loading }, loading ? 'Searching...' : 'Search')
      ),
      error ? h('p', { style: { color: 'var(--danger)', fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-xs)' } }, error) : null,
      results.length > 0
        ? h('div', null,
            ...results.map(u =>
              h('div', {
                className: 'search-result',
                key: u._id,
                onClick: () => this.selectUser(u._id)
              },
                h('span', { style: { color: 'var(--text-primary)', fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-xs)' } }, u.profile?.username || shortHash(u._id)),
                h('span', { style: { color: 'var(--text-secondary)', fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-xs)' } }, u.platform || 'web')
              )
            )
          )
        : null,
      this.renderUserDetail()
    );
  }
}
