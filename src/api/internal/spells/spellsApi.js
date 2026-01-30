const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the Spells API
module.exports = function spellsApi(dependencies) {
  const { logger, db, spellsService } = dependencies;
  // The 'db' object from dependencies should contain our instantiated DB services
  const spellsDb = db.spells;
  const spellPermissionsDb = db.spellPermissions;
  const castsDb = db.casts;
  if(!castsDb){ logger.warn('[spellsApi] castsDb not available – cast tracking disabled'); }

  if (!spellsDb || !spellPermissionsDb) {
    logger.error('[spellsApi] Critical dependency failure: spellsDb or spellPermissionsDb service is not available!');
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Spells database service is not available.' } });
    };
  }

  const router = express.Router();

  // -------------------------------------------------------------
  // PUBLIC: list all public spells (no auth) – used by marketplace & registry
  // -------------------------------------------------------------
  router.get('/public', async (req, res) => {
    try {
      const { tag, search } = req.query;
      const filter = {};
      
      // Add tag filter if provided
      if (tag) {
        filter.tags = tag;
      }
      
      // Add search filter if provided (searches name and description)
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      // findPublicSpells will merge this filter with its baseFilter using $and
      // MongoDB will automatically AND all top-level conditions
      const spells = await spellsDb.findPublicSpells(filter);
      return res.status(200).json({ spells });
    } catch (err) {
      logger.error('[spellsApi] GET /public list error', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // -------------------------------------------------------------
  // PUBLIC: fetch single by slug (must appear after list route)
  // -------------------------------------------------------------
  router.get('/public/:publicSlug', async (req, res) => {
    const { publicSlug } = req.params;
    try {
      const spell = await spellsDb.findByPublicSlug(publicSlug);
      if (!spell) return res.status(404).json({ error: 'Spell not found' });
      res.status(200).json(spell);
    } catch (err) {
      logger.error(`[spellsApi] GET /public/${publicSlug}:`, err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // POST /spells/cast - Execute a spell
  router.post('/cast', async (req, res) => {
    const { slug, context } = req.body;

    if (!slug || !context || !context.masterAccountId) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Request body must include a spell slug and a context object with a masterAccountId.'
        }
      });
    }

    if (!spellsService) {
        logger.error('[spellsApi] SpellsService is not available, cannot cast spell.');
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Spell execution service is not available.' } });
    }

    try {
      // Cast creation moved to after spell lookup in spellsService.castSpell
      const result = await spellsService.castSpell(slug, context, castsDb);

      // Ensure the client receives the newly-created castId immediately so it can
      // subscribe to progress updates without polling additional endpoints.
      const responsePayload = (result && typeof result === 'object') ? result : { status: 'running' };

      // Attach castId generated above (if any) when it was injected into context
      if (context.castId && !responsePayload.castId) {
        responsePayload.castId = context.castId;
      }

      res.status(200).json(responsePayload);
    } catch (error) {
      logger.error(`[spellsApi] POST /cast: Error casting spell "${slug}": ${error.message}`, { stack: error.stack });
      const statusCode = error.message.includes('not found') ? 404 : (error.message.includes('permission') ? 403 : 500);
      res.status(statusCode).json({ error: { code: 'SPELL_CAST_FAILED', message: error.message } });
    }
  });

  // ----------------------------------
  // POST /spells/casts  – create a cast record
  router.post('/casts', async (req,res)=>{
    if(!castsDb) return res.status(503).json({ error:'service-unavailable' });
    const { spellId, initiatorAccountId } = req.body||{};
    if(!spellId||!initiatorAccountId) return res.status(400).json({ error:'spellId and initiatorAccountId required' });
    try{
      const cast = await castsDb.createCast({ spellId, initiatorAccountId });
      res.status(201).json(cast);
    }catch(e){ logger.error('create cast err',e); res.status(500).json({ error:'internal' }); }
  });

  // GET /spells/casts/:castId – get cast by ID
  router.get('/casts/:castId', async (req, res) => {
    if (!castsDb) return res.status(503).json({ error: 'service-unavailable' });
    
    const castId = req.params.castId;
    if (!ObjectId.isValid(castId)) {
      logger.warn(`[spellsApi] Invalid castId format: ${castId}`);
      return res.status(400).json({ error: 'Invalid castId format. Must be a valid ObjectId.' });
    }
    
    try {
      // BaseDB.findOne expects a query object
      const cast = await castsDb.findOne({ _id: new ObjectId(castId) });
      if (!cast) {
        return res.status(404).json({ error: 'Cast not found' });
      }
      res.json(cast);
    } catch (e) {
      logger.error('[spellsApi] GET /casts/:castId error:', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // PUT /spells/casts/:castId – update cast progress / status
  router.put('/casts/:castId', async (req,res)=>{
    if(!castsDb) return res.status(503).json({ error:'service-unavailable' });
    
    const castId = req.params.castId;
    // Validate castId format (consistent with other endpoints)
    if (!ObjectId.isValid(castId)) {
      logger.warn(`[spellsApi] Invalid castId format: ${castId}`);
      return res.status(400).json({ error: 'Invalid castId format. Must be a valid ObjectId.' });
    }
    
    const { generationId, status, costDeltaUsd } = req.body||{};
    
    // Validate generationId format if provided (consistent with castsDb.addGeneration pattern)
    if (generationId && !ObjectId.isValid(generationId)) {
      logger.warn(`[spellsApi] Invalid generationId format: ${generationId}`);
      return res.status(400).json({ error: 'Invalid generationId format. Must be a valid ObjectId.' });
    }
    
    const update = { $set: { updatedAt: new Date() } };
    
    if (generationId) {
        // Convert to ObjectId (consistent with castsDb.addGeneration method)
        // Use $addToSet instead of $push to prevent duplicate generation IDs
        // This prevents race conditions where continueExecution is called multiple times
        update.$addToSet = { ...(update.$addToSet||{}), stepGenerationIds: new ObjectId(generationId) };
        // Note: $inc generatedCount is removed since $addToSet doesn't guarantee increment
        // The count can be derived from stepGenerationIds.length if needed
    }
    
    if (typeof costDeltaUsd !== 'undefined') {
        const numericCost = typeof costDeltaUsd === 'string' ? parseFloat(costDeltaUsd) : costDeltaUsd;
        if (!isNaN(numericCost) && numericCost !== 0) {
            update.$inc = { ...(update.$inc||{}), costUsd: numericCost };
        }
    }
    
    if (status) {
        update.$set.status = status;
        if (status === 'completed') {
            update.$set.completedAt = new Date();
        }
    }

    try { 
      // Convert castId to ObjectId (consistent with castsDb.addGeneration and other DB methods)
      await castsDb.updateOne({ _id: new ObjectId(castId) }, update); 
      res.json({ ok:true }); 
    }
    catch(e){ 
      logger.error('[spellsApi] Cast update error:', e); 
      res.status(500).json({ error:'internal' }); 
    }
  });

  // GET /spells - Get public spells or spells owned by a user
  router.get('/', async (req, res) => {
    try {
      const { ownedBy, tag } = req.query;
      let spells;

      // Add logging for incoming query
      logger.info(`[spellsApi] GET /spells query:`, req.query);

      if (ownedBy) {
        if (!ObjectId.isValid(ownedBy)) {
            logger.warn(`[spellsApi] Invalid ownedBy ID format: ${ownedBy}`);
            return res.status(400).json({ error: 'Invalid ownedBy ID format.' });
        }
        // If a tag filter is provided, include it in the query
        if (tag) {
          spells = await spellsDb.findMany({ ownedBy: new ObjectId(ownedBy), tags: tag });
        } else {
          spells = await spellsDb.findSpellsByOwner(ownedBy);
        }
        logger.info(`[spellsApi] findSpellsByOwner(${ownedBy}) returned ${spells.length} spells.`);
        if (spells.length > 0) {
          logger.info(`[spellsApi] Sample spell:`, JSON.stringify(spells[0], null, 2));
        }
      } else {
        // TODO: Add pagination, additional filtering, sorting from query params
        const filter = tag ? { tags: tag } : {};
        spells = await spellsDb.findPublicSpells(filter);
        logger.info(`[spellsApi] findPublicSpells() returned ${spells.length} spells.`);
      }
      
      res.status(200).json({ spells: spells || [] });
    } catch (error) {
      logger.error(`[spellsApi] GET /: Error retrieving spells: ${error.message}`, error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  // GET /spells/:spellIdentifier - Get a single spell by slug or ID
  router.get('/:spellIdentifier', async (req, res) => {
    const { spellIdentifier } = req.params;
    try {
      let spell;
      if (ObjectId.isValid(spellIdentifier)) {
        spell = await spellsDb.findById(spellIdentifier);
      } else {
        spell = await spellsDb.findBySlug(spellIdentifier);
        if(!spell){
           spell = await spellsDb.findByPublicSlug(spellIdentifier);
        }
      }

      if (!spell) {
        return res.status(404).json({ error: 'Spell not found' });
      }

      // Permission check: Use SpellsService if available, otherwise use simple check
      const { masterAccountId } = req.query;
      
      // FIRST: If user owns the spell, always allow access (regardless of visibility)
      // This ensures owners can always access their spells, even if marked private
      if (masterAccountId && spell.ownedBy) {
        if (spell.ownedBy.toString() === masterAccountId.toString()) {
          logger.debug(`[spellsApi] Access granted: User ${masterAccountId} owns spell ${spellIdentifier}`);
          return res.status(200).json(spell);
        }
      }
      
      // SECOND: If spell is explicitly public, allow access to EVERYONE (no masterAccountId required)
      // This is checked after ownership to ensure public spells work for all users, not just owners
      if (spell.visibility === 'public') {
        logger.debug(`[spellsApi] Access granted: Spell ${spellIdentifier} is public (requested by ${masterAccountId || 'anonymous'})`);
        return res.status(200).json(spell);
      }
      
      // THIRD: If spell is private, check permissions (user doesn't own it, so check other permissions)
      if (spell.visibility === 'private') {
        // If no masterAccountId provided, deny access to private spells
        if (!masterAccountId) {
          return res.status(403).json({ error: 'You do not have permission to view this private spell.' });
        }
        
        // Use SpellsService for comprehensive permission check (handles licensed spells)
        if (spellsService && typeof spellsService.checkPermissions === 'function') {
          try {
            const hasPermission = await spellsService.checkPermissions(spell, masterAccountId);
            if (hasPermission) {
              return res.status(200).json(spell);
            }
          } catch (permError) {
            logger.warn(`[spellsApi] Permission check failed for spell ${spellIdentifier}:`, permError);
          }
        }
        
        // No permission found for private spell
        return res.status(403).json({ error: 'You do not have permission to view this private spell.' });
      }
      
      // FOURTH: If visibility is not set or is null/undefined/empty, treat as public for backward compatibility
      // This handles legacy spells that may not have visibility set
      if (!spell.visibility || spell.visibility === null || spell.visibility === undefined || spell.visibility === '') {
        return res.status(200).json(spell);
      }

      // DEFAULT: Allow access for any other visibility values we don't recognize
      // This is permissive to avoid breaking existing functionality
      res.status(200).json(spell);
    } catch (error) {
      logger.error(`[spellsApi] GET /:spellIdentifier: Error retrieving spell ${spellIdentifier}: ${error.message}`, error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // POST /spells - Create a new spell
  // This would be initiated from the user's private spellbook
  router.post('/', async (req, res) => {
    // NOTE: We need the user's masterAccountId. This should come from a middleware.
    // For now, we'll expect it in the request body.
    const { name, description, creatorId, steps, connections, exposedInputs, tags, visibility, pricePoints } = req.body;

    if (!name || !creatorId) {
      return res.status(400).json({ error: 'Spell name and creatorId are required.' });
    }

    // Validate visibility
    const validVisibilities = ['private', 'listed', 'public'];
    const spellVisibility = validVisibilities.includes(visibility) ? visibility : 'private';

    // Validate pricePoints for listed spells
    if (spellVisibility === 'listed' && (!pricePoints || pricePoints < 1)) {
      return res.status(400).json({ error: 'Listed spells must have a price of at least 1 point.' });
    }

    try {
      const spellData = {
        name,
        description,
        creatorId,
        steps: Array.isArray(steps) ? steps : [], // Persist the spell steps for UI rendering and execution
        connections: Array.isArray(connections) ? connections : [], // Persist the sub-graph connections
        exposedInputs: Array.isArray(exposedInputs) ? exposedInputs : [],
        visibility: spellVisibility,
        pricePoints: spellVisibility === 'listed' ? pricePoints : undefined,
        tags: Array.isArray(tags) ? tags : [],
      };
      const newSpell = await spellsDb.createSpell(spellData);
      if (newSpell) {
        // Immediately compute initial average cost/runtime and cache on the spell.
        try {
          if (spellsService && typeof spellsService.quoteSpell === 'function') {
            const quote = await spellsService.quoteSpell(newSpell._id.toString(), { sampleSize: 10 });
            await spellsDb.updateSpell(newSpell._id, {
              avgRuntimeMsCached: quote.totalRuntimeMs,
              avgCostPtsCached: quote.totalCostPts,
            });
            // Attach cached fields to response
            newSpell.avgRuntimeMsCached = quote.totalRuntimeMs;
            newSpell.avgCostPtsCached   = quote.totalCostPts;
          }
        } catch (quoteErr) {
          logger.warn(`[spellsApi] Failed to compute initial quote for new spell ${newSpell._id}: ${quoteErr.message}`);
        }
        res.status(201).json(newSpell);
      } else {
        res.status(500).json({ error: 'Failed to create spell.' });
      }
    } catch (error) {
      logger.error(`[spellsApi] POST /: Error creating spell: ${error.message}`, error);
      if (error.message.includes('required')) {
          return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  // The following endpoints are placeholders and will need to be fleshed out
  // with proper authentication, authorization (who can edit/delete?), and logic.

  // PUT /spells/:spellId - Update a spell
  router.put('/:spellId', async (req, res) => {
    const { spellId } = req.params;
    const { masterAccountId, ...updateData } = req.body; // Requester's ID for auth

    if (!masterAccountId) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!ObjectId.isValid(spellId)) {
        return res.status(400).json({ error: 'Invalid spellId format.' });
    }

    // Validate visibility if provided
    if (updateData.visibility) {
        const validVisibilities = ['private', 'listed', 'public'];
        if (!validVisibilities.includes(updateData.visibility)) {
            return res.status(400).json({ error: 'Invalid visibility value. Must be private, listed, or public.' });
        }
        // Validate pricePoints for listed spells
        if (updateData.visibility === 'listed' && (!updateData.pricePoints || updateData.pricePoints < 1)) {
            return res.status(400).json({ error: 'Listed spells must have a price of at least 1 point.' });
        }
    }

    try {
        const spell = await spellsDb.findById(spellId);
        if (!spell) {
            return res.status(404).json({ error: 'Spell not found.' });
        }
        if (spell.ownedBy.toString() !== masterAccountId) {
            return res.status(403).json({ error: 'You do not have permission to edit this spell.' });
        }

        const result = await spellsDb.updateSpell(spellId, updateData);
        res.status(200).json({ success: result.modifiedCount > 0, ...result });
    } catch (error) {
        logger.error(`[spellsApi] PUT /${spellId}: Error updating spell: ${error.message}`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // DELETE /spells/:spellId - Delete a spell
  router.delete('/:spellId', async (req, res) => {
    const { spellId } = req.params;
    const { masterAccountId } = req.body; // Requester's ID for auth

    if (!masterAccountId) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!ObjectId.isValid(spellId)) {
        return res.status(400).json({ error: 'Invalid spellId format.' });
    }

    try {
        // SpellsDB's deleteSpell method already checks for ownership
        const result = await spellsDb.deleteSpell(spellId, masterAccountId);

        if (result.deletedCount === 0) {
            // This can happen if the spell doesn't exist OR the user is not the owner.
            return res.status(404).json({ error: 'Spell not found or you do not have permission to delete it.' });
        }
        
        res.status(204).send(); // Success, no content
    } catch (error) {
        logger.error(`[spellsApi] DELETE /${spellId}: Error deleting spell: ${error.message}`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // --- Spell Steps ---
  // POST /spells/:spellId/steps - Add a step to a spell
  router.post('/:spellId/steps', async (req, res) => {
    const { spellId } = req.params;
    const { masterAccountId, toolIdentifier, parameters, outputMappings } = req.body;

    if (!masterAccountId) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!ObjectId.isValid(spellId)) {
        return res.status(400).json({ error: 'Invalid spellId format.' });
    }
    if (!toolIdentifier) {
        return res.status(400).json({ error: 'toolIdentifier (the tool\'s unique displayName) is required.' });
    }

    try {
        const spell = await spellsDb.findById(spellId);
        if (!spell) {
            return res.status(404).json({ error: 'Spell not found.' });
        }
        if (spell.ownedBy.toString() !== masterAccountId) {
            return res.status(403).json({ error: 'You do not have permission to edit this spell.' });
        }

        const newStep = {
            stepId: (spell.steps?.length || 0) + 1,
            toolIdentifier: toolIdentifier,
            parameterOverrides: parameters || {}, // Note: frontend sends `parameters`, DB uses `parameterOverrides`
            outputMappings: outputMappings || {}
        };
        
        const result = await spellsDb.addStep(spellId, newStep);
        if (result.modifiedCount > 0) {
            res.status(201).json(newStep);
        } else {
            res.status(500).json({ error: 'Failed to add step to spell.' });
        }
    } catch (error) {
        logger.error(`[spellsApi] POST /${spellId}/steps: Error adding step: ${error.message}`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  /**
   * PUT /:spellId/steps/:stepId
   * Updates a specific step within a spell.
   * Body: { masterAccountId: string, parameterOverrides: object }
   */
  router.put('/:spellId/steps/:stepId', async (req, res) => {
    const { spellId, stepId } = req.params;
    const { masterAccountId, parameterOverrides } = req.body;

    try {
        const updatedSpell = await spellsDb.updateStep(spellId, parseInt(stepId, 10), parameterOverrides, masterAccountId);
        if (!updatedSpell) {
            return res.status(404).json({ error: 'Spell or step not found, or you do not have permission to edit.' });
        }
        res.status(200).json(updatedSpell);
    } catch (error) {
        logger.error(`[SpellsAPI] Error updating step ${stepId} for spell ${spellId}:`, error);
        res.status(500).json({ error: 'An internal error occurred while updating the spell step.' });
    }
  });

  /**
   * PUT /:spellId/steps/:stepId/parameters
   * Partially updates the parameterOverrides for a specific step.
   * Body: { masterAccountId: string, updates: object }
   */
  router.put('/:spellId/steps/:stepId/parameters', async (req, res) => {
    const { spellId, stepId } = req.params;
    const { masterAccountId, updates } = req.body;

    if (!masterAccountId || !updates) {
        return res.status(400).json({ error: 'masterAccountId and updates object are required.' });
    }
    if (!ObjectId.isValid(spellId) || isNaN(parseInt(stepId, 10))) {
        return res.status(400).json({ error: 'Invalid spellId or stepId format.' });
    }

    try {
        const updatedSpell = await spellsDb.updateStepParameters(spellId, parseInt(stepId, 10), updates, masterAccountId);
        if (!updatedSpell) {
            return res.status(404).json({ error: 'Spell or step not found, or you do not have permission to edit.' });
        }
        res.status(200).json(updatedSpell);
    } catch (error) {
        logger.error(`[SpellsAPI] Error partially updating parameters for step ${stepId} in spell ${spellId}:`, error);
        res.status(500).json({ error: 'An internal error occurred while updating the spell step parameters.' });
    }
  });

  // DELETE /spells/:spellId/steps/:stepId - Remove a step from a spell
  router.delete('/:spellId/steps/:stepId', async (req, res) => {
    const { spellId, stepId } = req.params;
    const { masterAccountId } = req.body; // Requester's ID for auth

    if (!masterAccountId) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!ObjectId.isValid(spellId)) {
        return res.status(400).json({ error: 'Invalid spellId format.' });
    }
    const stepIdInt = parseInt(stepId, 10);
    if (isNaN(stepIdInt)) {
        return res.status(400).json({ error: 'Invalid stepId format.' });
    }
    
    try {
        // First, verify ownership. The `removeStep` method should also do this, but an early check is good.
        const spell = await spellsDb.findById(spellId);
        if (!spell) {
            return res.status(404).json({ error: 'Spell not found.' });
        }
        if (spell.ownedBy.toString() !== masterAccountId) {
            return res.status(403).json({ error: 'You do not have permission to edit this spell.' });
        }
        
        const result = await spellsDb.removeStep(spellId, stepIdInt);
        
        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: 'Step not found in the specified spell.' });
        }
        
        // Return the updated spell so the client can refresh its state
        const updatedSpell = await spellsDb.findById(spellId);
        res.status(200).json(updatedSpell);

    } catch (error) {
        logger.error(`[spellsApi] DELETE /${spellId}/steps/${stepId}: Error removing step: ${error.message}`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // POST /:spellIdentifier/quote - Get estimated runtime & cost for the spell
  router.post('/:spellIdentifier/quote', async (req, res) => {
    const { spellIdentifier } = req.params;
    const sampleSize = parseInt(req.body?.sampleSize, 10) || 10;

    if (!spellsService) {
      logger.error('[spellsApi] SpellsService is not available, cannot provide quote.');
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Spell quote service is not available.' } });
    }

    try {
      const quote = await spellsService.quoteSpell(spellIdentifier, { sampleSize });
      res.status(200).json(quote);
    } catch (error) {
      logger.error(`[spellsApi] POST /${spellIdentifier}/quote: Error generating quote: ${error.message}`, { stack: error.stack });
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({ error: { code: 'SPELL_QUOTE_FAILED', message: error.message } });
    }
  });

  // (The public route is defined earlier to avoid being shadowed)

  logger.info('[spellsApi] Spells API routes initialized.');
  return router;
}; 