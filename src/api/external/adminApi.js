const express = require('express');
const { createLogger } = require('../../utils/logger');
const { getCachedClient } = require('../../core/services/db/utils/queue');

/**
 * Creates the admin API router with all admin-related endpoints
 * @param {Object} dependencies - Dependencies from the main application
 * @returns {express.Router} - The configured Express router for admin API
 */
function createAdminApi(dependencies) {
  const logger = createLogger('AdminAPI');
  const adminRouter = express.Router();

  // Daily Active Users (DAU) stats
  adminRouter.get('/stats/dau', async (req, res, next) => {
    try {
      const mongoClient = await getCachedClient();
      if (!mongoClient) {
        logger.error('[Admin DAU] Could not obtain MongoDB client from getCachedClient()');
        return res.status(500).json({ error: 'Database client acquisition failed.' });
      }

      const db = mongoClient.db(process.env.BOT_NAME);
      if (!db) {
        logger.error('[Admin DAU] Failed to get Db object for BOT_NAME from mongoClient.');
        return res.status(500).json({ error: 'Database connection failed for DAU count (db object).'});
      }
      logger.info(`[Admin DAU] Successfully connected to DB: ${db.databaseName}`);

      const userCoreCollection = db.collection('users_core');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logger.info(`[Admin DAU] Querying for records with lastTouch >= ${twentyFourHoursAgo.toISOString()}`);
      
      const dauCount = await userCoreCollection.countDocuments({
        lastTouch: { $gte: twentyFourHoursAgo }
      });
      logger.info(`[Admin DAU] Found ${dauCount} active users.`);

      res.json({ dau: dauCount });
    } catch (error) {
      logger.error('[Admin DAU] Error fetching DAU:', error);
      next(error);
    }
  });

  // Recent Generations stats
  adminRouter.get('/stats/recent-gens', async (req, res, next) => {
    try {
      const mongoClient = await getCachedClient();
      if (!mongoClient) {
        logger.error('[Admin RecentGens] Could not obtain MongoDB client');
        return res.status(500).json({ error: 'Database client acquisition failed.' });
      }
      const db = mongoClient.db(process.env.BOT_NAME);
      if (!db) {
        logger.error('[Admin RecentGens] Failed to get Db object for BOT_NAME');
        return res.status(500).json({ error: 'Database connection failed (db object).' });
      }
      logger.info(`[Admin RecentGens] Successfully connected to DB: ${db.databaseName}`);

      const gensCollection = db.collection('gens');
      const twentyFourHoursAgoDateObj = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logger.info(`[Admin RecentGens] Querying for records with timestamp (BSON Date) >= ${twentyFourHoursAgoDateObj.toISOString()}`);

      const countLast24h = await gensCollection.countDocuments({
        timestamp: { $gte: twentyFourHoursAgoDateObj }
      });
      logger.info(`[Admin RecentGens] Found ${countLast24h} records in the last 24 hours using BSON Date 'timestamp' field.`);

      const recentRecords = await gensCollection.find({
        timestamp: { $gte: twentyFourHoursAgoDateObj }
      })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

      res.json({ countLast24h, recentRecords });
    } catch (error) {
      logger.error('[Admin RecentGens] Error fetching recent gens:', error);
      next(error);
    }
  });

  // Recent History stats
  adminRouter.get('/stats/recent-history', async (req, res, next) => {
    try {
      const mongoClient = await getCachedClient();
      if (!mongoClient) {
        logger.error('[Admin RecentHistory] Could not obtain MongoDB client');
        return res.status(500).json({ error: 'Database client acquisition failed.' });
      }
      const db = mongoClient.db(process.env.BOT_NAME);
      if (!db) {
        logger.error('[Admin RecentHistory] Failed to get Db object for BOT_NAME');
        return res.status(500).json({ error: 'Database connection failed (db object).' });
      }
      logger.info(`[Admin RecentHistory] Successfully connected to DB: ${db.databaseName}`);

      const historyCollection = db.collection('history');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logger.info(`[Admin RecentHistory] Querying for records with timestamp >= ${twentyFourHoursAgo.toISOString()}`);

      const countLast24h = await historyCollection.countDocuments({
        timestamp: { $gte: twentyFourHoursAgo }
      });
      logger.info(`[Admin RecentHistory] Found ${countLast24h} records in the last 24 hours using 'timestamp' field.`);

      const recentRecords = await historyCollection.find({
        timestamp: { $gte: twentyFourHoursAgo }
      })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

      res.json({ countLast24h, recentRecords });
    } catch (error) {
      logger.error('[Admin RecentHistory] Error fetching recent history:', error);
      next(error);
    }
  });

  // Generation Duration stats
  adminRouter.get('/stats/gens-duration', async (req, res, next) => {
    try {
      const mongoClient = await getCachedClient();
      if (!mongoClient) {
        logger.error('[Admin GensDuration] Could not obtain MongoDB client');
        return res.status(500).json({ error: 'Database client acquisition failed.' });
      }
      const db = mongoClient.db(process.env.BOT_NAME);
      if (!db) {
        logger.error('[Admin GensDuration] Failed to get Db object for BOT_NAME');
        return res.status(500).json({ error: 'Database connection failed (db object).' });
      }
      logger.info(`[Admin GensDuration] Successfully connected to DB: ${db.databaseName}`);

      const gensCollection = db.collection('gens');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const aggregationPipeline = [
        {
          $match: {
            timestamp: { $gte: twentyFourHoursAgo },
            duration: { $exists: true, $type: 'number', $gte: 0 }
          }
        },
        {
          $facet: {
            overallStats: [
              {
                $match: {
                  duration: { $exists: true, $type: 'number', $gte: 0 }
                }
              },
              {
                $group: {
                  _id: null,
                  totalGenerations: { $sum: 1 },
                  totalDurationMs: { $sum: "$duration" }
                }
              },
              {
                $project: {
                  _id: 0,
                  totalGenerations: 1,
                  totalDurationMs: { $ifNull: ["$totalDurationMs", 0] },
                  averageDurationMs: {
                    $cond: [
                      { $eq: ["$totalGenerations", 0] },
                      0,
                      { $divide: [{ $ifNull: ["$totalDurationMs", 0] }, "$totalGenerations"] }
                    ]
                  }
                }
              }
            ],
            durationPerUser: [
              {
                $group: {
                  _id: "$userId",
                  username: { $first: "$username" },
                  totalUserDurationMs: { $sum: "$duration" },
                  userGenerationCount: { $sum: 1 }
                }
              },
              {
                $project: {
                  _id: 0,
                  userId: "$_id",
                  username: 1,
                  totalUserDurationMs: 1,
                  userGenerationCount: 1
                }
              },
              {
                $sort: { totalUserDurationMs: -1 }
              }
            ]
          }
        }
      ];
      
      const aggregationResult = await gensCollection.aggregate(aggregationPipeline).toArray();
      const overallStatsData = aggregationResult[0]?.overallStats[0] || { totalGenerations: 0, totalDurationMs: 0, averageDurationMs: 0 };
      const durationPerUserData = aggregationResult[0]?.durationPerUser || [];

      logger.info(`[Admin GensDuration] Processed ${overallStatsData.totalGenerations} gens, total duration ${overallStatsData.totalDurationMs}ms`);

      res.json({
        timeRange: {
          start: twentyFourHoursAgo.toISOString(),
          end: new Date().toISOString()
        },
        totalGenerations: overallStatsData.totalGenerations,
        totalDurationMs: overallStatsData.totalDurationMs,
        averageDurationMs: parseFloat(overallStatsData.averageDurationMs.toFixed(2)),
        durationPerUser: durationPerUserData
      });

    } catch (error) {
      logger.error('[Admin GensDuration] Error fetching generation duration stats:', error);
      next(error);
    }
  });

  // User Sessions stats
  adminRouter.get('/stats/user-sessions', async (req, res, next) => {
    try {
      const mongoClient = await getCachedClient();
      if (!mongoClient) {
        logger.error('[Admin UserSessions] Could not obtain MongoDB client');
        return res.status(500).json({ error: 'Database client acquisition failed.' });
      }
      const db = mongoClient.db(process.env.BOT_NAME);
      if (!db) {
        logger.error('[Admin UserSessions] Failed to get Db object for BOT_NAME');
        return res.status(500).json({ error: 'Database connection failed (db object).' });
      }
      logger.info(`[Admin UserSessions] Successfully connected to DB: ${db.databaseName}`);

      const historyCollection = db.collection('history');

      const daysToScan = parseInt(req.query.days) || 3;
      const specificUserId = req.query.userId ? parseInt(req.query.userId) : null;
      const INACTIVITY_TIMEOUT_MS = (parseInt(req.query.timeoutMinutes) || 30) * 60 * 1000;

      const NDaysAgo = new Date();
      NDaysAgo.setDate(NDaysAgo.getDate() - daysToScan);
      logger.info(`[Admin UserSessions] Fetching history since ${NDaysAgo.toISOString()} for session analysis.`);

      const matchQuery = {
        timestamp: { $gte: NDaysAgo }
      };
      if (specificUserId) {
        matchQuery.userId = specificUserId;
      }

      const userEvents = await historyCollection.find(matchQuery)
        .sort({ userId: 1, timestamp: 1 })
        .toArray();

      if (userEvents.length === 0) {
        return res.json({ sessions: [], message: 'No history events found for the specified criteria.' });
      }
      
      logger.info(`[Admin UserSessions] Fetched ${userEvents.length} events for processing.`);

      const allUserSessions = [];
      let currentUserEvents = [];
      let currentProcessingUserId = null;

      for (const event of userEvents) {
        if (currentProcessingUserId !== event.userId) {
          if (currentUserEvents.length > 0 && currentProcessingUserId !== null) {
            processEventsForUser(currentProcessingUserId, currentUserEvents, allUserSessions, INACTIVITY_TIMEOUT_MS);
          }
          currentProcessingUserId = event.userId;
          currentUserEvents = [event];
        } else {
          currentUserEvents.push(event);
        }
      }

      if (currentUserEvents.length > 0 && currentProcessingUserId !== null) {
        processEventsForUser(currentProcessingUserId, currentUserEvents, allUserSessions, INACTIVITY_TIMEOUT_MS);
      }

      const distinctUserIdsInSessions = new Set(allUserSessions.map(session => session.userId));
      logger.info(`[Admin UserSessions] Reconstructed ${allUserSessions.length} sessions for ${distinctUserIdsInSessions.size} unique users.`);

      res.json({ 
        message: "Session reconstruction completed.",
        parameters: { daysToScan, specificUserId, inactivityTimeoutMinutes: INACTIVITY_TIMEOUT_MS / (60 * 1000) },
        sessions: allUserSessions
      });

    } catch (error) {
      logger.error('[Admin UserSessions] Error fetching user session data:', error);
      next(error);
    }
  });

  return adminRouter;
}

// Helper function to generate a session ID
function generateSessionId(userId, startTime) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  hash.update(String(userId) + String(new Date(startTime).getTime()));
  return hash.digest('hex').substring(0, 16);
}

function processEventsForUser(userId, events, allUserSessions, inactivityTimeout) {
  if (!events || events.length === 0) return;
  
  let currentSession = null;
  const username = events[0].username;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const eventTime = new Date(event.timestamp).getTime();

    if (currentSession === null) {
      currentSession = startNewSession(event, userId, username);
      if (currentSession) {
        allUserSessions.push(currentSession);
      }
      continue;
    }

    if (eventTime - new Date(currentSession.lastEventTimestamp).getTime() > inactivityTimeout) {
      currentSession.endReason = 'timeout';
      currentSession.endTime = currentSession.lastEventTimestamp;
      currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();
      
      currentSession = startNewSession(event, userId, username);
      if (currentSession) {
        allUserSessions.push(currentSession);
      }
      continue;
    }

    if (currentSession && currentSession.events[currentSession.events.length -1] !== event) {
      currentSession.events.push(event);
    }
    currentSession.lastEventTimestamp = event.timestamp;

    if (event.type === 'user_state' && event.data && event.data.eventType === 'kicked') {
      currentSession.endReason = 'kicked';
      currentSession.endTime = event.timestamp;
      currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();
      currentSession = null;
    }
  }

  if (currentSession) {
    if (!currentSession.endTime) {
      currentSession.endReason = 'data_ended';
      currentSession.endTime = currentSession.lastEventTimestamp;
      currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();
    }
  }
}

function startNewSession(event, userId, username) {
  let sessionStartReason = null;
  let isDesignatedStartEvent = false;

  if (event.type === 'user_state' && event.data) {
    if (event.data.eventType === 'first_join') { sessionStartReason = 'first_join'; isDesignatedStartEvent = true; }
    else if (event.data.eventType === 'check_in') { sessionStartReason = 'check_in'; isDesignatedStartEvent = true; }
  } else if (event.type === 'command' && event.data && event.data.command === '/start') {
    sessionStartReason = 'command_start';
    isDesignatedStartEvent = true;
  }

  if (!isDesignatedStartEvent) {
    sessionStartReason = event.type;
  }
  
  const startTime = event.timestamp;
  return {
    sessionId: generateSessionId(userId, startTime),
    userId: userId,
    username: username,
    startTime: startTime,
    endTime: null,
    duration: null,
    startReason: sessionStartReason,
    endReason: null,
    events: [event],
    lastEventTimestamp: event.timestamp
  };
}

module.exports = { createAdminApi }; 