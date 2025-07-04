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

        // If not found, try a partial match for spells owned by the user
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
}

module.exports = SpellsService; 