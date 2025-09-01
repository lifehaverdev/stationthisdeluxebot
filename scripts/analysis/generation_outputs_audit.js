#!/usr/bin/env node
/*
 * generation_outputs_audit.js
 * ---------------------------------------------
 * Health-check & analytics report for the `generationOutputs` MongoDB collection.
 *
 * Usage examples (via run-with-env.sh):
 *   ./run-with-env.sh node scripts/analysis/generation_outputs_audit.js
 *   ./run-with-env.sh node scripts/analysis/generation_outputs_audit.js --hours 6 --limit 50
 *
 * This script intentionally avoids extra npm dependencies – only built-ins and
 * existing project modules are used.
 */

const path = require('path');
const GenerationOutputsDB = require(path.join(__dirname, '../../src/core/services/db/generationOutputsDb'));

// --------------------------------------------------
// 1. Minimal CLI arg parsing (no external deps)
// --------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { hours: 12, limit: 20, backfill: false }; // defaults

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--hours':
      case '-h':
        parsed.hours = Number(args[i + 1]);
        i++;
        break;
      case '--limit':
      case '-l':
        parsed.limit = Number(args[i + 1]);
        i++;
        break;
      case '--backfill':
        parsed.backfill = true;
        break;
      default:
        // ignore unknown flags for now
        break;
    }
  }
  return parsed;
}

(async () => {
  const { hours, limit, backfill } = parseArgs();
  const logger = console; // simple logger
  const db = new GenerationOutputsDB(logger);

  logger.log('================= Generation Outputs Audit =================');
  logger.log(`Database: ${db.dbName} | Collection: ${db.collectionName}`);
  logger.log(`Stale threshold: ${hours}h | Sample limit: ${limit}`);

  // --------------------------------------------------
  // 2. Counts by status
  // --------------------------------------------------
  const statusCounts = await db.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  logger.log('\n-- Counts by status --');
  statusCounts.forEach(r => logger.log(`${r._id || 'undefined'}: ${r.count}`));

  // --------------------------------------------------
  // 3. Stale "pending" docs
  // --------------------------------------------------
  const thresholdDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  const stalePendingFilter = { status: 'pending', requestTimestamp: { $lt: thresholdDate } };
  const stalePendingCount = await db.count(stalePendingFilter);
  const stalePendingSample = await db.findMany(stalePendingFilter, { limit, projection: { _id: 1, serviceName: 1, requestTimestamp: 1 } });

  logger.log(`\n-- Pending > ${hours}h (${stalePendingCount} total, showing up to ${limit}) --`);
  stalePendingSample.forEach(doc => logger.log(`${doc._id} | ${doc.serviceName} | ${doc.requestTimestamp?.toISOString?.()}`));

  // --------------------------------------------------
  // 4. Completed docs missing durationMs or costUsd
  // --------------------------------------------------
  const completedStatuses = ['success', 'failed', 'cancelled_by_user', 'timeout'];
  const missingMetricsFilter = {
    status: { $in: completedStatuses },
    $or: [
      { durationMs: { $exists: false } },
      { costUsd: { $exists: false } }
    ]
  };
  const missingMetricsCount = await db.count(missingMetricsFilter);
  const missingMetricsSample = await db.findMany(missingMetricsFilter, { limit, projection: { _id: 1, status: 1, durationMs: 1, costUsd: 1 } });

  logger.log(`\n-- Completed docs missing durationMs or costUsd (${missingMetricsCount} total, showing up to ${limit}) --`);
  missingMetricsSample.forEach(doc => logger.log(doc));

  // --------------------------------------------------
  // 5. Parent reference check (cook/spell)
  // --------------------------------------------------
  const parentRefMissingFilter = {
    $or: [
      { cookExecutionId: { $exists: false } },
      { spellCastId: { $exists: false } }
    ],
    // Only look at docs created after we rolled out cook/spell features (approx 2025-01-01). Adjust if needed.
    requestTimestamp: { $gte: new Date('2025-01-01') }
  };
  const parentMissingCount = await db.count(parentRefMissingFilter);
  const parentMissingSample = await db.findMany(parentRefMissingFilter, { limit, projection: { _id: 1, serviceName: 1, cookExecutionId: 1, spellCastId: 1 } });

  logger.log(`\n-- Docs missing cookExecutionId AND spellCastId since 2025-01-01 (${parentMissingCount} total, showing up to ${limit}) --`);
  parentMissingSample.forEach(doc => logger.log(doc));

  // --------------------------------------------------
  // 6. Top services by volume
  // --------------------------------------------------
  const topServices = await db.aggregate([
    { $group: { _id: '$serviceName', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);
  logger.log('\n-- Top 10 services by volume --');
  topServices.forEach(r => logger.log(`${r._id}: ${r.count}`));

  // --------------------------------------------------
  // 7. Average duration & cost by tool (display name if available)
  // --------------------------------------------------
  const avgByTool = await db.aggregate([
    {
      $addFields: {
        toolKey: { $ifNull: ['$toolDisplayName', '$serviceName'] }
      }
    },
    {
      $match: {
        status: { $in: completedStatuses },
        durationMs: { $exists: true, $gt: 0 },
        costUsd: { $exists: true }
      }
    },
    {
      $group: {
        _id: '$toolKey',
        avgDurationMs: { $avg: '$durationMs' },
        avgCostUsd: { $avg: '$costUsd' },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 15 }
  ]);

  logger.log('\n-- Average duration & cost per tool (top 15) --');
  avgByTool.forEach(r => {
    const dur = r.avgDurationMs.toFixed(0).padStart(6);
    const cost = (r.avgCostUsd && r.avgCostUsd._bsontype === 'Decimal128' ? parseFloat(r.avgCostUsd.toString()) : r.avgCostUsd).toFixed(4);
    logger.log(`${r._id}: avgDuration=${dur}ms | avgCost=$${cost} | n=${r.count}`);
  });
  
  // --------------------------------------------------
  // 8. Optional Backfill
  // --------------------------------------------------
  if (backfill) {
    logger.log('\n-- Running backfill for missing durationMs / pointsSpent / deliveryStatus --');
    const bulkOps = [];

    // a) durationMs
    const missingDurFilter = {
      responseTimestamp: { $exists: true },
      requestTimestamp: { $exists: true },
      $or: [ { durationMs: { $exists: false } }, { durationMs: null } ]
    };
    const cursor1 = await db.findMany(missingDurFilter, { projection: { _id: 1, requestTimestamp: 1, responseTimestamp: 1 } });
    cursor1.forEach(doc => {
      const duration = new Date(doc.responseTimestamp) - new Date(doc.requestTimestamp);
      if (!isNaN(duration) && duration >= 0) {
        bulkOps.push({ id: doc._id, update: { durationMs: duration } });
      }
    });

    // b) pointsSpent default
    const missingPoints = { pointsSpent: { $exists: false } };
    const cursor2 = await db.findMany(missingPoints, { projection: { _id: 1 } });
    cursor2.forEach(doc => bulkOps.push({ id: doc._id, update: { pointsSpent: 0, protocolNetPoints: 0 } }));

    // c) deliveryStatus default based on notificationPlatform
    const missingDeliv = { deliveryStatus: { $exists: false } };
    const cursor3 = await db.findMany(missingDeliv, { projection: { _id: 1, notificationPlatform: 1 } });
    cursor3.forEach(doc => {
      const status = (doc.notificationPlatform && doc.notificationPlatform !== 'none') ? 'pending' : 'skipped';
      bulkOps.push({ id: doc._id, update: { deliveryStatus: status } });
    });

    // Execute updates sequentially to honor existing DB class wrapper
    let updated = 0;
    for (const op of bulkOps) {
      try {
        await db.updateGenerationOutput(op.id, op.update);
        updated++;
      } catch (e) {
        logger.error('Backfill update failed for', op.id.toString(), e.message);
      }
    }
    logger.log(`Backfill completed. Updated ${updated} document(s).`);
  }

  logger.log('\nAudit complete.');
  process.exit(0);
})();
