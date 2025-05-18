const { ObjectId } = require('mongodb');

/**
 * @typedef {import('../../teams/Team').Team} Team
 * @typedef {import('../../teams/TeamMembership').TeamMembership} TeamMembership
 * @typedef {import('../../../../types/database').Db} Db // Assuming a global Db type
 * @typedef {import('../../../../types/logger').Logger} Logger // Assuming a global Logger type
 */

/**
 * Creates a team data service for interacting with team-related collections.
 * @param {{db: Db, logger: Logger}} dependencies
 * @returns {object} The team data service with methods for CRUD and membership.
 */
module.exports = (dependencies) => {
  const { db, logger } = dependencies;

  if (!db) {
    logger.error('[teamServiceDb] Database dependency (db) is missing!');
    throw new Error('[teamServiceDb] Database dependency (db) is missing!');
  }
  const teamsCollection = db.collection('teams');
  const teamMembershipsCollection = db.collection('teamMemberships');

  return {
    /**
     * Creates a new team and adds the owner as the first member.
     * @param {{teamName: string, ownerMasterAccountId: string, usdCredit?: number }} teamData
     * @returns {Promise<Team | null>}
     */
    async createTeam({ teamName, ownerMasterAccountId, usdCredit = 0 }) {
      logger.info(`[teamServiceDb] Creating team: ${teamName} by owner ${ownerMasterAccountId}`);
      if (!teamName || !ownerMasterAccountId) {
        logger.error('[teamServiceDb] Team name and ownerMasterAccountId are required to create a team.');
        return null;
      }

      const now = new Date();
      const newTeam = {
        teamName,
        ownerMasterAccountId: new ObjectId(ownerMasterAccountId),
        adminMasterAccountIds: [],
        memberMasterAccountIds: [],
        usdCredit,
        lineOfCredit: { limitUsd: 0, currentDebtUsd: 0, enabled: false },
        usageLimits: {},
        userDefaultSettingsOverrides: {},
        invitations: [],
        createdAt: now,
        updatedAt: now,
      };

      try {
        const result = await teamsCollection.insertOne(newTeam);
        const createdTeamId = result.insertedId;

        // Add owner to teamMemberships
        const ownerMembership = {
          teamId: createdTeamId,
          masterAccountId: new ObjectId(ownerMasterAccountId),
          role: 'owner',
          joinedAt: now,
          settings: {},
          createdAt: now,
          updatedAt: now,
        };
        await teamMembershipsCollection.insertOne(ownerMembership);
        logger.info(`[teamServiceDb] Team ${teamName} created with ID ${createdTeamId} and owner ${ownerMasterAccountId} added.`);
        // eslint-disable-next-line no-unused-vars
        const {acknowledged, ...teamToReturn} = newTeam; //remove acknowledged from newTeam
        return { _id: createdTeamId, ...teamToReturn };
      } catch (error) {
        logger.error(`[teamServiceDb] Error creating team ${teamName}:`, error);
        return null;
      }
    },

    /**
     * Retrieves a team by its ID.
     * @param {string} teamId
     * @returns {Promise<Team | null>}
     */
    async getTeamById(teamId) {
      logger.debug(`[teamServiceDb] Getting team by ID: ${teamId}`);
      if (!ObjectId.isValid(teamId)) {
        logger.warn(`[teamServiceDb] Invalid teamId format: ${teamId}`);
        return null;
      }
      try {
        return await teamsCollection.findOne({ _id: new ObjectId(teamId) });
      } catch (error) {
        logger.error(`[teamServiceDb] Error retrieving team ${teamId}:`, error);
        return null;
      }
    },

    /**
     * Adds a member to a team.
     * @param {string} teamId
     * @param {string} masterAccountId - The masterAccountId of the user to add.
     * @param {'admin'|'member'} role - Role of the new member.
     * @returns {Promise<TeamMembership | null>}
     */
    async addMemberToTeam(teamId, masterAccountId, role = 'member') {
      logger.info(`[teamServiceDb] Adding member ${masterAccountId} to team ${teamId} with role ${role}`);
      if (!ObjectId.isValid(teamId) || !ObjectId.isValid(masterAccountId)) {
        logger.error('[teamServiceDb] Invalid teamId or masterAccountId for addMemberToTeam.');
        return null;
      }

      const now = new Date();
      const newMembership = {
        teamId: new ObjectId(teamId),
        masterAccountId: new ObjectId(masterAccountId),
        role,
        joinedAt: now,
        settings: {},
        createdAt: now,
        updatedAt: now,
      };

      try {
        // Check if user is already a member
        const existingMembership = await teamMembershipsCollection.findOne({
          teamId: new ObjectId(teamId),
          masterAccountId: new ObjectId(masterAccountId),
        });
        if (existingMembership) {
          logger.warn(`[teamServiceDb] User ${masterAccountId} is already a member of team ${teamId}.`);
          return existingMembership;
        }

        const result = await teamMembershipsCollection.insertOne(newMembership);
        
        // Add to the team's memberMasterAccountIds or adminMasterAccountIds list
        const updateField = role === 'admin' ? 'adminMasterAccountIds' : 'memberMasterAccountIds';
        await teamsCollection.updateOne(
          { _id: new ObjectId(teamId) },
          { $addToSet: { [updateField]: new ObjectId(masterAccountId) }, $set: { updatedAt: now } }
        );

        logger.info(`[teamServiceDb] Member ${masterAccountId} added to team ${teamId}. Membership ID: ${result.insertedId}`);
        return { _id: result.insertedId, ...newMembership };

      } catch (error) {
        logger.error(`[teamServiceDb] Error adding member ${masterAccountId} to team ${teamId}:`, error);
        return null;
      }
    },

    /**
     * Retrieves all teams a user is a member of (including as owner or admin).
     * @param {string} masterAccountId
     * @returns {Promise<Team[] | null>}
     */
    async getUserTeams(masterAccountId) {
      logger.debug(`[teamServiceDb] Getting teams for user: ${masterAccountId}`);
      if (!ObjectId.isValid(masterAccountId)) {
        logger.warn(`[teamServiceDb] Invalid masterAccountId format for getUserTeams: ${masterAccountId}`);
        return null;
      }
      try {
        const userMemberships = await teamMembershipsCollection.find({
          masterAccountId: new ObjectId(masterAccountId)
        }).toArray();

        if (!userMemberships || userMemberships.length === 0) {
          return [];
        }

        const teamIds = userMemberships.map(mem => mem.teamId);
        return await teamsCollection.find({ _id: { $in: teamIds } }).toArray();
      } catch (error) {
        logger.error(`[teamServiceDb] Error retrieving teams for user ${masterAccountId}:`, error);
        return null;
      }
    },
    
    /**
     * Retrieves all members of a specific team.
     * @param {string} teamId
     * @returns {Promise<TeamMembership[] | null>}
     */
    async getTeamMembers(teamId) {
        logger.debug(`[teamServiceDb] Getting members for team: ${teamId}`);
        if (!ObjectId.isValid(teamId)) {
            logger.warn(`[teamServiceDb] Invalid teamId format for getTeamMembers: ${teamId}`);
            return null;
        }
        try {
            return await teamMembershipsCollection.find({ teamId: new ObjectId(teamId) }).toArray();
        } catch (error) {
            logger.error(`[teamServiceDb] Error retrieving members for team ${teamId}:`, error);
            return null;
        }
    }
    // Future methods: updateTeam, deleteTeam, removeMemberFromTeam, updateMemberInTeam, etc.
  };
}; 