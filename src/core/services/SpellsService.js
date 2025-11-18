class SpellsService {
    constructor({ logger, db, workflowExecutionService, spellPermissionsDb, creditService }) {
        this.logger = logger;
        this.db = db; // Contains spellsDb
        this.workflowExecutionService = workflowExecutionService;
        this.spellPermissionsDb = spellPermissionsDb;
        this.creditService = creditService; // Optional: for upfront payment charging
    }

    /**
     * Finds and executes a spell.
     * @param {string} slug - The spell's slug.
     * @param {Object} context - Execution context { masterAccountId, parameterOverrides, ... }
     * @param {Object} castsDb - Optional casts database for creating cast records
     * @returns {Promise<any>} The final result of the spell execution.
     */
    async castSpell(slug, context, castsDb = null) {
        this.logger.info(`[SpellsService] Attempting to cast spell with slug: "${slug}" for MAID ${context.masterAccountId}`);

        // 1. Find the spell
        let spell = await this.db.spells.findBySlug(slug);

        // If not found try direct name match (names are unique & act as slug)
        if(!spell){
            spell = await this.db.spells.findByName(slug);
            if(spell){
                this.logger.info(`[SpellsService] Found spell by unique name fallback: ${spell.name}`);
            }
        }

        // If not found, try public slug lookup (for public spells)
        if (!spell) {
            spell = await this.db.spells.findByPublicSlug(slug);
            if (spell) {
                this.logger.info(`[SpellsService] Found spell by public slug: ${spell.slug || spell.publicSlug}`);
            }
        }

        // If not found try by ObjectId (support legacy callers sending _id)
        if (!spell && require('mongodb').ObjectId.isValid(slug)) {
            spell = await this.db.spells.findById(slug);
            if (spell) {
                this.logger.info(`[SpellsService] Found spell by ObjectId fallback: ${spell.slug}`);
            }
        }

        // If still not found, try a partial match for spells owned by the user
        if (!spell) {
            this.logger.info(`[SpellsService] Exact slug "${slug}" not found. Trying partial match for user ${context.masterAccountId}.`);
            const possibleSpells = await this.db.spells.findSpellsByOwnerAndPartialSlug(context.masterAccountId, slug);
            
            if (possibleSpells.length === 1) {
                spell = possibleSpells[0];
                this.logger.info(`[SpellsService] Found unique partial match: "${spell.slug}"`);
            } else if (possibleSpells.length > 1) {
                this.logger.warn(`[SpellsService] Ambiguous partial slug "${slug}" for user ${context.masterAccountId} matched ${possibleSpells.length} spells.`);
                const spellNames = possibleSpells.map(s => `• ${s.name} (\`${s.slug}\`)`).join('\\n');
                throw new Error(`Multiple spells found starting with "${slug}". Please be more specific:\n${spellNames}`);
            }
        }
        
        if (!spell) {
            this.logger.warn(`[SpellsService] Spell with slug "${slug}" not found for user ${context.masterAccountId}.`);
            throw new Error(`Spell "${slug}" not found.`);
        }

        // 2. Check permissions
        const canCast = await this.checkPermissions(spell, context.masterAccountId);
        if (!canCast) {
            this.logger.warn(`[SpellsService] User ${context.masterAccountId} does not have permission to cast spell ${spell._id} ("${spell.name}").`);
            throw new Error('You do not have permission to cast this spell.');
        }

        // 2.5. Create cast record if not already provided
        let castId = context.castId;
        // Use castsDb parameter if provided, otherwise try to get it from this.db.casts
        const castsDbToUse = castsDb || this.db?.casts;
        if (!castId && castsDbToUse) {
            try {
                // Build metadata with webhook URL if provided
                const castMetadata = {};
                if (context.webhookUrl) {
                    castMetadata.webhookUrl = context.webhookUrl;
                    if (context.webhookSecret) {
                        castMetadata.webhookSecret = context.webhookSecret;
                    }
                    castMetadata.spellSlug = spell.slug || spell.name;
                }

                const newCast = await castsDbToUse.createCast({ 
                    spellId: spell._id.toString(), // Use spell._id instead of slug
                    initiatorAccountId: context.masterAccountId,
                    metadata: castMetadata
                });
                castId = newCast._id.toString();
                context.castId = castId;
                this.logger.info(`[SpellsService] Created cast record ${castId} for spell ${spell._id}.`);
            } catch (e) {
                this.logger.warn(`[SpellsService] Cast creation failed for spell ${spell._id}:`, e.message);
            }
        } else if (!castId && !castsDbToUse) {
            this.logger.warn(`[SpellsService] No castsDb available and no castId provided. Cast tracking will be disabled for this spell execution.`);
        }

        // 2.6. Charge upfront payment if quote provided (for guest users or when explicitly requested)
        if (context.quote && context.chargeUpfront !== false && this.creditService) {
            try {
                const quote = context.quote;
                if (!quote.totalCostPts || typeof quote.totalCostPts !== 'number') {
                    throw new Error('Invalid quote: totalCostPts is required');
                }

                this.logger.info(`[SpellsService] Charging upfront payment of ${quote.totalCostPts} points for spell ${spell._id}`);
                
                const chargeResult = await this.creditService.chargeSpellExecution(
                    context.masterAccountId,
                    spell._id.toString(),
                    quote
                );
                
                context.creditTxId = chargeResult.creditTxId;
                context.pointsCharged = chargeResult.pointsCharged;
                
                this.logger.info(`[SpellsService] Upfront payment successful: ${chargeResult.pointsCharged} points charged, creditTxId: ${chargeResult.creditTxId}`);
            } catch (error) {
                if (error.message === 'INSUFFICIENT_POINTS') {
                    this.logger.warn(`[SpellsService] Insufficient points for spell execution. User: ${context.masterAccountId}, Required: ${context.quote.totalCostPts}`);
                    throw new Error('Insufficient points to execute spell. Please purchase more points.');
                }
                this.logger.error(`[SpellsService] Failed to charge upfront payment:`, error);
                throw error;
            }
        }

        // 3. Execute the spell via WorkflowExecutionService
        // NOTE: WorkflowExecutionService now uses the centralized execution endpoint for all tool executions.
        this.logger.info(`[SpellsService] Permissions check passed. Handing off to WorkflowExecutionService for spell "${spell.name}". CastId: ${castId || 'none'}`);
        
        try {
            const result = await this.workflowExecutionService.execute(spell, context);
            this.logger.info(`[SpellsService] WorkflowExecutionService.execute() returned for spell "${spell.name}": ${JSON.stringify(result || 'undefined')}`);
            
            // 4. Increment usage count (fire and forget)
            this.db.spells.incrementUsage(spell._id).catch(err => {
                this.logger.error(`[SpellsService] Failed to increment usage for spell ${spell._id}: ${err.message}`);
            });

            return result;
        } catch (execError) {
            this.logger.error(`[SpellsService] Error executing spell "${spell.name}": ${execError.stack || execError}`);
            throw execError;
        }
    }

    async checkPermissions(spell, masterAccountId) {
        if (spell.visibility === 'public') {
            return true;
        }
        if (spell.ownedBy.toString() === masterAccountId.toString()) {
            return true;
        }
        if (spell.permissionType === 'licensed') {
            const permission = await this.spellPermissionsDb.hasAccess(masterAccountId, spell._id);
            return !!permission;
        }
        return false;
    }

    async quoteSpell(spellIdentifier, { sampleSize = 10 } = {}) {
        // Accept either slug or ObjectId string as spellIdentifier
        this.logger.info(`[SpellsService] Generating quote for spell "${spellIdentifier}" (sampleSize=${sampleSize}).`);

        // 1. Fetch the spell metadata
        let spell;
        if (require('mongodb').ObjectId.isValid(spellIdentifier)) {
            spell = await this.db.spells.findById(spellIdentifier);
        } else {
            spell = await this.db.spells.findBySlug(spellIdentifier);
            // If not found, try public slug lookup (for public spells)
            if (!spell) {
                spell = await this.db.spells.findByPublicSlug(spellIdentifier);
            }
        }

        if (!spell) {
            throw new Error(`Spell \"${spellIdentifier}\" not found.`);
        }

        // Ensure steps array exists
        const steps = Array.isArray(spell.steps) ? spell.steps : [];
        if (steps.length === 0) {
            throw new Error('Spell contains no steps – cannot generate quote.');
        }

        // 2. Iterate over each step and compute average stats using GenerationOutputsDB
        const generationOutputsDb = this.db.generationOutputs;
        if (!generationOutputsDb || typeof generationOutputsDb.aggregate !== 'function') {
            throw new Error('GenerationOutputsDB is not available – cannot generate quote.');
        }

        const USD_TO_POINTS_CONVERSION_RATE = 0.000337; // Keep in sync with CreditService

        const breakdown = [];
        let totalRuntimeMs = 0;
        let totalCostPts = 0;

        for (const step of steps) {
            // Support both `toolIdentifier` and legacy `toolId`
            const toolId = step.toolIdentifier || step.toolId;
            if (!toolId) {
                this.logger.warn(`[SpellsService] Step ${step.stepId || '<unknown>'} is missing toolIdentifier/toolId – skipping from quote.`);
                continue;
            }

            // Match on toolId (primary) or toolDisplayName (fallback) to find historical executions
            // Note: Generation records store toolId, toolDisplayName, and serviceName
            // We match on toolId first, then fallback to toolDisplayName for backward compatibility
            // Also try matching by serviceName for tools that might not have toolId set correctly
            const pipeline = [
                { $match: { 
                    $or: [
                        { toolId: toolId },
                        { toolDisplayName: toolId },
                        // Fallback: match by serviceName if toolId matches the service (for legacy records)
                        { serviceName: toolId }
                    ],
                    status: 'completed', 
                    // Require costUsd, but durationMs is optional (some async jobs don't track duration)
                    costUsd: { $exists: true, $ne: null, $gt: 0 }
                }},
                // Sort by responseTimestamp if available, otherwise by requestTimestamp
                { $sort: { 
                    responseTimestamp: -1,
                    requestTimestamp: -1 
                }},
                { $limit: sampleSize },
                { $group: {
                    _id: null,
                    count: { $sum: 1 },
                    avgRuntimeMs: { $avg: '$durationMs' },
                    avgCostUsd: { $avg: '$costUsd' },
                    minCostUsd: { $min: '$costUsd' },
                    maxCostUsd: { $max: '$costUsd' }
                }}
            ];

            const [stats] = await generationOutputsDb.aggregate(pipeline);
            
            // Log query results for debugging
            if (!stats || stats.count === 0) {
                this.logger.warn(`[SpellsService] No historical data found for tool "${toolId}". Query matched 0 records.`);
            } else {
                // Convert Decimal128 to number for logging
                let avgCostUsdForLog = 0;
                if (stats.avgCostUsd) {
                    if (typeof stats.avgCostUsd === 'object' && stats.avgCostUsd._bsontype === 'Decimal128') {
                        avgCostUsdForLog = parseFloat(stats.avgCostUsd.toString());
                    } else {
                        avgCostUsdForLog = parseFloat(stats.avgCostUsd) || 0;
                    }
                }
                const avgRuntimeMsForLog = stats.avgRuntimeMs || 0;
                this.logger.info(`[SpellsService] Found ${stats.count} historical records for tool "${toolId}". Avg cost: $${avgCostUsdForLog.toFixed(6)}, Avg runtime: ${avgRuntimeMsForLog.toFixed(0)}ms`);
            }
            const avgRuntimeMs = stats?.avgRuntimeMs || 0;
            let avgCostUsd = 0;
            if (stats?.avgCostUsd) {
                // Decimal128 may be returned; convert safely
                if (typeof stats.avgCostUsd === 'object' && stats.avgCostUsd._bsontype === 'Decimal128') {
                    avgCostUsd = parseFloat(stats.avgCostUsd.toString());
                } else {
                    avgCostUsd = parseFloat(stats.avgCostUsd);
                }
            }
            
            // Fallback: If no historical data exists, use a minimal default cost estimate
            // This prevents returning 0 cost which would block spell execution
            // TODO: Enhance to use tool's costingModel when toolRegistry is available
            if (avgCostUsd === 0 || !stats) {
                this.logger.warn(`[SpellsService] No historical cost data found for tool "${toolId}". Using fallback estimate.`);
                // Use a minimal default: $0.01 USD (approximately 30 points)
                // This is a conservative estimate that ensures spells can execute
                avgCostUsd = 0.01;
            }
            
            const avgCostPts = avgCostUsd / USD_TO_POINTS_CONVERSION_RATE;

            breakdown.push({ toolId, avgRuntimeMs, avgCostPts });
            totalRuntimeMs += avgRuntimeMs;
            totalCostPts += avgCostPts;
        }

        return {
            spellId: spell._id,
            totalRuntimeMs,
            totalCostPts,
            breakdown
        };
    }
}

module.exports = SpellsService; 