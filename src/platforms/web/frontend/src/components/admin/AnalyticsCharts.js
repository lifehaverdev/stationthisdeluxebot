import { Component, h } from '@monygroupcorp/microact';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// Read CSS variables at render time for chart colors
function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getChartColors() {
  return {
    primary: getCssVar('--accent') || '#00DFC8',
    warning: getCssVar('--danger') || '#d32f2f',
    text: getCssVar('--text-primary') || '#e0e0e0',
    grid: getCssVar('--border') || '#444',
    surface: getCssVar('--surface-1') || '#1a1a1a',
  };
}

function makeBaseOpts(colors) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: colors.text } },
      tooltip: { backgroundColor: colors.surface, titleColor: colors.text, bodyColor: colors.text, borderColor: colors.grid, borderWidth: 1 }
    },
    scales: {
      x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
      y: { ticks: { color: colors.text }, grid: { color: colors.grid } }
    }
  };
}

/**
 * Analytics charts section (usage, deposits, active users).
 * Props: { analytics }
 */
export class AnalyticsCharts extends Component {
  constructor(props) {
    super(props);
    this.charts = {};
    this._containerRef = null;
  }

  didMount() { this._scheduleRender(); }
  didUpdate() { this._scheduleRender(); }

  willUnmount() {
    Object.values(this.charts).forEach(c => c?.destroy());
    this.charts = {};
  }

  _scheduleRender() {
    Promise.resolve().then(() => this.renderCharts());
  }

  renderCharts() {
    Object.values(this.charts).forEach(c => c?.destroy());
    this.charts = {};

    if (!this._containerRef) return;
    const { analytics } = this.props;
    const colors = getChartColors();
    const BASE_OPTS = makeBaseOpts(colors);

    const getCanvas = (name) => this._containerRef.querySelector(`canvas[data-chart="${name}"]`);

    const pointUsageCanvas = getCanvas('pointUsage');
    if (analytics?.pointUsage?.length && pointUsageCanvas) {
      this.charts.pointUsage = new Chart(pointUsageCanvas, {
        type: 'line',
        data: {
          labels: analytics.pointUsage.map(d => d.date),
          datasets: [
            { label: 'Points Spent', data: analytics.pointUsage.map(d => Number(d.value)), borderColor: colors.primary, backgroundColor: colors.primary + '40', tension: 0.4, fill: true, yAxisID: 'y' },
            { label: 'Cost (USD)', data: analytics.pointUsage.map(d => parseFloat(d.costUsd || '0')), borderColor: colors.warning, backgroundColor: colors.warning + '40', tension: 0.4, fill: false, yAxisID: 'y1' }
          ]
        },
        options: {
          ...BASE_OPTS,
          plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Points Spent & Cost Over Time', color: colors.primary } },
          scales: {
            ...BASE_OPTS.scales,
            y: { ...BASE_OPTS.scales.y, position: 'left', title: { display: true, text: 'Points', color: colors.primary } },
            y1: { type: 'linear', display: true, position: 'right', ticks: { color: colors.warning }, grid: { drawOnChartArea: false }, title: { display: true, text: 'USD', color: colors.warning } }
          }
        }
      });
    }

    const depositsCanvas = getCanvas('deposits');
    if (analytics?.deposits?.length && depositsCanvas) {
      this.charts.deposits = new Chart(depositsCanvas, {
        type: 'bar',
        data: {
          labels: analytics.deposits.map(d => d.date),
          datasets: [{ label: 'Deposits', data: analytics.deposits.map(d => d.count), backgroundColor: colors.primary + '80', borderColor: colors.primary, borderWidth: 1 }]
        },
        options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Deposits Over Time', color: colors.primary } } }
      });
    }

    const activeUsersCanvas = getCanvas('activeUsers');
    if (analytics?.activeUsers?.length && activeUsersCanvas) {
      this.charts.activeUsers = new Chart(activeUsersCanvas, {
        type: 'line',
        data: {
          labels: analytics.activeUsers.map(d => d.date),
          datasets: [{ label: 'Active Users', data: analytics.activeUsers.map(d => d.value), borderColor: colors.primary, backgroundColor: colors.primary + '40', tension: 0.4, fill: true }]
        },
        options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Active Users Over Time', color: colors.primary } } }
      });
    }
  }

  static get styles() {
    return `
      .analytics-section {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .analytics-section h2 {
        margin-top: 0;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 1rem;
      }
      .chart-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }
      @media (max-width: 800px) {
        .chart-grid { grid-template-columns: 1fr; }
      }
      .chart-box {
        background: var(--surface-1);
        padding: 0.75rem;
        height: 280px;
        position: relative;
      }
    `;
  }

  render() {
    const { analytics } = this.props;
    if (!analytics) return null;

    return h('section', { id: 'activity', className: 'analytics-section', ref: el => { this._containerRef = el; } },
      h('h2', null, 'Analytics'),
      h('div', { className: 'chart-grid' },
        h('div', { className: 'chart-box' },
          h('canvas', { 'data-chart': 'pointUsage' })
        ),
        h('div', { className: 'chart-box' },
          h('canvas', { 'data-chart': 'deposits' })
        ),
        h('div', { className: 'chart-box' },
          h('canvas', { 'data-chart': 'activeUsers' })
        ),
      )
    );
  }
}
