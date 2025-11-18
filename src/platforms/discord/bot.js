/**
 * Discord Platform Adapter
 * 
 * Main entry point for the Discord bot implementation.
 * This file sets up the bot, initializes the dispatchers, and registers all feature handlers.
 *
 * Canonical Dependency Injection Pattern:
 * - All handlers and managers receive the full `dependencies` object.
 * - All internal API calls must use `dependencies.services.internal.client`.
 * - There should be no top-level `internalApiClient` in dependencies.
 */

const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { settings } = require('../../workflows');

// --- Dispatcher Imports ---
const { ButtonInteractionDispatcher, SelectMenuInteractionDispatcher, CommandDispatcher, DynamicCommandDispatcher, MessageReplyDispatcher } = require('./dispatcher');
const replyContextManager = require('./utils/replyContextManager.js');

// --- Legacy Command Handlers (will be migrated to dispatchers) ---
const createSettingsCommandHandler = require('./commands/settingsCommand');
const createCollectionsCommandHandler = require('./commands/collectionsCommand');
const createStatusCommandHandler = require('./commands/statusCommand');
const createAccountCommandHandler = require('./commands/accountCommand');
const createCastCommandHandler = require('./commands/castCommand');
const createTestMessageReferenceCommandHandler = require('./commands/testMessageReferenceCommand');
const { setupDynamicCommands, CommandRegistry } = require('./dynamicCommands');
const WorkflowCacheManager = require('../../core/services/comfydeploy/workflowCacheManager');

// --- Component Managers ---
const settingsMenuManager = require('./components/settingsMenuManager');
const walletManager = require('./components/walletManager');
const accountMenuManager = require('./components/accountMenuManager');
const linkManager = require('./components/linkManager');
const modsMenuManager = require('./components/modsMenuManager');
const toolsMenuManager = require('./components/toolsMenuManager');
const buyPointsManager = require('./components/buyPointsManager');

// --- Delivery Menu Managers ---
const globalMenuManager = require('./components/deliveryMenu/globalMenuManager');
const infoManager = require('./components/deliveryMenu/infoManager');
const rateManager = require('./components/deliveryMenu/rateManager');
const rerunManager = require('./components/deliveryMenu/rerunManager');
const tweakManager = require('./components/deliveryMenu/tweakManager');

/**
 * Create and configure the Discord bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Discord bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createDiscordBot(dependencies, token, options = {}) {
  const { logger = console, commandRegistry: existingCommandRegistry, toolRegistry } = dependencies;
  
  // Store app start time for the status command
  const appStartTime = new Date();
  
  // Create Discord client with necessary intents
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ]
  });
  
  // Create a collection to store commands (legacy, will be migrated to dispatchers)
  client.commands = new Collection();
  
  // Track bot startup time to filter old messages
  const botStartupTime = Date.now();
  const MESSAGE_AGE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

  // Create or use existing command registry for dynamic commands
  const dynamicCommandRegistry = existingCommandRegistry || new CommandRegistry(logger);

  // --- Initialize Dispatchers ---
  const buttonInteractionDispatcher = new ButtonInteractionDispatcher(logger);
  const selectMenuInteractionDispatcher = new SelectMenuInteractionDispatcher(logger);
  const commandDispatcher = new CommandDispatcher(logger);
  const dynamicCommandDispatcher = new DynamicCommandDispatcher(dynamicCommandRegistry, logger);
  const messageReplyDispatcher = new MessageReplyDispatcher(logger);
  
  // --- Register All Handlers ---
  function registerAllHandlers() {
    const dispatcherInstances = { 
      buttonInteractionDispatcher, 
      selectMenuInteractionDispatcher, 
      commandDispatcher, 
      dynamicCommandDispatcher,
      messageReplyDispatcher
    };
    const allDependencies = { ...dependencies, client, replyContextManager };

    const { disabledFeatures = {} } = dependencies;

    // Register component managers
    settingsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    walletManager.registerHandlers(dispatcherInstances, allDependencies);
    accountMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    linkManager.registerHandlers(dispatcherInstances, allDependencies);
    modsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    toolsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    buyPointsManager.registerHandlers(dispatcherInstances, allDependencies);

    // Register delivery menu managers
    globalMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    infoManager.registerHandlers(dispatcherInstances, allDependencies);
    rateManager.registerHandlers(dispatcherInstances, allDependencies);
    rerunManager.registerHandlers(dispatcherInstances, allDependencies);
    tweakManager.registerHandlers(dispatcherInstances, allDependencies);

    // Register legacy command handlers with dispatcher for now
    // These will be migrated to component managers later
    const handleStatusCommand = createStatusCommandHandler({
      client,
      services: {
        internal: dependencies.internal
      },
      logger
    });
    commandDispatcher.register('status', handleStatusCommand);
    logger.info('[Discord Bot] Registered status command handler');

    const handleAccountCommand = createAccountCommandHandler({
      logger,
      internalApiClient: dependencies.internalApiClient || dependencies.internal?.client,
      internal: dependencies.internal
    });
    commandDispatcher.register('account', handleAccountCommand);
    logger.info('[Discord Bot] Registered account command handler');

    const handleCastCommand = createCastCommandHandler({
      ...dependencies,
      client
    });
    commandDispatcher.register('cast', handleCastCommand);
    logger.info('[Discord Bot] Registered cast command handler');
    
    const handleTestMessageReferenceCommand = createTestMessageReferenceCommandHandler({
      logger
    });
    commandDispatcher.register('testmessageref', handleTestMessageReferenceCommand);
    logger.info('[Discord Bot] Registered testmessageref command handler');
    
    // Link command is registered via linkManager.registerHandlers above

    logger.info('[Discord Bot] All feature handlers registered with dispatchers.');
  }

  registerAllHandlers();

    // --- Legacy Command Handlers (temporary, for backward compatibility) ---
    // These will be migrated to use dispatchers or component managers
    const handleSettingsCommand = createSettingsCommandHandler({
    sessionService: dependencies.sessionService,
    pointsService: dependencies.pointsService,
    client,
    logger
  });
  
    // Register legacy commands with client.commands collection
    // Note: Status is handled by dispatcher, so we don't register it here to avoid conflicts
    // Note: make and upscale are now handled by dynamic commands from ToolRegistry
    client.commands.set('settings', handleSettingsCommand);
  // Status is registered with dispatcher above, don't duplicate
  
    // Command data for Discord API
    // This defines the slash commands and their options
    // Note: make and upscale are now handled by dynamic commands from ToolRegistry
    const commands = [
      {
      name: 'settings',
      description: 'View or modify your image generation settings',
      type: 1, // CHAT_INPUT
      options: [
        {
          name: 'setting',
          description: 'The setting to change',
          type: 3, // STRING type
          required: false,
          choices: [
            {
              name: 'Size',
              value: 'size'
            },
            {
              name: 'Steps',
              value: 'steps'
            },
            {
              name: 'Batch Size',
              value: 'batch_size'
            },
            {
              name: 'CFG Scale',
              value: 'cfg_scale'
            },
            {
              name: 'Strength',
              value: 'strength'
            },
            {
              name: 'Seed',
              value: 'seed'
            },
            {
              name: 'Checkpoint',
              value: 'checkpoint'
            }
          ]
        },
        {
          name: 'value',
          description: 'The new value for the setting',
          type: 3, // STRING type
          required: false
        }
      ]
    },
    // Collections command
    // createCollectionsCommandHandler.commandData.toJSON(),
    {
      name: 'status',
      description: 'Display bot status and runtime information',
      type: 1 // CHAT_INPUT
    },
    {
      name: 'account',
      description: 'View and manage your account',
      type: 1 // CHAT_INPUT
    },
    {
      name: 'link',
      description: 'Link your account to other platforms',
      type: 1, // CHAT_INPUT
      options: [
        {
          name: 'wallet',
          description: 'Wallet address to link to',
          type: 3, // STRING type
          required: false
        }
      ]
    },
    {
      name: 'mods',
      description: 'Browse and manage Mods (LoRAs)',
      type: 1 // CHAT_INPUT
    },
    {
      name: 'tools',
      description: 'Browse available tools',
      type: 1 // CHAT_INPUT
    },
    {
      name: 'wallet',
      description: 'Manage your wallet and link via magic amount',
      type: 1 // CHAT_INPUT
    },
    {
      name: 'cast',
      description: 'Cast a spell',
      type: 1, // CHAT_INPUT
      options: [
        {
          name: 'spell',
          description: 'The spell slug to cast',
          type: 3, // STRING type
          required: true
        },
        {
          name: 'params',
          description: 'Optional parameters (e.g., prompt="a cat" param2=value)',
          type: 3, // STRING type
          required: false
        }
      ]
    },
    {
      name: 'buypoints',
      description: 'Purchase points via ETH contribution',
      type: 1 // CHAT_INPUT
    },
    {
      name: 'testmessageref',
      description: 'Test message reference and image extraction (for debugging)',
      type: 1 // CHAT_INPUT
    }
  ];
  
  // Register event handlers
  client.on('ready', async () => {
    logger.info(`Discord bot logged in as ${client.user.tag}`);
    
    // Setup dynamic commands after ToolRegistry is ready (similar to Telegram)
    // This will register both static and dynamic commands together
    setupDynamicCommandsWhenReady();
  });
  
  // Setup dynamic commands after ToolRegistry is ready
  async function setupDynamicCommandsWhenReady() {
    try {
      // Ensure WorkflowCacheManager has fully initialized (populating ToolRegistry) before registering commands.
      const cacheManager = WorkflowCacheManager.getInstance();
      const timeoutMs = 30000; // 30-second safety cap

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`WorkflowCacheManager initialization timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      let initialized = false;
      try {
        await Promise.race([cacheManager.initialize(), timeoutPromise]);
        initialized = true;
      } catch (initErr) {
        logger.warn(`[Discord] WorkflowCacheManager did not fully initialize: ${initErr.message}`);
      }

      // Poll ToolRegistry for readiness (non-zero tools) up to same timeout
      const start = Date.now();
      const registry = dependencies.toolRegistry;
      while ((registry?.getAllTools()?.length || 0) === 0 && Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, 200));
      }

      logger.info(`[Discord] ToolRegistry ready? ${initialized}. Tools count: ${registry?.getAllTools()?.length || 0}.`);

      // Debug: Log available dependencies
      logger.info(`[Discord] Available dependencies: workflowsService=${!!dependencies.workflowsService}, comfyuiService=${!!dependencies.comfyuiService}, userSettingsService=${!!dependencies.userSettingsService}, sessionService=${!!dependencies.sessionService}, session=${!!dependencies.session}`);
      if (dependencies.workflowsService) {
        logger.info(`[Discord] workflowsService.getWorkflows type: ${typeof dependencies.workflowsService.getWorkflows}`);
      }
      if (dependencies.comfyuiService) {
        logger.info(`[Discord] comfyuiService.submitRequest type: ${typeof dependencies.comfyuiService.submitRequest}`);
      }
      if (dependencies.userSettingsService) {
        logger.info(`[Discord] userSettingsService type: ${typeof dependencies.userSettingsService}`);
      }

      // Prepare dependencies for dynamic command setup
      // Match the structure expected by setupDynamicCommands (same as Telegram)
      const dynamicCommandDependencies = {
        workflows: dependencies.workflowsService,
        workflowsService: dependencies.workflowsService, // Also provide as workflowsService for compatibility
        comfyUI: dependencies.comfyuiService,
        comfyuiService: dependencies.comfyuiService, // Also provide as comfyuiService for compatibility
        logger,
        toolRegistry: registry,
        userSettingsService: dependencies.userSettingsService || dependencies.sessionService || dependencies.session, // Use userSettingsService if available, fallback to sessionService or session
        openaiService: dependencies.openaiService,
        loraResolutionService: dependencies.loraResolutionService,
        disabledFeatures: dependencies.disabledFeatures || {},
        internalApiClient: dependencies.internalApiClient || dependencies.internal?.client,
        internal: dependencies.internal
      };
      
      const dynamicCommands = await setupDynamicCommands(
        dynamicCommandRegistry,
        dynamicCommandDependencies,
        client,
        token
      );
      logger.info(`[Discord] Setup ${dynamicCommands.length} dynamic commands`);
      
      // Merge static and dynamic commands for Discord API registration
      // Filter out dynamic commands that conflict with static commands (static takes precedence)
      const staticCommandNames = new Set(commands.map(cmd => cmd.name));
      const filteredDynamicCommands = dynamicCommands.filter(cmd => !staticCommandNames.has(cmd.name));
      
      if (filteredDynamicCommands.length < dynamicCommands.length) {
        const conflicts = dynamicCommands.filter(cmd => staticCommandNames.has(cmd.name));
        logger.info(`[Discord] Filtered out ${conflicts.length} dynamic commands that conflict with static commands: ${conflicts.map(c => c.name).join(', ')}`);
      }
      
      const allCommands = [...commands, ...filteredDynamicCommands];
      
      // Register all commands (static + dynamic) with Discord API
      // Always register, even if no dynamic commands, to ensure static commands are registered
      try {
        // Validate token before proceeding
        if (!token || typeof token !== 'string' || token.length < 10) {
          throw new Error('Invalid Discord bot token provided');
        }
        
        // Configure REST client (matching adapter.js pattern - no timeout config)
        const rest = new REST({ version: '10' }).setToken(token);
        
        logger.info(`Registering ${allCommands.length} slash commands with Discord API (${commands.length} static + ${filteredDynamicCommands.length} dynamic)`);
        if (filteredDynamicCommands.length > 0) {
          logger.info(`Dynamic command names: ${filteredDynamicCommands.slice(0, 10).map(cmd => cmd.name).join(', ')}${filteredDynamicCommands.length > 10 ? '...' : ''}`);
        }
        logger.info(`Static command names: ${commands.map(cmd => cmd.name).join(', ')}`);
        
        // Validate command structure before sending
        const invalidCommands = allCommands.filter(cmd => !cmd.name || !cmd.description);
        if (invalidCommands.length > 0) {
          logger.error(`❌ Found ${invalidCommands.length} invalid commands (missing name or description):`, invalidCommands);
        }
        
        logger.info('Started refreshing application (/) commands (static + dynamic)');
        
        // Ensure client.user is available
        if (!client.user || !client.user.id) {
          throw new Error('Discord client.user is not available. Bot may not be fully ready.');
        }
        
        logger.info(`Bot user ID: ${client.user.id}`);
        logger.info(`Command payload size: ${JSON.stringify(allCommands).length} bytes`);
        
        // Validate command structure before sending
        for (let i = 0; i < allCommands.length; i++) {
          const cmd = allCommands[i];
          if (!cmd.name || typeof cmd.name !== 'string') {
            throw new Error(`Command at index ${i} has invalid name: ${cmd.name}`);
          }
          if (cmd.name.length > 32) {
            throw new Error(`Command "${cmd.name}" has name longer than 32 characters (Discord limit)`);
          }
          if (!cmd.description || typeof cmd.description !== 'string') {
            throw new Error(`Command "${cmd.name}" has invalid description: ${cmd.description}`);
          }
          if (cmd.description.length > 100) {
            logger.warn(`Command "${cmd.name}" has description longer than 100 characters (${cmd.description.length}), truncating...`);
            cmd.description = cmd.description.substring(0, 97) + '...';
          }
          if (cmd.options && !Array.isArray(cmd.options)) {
            throw new Error(`Command "${cmd.name}" has invalid options (not an array): ${typeof cmd.options}`);
          }
          // Validate options structure
          if (cmd.options) {
            for (let j = 0; j < cmd.options.length; j++) {
              const opt = cmd.options[j];
              if (!opt.name || !opt.type) {
                throw new Error(`Command "${cmd.name}" option at index ${j} is missing name or type`);
              }
              if (opt.name.length > 32) {
                throw new Error(`Command "${cmd.name}" option "${opt.name}" has name longer than 32 characters (Discord limit)`);
              }
              if (opt.description && opt.description.length > 100) {
                logger.warn(`Command "${cmd.name}" option "${opt.name}" has description longer than 100 characters (${opt.description.length}), truncating...`);
                opt.description = opt.description.substring(0, 97) + '...';
              }
            }
          }
        }
        
        logger.info('Command structure validation passed');
        
        // Register all commands at once (matching adapter.js pattern - simple and direct)
        // This was working before, so reverting to the original approach
        try {
          // Strategy: Register commands incrementally, building up the full set
          // This avoids large payload timeouts while ensuring all commands are registered
          
          logger.info('Calling Discord API to register all commands...');
          logger.info(`Sending ${allCommands.length} commands: ${allCommands.map(c => c.name).join(', ')}`);
          
          // DEBUG: Log first command structure to verify format
          if (allCommands.length > 0) {
            logger.info(`[DEBUG] First command structure:`, JSON.stringify(allCommands[0], null, 2));
          }
          
          // DEBUG: Check for missing required fields
          const invalidCommands = allCommands.filter(cmd => {
            const issues = [];
            if (!cmd.name) issues.push('missing name');
            if (!cmd.description) issues.push('missing description');
            if (cmd.type !== 1) issues.push(`wrong type: ${cmd.type} (expected 1)`);
            if (cmd.name && cmd.name.length > 32) issues.push(`name too long: ${cmd.name.length}`);
            if (cmd.description && cmd.description.length > 100) issues.push(`description too long: ${cmd.description.length}`);
            return issues.length > 0;
        });
        
          if (invalidCommands.length > 0) {
            logger.error(`[DEBUG] Found ${invalidCommands.length} commands with validation issues:`);
            invalidCommands.forEach((cmd, idx) => {
              logger.error(`  Command ${idx}: ${cmd.name || 'UNNAMED'}`, cmd);
            });
          }
          
          // CRITICAL: Check existing commands first to avoid unnecessary registrations and rate limits
          logger.info(`[CHECK] Fetching existing commands from Discord to check if registration is needed...`);
        const startTime = Date.now();
          const TIMEOUT_MS = 30000; // 30 seconds max per request
          
          try {
            // Helper function to create timeout promise
            const createTimeoutPromise = (ms, operation) => {
              return new Promise((_, reject) => {
                setTimeout(() => {
                  reject(new Error(`${operation} timed out after ${ms}ms`));
                }, ms);
              });
            };
            
            // Step 1: GET existing commands
            logger.info(`[CHECK] GET existing commands from Discord...`);
            const getTimeoutPromise = createTimeoutPromise(TIMEOUT_MS, 'GET existing commands');
            const getPromise = rest.get(Routes.applicationCommands(client.user.id));
            
            let existingCommands = [];
            try {
              existingCommands = await Promise.race([getPromise, getTimeoutPromise]);
              logger.info(`[CHECK] ✅ Fetched ${existingCommands?.length || 0} existing commands from Discord`);
              if (existingCommands && existingCommands.length > 0) {
                logger.info(`[CHECK] Existing command names: ${existingCommands.map(c => c.name).join(', ')}`);
              }
            } catch (getError) {
              logger.warn(`[CHECK] ⚠️ Failed to fetch existing commands: ${getError.message}`);
              logger.warn(`[CHECK] Proceeding with registration anyway (commands may already exist)`);
              existingCommands = [];
            }
            
            // Step 2: Compare existing vs desired commands
            // Normalize options by sorting them to avoid order differences
            // Strip out Discord-specific fields we don't care about (id, localizations, etc.)
            const normalizeOptions = (options) => {
              if (!options || !Array.isArray(options) || options.length === 0) return null;
              // Sort by name, then normalize each option
              const normalized = options
                .map(opt => {
                  // Only extract fields we care about, ignoring Discord-specific fields
                  const normalizedOpt = {
                    name: opt.name || '',
                    description: (opt.description || '').trim(),
                    type: opt.type || 3,
                    required: opt.required === true // Explicitly convert to boolean
                  };
                  // Only include choices if they exist and are non-empty
                  if (opt.choices && Array.isArray(opt.choices) && opt.choices.length > 0) {
                    normalizedOpt.choices = opt.choices
                      .map(c => ({
                        name: c.name || '',
                        value: c.value
                      }))
                      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                  }
                  return normalizedOpt;
                })
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
              
              // Return JSON string for consistent comparison
              return JSON.stringify(normalized);
            };
            
            const normalizeCommand = (cmd) => {
              // Normalize description: trim and handle empty strings consistently
              const normalizedDesc = (cmd.description || '').trim();
              
              return {
                name: (cmd.name || '').trim(),
                description: normalizedDesc,
                type: cmd.type || 1,
                options: normalizeOptions(cmd.options)
              };
            };
            
            const existingMap = new Map();
            if (existingCommands && Array.isArray(existingCommands)) {
              existingCommands.forEach(cmd => {
                existingMap.set(cmd.name, normalizeCommand(cmd));
              });
            }
            
            const desiredMap = new Map();
            allCommands.forEach(cmd => {
              desiredMap.set(cmd.name, normalizeCommand(cmd));
            });
          
            // Check if commands are different
            // Only compare name, description, type, and normalized options
            const needsUpdate = 
              existingMap.size !== desiredMap.size ||
              Array.from(desiredMap.keys()).some(name => {
                const existing = existingMap.get(name);
                const desired = desiredMap.get(name);
                if (!existing) return true; // New command
                // Compare normalized versions
                return JSON.stringify(existing) !== JSON.stringify(desired);
              });
            
            if (!needsUpdate) {
              logger.info(`[CHECK] ✅ All ${allCommands.length} commands are already registered and up-to-date!`);
              logger.info(`[CHECK] Skipping registration to avoid rate limits.`);
              return; // No need to register
            }
            
            // Step 3: Register commands only if needed
            const newCommands = Array.from(desiredMap.keys()).filter(name => !existingMap.has(name));
            const updatedCommands = Array.from(desiredMap.keys()).filter(name => {
              const existing = existingMap.get(name);
              const desired = desiredMap.get(name);
              if (!existing) return false; // This is a new command, not an update
              const existingStr = JSON.stringify(existing);
              const desiredStr = JSON.stringify(desired);
              const differs = existingStr !== desiredStr;
              if (differs) {
                // Debug: Log what's different with full comparison
                logger.info(`[CHECK] [DEBUG] Command '${name}' differs:`);
                logger.info(`[CHECK] [DEBUG]   Existing: ${existingStr}`);
                logger.info(`[CHECK] [DEBUG]   Desired:  ${desiredStr}`);
                // Also show field-by-field comparison for easier debugging
                if (existing.name !== desired.name) {
                  logger.info(`[CHECK] [DEBUG]     - name differs: "${existing.name}" vs "${desired.name}"`);
                }
                if (existing.description !== desired.description) {
                  logger.info(`[CHECK] [DEBUG]     - description differs: "${existing.description.substring(0, 50)}..." vs "${desired.description.substring(0, 50)}..."`);
                }
                if (existing.type !== desired.type) {
                  logger.info(`[CHECK] [DEBUG]     - type differs: ${existing.type} vs ${desired.type}`);
                }
                if (existing.options !== desired.options) {
                  logger.info(`[CHECK] [DEBUG]     - options differ`);
                  logger.info(`[CHECK] [DEBUG]       Existing options: ${existing.options || 'null'}`);
                  logger.info(`[CHECK] [DEBUG]       Desired options:  ${desired.options || 'null'}`);
                }
              }
              return differs;
            });
            
            // Safety check: If all commands exist and we're detecting many "differences",
            // the comparison might be too strict. Be conservative.
            if (newCommands.length === 0 && updatedCommands.length > 0 && existingMap.size === desiredMap.size) {
              const updateRatio = updatedCommands.length / existingMap.size;
              if (updateRatio > 0.5) {
                logger.warn(`[CHECK] ⚠️ WARNING: Detected differences in ${updatedCommands.length} out of ${existingMap.size} commands (${Math.round(updateRatio * 100)}%)`);
                logger.warn(`[CHECK] ⚠️ This might be a false positive. All commands exist with correct names.`);
                logger.warn(`[CHECK] ⚠️ Skipping registration to avoid rate limits. If commands are actually broken, fix them and restart.`);
                logger.info(`[CHECK] ✅ Skipping registration - all commands exist, differences may be cosmetic`);
                return; // Don't re-register if >50% are "different" but all exist
              }
            }
            
            if (newCommands.length > 0) {
              logger.info(`[CHECK] ⚠️ Commands differ - registration needed`);
              logger.info(`[CHECK] New commands to register: ${newCommands.join(', ')}`);
            }
            if (updatedCommands.length > 0) {
              logger.info(`[CHECK] ⚠️ Commands differ - registration needed`);
              logger.info(`[CHECK] Commands to update: ${updatedCommands.join(', ')}`);
              if (updatedCommands.length > 10) {
                logger.warn(`[CHECK] [DEBUG] Many commands marked for update - check debug logs above to verify differences are real`);
              }
            }
            
            // Add a small delay after GET to avoid rate limiting
            // Discord may throttle rapid GET->PUT sequences
            logger.info(`[CHECK] Waiting 2 seconds before PUT to avoid rate limiting...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            logger.info(`[TIMING] Starting Discord API PUT call at ${new Date().toISOString()}`);
            logger.info(`[DEBUG] Route: ${Routes.applicationCommands(client.user.id)}`);
            logger.info(`[DEBUG] Payload size: ${JSON.stringify(allCommands).length} bytes`);
            
            // Retry logic with exponential backoff
            const MAX_RETRIES = 3;
            const REQUEST_TIMEOUT_MS = 60000; // 60 seconds per attempt
            let lastError = null;
            let result = null;
            
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                logger.info(`[RETRY] Attempt ${attempt}/${MAX_RETRIES} to register commands...`);
                logger.info(`[RETRY] Using ${REQUEST_TIMEOUT_MS}ms timeout per attempt`);
                
                // Create timeout promise to detect hanging requests
                // Note: This doesn't cancel the HTTP request, but lets us detect timeouts
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(() => {
                    reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms (attempt ${attempt})`));
                  }, REQUEST_TIMEOUT_MS);
                });
                
                // Race between API call and timeout
                const apiCallPromise = rest.put(
                  Routes.applicationCommands(client.user.id),
                  { body: allCommands }
                );
                
                result = await Promise.race([apiCallPromise, timeoutPromise]);
                
                logger.info(`[RETRY] ✅ Success on attempt ${attempt}!`);
                break; // Success, exit retry loop
              } catch (attemptError) {
                lastError = attemptError;
                const isRateLimit = attemptError.status === 429 || attemptError.name === 'RateLimitError' || attemptError.retryAfter;
                const isTimeout = attemptError.message?.includes('timed out') || attemptError.message?.includes('timeout') || attemptError.code === 'ETIMEDOUT';
                
                logger.warn(`[RETRY] ❌ Attempt ${attempt} failed: ${attemptError.message}`);
                
                if (isRateLimit) {
                  const retryAfter = attemptError.retryAfter || attemptError.timeToReset || 5000;
                  logger.warn(`[RETRY] ⚠️ Rate limited on attempt ${attempt}. Waiting ${Math.ceil(retryAfter / 1000)}s before retry...`);
                  await new Promise(resolve => setTimeout(resolve, retryAfter));
                } else if (isTimeout && attempt < MAX_RETRIES) {
                  // Exponential backoff for timeouts: 10s, 20s
                  const backoffMs = 10000 * attempt; // 10s, 20s
                  logger.warn(`[RETRY] ⚠️ Timeout on attempt ${attempt}. Waiting ${backoffMs / 1000}s before retry...`);
                  await new Promise(resolve => setTimeout(resolve, backoffMs));
                } else {
                  // Non-retryable error or last attempt
                  logger.error(`[RETRY] ❌ Giving up after ${attempt} attempts`);
                  throw attemptError;
                }
              }
            }
            
            if (!result) {
              throw lastError || new Error('Failed to register commands after all retries');
            }
            
            logger.info(`[DEBUG] Promise resolved! Got result:`, typeof result);
            
            const duration = Date.now() - startTime;
          
            logger.info(`[TIMING] Discord API call completed in ${duration}ms`);
            logger.info(`✅ Successfully registered ${allCommands.length} application commands`);
          logger.info(`   - ${commands.length} static commands`);
            logger.info(`   - ${filteredDynamicCommands.length} dynamic commands`);
            
          if (result && Array.isArray(result)) {
            logger.info(`Discord API returned ${result.length} registered commands`);
              logger.info(`Registered command names: ${result.map(c => c.name).join(', ')}`);
              
              // Check if all commands were registered
              if (result.length !== allCommands.length) {
                logger.warn(`⚠️ Discord only registered ${result.length} out of ${allCommands.length} commands!`);
                const sentNames = new Set(allCommands.map(c => c.name));
                const registeredNames = new Set(result.map(c => c.name));
                const missing = Array.from(sentNames).filter(name => !registeredNames.has(name));
                if (missing.length > 0) {
                  logger.warn(`Missing commands: ${missing.join(', ')}`);
                }
              } else {
                logger.info(`✅ All ${allCommands.length} commands successfully registered!`);
              }
            } else {
              logger.warn(`⚠️ Discord API returned unexpected result type: ${typeof result}`);
              logger.warn(`Result value:`, JSON.stringify(result).substring(0, 500));
                }
          } catch (error) {
            const duration = Date.now() - startTime;
            
            // Check for rate limit errors
            if (error.status === 429 || error.name === 'RateLimitError' || error.retryAfter) {
              const retryAfter = error.retryAfter || error.timeToReset || 'unknown';
              logger.error(`❌ RATE LIMIT HIT! Retry after: ${retryAfter}ms`);
              logger.error(`❌ This explains why registration is failing - we've hit Discord's rate limits!`);
              logger.error(`❌ Solution: The check-first approach should prevent this, but you may need to wait ${Math.ceil(retryAfter / 1000)} seconds`);
              throw new Error(`Discord API rate limit exceeded. Retry after ${Math.ceil(retryAfter / 1000)} seconds. The check-first approach should prevent this in the future.`);
            }
            
            // Check for timeout
            if (error.message?.includes('timed out')) {
              logger.error(`❌ Request timed out after ${duration}ms`);
              logger.error(`❌ This could be due to rate limiting (Discord may be silently dropping requests)`);
              logger.error(`❌ Or network connectivity issues`);
            }
            
            logger.error(`❌ Command registration failed after ${duration}ms:`, error.message);
            logger.error(`❌ Error details:`, {
              status: error.status,
              statusCode: error.statusCode,
              code: error.code,
              name: error.name,
              retryAfter: error.retryAfter,
              timeToReset: error.timeToReset
            });
            throw error; // Re-throw to be caught by outer catch
          }
          
          
        } catch (error) {
          logger.error('❌ Error registering slash commands:', error);
          logger.error('Error details:', {
            message: error.message,
            status: error.status,
            statusCode: error.statusCode,
            code: error.code,
            method: error.method,
            path: error.path,
            requestData: error.requestData ? JSON.stringify(error.requestData).substring(0, 500) : 'N/A',
            rawError: error.rawError
          });
          
          // Check if it's a rate limit error
          if (error.name === 'RateLimitError' || error.retryAfter) {
            logger.error(`Rate limit hit! Retry after: ${error.retryAfter || error.timeToReset}ms`);
          }
          
          // Try to get more details from Discord API error
          if (error.rawError) {
            logger.error('Discord API raw error:', JSON.stringify(error.rawError, null, 2));
          }
          throw error;
        }
      } catch (error) {
        logger.error('❌ Error registering slash commands:', error);
        logger.error('Error details:', {
          message: error.message,
          stack: error.stack,
          statusCode: error.statusCode,
          code: error.code,
          requestData: error.requestData ? JSON.stringify(error.requestData).substring(0, 500) : 'N/A',
          rawError: error
        });
        
        // Try to get more details from Discord API error
        if (error.rawError) {
          logger.error('Discord API raw error:', JSON.stringify(error.rawError, null, 2));
        }
        if (error.request) {
          logger.error('Request details:', {
            method: error.request.method,
            path: error.request.path,
            body: error.request.body ? JSON.stringify(error.request.body).substring(0, 500) : 'N/A'
          });
        }
      }
      
    } catch (error) {
      logger.error('[Discord] Error setting up dynamic commands:', error);
    }
  }
  
  
  // --- Interaction Event Handlers ---
  
  // Handle slash commands
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
      logger.info(`[Discord Bot] Received command: ${commandName}`);
    
      // Try dispatcher first
      const handled = await commandDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      
      if (handled) {
        logger.info(`[Discord Bot] Command ${commandName} handled by dispatcher`);
        return;
      }
      
      // Try dynamic command dispatcher before falling back to legacy handlers
      const dynamicHandled = await dynamicCommandDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      if (dynamicHandled) {
        logger.info(`[Discord Bot] Command ${commandName} handled by dynamic command dispatcher`);
        return;
      }
      
      // Fallback to legacy command handlers
    const command = client.commands.get(commandName);
    
    if (!command) {
        logger.warn(`[Discord Bot] No handler found for command: ${commandName}`);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Command not found.', flags: 64 }); // Ephemeral flag
        }
      return;
    }
    
    try {
      await command(interaction);
        logger.info(`[Discord Bot] Command ${commandName} executed successfully`);
    } catch (error) {
        logger.error(`[Discord Bot] Error executing command ${commandName}:`, error);
      
      const errorMessage = 'An error occurred while executing this command.';
      if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: 64 }); // Ephemeral flag
      } else {
          await interaction.reply({ content: errorMessage, flags: 64 }); // Ephemeral flag
        }
      }
    } catch (error) {
      logger.error(`[Discord Bot] Unhandled error in command handler: ${error.stack}`);
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Sorry, a critical error occurred.', flags: 64 }); // Ephemeral flag
        } catch (e) {
          logger.error('[Discord Bot] Critical: Failed to reply in error path:', e.stack);
        }
      }
    }
  });
  
  // Handle button interactions
  client.on('interactionCreate', async (interaction) => {
    try {
    if (!interaction.isButton()) return;
    
      logger.info(`[Discord Bot] Received button interaction: ${interaction.customId}`);
      
      // Defer update immediately (Discord requires response within 3 seconds)
      await interaction.deferUpdate();
      
      // Try dispatcher
      const handled = await buttonInteractionDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      
      if (handled) {
        logger.info(`[Discord Bot] Button interaction ${interaction.customId} handled by dispatcher`);
        return;
      }
      
      // Legacy button handling (temporary, for backward compatibility)
    const customId = interaction.customId;
      if (customId.startsWith('settings:')) {
        const parts = customId.split(':');
        const settingType = parts[1];
        const settingValue = parts[2];
        
        // Create settings workflow instance
        const settingsWorkflow = settings({ 
          session: dependencies.sessionService, 
          points: dependencies.pointsService, 
          logger 
        });
        
        if (settingType === 'reset') {
          const resetResult = settingsWorkflow.resetSettings(interaction.user.id);
          
          if (resetResult.success) {
            await handleSettingsCommand(interaction);
          } else {
            await interaction.editReply({
              content: `Error resetting settings: ${resetResult.error}`,
              components: []
            });
          }
        } else {
          const updateResult = settingsWorkflow.updateSetting(
            interaction.user.id,
            settingType,
            settingValue
          );
          
          if (updateResult.success) {
            await handleSettingsCommand(interaction);
          } else {
            await interaction.editReply({
              content: `Error updating ${settingType}: ${updateResult.error}`,
              components: []
            });
          }
        }
      }
    } catch (error) {
      logger.error(`[Discord Bot] Unhandled error in button handler: ${error.stack}`);
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Sorry, a critical error occurred.', flags: 64 }); // Ephemeral flag
        } catch (e) {
          logger.error('[Discord Bot] Critical: Failed to reply in error path:', e.stack);
        }
      }
    }
  });
  
  // Handle select menu interactions
  client.on('interactionCreate', async (interaction) => {
    try {
    if (!interaction.isStringSelectMenu()) return;
    
      logger.info(`[Discord Bot] Received select menu interaction: ${interaction.customId}`);
    
      // Defer update immediately (Discord requires response within 3 seconds)
      await interaction.deferUpdate();
      
      // Try dispatcher
      const handled = await selectMenuInteractionDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      
      if (handled) {
        logger.info(`[Discord Bot] Select menu interaction ${interaction.customId} handled by dispatcher`);
        return;
      }
      
      // Legacy select menu handling (temporary, for backward compatibility)
      const customId = interaction.customId;
      if (customId.startsWith('settings:')) {
        const parts = customId.split(':');
        const settingType = parts[1];
        const settingValue = interaction.values[0];
        
          // Create settings workflow instance
          const settingsWorkflow = settings({ 
            session: dependencies.sessionService, 
            points: dependencies.pointsService, 
            logger 
          });
          
          const updateResult = settingsWorkflow.updateSetting(
          interaction.user.id,
          settingType,
          settingValue
        );
        
        if (updateResult.success) {
          await handleSettingsCommand(interaction);
        } else {
          await interaction.editReply({
            content: `Error updating ${settingType}: ${updateResult.error}`,
            components: []
          });
        }
      }
    } catch (error) {
      logger.error(`[Discord Bot] Unhandled error in select menu handler: ${error.stack}`);
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Sorry, a critical error occurred.', flags: 64 }); // Ephemeral flag
        } catch (e) {
          logger.error('[Discord Bot] Critical: Failed to reply in error path:', e.stack);
        }
      }
    }
  });

  // Handle message events (for reply context, dynamic commands, etc.)
  client.on('messageCreate', async (message) => {
    try {
      // Ignore bot messages
      if (message.author.bot) return;
      
      // Filter out old messages
      const messageTime = message.createdTimestamp;
      const messageAge = Date.now() - messageTime;
      
      if (messageAge > MESSAGE_AGE_LIMIT_MS) {
        logger.debug(`[Discord Bot] Ignoring old message (age: ${Math.round(messageAge / 1000)}s, limit: ${MESSAGE_AGE_LIMIT_MS / 1000}s)`);
        return;
      }
      
      const fullDependencies = { ...dependencies, replyContextManager };
      
      // Check for replies with a specific context
      if (message.reference && message.reference.messageId) {
        const context = replyContextManager.getContextById(message.channel.id, message.reference.messageId);
        if (context) {
          const handled = await messageReplyDispatcher.handle(client, message, context, fullDependencies);
          if (handled) {
            replyContextManager.removeContextById(message.channel.id, message.reference.messageId);
            return;
          }
        }
      }
      
      // Check for dynamic commands (if message starts with command-like text)
      // Note: Discord primarily uses slash commands, but we can support text commands too
      if (message.content && message.content.startsWith('/')) {
        // Try dynamic command dispatcher
        // Note: This would need to be adapted for Discord's message format
        // const dynamicHandled = await dynamicCommandDispatcher.handle(client, message, fullDependencies);
        // if (dynamicHandled) return;
      }
      
    } catch (error) {
      logger.error(`[Discord Bot] Error processing message: ${error.stack}`);
      try {
        await message.reply('Sorry, an unexpected error occurred.');
      } catch (e) {
        logger.error('[Discord Bot] Failed to send error message:', e);
      }
    }
  });
  
  // Log errors
  client.on('error', (error) => {
    logger.error('[Discord Bot] Client error:', error);
  });
  
  // Log warnings
  client.on('warn', (warning) => {
    logger.warn('[Discord Bot] Client warning:', warning);
  });
  
  // Login to Discord
  client.login(token);
  
  logger.info('[Discord Bot] Discord bot configured and ready with dispatcher architecture.');
  
  // Return client and bot object for compatibility
  return {
    client,
    bot: client // Alias for compatibility
  };
}

module.exports = createDiscordBot; 