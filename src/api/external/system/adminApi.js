const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { getCachedClient } = require('../../../core/services/db/utils/queue');

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
      logger.debug(`[Admin DAU] Successfully connected to DB: ${db.databaseName}`);

      const userCoreCollection = db.collection('users_core');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logger.debug(`[Admin DAU] Querying for records with lastTouch >= ${twentyFourHoursAgo.toISOString()}`);
      
      const dauCount = await userCoreCollection.countDocuments({
        lastTouch: { $gte: twentyFourHoursAgo }
      });
      logger.debug(`[Admin DAU] Found ${dauCount} active users.`);

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
      logger.debug(`[Admin RecentGens] Successfully connected to DB: ${db.databaseName}`);

      const gensCollection = db.collection('gens');
      const twentyFourHoursAgoDateObj = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logger.debug(`[Admin RecentGens] Querying for records with timestamp (BSON Date) >= ${twentyFourHoursAgoDateObj.toISOString()}`);

      const countLast24h = await gensCollection.countDocuments({
        timestamp: { $gte: twentyFourHoursAgoDateObj }
      });
      logger.debug(`[Admin RecentGens] Found ${countLast24h} records in the last 24 hours using BSON Date 'timestamp' field.`);

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
      logger.debug(`[Admin RecentHistory] Successfully connected to DB: ${db.databaseName}`);

      const historyCollection = db.collection('history');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logger.debug(`[Admin RecentHistory] Querying for records with timestamp >= ${twentyFourHoursAgo.toISOString()}`);

      const countLast24h = await historyCollection.countDocuments({
        timestamp: { $gte: twentyFourHoursAgo }
      });
      logger.debug(`[Admin RecentHistory] Found ${countLast24h} records in the last 24 hours using 'timestamp' field.`);

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
      logger.debug(`[Admin GensDuration] Successfully connected to DB: ${db.databaseName}`);

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

      logger.debug(`[Admin GensDuration] Processed ${overallStatsData.totalGenerations} gens, total duration ${overallStatsData.totalDurationMs}ms`);

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

  // Deprecated: User Sessions stats endpoint (sessions removed)
  adminRouter.get('/stats/user-sessions', (req, res) => {
    res.status(410).json({ error: { code: 'GONE', message: 'Sessions have been removed; this endpoint is deprecated.' } });
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