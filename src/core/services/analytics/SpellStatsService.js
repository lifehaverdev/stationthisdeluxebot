const { ObjectId, Decimal128 } = require('mongodb');

/**
 * SpellStatsService aggregates historical runtime & cost information
 * from generationOutputs collection and provides average statistics
 * for each tool (serviceName).
 */
class SpellStatsService {
    /**
     * @param {Object} deps
     * @param {import('../db/generationOutputsDb')} deps.generationOutputsDb
     * @param {Console|import('pino').Logger} deps.logger
     * @param {number} [sampleSize=10] - How many recent completed generations to include per tool.
     */
    constructor({ generationOutputsDb, logger }, sampleSize = 10) {
        if (!generationOutputsDb) throw new Error('SpellStatsService requires generationOutputsDb');
        this.genDb = generationOutputsDb;
        this.logger = logger || console;
        this.sampleSize = sampleSize;
        this.cache = new Map(); // toolId => { avgRuntimeMs, avgCostPts, updatedAt }
    }

    /**
     * Compute averaged stats for a single tool.
     * @param {string} toolId
     * @returns {Promise<{ avgRuntimeMs:number, avgCostPts:number }>}
     */
    async getAvgStats(toolId) {
        // Return cached if computed within last hour
        const cached = this.cache.get(toolId);
        if (cached && Date.now() - cached.updatedAt < 60 * 60 * 1000) {
            return { avgRuntimeMs: cached.avgRuntimeMs, avgCostPts: cached.avgCostPts };
        }

        const pipeline = [
            { $match: { serviceName: toolId, status: 'completed', durationMs: { $exists: true }, costUsd: { $exists: true } } },
            { $sort: { responseTimestamp: -1 } },
            { $limit: this.sampleSize },
            { $group: {
                _id: null,
                avgRuntimeMs: { $avg: '$durationMs' },
                avgCostUsd: { $avg: '$costUsd' }
            }}
        ];

        const [stats] = await this.genDb.aggregate(pipeline);

        const avgRuntimeMs = stats?.avgRuntimeMs || 0;
        let avgCostUsd = 0;
        if (stats?.avgCostUsd) {
            if (typeof stats.avgCostUsd === 'object' && stats.avgCostUsd._bsontype === 'Decimal128') {
                avgCostUsd = parseFloat(stats.avgCostUsd.toString());
            } else {
                avgCostUsd = parseFloat(stats.avgCostUsd);
            }
        }
        const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
        const avgCostPts = avgCostUsd / USD_TO_POINTS_CONVERSION_RATE;

        this.cache.set(toolId, { avgRuntimeMs, avgCostPts, updatedAt: Date.now() });
        return { avgRuntimeMs, avgCostPts };
    }

    /**
     * Iterate over all tools in the registry and attach stats.
     * @param {import('../../tools/ToolRegistry').ToolRegistry} toolRegistry
     */
    async enrichToolRegistry(toolRegistry) {
        const tools = toolRegistry.getAllTools();
        this.logger.info(`[SpellStatsService] Enriching ${tools.length} tool(s) with avg stats...`);
        const promises = tools.map(async (tool) => {
            try {
                const stats = await this.getAvgStats(tool.toolId);
                tool.avgRuntimeMs = stats.avgRuntimeMs;
                tool.avgCostPts   = stats.avgCostPts;
            } catch (err) {
                this.logger.warn(`[SpellStatsService] Failed to compute stats for ${tool.toolId}: ${err.message}`);
            }
        });
        await Promise.all(promises);
        this.logger.info('[SpellStatsService] ToolRegistry enrichment complete.');
    }

    /**
     * Schedule hourly refresh.
     * @param {import('../../tools/ToolRegistry').ToolRegistry} toolRegistry
     */
    startAutoRefresh(toolRegistry) {
        this.enrichToolRegistry(toolRegistry).catch(err => this.logger.error(err));
        setInterval(() => {
            this.enrichToolRegistry(toolRegistry).catch(err => this.logger.error(err));
        }, 60 * 60 * 1000); // hourly
    }
}

module.exports = SpellStatsService; 