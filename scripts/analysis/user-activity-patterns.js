#!/usr/bin/env node
/**
 * user-activity-patterns.js - Analyze generation request patterns
 *
 * Analyzes generationOutputs to find:
 * - Hour-of-day patterns (when are users most active?)
 * - Day-of-week patterns
 * - User-specific patterns (who are the power users?)
 * - Burst detection (rapid sequential requests)
 *
 * Usage: node scripts/analysis/user-activity-patterns.js [--days 30]
 */
require('dotenv').config();

const GenerationOutputsDB = require('../../src/core/services/db/generationOutputsDb');

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: () => {},
};

async function analyzeActivityPatterns(days = 30) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`User Activity Pattern Analysis (last ${days} days)`);
  console.log('='.repeat(60));

  const db = new GenerationOutputsDB(logger);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all generations in time range (no sort to avoid memory limit)
  const generations = await db.findGenerations(
    { requestTimestamp: { $gte: cutoff } },
    {}
  );

  // Sort in memory
  generations.sort((a, b) => new Date(a.requestTimestamp) - new Date(b.requestTimestamp));

  console.log(`\nTotal generations: ${generations.length}`);

  if (generations.length === 0) {
    console.log('No data to analyze.');
    process.exit(0);
  }

  // Hour-of-day distribution
  const hourCounts = new Array(24).fill(0);
  generations.forEach(g => {
    if (g.requestTimestamp) {
      const hour = new Date(g.requestTimestamp).getUTCHours();
      hourCounts[hour]++;
    }
  });

  console.log('\n--- Hour of Day (UTC) ---');
  const maxHourCount = Math.max(...hourCounts);
  hourCounts.forEach((count, hour) => {
    const bar = '█'.repeat(Math.round((count / maxHourCount) * 30));
    const hourStr = hour.toString().padStart(2, '0');
    console.log(`  ${hourStr}:00  ${bar} ${count}`);
  });

  // Find peak hours
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  console.log(`\n  Peak hours: ${peakHours.map(h => `${h.hour}:00 UTC (${h.count})`).join(', ')}`);

  // Day-of-week distribution
  const dayCounts = new Array(7).fill(0);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  generations.forEach(g => {
    if (g.requestTimestamp) {
      const day = new Date(g.requestTimestamp).getUTCDay();
      dayCounts[day]++;
    }
  });

  console.log('\n--- Day of Week ---');
  const maxDayCount = Math.max(...dayCounts);
  dayCounts.forEach((count, day) => {
    const bar = '█'.repeat(Math.round((count / maxDayCount) * 30));
    console.log(`  ${dayNames[day]}  ${bar} ${count}`);
  });

  // Per-user breakdown
  const userCounts = {};
  generations.forEach(g => {
    const id = g.masterAccountId?.toString() || 'unknown';
    userCounts[id] = (userCounts[id] || 0) + 1;
  });

  const sortedUsers = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1]);

  console.log('\n--- Top Users ---');
  sortedUsers.slice(0, 10).forEach(([id, count], i) => {
    const shortId = id.substring(0, 8) + '...';
    console.log(`  ${i + 1}. ${shortId}: ${count} generations`);
  });

  // Burst detection - requests within 5 minutes of each other
  console.log('\n--- Burst Analysis ---');
  const bursts = [];
  let currentBurst = [];

  generations.forEach((g, i) => {
    if (i === 0) {
      currentBurst = [g];
      return;
    }

    const prev = generations[i - 1];
    const timeDiff = new Date(g.requestTimestamp) - new Date(prev.requestTimestamp);

    if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes
      currentBurst.push(g);
    } else {
      if (currentBurst.length >= 3) {
        bursts.push([...currentBurst]);
      }
      currentBurst = [g];
    }
  });

  if (currentBurst.length >= 3) {
    bursts.push(currentBurst);
  }

  console.log(`  Detected ${bursts.length} bursts (3+ requests within 5 min)`);

  const burstSizes = bursts.map(b => b.length);
  if (burstSizes.length > 0) {
    console.log(`  Avg burst size: ${(burstSizes.reduce((a, b) => a + b, 0) / burstSizes.length).toFixed(1)} requests`);
    console.log(`  Max burst size: ${Math.max(...burstSizes)} requests`);
  }

  // Inter-request timing for power users
  console.log('\n--- Power User Patterns ---');
  const topUserIds = sortedUsers.slice(0, 3).map(([id]) => id);

  for (const userId of topUserIds) {
    const userGens = generations.filter(g => g.masterAccountId?.toString() === userId);
    if (userGens.length < 5) continue;

    const intervals = [];
    for (let i = 1; i < userGens.length; i++) {
      const diff = new Date(userGens[i].requestTimestamp) - new Date(userGens[i-1].requestTimestamp);
      intervals.push(diff / 1000 / 60); // minutes
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const medianInterval = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)];

    console.log(`  User ${userId.substring(0, 8)}...:`);
    console.log(`    ${userGens.length} requests, avg interval: ${avgInterval.toFixed(1)} min, median: ${medianInterval.toFixed(1)} min`);
  }

  // Tool/service breakdown
  const toolCounts = {};
  generations.forEach(g => {
    const tool = g.serviceName || g.toolId || 'unknown';
    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
  });

  console.log('\n--- Tools/Services Used ---');
  Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([tool, count]) => {
      console.log(`  ${tool}: ${count}`);
    });

  // Recommendations
  console.log('\n--- Recommendations ---');

  if (peakHours.length > 0) {
    console.log(`  - Consider pre-warming instances around ${peakHours[0].hour}:00 UTC`);
  }

  if (bursts.length > generations.length * 0.1) {
    console.log(`  - High burst frequency (${Math.round(bursts.length / generations.length * 100)}%) - warm pool with 5-10 min idle timeout recommended`);
  }

  const avgRequestsPerDay = generations.length / days;
  if (avgRequestsPerDay < 10) {
    console.log(`  - Low volume (${avgRequestsPerDay.toFixed(1)}/day) - cold start optimization more important than warm pools`);
  } else if (avgRequestsPerDay > 50) {
    console.log(`  - High volume (${avgRequestsPerDay.toFixed(1)}/day) - consider dedicated warm pool`);
  }

  console.log('\n');
  process.exit(0);
}

// CLI
const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 30 : 30;

analyzeActivityPatterns(days).catch(err => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
