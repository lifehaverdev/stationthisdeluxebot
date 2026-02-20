import { Component, h } from '@monygroupcorp/microact';
import { relativeTime } from '../../lib/format.js';

const ICONS = {
  generation: '\uD83C\uDFA8',
  deposit: '\uD83D\uDCB0',
  payment: '\uD83D\uDCB3',
  withdrawal: '\uD83D\uDCE4',
  alert: '\u26A0\uFE0F',
  default: '\uD83D\uDD14'
};

/**
 * Real-time activity feed.
 * Props: { activities, alerts }
 */
export class ActivityFeed extends Component {
  static get styles() {
    return `
      .activity-section {
        background: #1a1f2b;
        border: 1px solid #2a2f3a;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .activity-section h2 {
        margin-top: 0;
        color: #90caf9;
        font-size: 1.2rem;
        margin-bottom: 1rem;
      }
      .activity-feed {
        max-height: 400px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .activity-item {
        padding: 0.6rem;
        background: #2a2f3a;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .activity-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
      }
      .activity-type {
        text-transform: uppercase;
        font-weight: 600;
        color: #90caf9;
        font-size: 0.8rem;
      }
      .activity-time {
        margin-left: auto;
        color: #888;
        font-size: 0.8rem;
      }
      .activity-details { color: #e0e0e0; }
      .alert-item {
        padding: 0.75rem;
        border-radius: 4px;
        margin-bottom: 0.5rem;
        background: #2a1510;
        border-left: 3px solid #d32f2f;
      }
      .alert-item.warning {
        background: #2a2510;
        border-left-color: #ff9800;
      }
    `;
  }

  render() {
    const { activities = [], alerts = [] } = this.props;

    return h('div', null,
      alerts.length > 0
        ? h('section', { className: 'activity-section' },
            h('h2', null, 'Alerts'),
            ...alerts.slice(0, 10).map((alert, i) =>
              h('div', { className: `alert-item ${alert.severity === 'warning' ? 'warning' : ''}`, key: i },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' } },
                  h('span', { style: { fontWeight: 600, fontSize: '0.85rem', color: alert.severity === 'error' ? '#f88' : '#ff9800' } }, alert.severity?.toUpperCase() || 'ALERT'),
                  h('span', { style: { color: '#888', fontSize: '0.8rem' } }, relativeTime(alert.receivedAt))
                ),
                h('div', { style: { color: '#e0e0e0' } }, alert.message || '')
              )
            )
          )
        : null,

      h('section', { className: 'activity-section' },
        h('h2', null, `Activity Feed (${activities.length})`),
        activities.length === 0
          ? h('p', { style: { color: '#888', textAlign: 'center', padding: '1rem' } }, 'No activity yet.')
          : h('div', { className: 'activity-feed' },
              ...activities.slice(0, 50).map((act, i) =>
                h('div', { className: 'activity-item', key: i },
                  h('div', { className: 'activity-header' },
                    h('span', null, ICONS[act.eventType] || ICONS.default),
                    h('span', { className: 'activity-type' }, act.eventType || 'event'),
                    h('span', { className: 'activity-time' }, relativeTime(act.receivedAt))
                  ),
                  h('div', { className: 'activity-details' }, act.message || JSON.stringify(act.data || ''))
                )
              )
            )
      )
    );
  }
}
