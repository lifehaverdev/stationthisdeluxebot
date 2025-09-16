const GenerationOutputsDB = require('../../src/core/services/db/generationOutputsDb');
const { ObjectId } = require('mongodb');
require('dotenv').config();

(async () => {
  const logger = console; // Simple logger
  const genOutputsDb = new GenerationOutputsDB(logger);

  try {
    // Pipeline to compute average durationMs by toolDisplayName
    const pipeline = [
      {
        $match: {
          status: { $in: ['success', 'completed'] },
          durationMs: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: '$toolDisplayName',
          avgDuration: { $avg: '$durationMs' },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { avgDuration: -1 },
      },
    ];

    const results = await genOutputsDb.aggregate(pipeline);

    if (!results || results.length === 0) {
      logger.info('No generation records with duration found.');
      process.exit(0);
    }

    logger.info('Average execution time (ms) by toolDisplayName');
    console.table(
      results.map((r) => ({ Tool: r._id, AverageMs: Math.round(r.avgDuration), Runs: r.count }))
    );

    // Extra investigation for 'kontext'
    const kontextDoc = await genOutputsDb.findOne(
      { toolDisplayName: 'kontext', durationMs: { $gt: 0 } },
      { sort: { requestTimestamp: -1 } }
    );

    if (kontextDoc) {
      logger.info("\nMost recent 'kontext' generation document with durationMs > 0:\n");
      console.dir(kontextDoc, { depth: null, colors: true });
    } else {
      logger.info("No generation document found for 'kontext' with durationMs > 0.");
    }
  } catch (err) {
    logger.error('Error computing execution stats:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
