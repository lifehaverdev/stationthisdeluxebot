const express = require('express');
const { ObjectId } = require('mongodb');

/**
 * Creates an Express router for team-related API endpoints.
 * @param {{teamServiceDb: object, logger: object}} dependencies
 * @returns {express.Router}
 */
module.exports = (dependencies) => {
  const { teamServiceDb, logger } = dependencies;
  const router = express.Router();

  if (!teamServiceDb) {
    logger.error('[teamsApi] teamServiceDb dependency is missing!');
    // Fallback to prevent crashing if used without proper setup
    router.use((req, res) => {
      res.status(500).json({ error: 'Team service not configured' });
    });
    return router;
  }

  // POST /teams - Create a new team
  router.post('/teams', async (req, res) => {
    const { teamName, ownerMasterAccountId, usdCredit } = req.body;
    logger.info(`[teamsApi] Received request to create team: ${teamName}`);

    if (!teamName || !ownerMasterAccountId) {
      return res.status(400).json({ error: 'teamName and ownerMasterAccountId are required.' });
    }
    if (ownerMasterAccountId && !ObjectId.isValid(ownerMasterAccountId)) {
        return res.status(400).json({ error: 'Invalid ownerMasterAccountId format.' });
    }

    try {
      const team = await teamServiceDb.createTeam({ teamName, ownerMasterAccountId, usdCredit });
      if (team) {
        res.status(201).json(team);
      } else {
        res.status(500).json({ error: 'Failed to create team.' });
      }
    } catch (error) {
      logger.error('[teamsApi] Error creating team:', error);
      res.status(500).json({ error: 'Internal server error while creating team.' });
    }
  });

  // GET /teams/:teamId - Get team details
  router.get('/teams/:teamId', async (req, res) => {
    const { teamId } = req.params;
    logger.info(`[teamsApi] Received request to get team: ${teamId}`);

    if (!ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: 'Invalid teamId format.' });
    }

    try {
      const team = await teamServiceDb.getTeamById(teamId);
      if (team) {
        res.status(200).json(team);
      } else {
        res.status(404).json({ error: 'Team not found.' });
      }
    } catch (error) {
      logger.error(`[teamsApi] Error fetching team ${teamId}:`, error);
      res.status(500).json({ error: 'Internal server error while fetching team.' });
    }
  });

  // POST /teams/:teamId/members - Add a member to a team
  router.post('/teams/:teamId/members', async (req, res) => {
    const { teamId } = req.params;
    const { masterAccountId, role } = req.body;
    logger.info(`[teamsApi] Received request to add member ${masterAccountId} to team ${teamId}`);

    if (!ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: 'Invalid teamId format.' });
    }
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({ error: 'masterAccountId is required and must be a valid ObjectId.' });
    }
    if (role && !['admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified. Allowed roles: admin, member.' });
    }

    try {
      const membership = await teamServiceDb.addMemberToTeam(teamId, masterAccountId, role);
      if (membership) {
        // If user was already a member, existing membership is returned. Consider status 200 or 201.
        // For simplicity, let's assume 201 for new, and if it returns existing, client can deduce.
        // Or, teamServiceDb could return a flag. For now, 200 if it might be existing, 201 if always new.
        // Let's use 200 for now and return the membership document.
        res.status(200).json(membership);
      } else {
        // This could be due to team not found, or other internal error during add.
        // teamServiceDb.addMemberToTeam should ideally distinguish.
        res.status(500).json({ error: 'Failed to add member to team.' }); 
      }
    } catch (error) {
      logger.error(`[teamsApi] Error adding member to team ${teamId}:`, error);
      res.status(500).json({ error: 'Internal server error while adding member.' });
    }
  });

  // GET /users/:masterAccountId/teams - List teams for a user
  router.get('/users/:masterAccountId/teams', async (req, res) => {
    const { masterAccountId } = req.params;
    logger.info(`[teamsApi] Received request to get teams for user: ${masterAccountId}`);

    if (!ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({ error: 'Invalid masterAccountId format.' });
    }

    try {
      const teams = await teamServiceDb.getUserTeams(masterAccountId);
      if (teams) {
        res.status(200).json(teams);
      } else {
        // This typically means an error occurred in the service, not that there are no teams.
        // An empty array [] is a valid successful response for no teams.
        res.status(500).json({ error: 'Failed to retrieve teams for user.' });
      }
    } catch (error) {
      logger.error(`[teamsApi] Error fetching teams for user ${masterAccountId}:`, error);
      res.status(500).json({ error: 'Internal server error while fetching user teams.' });
    }
  });

  return router;
}; 