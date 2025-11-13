/**
 * CostAggregator - Aggregates costs and points across multiple generation records
 * 
 * Calculates total costs and points spent across spell step generations.
 */

class CostAggregator {
    constructor({ logger, internalApiClient }) {
        this.logger = logger;
        this.internalApiClient = internalApiClient;
    }

    /**
     * Aggregates costs and points across generation records
     * @param {string[]} generationIds - Array of generation IDs to aggregate
     * @returns {Promise<{totalCostUsd: number, totalPointsSpent: number}>}
     */
    async aggregateCosts(generationIds) {
        let totalCostUsd = 0;
        let totalPointsSpent = 0;

        if (!generationIds || generationIds.length === 0) {
            return { totalCostUsd: 0, totalPointsSpent: 0 };
        }

        try {
            // Fetch all generation records
            const queryString = generationIds.map(id => `_id_in=${id}`).join('&');
            const genRes = await this.internalApiClient.get(`/internal/v1/data/generations?${queryString}`);
            let stepGens = genRes.data.generations || [];
            
            if (stepGens.length === 0) {
                // Possibly ObjectId mismatch; fetch each individually
                stepGens = [];
                for (const gid of generationIds) {
                    try {
                        const one = await this.internalApiClient.get(`/internal/v1/data/generations/${gid}`);
                        if (one.data) stepGens.push(one.data);
                    } catch (e) {
                        this.logger.warn(`[CostAggregator] Failed to fetch generation ${gid} individually for cost aggregation: ${e.message}`);
                    }
                }
            }

            // Aggregate costs
            totalCostUsd = stepGens.reduce((sum, g) => {
                const val = g.costUsd !== undefined && g.costUsd !== null ? Number(g.costUsd) : 0;
                return sum + (isNaN(val) ? 0 : val);
            }, 0);

            totalPointsSpent = stepGens.reduce((sum, g) => {
                const val = g.pointsSpent !== undefined && g.pointsSpent !== null ? Number(g.pointsSpent) : 0;
                return sum + (isNaN(val) ? 0 : val);
            }, 0);

            this.logger.info(`[CostAggregator] Aggregated costs: ${totalCostUsd} USD, ${totalPointsSpent} points across ${stepGens.length} generations`);
        } catch (err) {
            this.logger.warn('[CostAggregator] Failed to aggregate cost for final spell generation:', err.message);
        }

        return { totalCostUsd, totalPointsSpent };
    }
}

module.exports = CostAggregator;

