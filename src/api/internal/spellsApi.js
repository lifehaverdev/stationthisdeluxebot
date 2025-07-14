const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the Spells API
module.exports = function spellsApi(dependencies) {
  const { logger, db } = dependencies;
  // The 'db' object from dependencies should contain our instantiated DB services
  const spellsDb = db.spells;
  const spellPermissionsDb = db.spellPermissions;

  if (!spellsDb || !spellPermissionsDb) {
    logger.error('[spellsApi] Critical dependency failure: spellsDb or spellPermissionsDb service is missing!');
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Spells database service is not available.' } });
    };
  }

  const router = express.Router();

  // GET /spells - Get public spells or spells owned by a user
  router.get('/', async (req, res) => {
    try {
      const { ownedBy } = req.query;
      let spells;

      // Add logging for incoming query
      logger.info(`[spellsApi] GET /spells query:`, req.query);

      if (ownedBy) {
        if (!ObjectId.isValid(ownedBy)) {
            logger.warn(`[spellsApi] Invalid ownedBy ID format: ${ownedBy}`);
            return res.status(400).json({ error: 'Invalid ownedBy ID format.' });
        }
        spells = await spellsDb.findSpellsByOwner(ownedBy);
        logger.info(`[spellsApi] findSpellsByOwner(${ownedBy}) returned ${spells.length} spells.`);
        if (spells.length > 0) {
          logger.info(`[spellsApi] Sample spell:`, JSON.stringify(spells[0], null, 2));
        }
      } else {
        // TODO: Add pagination, filtering, sorting from query params
        spells = await spellsDb.findPublicSpells();
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
      }

      if (!spell) {
        return res.status(404).json({ error: 'Spell not found' });
      }

      // TODO: Add permission check here. For now, we assume if it's not private, it's visible.
      // A proper check would see if the user owns it, has permission via spellPermissionsDb, or if it's public.
      const { masterAccountId } = req.query; // Assume MAID is passed for auth checks
      if (spell.visibility === 'private' && (!masterAccountId || spell.ownedBy.toString() !== masterAccountId)) {
        return res.status(403).json({ error: 'You do not have permission to view this private spell.' });
      }

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
    const { name, description, creatorId } = req.body;

    if (!name || !creatorId) {
      return res.status(400).json({ error: 'Spell name and creatorId are required.' });
    }

    try {
      const spellData = {
        name,
        description,
        creatorId,
        visibility: 'private', // All new spells start as private
      };
      const newSpell = await spellsDb.createSpell(spellData);
      if (newSpell) {
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

  logger.info('[spellsApi] Spells API routes initialized.');
  return router;
}; 