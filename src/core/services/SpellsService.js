class SpellsService {
    constructor({ logger, db, workflowExecutionService, spellPermissionsDb }) {
        this.logger = logger;
        this.db = db; // Contains spellsDb
        this.workflowExecutionService = workflowExecutionService;
        this.spellPermissionsDb = spellPermissionsDb;
    }

    /**
     * Finds and executes a spell.
     * @param {string} slug - The spell's slug.
     * @param {Object} context - Execution context { masterAccountId, parameterOverrides, ... }
     * @returns {Promise<any>} The final result of the spell execution.
     */
    async castSpell(slug, context) {
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

        // 3. Execute the spell via WorkflowExecutionService
        // NOTE: WorkflowExecutionService now uses the centralized execution endpoint for all tool executions.
        this.logger.info(`[SpellsService] Permissions check passed. Handing off to WorkflowExecutionService for spell "${spell.name}".`);
        const result = await this.workflowExecutionService.execute(spell, context);
        
        // 4. Increment usage count (fire and forget)
        this.db.spells.incrementUsage(spell._id).catch(err => {
            this.logger.error(`[SpellsService] Failed to increment usage for spell ${spell._id}: ${err.message}`);
        });

        return result;
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

            const pipeline = [
                { $match: { serviceName: toolId, status: 'completed', durationMs: { $exists: true }, costUsd: { $exists: true } } },
                { $sort: { responseTimestamp: -1 } },
                { $limit: sampleSize },
                { $group: {
                    _id: null,
                    avgRuntimeMs: { $avg: '$durationMs' },
                    avgCostUsd: { $avg: '$costUsd' }
                }}
            ];

            const [stats] = await generationOutputsDb.aggregate(pipeline);
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