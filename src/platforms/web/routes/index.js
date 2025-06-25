/**
 * Web Platform Routes
 * 
 * Initializes all routes for the web platform
 */

const authRoutes = require('./authRoutes');
const collectionsRoutes = require('./collectionsRoutes');
const shareRoutes = require('./shareRoutes');
const workflowsRoutes = require('./api/workflows');
const pointsRoutes = require('./api/points');
const pipelinesRoutes = require('./api/pipelines');
const statusRoutes = require('./api/status');
const fileRoutes = require('./fileRoutes');
const express = require('express'); // Ensure express is required if not already
const crypto = require('crypto'); // For generating session IDs

// Import our custom logger
const { createLogger } = require('../../../utils/logger');
const logger = createLogger('web-routes');

// Import getCachedClient for direct DB access in admin routes
const { getCachedClient } = require('../../../core/services/db/utils/queue'); //require('../../../../db/utils/queue');

// Import the new webhook processor
const { processComfyDeployWebhook } = require('../../../core/services/comfydeploy/webhookProcessor');

// geniusoverhaul: Import ToolRegistry
const { ToolRegistry } = require('../../../core/tools/ToolRegistry.js');

// Import new user status API routes
const createUserStatusApiRoutes = require('./api/userStatus.js');

/**
 * Initialize all routes for the web platform
 * @param {Express} app - Express application instance
 * @param {Object} services - Core services
 */
async function initializeRoutes(app, services) {
  // Mount API routes
  app.use('/api/auth', authRoutes(services));
  app.use('/api/collections', collectionsRoutes(services));
  app.use('/api/share', shareRoutes(services));
  app.use('/api/workflows', workflowsRoutes(services));
  app.use('/api/points', pointsRoutes(services));
  app.use('/api/pipelines', pipelinesRoutes);
  app.use('/api/status', statusRoutes(services));
  
  // Mount new User Status API (v1/me/status)
  if (services && services.internal && services.internal.client && services.db && services.db.data && services.db.data.userCore) {
    app.use('/api/v1/me', createUserStatusApiRoutes({
      internalApiClient: services.internal.client,
      logger: logger, // Use the logger defined in this file
      userCoreDb: services.db.data.userCore
    }));
    logger.info('[Web Routes] User Status API (/api/v1/me/status) mounted.');
  } else {
    logger.error('[Web Routes] Failed to mount User Status API due to missing dependencies (internal.client or db.data.userCore).');
  }
  
  // Mount direct file routes
  app.use('/files', fileRoutes());
  
  // --- BEGIN DYNAMIC WORKFLOW ROUTES ---
  try {
    const workflowsService = services.workflows; // Assuming service name is 'workflows'
    const comfyuiService = services.comfyui; // Assuming service name is 'comfyui'
    
    // Helper to sanitize display names for URL paths
    const sanitizeForPath = (name) => {
      if (!name) return 'unknown-workflow';
      return name.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    };

    if (workflowsService && comfyuiService && typeof workflowsService.getWorkflows === 'function') {
      const internalWorkflowRouter = express.Router();
      const tools = await workflowsService.getWorkflows(); // Now returns ToolDefinition[]

      tools.forEach(tool => {
        // Use tool.displayName for the route path, sanitized
        // Ensure tool and tool.displayName exist
        if (tool && tool.displayName) {
          const cleanDisplayName = sanitizeForPath(tool.displayName);
          const routePath = `/${cleanDisplayName}/run`; // Example: /flux-general/run
          
          logger.info(`[Web Routes] Registering internal tool route: POST /api/internal/run${routePath} for toolId: ${tool.toolId}`);
          
          internalWorkflowRouter.post(routePath, async (req, res, next) => {
            const currentToolId = tool.toolId; // Capture toolId for this handler
            const currentDisplayName = tool.displayName;
            
            try {
              const userInput = req.body || {};
  
              // geniusoverhaul: Use prepareToolRunPayload from WorkflowsService
              const preparedResult = await workflowsService.prepareToolRunPayload(currentToolId, userInput);

              if (!preparedResult) {
                // prepareToolRunPayload logs errors internally, but we should respond to client
                // It could be a validation error (400) or a tool not found/config error (500)
                // For simplicity, sending 500; can be refined if prepareToolRunPayload returns error details.
                logger.error(`[Web Routes] prepareToolRunPayload failed for tool '${currentDisplayName}' (ID: ${currentToolId}).`);
                return res.status(500).json({
                  status: 'error', 
                  message: `Failed to prepare payload for tool '${currentDisplayName}'. Check server logs for details.`
                });
              }
              
              // The `preparedResult` is the final payload, validated and with defaults.
              const finalPayload = preparedResult;
  
              // 2. Get ComfyUI Deployment ID
              // The ToolDefinition should store the actual ComfyUI deployment_id in its metadata
              const deploymentId = tool.metadata && tool.metadata.deploymentId 
                                   ? tool.metadata.deploymentId.startsWith('comfy-') 
                                     ? tool.metadata.deploymentId.substring(6) // Remove 'comfy-' prefix
                                     : tool.metadata.deploymentId
                                   : null;

              if (!deploymentId) {
                 logger.error(`[Web Routes] ComfyUI deployment_id not found in metadata for tool '${currentDisplayName}' (ID: ${currentToolId})`);
                 return res.status(500).json({ 
                   status: 'error', 
                   message: `Configuration error: Deployment ID not found for tool '${currentDisplayName}'`
                 });
              }
  
              // 3. Submit request via ComfyUI Service
              const runId = await comfyuiService.submitRequest({ 
                deploymentId: deploymentId, // Use the actual ComfyUI deployment_id
                inputs: finalPayload,
                // Pass tool.displayName for machine routing if comfyuiService still uses it.
                // Otherwise, this might be tool.toolId or removed if routing logic changed.
                workflowName: currentDisplayName 
              }); 
  
              // 4. Respond to client
              res.status(202).json({ 
                status: 'success',
                message: `Tool '${currentDisplayName}' (ID: ${currentToolId}) queued successfully.`,
                job: { run_id: runId } 
              });

            } catch (error) {
              logger.error(`Error processing internal tool request for '${currentDisplayName}' (ID: ${currentToolId}):`, error);
              next(error); 
            }
          });
        } else {
           const toolIdentifier = (tool && tool.toolId) 
                                  ? tool.toolId 
                                  : ((tool && tool.displayName) 
                                     ? tool.displayName 
                                     : 'unknown tool (missing toolId and displayName)');
           // Log concisely, as per previous fix.
           logger.warn(`[Web Routes] Skipping route generation for invalid tool object: ${toolIdentifier}`);
        }
      });

      // Mount the dynamic router
      app.use('/api/internal/run', internalWorkflowRouter);
      
    } else {
       logger.warn('[Web Routes] WorkflowsService or ComfyUIService not available or getWorkflows method missing. Skipping dynamic route generation.');
    }
  } catch (error) {
    logger.error('[Web Routes] Error setting up dynamic workflow routes:', error);
    // Decide if this should prevent startup or just log
  }
  // --- END DYNAMIC WORKFLOW ROUTES ---
  
  // --- BEGIN TOOL REGISTRY INSPECTION ROUTES ---
  const registryRouter = express.Router();
  
  registryRouter.get('/tools', (req, res) => {
    try {
      const toolRegistry = ToolRegistry.getInstance();
      const allTools = toolRegistry.getAllTools();
      res.status(200).json(allTools);
    } catch (error) {
      logger.error('[Web Routes] Error fetching all tools from registry:', error);
      res.status(500).json({ error: 'Failed to retrieve tools from registry' });
    }
  });
  
  registryRouter.get('/tools/:toolId', (req, res) => {
    try {
      const toolRegistry = ToolRegistry.getInstance();
      const toolId = req.params.toolId;
      const tool = toolRegistry.getToolById(toolId);
      if (tool) {
        res.status(200).json(tool);
      } else {
        res.status(404).json({ error: `Tool with ID '${toolId}' not found.` });
      }
    } catch (error) {
      logger.error(`[Web Routes] Error fetching tool '${req.params.toolId}' from registry:`, error);
      res.status(500).json({ error: 'Failed to retrieve tool from registry' });
    }
  });
  
  app.use('/api/internal/registry', registryRouter);
  logger.info('[Web Routes] Registered tool registry inspection routes at /api/internal/registry');
  // --- END TOOL REGISTRY INSPECTION ROUTES ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  
  // API documentation
  app.get('/api', (req, res) => {
    res.status(200).json({
      name: 'StationThis API',
      version: '1.0.0',
      endpoints: [
        { path: '/api/auth', description: 'Authentication endpoints' },
        { path: '/api/collections', description: 'Collection management' },
        { path: '/api/share', description: 'Collection sharing' },
        { path: '/api/workflows', description: 'Workflow execution and configuration' },
        { path: '/api/points', description: 'Point balance and transactions' },
        { path: '/api/pipelines', description: 'Pipeline templates and execution' },
        { path: '/api/status', description: 'Application status information' },
        { path: '/files', description: 'Direct access to client files' }
      ]
    });
  });

  // --- Admin Dashboard API Endpoints ---
  app.get('/api/admin/stats/dau', async (req, res, next) => {
    try {
      // Get the MongoDB client using getCachedClient
      const mongoClient = await getCachedClient();
      if (!mongoClient) {
        logger.error('[Admin DAU] Could not obtain MongoDB client from getCachedClient()');
        return res.status(500).json({ error: 'Database client acquisition failed.' });
      }

      // Get the specific database for BOT_NAME
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

      // Optional: Log a sample document to inspect its structure, especially 'lastTouch'
      const sampleUser = await userCoreCollection.findOne({ lastTouch: { $gte: twentyFourHoursAgo } });
      if (sampleUser) {
        logger.info(`[Admin DAU] Sample active user (inspect lastTouch):`, { user: sampleUser });
      } else {
        // If count is > 0 but no sample found with that criteria, it implies an issue, but usually, if count > 0, findOne should also work.
        // More likely, if count is 0, this will also be null.
        const anyUser = await userCoreCollection.findOne({});
        if (anyUser) {
          logger.info(`[Admin DAU] No users active in last 24h. Sample user from collection (inspect lastTouch):`, { user: anyUser });
        } else {
          logger.info(`[Admin DAU] users_core collection appears to be empty or no documents found.`);
        }
      }

      res.json({ dau: dauCount });
    } catch (error) {
      logger.error('[Admin DAU] Error fetching DAU:', error);
      next(error); // Pass to default error handler
    }
  });

  app.get('/api/admin/stats/recent-gens', async (req, res, next) => {
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
      // The 'timestamp' field in 'gens' is a BSON Date object, so compare with a JS Date object.
      logger.info(`[Admin RecentGens] Querying for records with timestamp (BSON Date) >= ${twentyFourHoursAgoDateObj.toISOString()}`);

      const countLast24h = await gensCollection.countDocuments({
        timestamp: { $gte: twentyFourHoursAgoDateObj } // Compare BSON Date with JS Date object
      });
      logger.info(`[Admin RecentGens] Found ${countLast24h} records in the last 24 hours using BSON Date 'timestamp' field.`);

      const recentRecords = await gensCollection.find({
        timestamp: { $gte: twentyFourHoursAgoDateObj } // Compare BSON Date with JS Date object
      })
      .sort({ timestamp: -1 }) // Sort by BSON Date timestamp
      .limit(20)
      .toArray();
      logger.info(`[Admin RecentGens] Fetched ${recentRecords.length} sample records using BSON Date 'timestamp'.`);
      if (recentRecords.length > 0) {
        logger.info('[Admin RecentGens] Sample recent record (inspect timestamp):', { record: recentRecords[0] });
      } else {
        const anyRecord = await gensCollection.findOne({}, { sort: { timestamp: -1 } }); 
        if (anyRecord) {
          logger.info('[Admin RecentGens] No records in last 24h. Sample record from collection (inspect BSON Date timestamp):', { record: anyRecord });
        } else {
          logger.info('[Admin RecentGens] gens collection appears to be empty.');
        }
      }

      res.json({ countLast24h, recentRecords });
    } catch (error) {
      logger.error('[Admin RecentGens] Error fetching recent gens:', error);
      next(error); // Pass to default error handler
    }
  });

  app.get('/api/admin/stats/recent-history', async (req, res, next) => {
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
      // Query will use the 'timestamp' field which is an ISO date string in this collection
      logger.info(`[Admin RecentHistory] Querying for records with timestamp >= ${twentyFourHoursAgo.toISOString()}`);

      // Use 'timestamp' field (ISO date string) instead of 'createdAt'
      const countLast24h = await historyCollection.countDocuments({
        timestamp: { $gte: twentyFourHoursAgo } 
      });
      logger.info(`[Admin RecentHistory] Found ${countLast24h} records in the last 24 hours using 'timestamp' field.`);

      const recentRecords = await historyCollection.find({
        timestamp: { $gte: twentyFourHoursAgo } 
      })
      .sort({ timestamp: -1 }) // Sort by newest first using the ISO date string timestamp
      .limit(20) 
      .toArray();
      logger.info(`[Admin RecentHistory] Fetched ${recentRecords.length} sample records using 'timestamp'.`);
      if (recentRecords.length > 0) {
        logger.info('[Admin RecentHistory] Sample recent record (inspect timestamp):', { record: recentRecords[0] });
      } else {
        // Updated fallback to sort by the ISO date string timestamp field
        const anyRecord = await historyCollection.findOne({}, { sort: { timestamp: -1 } }); 
        if (anyRecord) {
          logger.info('[Admin RecentHistory] No records in last 24h. Sample record from collection (inspect timestamp):', { record: anyRecord });
        } else {
          logger.info('[Admin RecentHistory] history collection appears to be empty.');
        }
      }

      res.json({ countLast24h, recentRecords });
    } catch (error) {
      logger.error('[Admin RecentHistory] Error fetching recent history:', error);
      next(error); // Pass to default error handler
    }
  });

  app.get('/api/admin/stats/gens-duration', async (req, res, next) => {
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

      // MongoDB Aggregation Pipeline using $facet
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
                $project: { // Reshape for consistent output
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

      // --- BEGIN DEBUG LOGGING ---
      if (aggregationResult && aggregationResult.length > 0 && aggregationResult[0].overallStats && aggregationResult[0].overallStats.length > 0) {
        logger.info('[Admin GensDuration DEBUG] Raw overallStats from aggregation:', { aggregationResult: aggregationResult[0].overallStats[0] });
      } else {
        logger.info('[Admin GensDuration DEBUG] aggregationResult[0].overallStats[0] is not available. Full aggregationResult:', { aggregationResult });
      }
      // --- END DEBUG LOGGING ---

      // Extract results from $facet
      const overallStatsData = aggregationResult[0]?.overallStats[0] || { totalGenerations: 0, totalDurationMs: 0, averageDurationMs: 0 };
      const durationPerUserData = aggregationResult[0]?.durationPerUser || [];

      // --- BEGIN DEBUG LOGGING ---
      logger.info(`[Admin GensDuration DEBUG] Extracted overallStatsData:`, { overallStatsData });
      logger.info(`[Admin GensDuration DEBUG] totalGenerations from overallStatsData: ${overallStatsData.totalGenerations}`);
      logger.info(`[Admin GensDuration DEBUG] totalDurationMs from overallStatsData: ${overallStatsData.totalDurationMs}`);
      logger.info(`[Admin GensDuration DEBUG] averageDurationMs from overallStatsData (before toFixed): ${overallStatsData.averageDurationMs}`);
      // --- END DEBUG LOGGING ---

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

  app.get('/api/admin/stats/user-sessions', async (req, res, next) => {
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

      // Parameters for session reconstruction
      const daysToScan = parseInt(req.query.days) || 3; // Default to 3 days
      const specificUserId = req.query.userId ? parseInt(req.query.userId) : null;
      // Inactivity timeout in milliseconds (e.g., 30 minutes)
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

      // Fetch all relevant history events, sorted by user and then by time
      const userEvents = await historyCollection.find(matchQuery)
        .sort({ userId: 1, timestamp: 1 })
        .toArray();

      if (userEvents.length === 0) {
        return res.json({ sessions: [], message: 'No history events found for the specified criteria.' });
      }
      
      logger.info(`[Admin UserSessions] Fetched ${userEvents.length} events for processing.`);

      // --- Session Reconstruction Logic --- 
      const allUserSessions = [];
      let currentUserEvents = [];
      let currentProcessingUserId = null; // Renamed to avoid conflict with specificUserId
      const inactivityTimeoutMs = INACTIVITY_TIMEOUT_MS; // Use the already defined constant

      for (const event of userEvents) {
          if (currentProcessingUserId !== event.userId) {
              if (currentUserEvents.length > 0 && currentProcessingUserId !== null) {
                  processEventsForUser(currentProcessingUserId, currentUserEvents, allUserSessions, inactivityTimeoutMs, db); // Pass db if needed by helpers
              }
              currentProcessingUserId = event.userId;
              currentUserEvents = [event];
          } else {
              currentUserEvents.push(event);
          }
      }
      // Process the last user's events
      if (currentUserEvents.length > 0 && currentProcessingUserId !== null) {
          processEventsForUser(currentProcessingUserId, currentUserEvents, allUserSessions, inactivityTimeoutMs, db); // Pass db if needed by helpers
      }
      // --- End Session Reconstruction Logic ---

      // Get unique user IDs from the reconstructed sessions
      const distinctUserIdsInSessions = new Set(allUserSessions.map(session => session.userId));
      logger.info(`[Admin UserSessions] Reconstructed ${allUserSessions.length} sessions for ${distinctUserIdsInSessions.size} unique users.`);

      res.json({ 
        message: "Session reconstruction in progress.", // Updated message
        parameters: { daysToScan, specificUserId, inactivityTimeoutMinutes: inactivityTimeoutMs / (60 * 1000) },
        sessions: allUserSessions // Send reconstructed sessions
      });

    } catch (error) {
      logger.error('[Admin UserSessions] Error fetching user session data:', error);
      next(error);
    }
  });

  // Helper function to generate a simple session ID (can be outside the route handler)
  function generateSessionId(userId, startTime) {
      const hash = crypto.createHash('sha256');
      hash.update(String(userId) + String(new Date(startTime).getTime())); // Ensure startTime is treated consistently as time value
      return hash.digest('hex').substring(0, 16); // Short hash
  }

  function processEventsForUser(userId, events, allUserSessions, inactivityTimeout, db) { // Added db as potential param
      if (!events || events.length === 0) return;
      
      let currentSession = null;
      const username = events[0].username; // Assuming username is consistent for the user from the first event

      for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const eventTime = new Date(event.timestamp).getTime();

          if (currentSession === null) {
              currentSession = startNewSession(event, userId, username, db); // Pass db
              if (currentSession) {
                   allUserSessions.push(currentSession);
              }
              // If startNewSession returns null (event wasn't a starter and we don't force start),
              // currentSession remains null, and we look for the next potential starter.
              // If it returned a session, the event is already in currentSession.events
              continue; 
          }

          // Check for inactivity timeout BEFORE adding the current event to the existing session
          if (eventTime - new Date(currentSession.lastEventTimestamp).getTime() > inactivityTimeout) {
              currentSession.endReason = 'timeout';
              currentSession.endTime = currentSession.lastEventTimestamp; 
              currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();
              
              currentSession = startNewSession(event, userId, username, db); // Start new session with current event
              if (currentSession) {
                   allUserSessions.push(currentSession);
              }
              continue;
          }

          // Add event to current session (if it wasn't consumed by starting a new session above)
          if (currentSession && currentSession.events[currentSession.events.length -1] !== event ){
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

  function startNewSession(event, userId, username, db) { // Added db as potential param
      let sessionStartReason = null;
      let isDesignatedStartEvent = false;

      if (event.type === 'user_state' && event.data) {
          if (event.data.eventType === 'first_join') { sessionStartReason = 'first_join'; isDesignatedStartEvent = true; }
          else if (event.data.eventType === 'check_in') { sessionStartReason = 'check_in'; isDesignatedStartEvent = true; }
      } else if (event.type === 'command' && event.data && event.data.command === '/start') {
          sessionStartReason = 'command_start';
          isDesignatedStartEvent = true;
      }

      // For now, any event can start a session if no current session exists.
      // More sophisticated logic might look at the *previous* event to decide if this one starts a new session after a timeout.
      // The current loop structure handles timeout by creating a new session *before* adding the event that broke the timeout.
      if (!isDesignatedStartEvent) {
          sessionStartReason = event.type; // Generic start reason based on the event type itself
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
          events: [event], // Session starts with this event
          lastEventTimestamp: event.timestamp
      };
  }

  // Add a new route for the admin dashboard HTML page
  app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Dashboard</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; color: #333; }
                header { background-color: #333; color: #fff; padding: 1rem; text-align: center; }
                nav { background-color: #444; padding: 1rem; }
                nav ul { list-style-type: none; padding: 0; margin: 0; text-align: center; }
                nav ul li { display: inline; margin-right: 20px; }
                nav ul li a { color: #fff; text-decoration: none; }
                .container { padding: 20px; }
                .metric-group { margin-bottom: 20px; padding: 15px; background-color: #fff; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1, h2 { text-align: center; }
                h3 { margin-top: 0; }
                pre { background-color: #eee; padding: 10px; border-radius: 3px; white-space: pre-wrap; word-wrap: break-word; }
                .metric-header { cursor: pointer; padding: 10px; background-color: #e9e9e9; margin-top:0; margin-bottom:0; border-bottom: 1px solid #ddd; }
                .metric-header:hover { background-color: #dcdcdc; }
                .metric-content { padding: 15px; display: none; /* Initially hidden */ }
                .metric-content.open { display: block; }
                #user-sessions-controls { margin-bottom: 15px; padding: 10px; background-color: #f0f0f0; border-radius: 3px; }
                #user-sessions-controls label { margin-right: 5px; }
                #user-sessions-controls input[type="number"], #user-sessions-controls input[type="text"] { margin-right: 10px; width: 80px; }
                .session-summary { margin-bottom: 10px; padding: 8px; background-color: #f9f9f9; border: 1px solid #eee; border-radius: 3px; cursor: pointer; }
                .session-summary:hover { background-color: #efefef; }
                .session-events { display: none; padding-left: 20px; margin-top: 5px; border-left: 2px solid #ccc; }
                .session-events.open { display: block; }
                .session-events pre { font-size: 0.9em; }
            </style>
        </head>
        <body>
            <header>
                <h1>StationThis Deluxe Bot - Admin Dashboard</h1>
            </header>
            <nav>
                <ul>
                    <li><a href="/admin">Home</a></li>
                    <!-- Placeholder for future links -->
                </ul>
            </nav>
            <div class="container">
                <div id="dau-stats" class="metric-group">
                    <h2 class="metric-header">Daily Active Users (DAU)</h2>
                    <div class="metric-content">
                        <p id="dau-count">Loading...</p>
                    </div>
                </div>

                <div id="gens-stats" class="metric-group">
                    <h2 class="metric-header">Recent Generations (last 24h)</h2>
                    <div class="metric-content">
                        <p>Count: <span id="gens-count">Loading...</span></p>
                        <h4>Sample Records:</h4>
                        <pre id="gens-records">Loading...</pre>
                    </div>
                </div>

                <div id="history-stats" class="metric-group">
                    <h2 class="metric-header">Recent History (last 24h)</h2>
                    <div class="metric-content">
                        <p>Count: <span id="history-count">Loading...</span></p>
                        <h4>Sample Records:</h4>
                        <pre id="history-records">Loading...</pre>
                    </div>
                </div>

                <div id="gens-duration-stats" class="metric-group">
                    <h2 class="metric-header">Generation Duration Stats (last 24h)</h2>
                    <div class="metric-content">
                        <p>Total Generations: <span id="total-gens-count">Loading...</span></p>
                        <p>Total Duration (seconds): <span id="total-gens-duration">Loading...</span></p>
                        <p>Average Duration (seconds): <span id="avg-gens-duration">Loading...</span></p>
                        <h4>Duration Per User (Top 5 by duration):</h4>
                        <pre id="gens-duration-by-user">Loading...</pre>
                    </div>
                </div>

                <div id="user-sessions-stats" class="metric-group">
                    <h2 class="metric-header">User Session Narratives (Last 3 Days)</h2>
                    <div class="metric-content">
                        <div id="user-sessions-controls">
                            <label for="session-days">Days to scan:</label>
                            <input type="number" id="session-days" value="3" min="1" max="30">
                            <label for="session-user-id">User ID (optional):</label>
                            <input type="text" id="session-user-id" placeholder="Enter User ID">
                            <label for="session-timeout">Inactivity Timeout (minutes):</label>
                            <input type="number" id="session-timeout" value="30" min="5">
                            <button id="fetch-sessions-btn">Fetch Sessions</button>
                        </div>
                        <div id="user-sessions-summary">Loading session data...</div>
                        <!-- Detailed session events will be populated here dynamically -->
                    </div>
                </div>

            </div>

            <script src="/js/admin-dashboard.js"></script> 
        </body>
        </html>
    `);
  });

  // --- NEW ComfyDeploy Webhook Handler ---
  app.post('/api/webhook/comfydeploy', async (req, res) => {
    try {
      // console.log('~~⚡~~ [ComfyDeploy Webhook Received] POST request hit /api/webhook/comfydeploy');
      // The new processor function handles its own logging of the hit and payload.

      // Log the services object to check for internalApiClient
      const routeLogger = services.logger || console; // Use existing logger or fallback
      routeLogger.info('[Routes/Index] Checking services object before creating dependencies for webhookProcessor:', {
        hasInternalApiClientProperty: !!services.internalApiClient, // This should now be true
        isInternalApiClientGetFunction: typeof services.internalApiClient?.get === 'function', // This should now be true
        hasInternalProperty: !!services.internal, 
        hasLogger: !!services.logger,
        serviceKeys: services ? Object.keys(services) : 'services_is_undefined_or_null'
      });

      // Dependencies for the processor
      const dependencies = {
        internalApiClient: services.internal.client, // Corrected to use services.internal.client
        telegramNotifier: services.telegramNotifier, 
        logger: services.logger || console 
      };

      routeLogger.info('[Routes/Index] Dependencies object created for webhookProcessor:', {
        hasInternalApiClientInDeps: !!dependencies.internalApiClient,
        isInternalApiClientInDepsFunction: typeof dependencies.internalApiClient?.get === 'function',
        hasLoggerInDeps: !!dependencies.logger
      });

      const result = await processComfyDeployWebhook(req.body, dependencies);

      if (result.success) {
        res.status(result.statusCode || 200).json(result.data || { message: "Webhook processed" });
      } else {
        res.status(result.statusCode || 500).json({ message: "error", error: result.error || "Webhook processing failed." });
      }

    } catch (error) {
      const routeLogger = services.logger || console; // Ensure routeLogger is defined in this scope too or use the one from above
      routeLogger.error('[Webhook Route Handler] Unhandled exception:', error);
      res.status(500).json({ message: "error", error: "Internal server error in webhook route handler." });
    }
  });
  // --- END NEW Webhook Handler ---

  // --- NEW Alchemy Webhook Handler for CreditService ---
  app.post('/api/webhook/alchemy', async (req, res) => {
    logger.info(`[Webhook Route] Received a request on the Alchemy endpoint.`);
    
    if (!services.creditService) {
      logger.error('[Webhook Route] CreditService is not available.');
      // Always return 200 to Alchemy, even on critical internal errors,
      // to prevent them from disabling the webhook.
      return res.status(200).json({ status: 'error', message: 'Internal server error: Service not configured.' });
    }

    try {
      logger.info(`[Webhook Route] Processing Alchemy event...`, { body: req.body });
      const result = await services.creditService.handleDepositEventWebhook(req.body);
      
      if (!result.success) {
        logger.warn(`[Webhook Route] Failed to process Alchemy event: ${result.message}`, { detail: result.detail });
      } else {
        logger.info(`[Webhook Route] Successfully processed Alchemy event: ${result.message}`);
      }

    } catch (error) {
      logger.error('[Webhook Route] An unexpected error occurred processing the Alchemy webhook.', error);
    }
    
    // Always acknowledge the webhook to prevent Alchemy from disabling it.
    res.status(200).json({ status: 'received' });
  });
  // --- END Alchemy Webhook Handler ---
}

module.exports = {
  initializeRoutes
}; 