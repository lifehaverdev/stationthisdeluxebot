import { Component, h } from '@monygroupcorp/microact';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const COLORS = {
  primary: '#90caf9',
  secondary: '#4caf50',
  warning: '#ff9800',
  error: '#d32f2f',
  text: '#e0e0e0',
  grid: '#444'
};

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: COLORS.text } },
    tooltip: { backgroundColor: '#23272f', titleColor: COLORS.text, bodyColor: COLORS.text, borderColor: COLORS.grid, borderWidth: 1 }
  },
  scales: {
    x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
    y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } }
  }
};

/**
 * Analytics charts section.
 * Props: { analytics, withdrawalAnalytics }
 */
export class AnalyticsCharts extends Component {
  constructor(props) {
    super(props);
    this.charts = {};
    this.canvasRefs = {};
  }

  didMount() { this.renderCharts(); }
  didUpdate() { this.renderCharts(); }

  willUnmount() {
    Object.values(this.charts).forEach(c => c?.destroy());
    this.charts = {};
  }

  renderCharts() {
    // Destroy existing
    Object.values(this.charts).forEach(c => c?.destroy());
    this.charts = {};

    const { analytics, withdrawalAnalytics } = this.props;

    if (analytics?.pointUsage?.length && this.canvasRefs.pointUsage) {
      this.charts.pointUsage = new Chart(this.canvasRefs.pointUsage, {
        type: 'line',
        data: {
          labels: analytics.pointUsage.map(d => d.date),
          datasets: [
            { label: 'Points Spent', data: analytics.pointUsage.map(d => Number(d.value)), borderColor: COLORS.primary, backgroundColor: COLORS.primary + '40', tension: 0.4, fill: true, yAxisID: 'y' },
            { label: 'Cost (USD)', data: analytics.pointUsage.map(d => parseFloat(d.costUsd || '0')), borderColor: COLORS.warning, backgroundColor: COLORS.warning + '40', tension: 0.4, fill: false, yAxisID: 'y1' }
          ]
        },
        options: {
          ...BASE_OPTS,
          plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Points Spent & Cost Over Time', color: COLORS.primary } },
          scales: {
            ...BASE_OPTS.scales,
            y: { ...BASE_OPTS.scales.y, position: 'left', title: { display: true, text: 'Points', color: COLORS.primary } },
            y1: { type: 'linear', display: true, position: 'right', ticks: { color: COLORS.warning }, grid: { drawOnChartArea: false }, title: { display: true, text: 'USD', color: COLORS.warning } }
          }
        }
      });
    }

    if (analytics?.deposits?.length && this.canvasRefs.deposits) {
      this.charts.deposits = new Chart(this.canvasRefs.deposits, {
        type: 'bar',
        data: {
          labels: analytics.deposits.map(d => d.date),
          datasets: [{ label: 'Deposits', data: analytics.deposits.map(d => d.count), backgroundColor: COLORS.secondary + '80', borderColor: COLORS.secondary, borderWidth: 1 }]
        },
        options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Deposits Over Time', color: COLORS.primary } } }
      });
    }

    if (analytics?.activeUsers?.length && this.canvasRefs.activeUsers) {
      this.charts.activeUsers = new Chart(this.canvasRefs.activeUsers, {
        type: 'line',
        data: {
          labels: analytics.activeUsers.map(d => d.date),
          datasets: [{ label: 'Active Users', data: analytics.activeUsers.map(d => d.value), borderColor: COLORS.warning, backgroundColor: COLORS.warning + '40', tension: 0.4, fill: true }]
        },
        options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Active Users Over Time', color: COLORS.primary } } }
      });
    }

    if (withdrawalAnalytics?.withdrawals?.length && this.canvasRefs.withdrawals) {
      this.charts.withdrawals = new Chart(this.canvasRefs.withdrawals, {
        type: 'bar',
        data: {
          labels: withdrawalAnalytics.withdrawals.map(d => d.date),
          datasets: [{ label: 'Withdrawals', data: withdrawalAnalytics.withdrawals.map(d => Number(d.value || 0)), backgroundColor: COLORS.error + '80', borderColor: COLORS.error, borderWidth: 1 }]
        },
        options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, title: { display: true, text: 'Withdrawals Over Time', color: COLORS.primary } } }
      });
    }
  }

  static get styles() {
    return `
      .analytics-section {
        background: #1a1f2b;
        border: 1px solid #2a2f3a;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .analytics-section h2 {
        margin-top: 0;
        color: #90caf9;
        font-size: 1.2rem;
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
        background: #1a1a1a;
        border-radius: 4px;
        padding: 0.75rem;
        height: 280px;
        position: relative;
      }
    `;
  }

  render() {
    const { analytics, withdrawalAnalytics } = this.props;
    if (!analytics) return null;

    return h('section', { className: 'analytics-section' },
      h('h2', null, 'Analytics'),
      h('div', { className: 'chart-grid' },
        h('div', { className: 'chart-box' },
          h('canvas', { ref: el => { this.canvasRefs.pointUsage = el; } })
        ),
        h('div', { className: 'chart-box' },
          h('canvas', { ref: el => { this.canvasRefs.deposits = el; } })
        ),
        h('div', { className: 'chart-box' },
          h('canvas', { ref: el => { this.canvasRefs.activeUsers = el; } })
        ),
        withdrawalAnalytics?.withdrawals?.length
          ? h('div', { className: 'chart-box' },
              h('canvas', { ref: el => { this.canvasRefs.withdrawals = el; } })
            )
          : null
      )
    );
  }
}
