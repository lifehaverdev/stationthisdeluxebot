/**
 * API Service for LoRA Trainings
 */
const express = require('express');

// Assume trainingDb.js provides functions like:
// const trainingDb = require('../../core/services/db/trainingDb'); // Adjust path as needed
// - getTrainingsByOwner(masterAccountId)
// - getTrainingById(trainingId)
// - createTraining(trainingData) -> trainingData includes masterAccountId, name, etc.
// - updateTraining(trainingId, updateData)
// - deleteTraining(trainingId)

function createTrainingsApi(dependencies) {
  const { logger, db } = dependencies; // db should now be the object containing loraTrainings directly

  // ++ MODIFIED LOGS (adjusted for direct db access) ++
  logger.info(`[TrainingsAPI Init] Received dependencies. Logger type: ${typeof logger}`);
  logger.info(`[TrainingsAPI Init] Received dependencies.db type: ${typeof db}`);

  if (db) {
    logger.info(`[TrainingsAPI Init] dependencies.db keys: ${Object.keys(db).join(', ')}`);
    // No longer expect db.data, directly check for db.loraTrainings
    logger.info(`[TrainingsAPI Init] dependencies.db.loraTrainings type: ${typeof db.loraTrainings}`);
    if (db.loraTrainings && typeof db.loraTrainings.findTrainingsByUser === 'function') {
      logger.info(`[TrainingsAPI Init] db.loraTrainings instance appears valid and has findTrainingsByUser method.`);
    } else {
      logger.warn(`[TrainingsAPI Init] db.loraTrainings IS MISSING or INVALID or lacks expected methods.`);
    }
  } else {
    logger.warn(`[TrainingsAPI Init] dependencies.db IS UNDEFINED.`);
  }
  // -- END MODIFIED LOGS --

  const router = express.Router();

  // GET /internal/v1/data/trainings/owner/:masterAccountId - List trainings by owner
  router.get('/owner/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    logger.info(`[TrainingsAPI] GET /owner/${masterAccountId} - Fetching trainings for user.`);
    try {
      // Use masterAccountId as userId for the DB query - access db.loraTrainings directly
      const trainings = await db.loraTrainings.findTrainingsByUser(masterAccountId);
      res.json(trainings || []);
      // logger.warn(`[TrainingsAPI] GET /owner/${masterAccountId} - DB interaction not yet implemented. Returning empty array.`);
      // res.json([]); // TODO: Replace with actual DB call
    } catch (error) {
      logger.error(`[TrainingsAPI] Error fetching trainings for owner ${masterAccountId}:`, error);
      next(error);
    }
  });

  // POST /internal/v1/data/trainings - Create a new training
  router.post('/', async (req, res, next) => {
    const { masterAccountId, name, notes, allowPublishing, tags } = req.body;
    logger.info(`[TrainingsAPI] POST / - Creating new training with name "${name}" for MAID ${masterAccountId}`);
    if (!masterAccountId || !name) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId and name are required.' } });
    }
    try {
      const newTrainingData = {
        userId: masterAccountId, // trainingDb expects userId
        name,
        notes: notes || '',
        allowPublishing: allowPublishing || false,
        tags: tags || [],
        // status: 'draft', // createTrainingSession in trainingDb.js sets this default
        // ownedBy: masterAccountId, // createTrainingSession in trainingDb.js sets this default
      };
      // Access db.loraTrainings directly
      const createdTraining = await db.loraTrainings.createTrainingSession(newTrainingData);
      if (!createdTraining) {
        logger.error(`[TrainingsAPI] Failed to create training session for MAID ${masterAccountId}. createTrainingSession returned null.`);
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create training session.' }});
      }
      res.status(201).json(createdTraining);
      // logger.warn(`[TrainingsAPI] POST / - DB interaction not yet implemented. Returning mock data.`);
      // res.status(201).json({ _id: `mock_train_${Date.now()}`, ...newTrainingData }); // TODO: Replace
    } catch (error) {
      logger.error(`[TrainingsAPI] Error creating training for MAID ${masterAccountId}:`, error);
      next(error);
    }
  });

  // GET /internal/v1/data/trainings/:trainingId - Get a specific training by ID
  router.get('/:trainingId', async (req, res, next) => {
    const { trainingId } = req.params;
    logger.info(`[TrainingsAPI] GET /${trainingId} - Fetching training by ID.`);
    try {
      // Access db.loraTrainings directly
      const training = await db.loraTrainings.findTrainingById(trainingId);
      if (!training) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found.' } });
      }
      res.json(training);
      // logger.warn(`[TrainingsAPI] GET /${trainingId} - DB interaction not yet implemented. Returning mock data.`);
      // if (trainingId === 'mock_train_exists') { // Simulate found
      //    res.json({ _id: trainingId, name: 'Mock Training Details', status: 'draft', notes: 'Details for mock training.', masterAccountId: 'mock_user' });
      // } else {
      //    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found (mock response).' } });
      // } // TODO: Replace with actual DB call
    } catch (error) {
      // Handle ObjectId cast errors if trainingId is not a valid ObjectId format
      if (error.message && error.message.toLowerCase().includes('objectid')) {
        logger.warn(`[TrainingsAPI] Invalid trainingId format: ${trainingId}`);
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid trainingId format.' } });
      }
      logger.error(`[TrainingsAPI] Error fetching training ${trainingId}:`, error);
      next(error);
    }
  });

  // TODO: Add PUT /:trainingId for updates
  // TODO: Add DELETE /:trainingId for deletion

  return router;
}

module.exports = createTrainingsApi; 