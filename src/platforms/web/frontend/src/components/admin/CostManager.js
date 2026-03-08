import { Component, h } from '@monygroupcorp/microact';
import { formatUsd } from '../../lib/format.js';
import * as adminApi from '../../lib/adminApi.js';

const CATEGORIES = ['infrastructure', 'third-party', 'development', 'marketing', 'other'];

/**
 * Cost display + inline entry form.
 * Props: { costs, costTotals, expenditure, wallet, onCostAdded }
 */
export class CostManager extends Component {
  constructor(props) {
    super(props);
    this.state = {
      date: new Date().toISOString().slice(0, 10),
      category: 'infrastructure',
      amount: '',
      vendor: '',
      description: '',
      submitting: false,
      error: null,
    };
  }

  async handleSubmit(e) {
    e.preventDefault();
    const { wallet, onCostAdded } = this.props;
    const { date, category, amount, vendor, description } = this.state;
    if (!amount || !description.trim()) return;

    this.setState({ submitting: true, error: null });
    try {
      await adminApi.submitCostEntry(wallet, {
        date,
        category,
        amountUsd: parseFloat(amount),
        vendor: vendor.trim() || undefined,
        description: description.trim(),
      });
      this.setState({
        date: new Date().toISOString().slice(0, 10),
        category: 'infrastructure',
        amount: '',
        vendor: '',
        description: '',
        submitting: false,
      });
      onCostAdded?.();
    } catch (err) {
      this.setState({ submitting: false, error: err.message });
    }
  }

  static get styles() {
    return `
      .cost-section {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .cost-section h2 {
        margin-top: 0;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 1rem;
      }
      .cost-section h3 {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin: 1rem 0 0.5rem;
      }
      .cost-totals {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .cost-total-item {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        padding: 0.5rem 0.75rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .cost-total-label {
        color: var(--text-secondary);
        text-transform: capitalize;
      }
      .cost-total-value {
        color: var(--accent);
        margin-left: 0.5rem;
      }
      .cost-form {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 1rem;
      }
      @media (max-width: 600px) {
        .cost-form { grid-template-columns: 1fr; }
      }
      .cost-form label {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .cost-form input, .cost-form select, .cost-form textarea {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 4px 8px;
        outline: none;
      }
      .cost-form input:focus, .cost-form select:focus, .cost-form textarea:focus {
        border-color: var(--accent);
      }
      .cost-form textarea { resize: vertical; min-height: 40px; }
      .cost-form-actions {
        grid-column: 1 / -1;
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .cost-form-actions button {
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 3px 10px;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .cost-form-actions button:hover { color: var(--accent); border-color: var(--accent); }
      .cost-form-actions button:disabled { opacity: 0.4; cursor: default; }
      .cost-form-error {
        color: var(--danger);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .cost-table {
        width: 100%;
        border-collapse: collapse;
      }
      .cost-table th {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        text-align: left;
        padding: 0.5rem;
        border-bottom: var(--border-width) solid var(--border);
      }
      .cost-table td {
        padding: 0.5rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-primary);
        border-bottom: var(--border-width) solid var(--border);
      }
      .cost-table tr:nth-child(even) td { background: var(--surface-1); }
      .cost-table tr:nth-child(odd) td { background: var(--surface-2); }
    `;
  }

  render() {
    const { costs, costTotals, expenditure } = this.props;
    const { date, category, amount, vendor, description, submitting, error } = this.state;

    return h('section', { id: 'costs', className: 'cost-section' },
      h('h2', null, 'Costs'),

      // Expenditure by tool (infra costs from generations)
      expenditure?.breakdown?.length
        ? h('div', null,
            h('h3', null, 'Infrastructure (by tool)'),
            h('div', { className: 'cost-totals' },
              ...expenditure.breakdown.map(item =>
                h('div', { className: 'cost-total-item', key: item.tool || item.category },
                  h('span', { className: 'cost-total-label' }, item.tool || item.category),
                  h('span', { className: 'cost-total-value' }, formatUsd(item.totalCostUsd || item.total || 0)),
                )
              )
            )
          )
        : null,

      // Logged costs by category
      costTotals?.length
        ? h('div', null,
            h('h3', null, 'Logged Costs (by category)'),
            h('div', { className: 'cost-totals' },
              ...costTotals.map(t =>
                h('div', { className: 'cost-total-item', key: t.category || t._id },
                  h('span', { className: 'cost-total-label' }, t.category || t._id),
                  h('span', { className: 'cost-total-value' }, formatUsd(t.totalAmountUsd || t.total || 0)),
                )
              )
            )
          )
        : null,

      // Add Cost form
      h('h3', null, 'Add Cost'),
      h('form', { className: 'cost-form', onSubmit: this.bind(this.handleSubmit) },
        h('label', null, 'Date'),
        h('input', { type: 'date', value: date, onInput: e => this.setState({ date: e.target.value }), disabled: submitting }),

        h('label', null, 'Category'),
        h('select', { value: category, onChange: e => this.setState({ category: e.target.value }), disabled: submitting },
          ...CATEGORIES.map(c => h('option', { value: c, key: c }, c))
        ),

        h('label', null, 'Amount ($)'),
        h('input', { type: 'number', step: '0.01', placeholder: '0.00', value: amount, onInput: e => this.setState({ amount: e.target.value }), disabled: submitting }),

        h('label', null, 'Vendor'),
        h('input', { type: 'text', placeholder: 'Optional', value: vendor, onInput: e => this.setState({ vendor: e.target.value }), disabled: submitting }),

        h('label', null, 'Description'),
        h('textarea', { placeholder: 'What was this cost for?', value: description, onInput: e => this.setState({ description: e.target.value }), disabled: submitting }),

        h('div', { className: 'cost-form-actions' },
          h('button', { type: 'submit', disabled: submitting || !amount || !description.trim() }, submitting ? 'Submitting...' : 'Add Cost'),
          error ? h('span', { className: 'cost-form-error' }, error) : null,
        ),
      ),

      // Recent costs table
      costs?.length
        ? h('div', null,
            h('h3', null, 'Recent Entries'),
            h('table', { className: 'cost-table' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Date'),
                  h('th', null, 'Category'),
                  h('th', null, 'Amount'),
                  h('th', null, 'Vendor'),
                  h('th', null, 'Description'),
                )
              ),
              h('tbody', null,
                ...costs.map((c, i) =>
                  h('tr', { key: c._id || i },
                    h('td', null, c.date ? new Date(c.date).toLocaleDateString() : '—'),
                    h('td', null, c.category || '—'),
                    h('td', null, formatUsd(c.amountUsd || c.amount || 0)),
                    h('td', null, c.vendor || '—'),
                    h('td', null, (c.description || '').slice(0, 60) + (c.description?.length > 60 ? '...' : '')),
                  )
                )
              )
            )
          )
        : null,
    );
  }
}
