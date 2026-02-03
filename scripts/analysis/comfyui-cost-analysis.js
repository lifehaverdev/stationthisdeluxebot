#!/usr/bin/env node
/**
 * ComfyUI Cost Analysis Script
 *
 * Analyzes usage patterns for ComfyUI Deploy to inform pricing strategy
 * for passing on the $100/month platform fee to users.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." node scripts/analysis/comfyui-cost-analysis.js
 */

const path = require('path');
const GenerationOutputsDB = require(path.join(__dirname, '../../src/core/services/db/generationOutputsDb'));
const CreditLedgerDB = require(path.join(__dirname, '../../src/core/services/db/alchemy/creditLedgerDb'));

const MS2_TOKEN_ADDRESS = '0x98ed411b8cf8536657c660db8aa55d9d4baaf820'.toLowerCase();

async function analyzeComfyUIUsage() {
  const logger = console;
  const genDb = new GenerationOutputsDB(logger);
  const ledgerDb = new CreditLedgerDB(logger);

  console.log('='.repeat(70));
  console.log('COMFYUI DEPLOY COST ANALYSIS');
  console.log('='.repeat(70));

  // 1. Overall ComfyUI usage stats
  console.log('\n📊 OVERALL COMFYUI USAGE STATS\n');

  const comfyuiGenerations = await genDb.aggregate([
    {
      $match: {
        serviceName: { $regex: /comfyui/i },
        status: { $in: ['completed', 'success'] }
      }
    },
    {
      $group: {
        _id: null,
        totalGenerations: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: '$costUsd' } },
        totalPointsSpent: { $sum: '$pointsSpent' },
        uniqueUsers: { $addToSet: '$masterAccountId' },
        avgCostUsd: { $avg: { $toDouble: '$costUsd' } },
        minCostUsd: { $min: { $toDouble: '$costUsd' } },
        maxCostUsd: { $max: { $toDouble: '$costUsd' } },
        firstGeneration: { $min: '$requestTimestamp' },
        lastGeneration: { $max: '$requestTimestamp' }
      }
    }
  ]);

  if (comfyuiGenerations.length > 0) {
    const stats = comfyuiGenerations[0];
    console.log(`Total Generations: ${stats.totalGenerations}`);
    console.log(`Total Cost (USD): $${stats.totalCostUsd?.toFixed(4) || 0}`);
    console.log(`Total Points Spent: ${stats.totalPointsSpent || 0}`);
    console.log(`Unique Users: ${stats.uniqueUsers?.length || 0}`);
    console.log(`Avg Cost per Generation: $${stats.avgCostUsd?.toFixed(4) || 0}`);
    console.log(`Min/Max Cost: $${stats.minCostUsd?.toFixed(4) || 0} / $${stats.maxCostUsd?.toFixed(4) || 0}`);
    console.log(`Date Range: ${stats.firstGeneration?.toISOString().split('T')[0]} to ${stats.lastGeneration?.toISOString().split('T')[0]}`);
  } else {
    console.log('No ComfyUI generations found.');
  }

  // 2. Monthly breakdown
  console.log('\n📅 MONTHLY BREAKDOWN\n');

  const monthlyStats = await genDb.aggregate([
    {
      $match: {
        serviceName: { $regex: /comfyui/i },
        status: { $in: ['completed', 'success'] }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$requestTimestamp' },
          month: { $month: '$requestTimestamp' }
        },
        generations: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: '$costUsd' } },
        uniqueUsers: { $addToSet: '$masterAccountId' }
      }
    },
    { $sort: { '_id.year': -1, '_id.month': -1 } },
    { $limit: 12 }
  ]);

  console.log('Month       | Generations | Cost (USD) | Users | Avg/Gen  | Platform Fee Coverage');
  console.log('-'.repeat(85));

  for (const month of monthlyStats) {
    const monthStr = `${month._id.year}-${String(month._id.month).padStart(2, '0')}`;
    const avgPerGen = month.generations > 0 ? month.totalCostUsd / month.generations : 0;
    const platformFeeCoverage = (month.totalCostUsd / 100 * 100).toFixed(1); // % of $100 fee
    console.log(
      `${monthStr}    | ${String(month.generations).padStart(11)} | $${month.totalCostUsd.toFixed(2).padStart(8)} | ${String(month.uniqueUsers.length).padStart(5)} | $${avgPerGen.toFixed(4).padStart(6)} | ${platformFeeCoverage}%`
    );
  }

  // 3. Per-user breakdown
  console.log('\n👤 PER-USER BREAKDOWN (Top 20)\n');

  const userStats = await genDb.aggregate([
    {
      $match: {
        serviceName: { $regex: /comfyui/i },
        status: { $in: ['completed', 'success'] }
      }
    },
    {
      $group: {
        _id: '$masterAccountId',
        generations: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: '$costUsd' } },
        totalPointsSpent: { $sum: '$pointsSpent' },
        firstGen: { $min: '$requestTimestamp' },
        lastGen: { $max: '$requestTimestamp' }
      }
    },
    { $sort: { totalCostUsd: -1 } },
    { $limit: 20 }
  ]);

  console.log('User ID                  | Generations | Cost (USD) | Points | First Use  | Last Use');
  console.log('-'.repeat(95));

  const comfyuiUserIds = [];
  for (const user of userStats) {
    comfyuiUserIds.push(user._id);
    const userId = String(user._id).substring(0, 24);
    const firstUse = user.firstGen?.toISOString().split('T')[0] || 'N/A';
    const lastUse = user.lastGen?.toISOString().split('T')[0] || 'N/A';
    console.log(
      `${userId} | ${String(user.generations).padStart(11)} | $${user.totalCostUsd.toFixed(2).padStart(8)} | ${String(user.totalPointsSpent || 0).padStart(6)} | ${firstUse} | ${lastUse}`
    );
  }

  // 4. Check payment sources from credit ledger (MS2 vs other)
  console.log('\n💰 PAYMENT SOURCE ANALYSIS (for ComfyUI users)\n');

  // Analyze their credit sources
  const creditSources = await ledgerDb.aggregate([
    {
      $match: {
        master_account_id: { $in: comfyuiUserIds },
        status: 'CONFIRMED',
        type: { $ne: 'REFERRAL_VAULT' }
      }
    },
    {
      $group: {
        _id: {
          isMS2: {
            $cond: [
              { $eq: [{ $toLower: '$token_address' }, MS2_TOKEN_ADDRESS] },
              'MS2',
              'Other'
            ]
          }
        },
        totalDeposits: { $sum: 1 },
        totalPointsCredited: { $sum: '$points_credited' },
        totalPointsRemaining: { $sum: '$points_remaining' },
        totalUsdCredited: { $sum: '$user_credited_usd' }
      }
    }
  ]);

  console.log('Payment Source | Deposits | Points Credited | Points Remaining | USD Credited');
  console.log('-'.repeat(80));

  for (const source of creditSources) {
    console.log(
      `${(source._id.isMS2 || 'Unknown').padEnd(14)} | ${String(source.totalDeposits).padStart(8)} | ${String(source.totalPointsCredited || 0).padStart(15)} | ${String(source.totalPointsRemaining || 0).padStart(16)} | $${(source.totalUsdCredited || 0).toFixed(2).padStart(10)}`
    );
  }

  // 5. Tool-specific breakdown
  console.log('\n🔧 TOOL-SPECIFIC BREAKDOWN\n');

  const toolStats = await genDb.aggregate([
    {
      $match: {
        serviceName: { $regex: /comfyui/i },
        status: { $in: ['completed', 'success'] }
      }
    },
    {
      $group: {
        _id: '$toolDisplayName',
        generations: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: '$costUsd' } },
        avgDurationMs: { $avg: '$durationMs' }
      }
    },
    { $sort: { totalCostUsd: -1 } },
    { $limit: 15 }
  ]);

  console.log('Tool Name                                    | Generations | Cost (USD) | Avg Duration');
  console.log('-'.repeat(90));

  for (const tool of toolStats) {
    const toolName = (tool._id || 'Unknown').substring(0, 44).padEnd(44);
    const avgDuration = tool.avgDurationMs ? `${(tool.avgDurationMs / 1000).toFixed(1)}s` : 'N/A';
    console.log(
      `${toolName} | ${String(tool.generations).padStart(11)} | $${tool.totalCostUsd.toFixed(2).padStart(8)} | ${avgDuration.padStart(12)}`
    );
  }

  // 6. Pricing scenarios
  console.log('\n💵 PRICING SCENARIOS TO COVER $100/MONTH PLATFORM FEE\n');

  const recentMonth = monthlyStats[0];
  if (recentMonth) {
    const monthlyGens = recentMonth.generations;
    const monthlyUsers = recentMonth.uniqueUsers.length;
    const monthlyCost = recentMonth.totalCostUsd;

    console.log(`Based on most recent month (${recentMonth._id.year}-${String(recentMonth._id.month).padStart(2, '0')}):`);
    console.log(`  - ${monthlyGens} generations`);
    console.log(`  - ${monthlyUsers} unique users`);
    console.log(`  - $${monthlyCost.toFixed(2)} compute cost\n`);

    // Scenario 1: Flat per-generation fee
    const feePerGen = monthlyGens > 0 ? 100 / monthlyGens : 0;
    const avgCostPerGen = monthlyGens > 0 ? monthlyCost / monthlyGens : 0;
    console.log(`1. FLAT PER-GENERATION FEE:`);
    console.log(`   $${feePerGen.toFixed(4)} per generation`);
    if (avgCostPerGen > 0) {
      console.log(`   (${(feePerGen / avgCostPerGen * 100).toFixed(0)}% markup on avg cost of $${avgCostPerGen.toFixed(4)})`);
    }

    // Scenario 2: Percentage markup
    const markupPct = monthlyCost > 0 ? (100 / monthlyCost) * 100 : 0;
    console.log(`\n2. PERCENTAGE MARKUP ON COMPUTE:`);
    console.log(`   ${markupPct.toFixed(0)}% markup to cover platform fee`);
    console.log(`   Effective rate: ${(100 + markupPct).toFixed(0)}% of compute cost`);

    // Scenario 3: Per-user fee
    const feePerUser = monthlyUsers > 0 ? 100 / monthlyUsers : 0;
    console.log(`\n3. MONTHLY PER-USER FEE:`);
    console.log(`   $${feePerUser.toFixed(2)} per active user per month`);

    // Scenario 4: Tiered (MS2 discount)
    console.log(`\n4. TIERED PRICING (MS2 DISCOUNT):`);
    console.log(`   Standard users: ${(markupPct * 1.25).toFixed(0)}% markup`);
    console.log(`   MS2 token users: ${(markupPct * 0.75).toFixed(0)}% markup (40% discount)`);

    // Scenario 5: Hybrid
    const baseFee = 0.01; // $0.01 per generation
    const remainingToRecover = 100 - (baseFee * monthlyGens);
    const hybridMarkup = monthlyCost > 0 ? (remainingToRecover / monthlyCost) * 100 : 0;
    console.log(`\n5. HYBRID (BASE FEE + MARKUP):`);
    console.log(`   $0.01 base fee per generation + ${Math.max(0, hybridMarkup).toFixed(0)}% compute markup`);
  } else {
    console.log('No recent month data available for pricing scenarios.');
  }

  // 7. X402 vs Credit payments for ComfyUI
  console.log('\n💳 PAYMENT METHOD BREAKDOWN (X402 vs CREDITS)\n');

  const paymentMethods = await genDb.aggregate([
    {
      $match: {
        serviceName: { $regex: /comfyui/i },
        status: { $in: ['completed', 'success'] }
      }
    },
    {
      $group: {
        _id: {
          isX402: {
            $cond: [
              { $regexMatch: { input: { $toString: '$masterAccountId' }, regex: /^x402:/ } },
              'X402 (Direct USDC)',
              'Credits'
            ]
          }
        },
        generations: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: '$costUsd' } },
        totalPointsSpent: { $sum: '$pointsSpent' }
      }
    }
  ]);

  console.log('Payment Method   | Generations | Cost (USD) | Points Spent');
  console.log('-'.repeat(60));

  for (const method of paymentMethods) {
    console.log(
      `${(method._id.isX402 || 'Unknown').padEnd(16)} | ${String(method.generations).padStart(11)} | $${method.totalCostUsd.toFixed(2).padStart(8)} | ${String(method.totalPointsSpent || 0).padStart(12)}`
    );
  }

  // 8. Recent 30-day trend
  console.log('\n📈 LAST 30 DAYS DAILY TREND\n');

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyTrend = await genDb.aggregate([
    {
      $match: {
        serviceName: { $regex: /comfyui/i },
        status: { $in: ['completed', 'success'] },
        requestTimestamp: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$requestTimestamp' },
          month: { $month: '$requestTimestamp' },
          day: { $dayOfMonth: '$requestTimestamp' }
        },
        generations: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: '$costUsd' } }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);

  console.log('Date       | Gens | Cost (USD)');
  console.log('-'.repeat(35));

  for (const day of dailyTrend) {
    const dateStr = `${day._id.year}-${String(day._id.month).padStart(2, '0')}-${String(day._id.day).padStart(2, '0')}`;
    console.log(`${dateStr} | ${String(day.generations).padStart(4)} | $${day.totalCostUsd.toFixed(2).padStart(8)}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Analysis complete.');

  process.exit(0);
}

analyzeComfyUIUsage().catch(err => {
  console.error('Error running analysis:', err);
  process.exit(1);
});
