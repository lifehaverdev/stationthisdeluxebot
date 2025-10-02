const { sanitizeCommandName } = require('../../utils/stringUtils');
const { getTelegramFileUrl, setReaction } = require('./utils/telegramUtils');
// Using internal API client directly instead of making HTTP requests
const InputCollector = require('./components/inputCollector');
const { ExecutionError } = require('../../utils/ExecutionClient');

/**
 * A registry to hold dynamic command definitions and their handlers.
 * This decouples the command setup from the bot's event listeners.
 */
class CommandRegistry {
    constructor(logger) {
        this.commands = new Map();
        this.logger = logger || console;
    }

    /**
     * Registers a command and its handler logic.
     * @param {string} commandName - The command name (e.g., 'animediffusion').
     * @param {RegExp} regex - The regex to match the command.
     * @param {Function} handler - The async function to handle the command.
     */
    register(commandName, regex, handler) {
        if (this.commands.has(commandName)) {
            this.logger.warn(`[CommandRegistry] Command '/${commandName}' is already registered. Overwriting.`);
        }
        this.commands.set(commandName, { regex, handler });
        this.logger.info(`[CommandRegistry] Registered command: /${commandName}`);
    }

    /**
     * Finds a handler for a given message text.
     * @param {string} text - The message text to match against.
     * @returns {object|null} - An object with the handler and the match result, or null if no match.
     */
    findHandler(text) {
        for (const [commandName, { regex, handler }] of this.commands.entries()) {
            const match = text.match(regex);
            if (match) {
                this.logger.debug(`[CommandRegistry] Matched command '/${commandName}'`);
                return { handler, match };
            }
        }
        return null;
    }

    /**
     * Gets all registered commands for setting bot commands.
     * @returns {Array<object>} - An array of { command, description } objects.
     */
    getAllCommands() {
        // This is a simplified version. In a real scenario, you'd store the description
        // during registration. For now, we derive it.
        return Array.from(this.commands.keys()).map(cmd => ({
            command: cmd,
            description: `Run ${cmd}` // Placeholder description
        }));
    }
}


/**
 * Sets up dynamic commands by populating a CommandRegistry.
 * @param {CommandRegistry} commandRegistry - The registry to populate.
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<Array<object>>} - A promise that resolves to the list of commands for API registration.
 */
async function setupDynamicCommands(commandRegistry, dependencies) {
  const { workflows, comfyUI, logger, toolRegistry, userSettingsService, openaiService, loraResolutionService, disabledFeatures = {} } = dependencies;
  
  // Backwards compatibility for services structure if needed, but prefer flat dependencies.
  const workflowsService = workflows || dependencies.workflowsService;
  const comfyuiService = comfyUI;

  logger.info('[Telegram] Setting up dynamic commands...');

  try {
    if (!workflowsService || typeof workflowsService.getWorkflows !== 'function') {
      logger.warn('[Telegram] WorkflowsService not available or getWorkflows method is missing. Skipping dynamic command generation.');
      return [];
    }
    if (!comfyuiService || typeof comfyuiService.submitRequest !== 'function') {
      logger.warn('[Telegram] ComfyUIService not available or submitRequest method is missing. Skipping dynamic command generation.');
      return [];
    }
    if (!toolRegistry) {
      logger.warn('[Telegram] ToolRegistry not available in services. Skipping dynamic command generation.');
      return [];
    }
    if (!userSettingsService) {
        logger.error('[Telegram] userSettingsService is missing from dependencies. Cannot set up dynamic commands.');
        return [];
    }

    const allTools = toolRegistry.getAllTools();
    
    if (!allTools || allTools.length === 0) {
      logger.warn('[Telegram] No tools found in the registry to process for dynamic commands.');
      return [];
    }
    logger.info(`[Telegram] Found ${allTools.length} total tools from ToolRegistry.`);

    const commandableTools = allTools.reduce((acc, tool) => {
      // ... (existing tool classification logic remains the same)
      if (!tool || !tool.toolId || !tool.displayName) { 
        return acc;
      }
      if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Object.keys(tool.inputSchema).length === 0) {
        logger.warn(`[Telegram Filter] Tool '${tool.displayName}' (ID: ${tool.toolId}) has no valid or empty inputSchema. Skipping.`);
        return acc;
      }

      let textInputKey = null;
      let imageInputKey = null;
      let videoInputKey = null;
      let hasRequiredImage = false;
      let hasRequiredVideo = false;
      let hasRequiredText = false;

      const primaryHint = tool.platformHints?.primaryInput;

      for (const inputName in tool.inputSchema) {
        const inputField = tool.inputSchema[inputName];
        if (!inputField) continue;

        const fieldType = inputField.type || 'unknown';
        const fieldTypeLower = typeof fieldType === 'string' ? fieldType.toLowerCase() : 'unknown';
        
        const isPromptCandidateByName = (inputName === 'input_prompt' || inputName === 'prompt' || inputName.toLowerCase().includes('text'));
        const isImageCandidateByName = (inputName === 'input_image' || inputName === 'image' || inputName.toLowerCase().includes('image'));
        const isVideoCandidateByName = (inputName === 'input_video' || inputName === 'video' || inputName.toLowerCase().includes('video'));
        
        if ((fieldTypeLower === 'string' || fieldTypeLower === 'text') && isPromptCandidateByName) {
          if (!textInputKey) textInputKey = inputName;
          if (inputField.required) hasRequiredText = true;
        }
        if (fieldTypeLower === 'image' && isImageCandidateByName) {
          if (!imageInputKey) imageInputKey = inputName;
          if (inputField.required) hasRequiredImage = true;
        }
        if (fieldTypeLower === 'video' && isVideoCandidateByName) {
          if (!videoInputKey) videoInputKey = inputName;
          if (inputField.required) hasRequiredVideo = true;
        }
      }
      
      if (!textInputKey && primaryHint === 'text') {
        for (const inputName in tool.inputSchema) {
          const inputField = tool.inputSchema[inputName];
          const currentFieldTypeLower = inputField?.type?.toLowerCase?.();
          if (inputField && (currentFieldTypeLower === 'string' || currentFieldTypeLower === 'text')) {
            textInputKey = inputName;
            if (inputField.required) hasRequiredText = true;
            break; 
          }
        }
      }

      if (!imageInputKey) {
          for (const inputName in tool.inputSchema) {
              const inputField = tool.inputSchema[inputName];
              if (inputField && inputField.type?.toLowerCase?.() === 'image') {
                  imageInputKey = inputName;
                  if (inputField.required) hasRequiredImage = true;
                  break;
              }
          }
      }
      if (!videoInputKey) {
          for (const inputName in tool.inputSchema) {
              const inputField = tool.inputSchema[inputName];
              if (inputField && inputField.type?.toLowerCase?.() === 'video') {
                  videoInputKey = inputName;
                  if (inputField.required) hasRequiredVideo = true;
                  break;
              }
          }
      }

      tool.metadata = tool.metadata || {};
      let handlerType = null;

      if (primaryHint === 'text' && textInputKey && !imageInputKey && !videoInputKey) {
        handlerType = 'text_only';
      } else if (primaryHint === 'text' && textInputKey && (imageInputKey || videoInputKey)) {
        if (hasRequiredImage) handlerType = 'image_required_with_text';
        else if (hasRequiredVideo) handlerType = 'video_required_with_text';
        else handlerType = 'text_primary_media_optional';
      } else if (primaryHint === 'image' && imageInputKey) {
        handlerType = textInputKey ? 'image_primary_with_text' : 'image_only';
      } else if (primaryHint === 'video' && videoInputKey) {
        handlerType = textInputKey ? 'video_primary_with_text' : 'video_only';
      } else if (textInputKey && !imageInputKey && !videoInputKey) {
         handlerType = 'text_only';
      } else if (imageInputKey && !textInputKey && !videoInputKey) {
         handlerType = 'image_only';
      } else if (videoInputKey && !textInputKey && !imageInputKey) {
         handlerType = 'video_only';
      }

      if (handlerType) {
        tool.metadata.telegramHandlerType = handlerType;
        tool.metadata.telegramPromptInputKey = textInputKey;
        tool.metadata.telegramImageInputKey = imageInputKey;
        tool.metadata.telegramVideoInputKey = videoInputKey;
        acc.push(tool);
      } else {
        logger.warn(`[Telegram Filter] Tool '${tool.displayName}' (ID: ${tool.toolId}) could not be classified for a Telegram handler. Skipping.`);
      }
      return acc;
    }, []);

    logger.info(`[Telegram] Found ${commandableTools.length} tools classified for dynamic command registration.`);

    if (commandableTools.length === 0) {
      logger.info('[Telegram] No suitable tools found to register as dynamic commands after classification.');
      return [];
    }

    const registeredCommandsList = [];

    for (const tool of commandableTools) {
      if (disabledFeatures.cook && (tool.displayName.toLowerCase().includes('cook') || tool.toolId?.toLowerCase?.().includes('cook'))) {
        logger.info(`[Telegram] Skipping dynamic command for tool '${tool.displayName}' due to cook feature toggle.`);
        continue;
      }
      const commandName = sanitizeCommandName(tool.displayName);
      if (!commandName) {
        logger.warn(`[Telegram] Skipping tool with invalid or empty sanitized name: ${tool.displayName} (ID: ${tool.toolId})`);
        continue;
      }

      // The handler is now a standalone async function.
      const commandHandler = async (bot, msg, dependencies, match) => {
        const { logger } = dependencies;
        const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
        if (!apiClient) {
            throw new Error('[dynamicCommands] internalApiClient dependency missing');
        }
        const chatId = msg.chat.id;

        await setReaction(bot, chatId, msg.message_id, '🤔').catch(reactError => 
            logger.warn(`[Telegram EXEC /${commandName}] Failed to set initial reaction: ${reactError.message}`)
        );

        const promptText = match && match[1] ? match[1].trim() : '';
        let masterAccountId;
        // sessions deprecated
        let initiatingEventId;

        try {
          // Step 1: Find or create user to get masterAccountId
          const userResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
            platform: 'telegram',
            platformId: msg.from.id.toString(),
            platformContext: {
              firstName: msg.from.first_name,
              username: msg.from.username,
            },
          });
          masterAccountId = userResponse.data.masterAccountId;

          // --- Group sponsorship handling ---
          if (msg.chat && msg.chat.id < 0) {
            try {
              const groupRes = await apiClient.get(`/internal/v1/data/groups/${msg.chat.id}`);
              if (groupRes.data && groupRes.data.sponsorMasterAccountId) {
                // Check admin status
                let isAdmin = false;
                try {
                  const admins = await bot.getChatAdministrators(msg.chat.id);
                  isAdmin = admins.some(a => a.user.id === msg.from.id);
                } catch (adminErr) {
                  logger.warn(`[dynamicCommands] Could not fetch admin list for ${msg.chat.id}: ${adminErr.message}`);
                }

                // Fallback: if group marks all members as admins
                if (!isAdmin) {
                  try {
                    const chatInfo = await bot.getChat(msg.chat.id);
                    if (chatInfo && chatInfo.all_members_are_administrators) {
                      isAdmin = true;
                    }
                  } catch (chatErr) {
                    logger.warn(`[dynamicCommands] Could not fetch chat info for ${msg.chat.id}: ${chatErr.message}`);
                  }
                }
                if (isAdmin) {
                  masterAccountId = groupRes.data.sponsorMasterAccountId.toString();
                  logger.info(`[dynamicCommands] Admin ${msg.from.id} using sponsor MAID ${masterAccountId} for group ${msg.chat.id}`);
                }
              }
            } catch (e) {
              if (e.response?.status !== 404) {
                logger.warn(`[dynamicCommands] Failed to fetch group sponsor: ${e.message}`);
              }
            }
          }

          // Step 2: Create the initiating event record
          const eventResponse = await apiClient.post('/internal/v1/data/events', {
            masterAccountId,
            eventType: 'command_used',
            sourcePlatform: 'telegram',
            eventData: {
              command: commandName,
              text: msg.text || msg.caption || '',
              toolId: tool.toolId,
            }
          });
          initiatingEventId = eventResponse.data._id;

        } catch (err) {
            const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
            logger.error(`[Telegram EXEC /${commandName}] An error occurred during initial record creation: ${errorMessage}`, { stack: err.stack });
            await bot.sendMessage(msg.chat.id, `An error occurred while preparing your request. Please try again.`, { reply_to_message_id: msg.message_id });
            await setReaction(bot, chatId, msg.message_id, '😨');
            return;
        }

        try {
            const textInputKey = tool.metadata.telegramPromptInputKey;
            const imageInputKey = tool.metadata.telegramImageInputKey;

            // 1. Fetch user preferences for this tool
            let userPreferences = {};
            try {
                const encodedDisplayName = encodeURIComponent(tool.displayName);
                const preferencesResponse = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/preferences/${encodedDisplayName}`);
                if (preferencesResponse.data && typeof preferencesResponse.data === 'object') {
                    userPreferences = preferencesResponse.data;
                }
            } catch (error) {
                if (!error.response || error.response.status !== 404) {
                    logger.warn(`[Telegram EXEC /${commandName}] Could not fetch user preferences for '${tool.displayName}': ${error.message}`);
                }
            }

            // 2. Build inputs payload, prioritizing command inputs over user preferences
            let inputs = { ...userPreferences };
            if (textInputKey && promptText) {
                inputs[textInputKey] = promptText.trim();
            }

            // Handle image inputs (main or supporting)
            const missingImageKeys = [];

            // If main image key is known
            if (imageInputKey) {
              const initialFile = await getTelegramFileUrl(bot, msg);
              if (initialFile) {
                inputs[imageInputKey] = initialFile;
              }
            }

            // Evaluate all required image fields
            for (const [key, def] of Object.entries(tool.inputSchema)) {
              if (def.type?.toLowerCase?.() === 'image' && def.required && !inputs[key]) {
                missingImageKeys.push(key);
              }
            }

            if (missingImageKeys.length > 0) {
              const collector = new InputCollector(bot, { logger, setReaction });
              try {
                await collector.collect({
                  chatId,
                  originatingMsg: msg,
                  tool,
                  currentInputs: inputs,
                  missingInputKeys: missingImageKeys,
                  timeoutMs: 60000
                });
              } catch (collectErr) {
                logger.warn(`[Telegram EXEC /${commandName}] Input collection failed or timed out: ${collectErr.message}`);
                await setReaction(bot, chatId, msg.message_id, '😨');
                return;
              }
            }

            logger.info(`[Telegram EXEC /${commandName}] Final inputs for submission: ${JSON.stringify(inputs)}`);
            
            // 3. Construct the payload for the new centralized execution endpoint
            const executionPayload = {
              toolId: tool.toolId,
              inputs: inputs,
              user: {
                masterAccountId: masterAccountId,
                platform: 'telegram',
                platformId: msg.from.id.toString(),
                platformContext: {
                  firstName: msg.from.first_name,
                  username: msg.from.username,
                  chatId: msg.chat.id,
                  messageId: msg.message_id,
                },
              },
              eventId: initiatingEventId,
              metadata: {
                // Pass notification context for the dispatcher to use upon completion
                notificationContext: {
                  chatId: msg.chat.id,
                  messageId: msg.message_id,
                  replyToMessageId: msg.message_id,
                  userId: msg.from.id,
                }
              }
            };

            // 4. Execute via central ExecutionClient (wraps internal endpoint)
            const execRes = await apiClient.post('/internal/v1/data/execute', executionPayload);
            const execResult = execRes.data || {};

            if (execResult.status === 'completed' && execResult.generationId) {
              // Delivery will arrive via notifier; just react OK.
              await setReaction(bot, chatId, msg.message_id, '👌');
              return;
            }

            // Non-immediate tools – respond with a quick acknowledgement; updates will arrive via websocket or polling
            logger.info(`[Telegram EXEC /${commandName}] Job submitted via execution service. Gen ID: ${execResult.generationId}`);
            // No Gen ID or polling sent to user; NotificationDispatcher will deliver via delivery menu.

            await setReaction(bot, chatId, msg.message_id, '👌');

        } catch (err) {
            let userMessage = 'Sorry, something went wrong while starting the task.';
            // Provide more specific feedback for common credit-related issues
            if (err instanceof ExecutionError && err.payload && err.payload.error) {
              const { code, message } = err.payload.error;
              switch (code) {
                case 'INSUFFICIENT_FUNDS':
                  userMessage = 'You do not have enough points to run this. Purchase more with /buypoints or view your balance with /account.';
                  break;
                case 'WALLET_NOT_FOUND':
                  userMessage = 'You need to connect a wallet before running this. Link your wallet using /account, then purchase points with /buypoints.';
                  break;
                default:
                  userMessage = message || userMessage;
              }
            }

            const errorLog = err.payload ? JSON.stringify(err.payload.error || err.payload) : err.message;
            logger.error(`[Telegram EXEC /${commandName}] Job submission error: ${errorLog}`, { stack: err.stack });

            await bot.sendMessage(msg.chat.id, userMessage, { reply_to_message_id: msg.message_id });
            await setReaction(bot, chatId, msg.message_id, '😨');
        }
      };

      // Register with the registry instead of bot.onText
      const regex = new RegExp(`^/${commandName}(?:@\\w+)?(?:\\s+(.*))?$`, 'is');
      commandRegistry.register(commandName, regex, commandHandler);

      const rawDesc = tool.description?.split('\n')[0] || `Runs the ${tool.displayName} tool.`;
      const trimmedDesc = rawDesc.length > 256 ? rawDesc.slice(0, 253) + '...' : rawDesc;
      registeredCommandsList.push({ command: commandName, description: trimmedDesc });
    }

    logger.info(`[Telegram] Successfully registered ${registeredCommandsList.length} dynamic commands in the registry.`);
    return registeredCommandsList;

  } catch (error) {
    logger.error('[Telegram] A critical error occurred during dynamic command setup:', error);
    return []; // Return empty array on critical failure
  }
}

module.exports = {
  setupDynamicCommands,
  CommandRegistry
};