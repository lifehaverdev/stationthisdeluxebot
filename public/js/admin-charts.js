/**
 * Chart rendering utilities for admin dashboard
 * Uses Chart.js for visualizations
 */

const CHART_COLORS = {
  primary: '#90caf9',
  secondary: '#4caf50',
  warning: '#ff9800',
  error: '#d32f2f',
  background: '#1a1a1a',
  grid: '#444',
  text: '#e0e0e0'
};

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: CHART_COLORS.text
      }
    },
    tooltip: {
      backgroundColor: '#23272f',
      titleColor: CHART_COLORS.text,
      bodyColor: CHART_COLORS.text,
      borderColor: CHART_COLORS.grid,
      borderWidth: 1
    }
  },
  scales: {
    x: {
      ticks: {
        color: CHART_COLORS.text
      },
      grid: {
        color: CHART_COLORS.grid
      }
    },
    y: {
      ticks: {
        color: CHART_COLORS.text
      },
      grid: {
        color: CHART_COLORS.grid
      }
    }
  }
};

/**
 * Creates a line chart
 */
function createLineChart(canvasId, data, options = {}) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) {
    console.error(`[AdminCharts] Canvas element ${canvasId} not found`);
    return null;
  }

  const chartOptions = {
    ...CHART_OPTIONS,
    ...options
  };

  return new Chart(ctx, {
    type: 'line',
    data: data,
    options: chartOptions
  });
}

/**
 * Creates a bar chart
 */
function createBarChart(canvasId, data, options = {}) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) {
    console.error(`[AdminCharts] Canvas element ${canvasId} not found`);
    return null;
  }

  const chartOptions = {
    ...CHART_OPTIONS,
    ...options
  };

  return new Chart(ctx, {
    type: 'bar',
    data: data,
    options: chartOptions
  });
}

/**
 * Formats number with commas
 */
function formatNumber(num) {
  return parseInt(num).toLocaleString();
}

/**
 * Creates chart data for point usage over time
 */
function createPointUsageChartData(pointUsageData) {
  return {
    labels: pointUsageData.map(d => d.date),
    datasets: [{
      label: 'Points Spent',
      data: pointUsageData.map(d => Number(d.value)),
      borderColor: CHART_COLORS.primary,
      backgroundColor: CHART_COLORS.primary + '40',
      tension: 0.4,
      fill: true,
      yAxisID: 'y'
    }, {
      label: 'Cost (USD)',
      data: pointUsageData.map(d => parseFloat(d.costUsd || '0')),
      borderColor: CHART_COLORS.warning,
      backgroundColor: CHART_COLORS.warning + '40',
      tension: 0.4,
      fill: false,
      yAxisID: 'y1'
    }]
  };
}

/**
 * Creates chart data for deposits over time
 */
function createDepositsChartData(depositsData) {
  return {
    labels: depositsData.map(d => d.date),
    datasets: [{
      label: 'Deposits Count',
      data: depositsData.map(d => d.count),
      backgroundColor: CHART_COLORS.secondary + '80',
      borderColor: CHART_COLORS.secondary,
      borderWidth: 1
    }]
  };
}

/**
 * Creates chart data for active users over time
 */
function createActiveUsersChartData(activeUsersData) {
  return {
    labels: activeUsersData.map(d => d.date),
    datasets: [{
      label: 'Active Users',
      data: activeUsersData.map(d => d.value),
      borderColor: CHART_COLORS.warning,
      backgroundColor: CHART_COLORS.warning + '40',
      tension: 0.4,
      fill: true
    }]
  };
}

/**
 * Creates chart data for withdrawals over time
 */
function createWithdrawalsChartData(withdrawalsData) {
  return {
    labels: withdrawalsData.map(d => d.date),
    datasets: [{
      label: 'Withdrawal Amount',
      data: withdrawalsData.map(d => formatUnits(d.value, 18)),
      backgroundColor: CHART_COLORS.error + '80',
      borderColor: CHART_COLORS.error,
      borderWidth: 1
    }]
  };
}

/**
 * Helper to format units (from admin-dashboard.js)
 */
function formatUnits(value, decimals = 18) {
  const val = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = val / divisor;
  const fraction = (val % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Exports chart data to CSV
 */
function exportChartDataToCSV(data, filename) {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(',')
  ];

  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Escape commas and quotes in values
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvRows.push(values.join(','));
  }

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Exports chart as image
 */
function exportChartAsImage(chart, filename) {
  const url = chart.toBase64Image();
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
}

export {
  createLineChart,
  createBarChart,
  createPointUsageChartData,
  createDepositsChartData,
  createActiveUsersChartData,
  createWithdrawalsChartData,
  formatNumber,
  exportChartDataToCSV,
  exportChartAsImage,
  CHART_COLORS,
  CHART_OPTIONS
};

