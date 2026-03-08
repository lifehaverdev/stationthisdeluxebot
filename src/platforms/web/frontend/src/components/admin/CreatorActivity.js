import { Component, h } from '@monygroupcorp/microact';
import { shortHash, relativeTime } from '../../lib/format.js';

/**
 * Creator activity summary + leaderboard.
 * Props: { creatorStats }
 */
export class CreatorActivity extends Component {
  static get styles() {
    return `
      .creator-section {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .creator-section h2 {
        margin-top: 0;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 1rem;
      }
      .creator-summary {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      @media (max-width: 800px) {
        .creator-summary { grid-template-columns: 1fr; }
      }
      .creator-card {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        padding: 1rem;
      }
      .creator-card-title {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 0.75rem;
      }
      .creator-card-stat {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.25rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .creator-card-stat .label { color: var(--text-secondary); }
      .creator-card-stat .value { color: var(--accent); }
      .creator-table {
        width: 100%;
        border-collapse: collapse;
      }
      .creator-table th {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        text-align: left;
        padding: 0.5rem;
        border-bottom: var(--border-width) solid var(--border);
      }
      .creator-table td {
        padding: 0.5rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-primary);
        border-bottom: var(--border-width) solid var(--border);
      }
      .creator-table tr:nth-child(even) td { background: var(--surface-1); }
      .creator-table tr:nth-child(odd) td { background: var(--surface-2); }
      .creator-empty {
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 1rem 0;
      }
    `;
  }

  render() {
    const { creatorStats } = this.props;
    const summary = creatorStats?.summary;
    const topCreators = creatorStats?.topCreators || [];

    return h('section', { id: 'creators', className: 'creator-section' },
      h('h2', null, 'Creator Activity'),

      summary
        ? h('div', { className: 'creator-summary' },
            h('div', { className: 'creator-card' },
              h('div', { className: 'creator-card-title' }, 'Spells'),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Total'),
                h('span', { className: 'value' }, summary.spells?.total || 0),
              ),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Public'),
                h('span', { className: 'value' }, summary.spells?.public || 0),
              ),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Total Casts'),
                h('span', { className: 'value' }, (summary.spells?.totalCasts || 0).toLocaleString()),
              ),
            ),
            h('div', { className: 'creator-card' },
              h('div', { className: 'creator-card-title' }, 'Models'),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Total'),
                h('span', { className: 'value' }, summary.models?.total || 0),
              ),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Completed'),
                h('span', { className: 'value' }, summary.models?.completed || 0),
              ),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Success Rate'),
                h('span', { className: 'value' }, `${summary.models?.successRate || 0}%`),
              ),
            ),
            h('div', { className: 'creator-card' },
              h('div', { className: 'creator-card-title' }, 'Collections'),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Total'),
                h('span', { className: 'value' }, summary.collections?.total || 0),
              ),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Active Cooks'),
                h('span', { className: 'value' }, summary.collections?.activeCooks || 0),
              ),
              h('div', { className: 'creator-card-stat' },
                h('span', { className: 'label' }, 'Generated'),
                h('span', { className: 'value' }, (summary.collections?.totalGenerated || 0).toLocaleString()),
              ),
            ),
          )
        : null,

      topCreators.length > 0
        ? h('table', { className: 'creator-table' },
            h('thead', null,
              h('tr', null,
                h('th', null, 'Creator'),
                h('th', null, 'Spells'),
                h('th', null, 'Casts'),
                h('th', null, 'Models'),
                h('th', null, 'Collections'),
                h('th', null, 'Points Spent'),
                h('th', null, 'Last Active'),
              )
            ),
            h('tbody', null,
              ...topCreators.map((c, i) =>
                h('tr', { key: c.masterAccountId || i },
                  h('td', null,
                    c.username || shortHash(c.address || c.masterAccountId || '')
                  ),
                  h('td', null, c.spells || 0),
                  h('td', null, c.casts || 0),
                  h('td', null, c.models || 0),
                  h('td', null, c.collections || 0),
                  h('td', null, (c.totalPointsSpent || 0).toLocaleString()),
                  h('td', null, relativeTime(c.lastActive)),
                )
              )
            )
          )
        : h('div', { className: 'creator-empty' }, 'No creator data available.'),
    );
  }
}
