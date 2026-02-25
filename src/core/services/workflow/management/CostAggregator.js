/**
 * CostAggregator - Aggregates costs and points across multiple generation records
 * 
 * Calculates total costs and points spent across spell step generations.
 */

class CostAggregator {
    constructor({ logger, generationService, internalApiClient }) {
        this.logger = logger;
        this.generationService = generationService || null;
        this.internalApiClient = internalApiClient || null;
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
            let stepGens;
            if (this.generationService) {
                stepGens = await this.generationService.findByIds(generationIds);
            } else {
                const queryString = `_id_in=${generationIds.join(',')}`;
                const genRes = await this.internalApiClient.get(`/internal/v1/data/generations?${queryString}`);
                stepGens = genRes.data.generations || [];

                if (stepGens.length === 0) {
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
            }

            // Aggregate costs
            totalCostUsd = stepGens.reduce((sum, g) => {
                if (g.costUsd === undefined || g.costUsd === null) {
                    return sum;
                }
                
                // Handle Decimal128 objects (MongoDB BSON type)
                let val = 0;
                if (typeof g.costUsd === 'object') {
                    // Check for Decimal128 BSON type
                    if (g.costUsd._bsontype === 'Decimal128' && g.costUsd.toString) {
                        try {
                            val = parseFloat(g.costUsd.toString());
                        } catch (e) {
                            this.logger.warn(`[CostAggregator] Failed to convert Decimal128 costUsd for generation ${g._id}:`, e.message);
                            val = 0;
                        }
                    } else if (g.costUsd.$numberDecimal) {
                        // Handle MongoDB $numberDecimal format
                        try {
                            val = parseFloat(g.costUsd.$numberDecimal);
                        } catch (e) {
                            this.logger.warn(`[CostAggregator] Failed to convert $numberDecimal costUsd for generation ${g._id}:`, e.message);
                            val = 0;
                        }
                    } else {
                        // Try Number() as fallback
                        val = Number(g.costUsd);
                    }
                } else {
                    // Handle string or number
                    val = parseFloat(g.costUsd);
                }
                
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

