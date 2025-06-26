const { sanitizeCommandName } = require('../../utils/stringUtils');
const { getTelegramFileUrl, setReaction } = require('./utils/telegramUtils');

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
  const { workflows, comfyUI, logger, toolRegistry, userSettingsService, openaiService, loraResolutionService } = dependencies;
  
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
      const commandName = sanitizeCommandName(tool.displayName);
      if (!commandName) {
        logger.warn(`[Telegram] Skipping tool with invalid or empty sanitized name: ${tool.displayName} (ID: ${tool.toolId})`);
        continue;
      }

      // The handler is now a standalone async function.
      const commandHandler = async (bot, msg, dependencies, match) => {
        const { internal, comfyUI, userSettingsService, logger, loraResolutionService } = dependencies;
        const comfyuiService = comfyUI; // Alias for clarity
        const chatId = msg.chat.id;

        await setReaction(bot, chatId, msg.message_id, '🤔').catch(reactError => 
            logger.warn(`[Telegram EXEC /${commandName}] Failed to set initial reaction: ${reactError.message}`)
        );

        const promptText = match && match[1] ? match[1].trim() : '';
        let masterAccountId;
        let sessionId;
        let generationRecord;

        try {
            // Step 1: Find or create user to get masterAccountId
            const userResponse = await internal.client.post('/internal/v1/data/users/find-or-create', {
                platform: 'telegram',
                platformId: msg.from.id.toString(),
                platformContext: {
                    firstName: msg.from.first_name,
                    username: msg.from.username,
                },
            });
            masterAccountId = userResponse.data.masterAccountId;

            // Step 2: Create a user session for this interaction
            const sessionResponse = await internal.client.post('/internal/v1/data/sessions', {
                masterAccountId: masterAccountId,
                platform: 'telegram',
            });
            sessionId = sessionResponse.data._id;

            // Step 3: Create the initiating event record
            const eventResponse = await internal.client.post('/internal/v1/data/events', {
                masterAccountId,
                sessionId,
                eventType: 'command_used',
                sourcePlatform: 'telegram',
                eventData: {
                    command: commandName,
                    text: msg.text || msg.caption || '',
                    toolId: tool.toolId,
                }
            });
            const initiatingEventId = eventResponse.data._id;

            // Step 4: Create the generation record, now with the sessionId and initiatingEventId
            const generationRecordResponse = await internal.client.post('/internal/v1/data/generations', {
                masterAccountId,
                sessionId,
                initiatingEventId,
                platform: 'telegram',
                toolId: tool.toolId,
                serviceName: 'comfy-deploy',
                status: 'pending',
                costUsd: null,
                deliveryStatus: 'pending',
                notificationPlatform: 'telegram',
                requestTimestamp: new Date().toISOString(),
                requestPayload: {}, // Initially empty, updated before submission
                metadata: {
                    ...tool.metadata,
                    displayName: tool.displayName,
                    toolId: tool.toolId,
                    // Add direct context for rerunManager compatibility
                    telegramChatId: msg.chat.id,
                    telegramMessageId: msg.message_id,
                    userInputPrompt: msg.text || msg.caption || '',
                    platformContext: {
                        firstName: msg.from?.first_name,
                        username: msg.from?.username,
                    },
                    // Keep notificationContext for the notification service
                    notificationContext: {
                        chatId: msg.chat.id,
                        messageId: msg.message_id,
                        replyToMessageId: msg.message_id,
                        userId: msg.from.id,
                    }
                }
            });
            generationRecord = generationRecordResponse.data;

        } catch (err) {
            const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
            logger.error(`[Telegram EXEC /${commandName}] An error occurred during initial record creation: ${errorMessage}`, { stack: err.stack });
            await bot.sendMessage(msg.chat.id, `An error occurred: ${err.message}`, { reply_to_message_id: msg.message_id });
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
                const preferencesResponse = await internal.client.get(`/internal/v1/data/users/${masterAccountId}/preferences/${encodedDisplayName}`);
                if (preferencesResponse.data && typeof preferencesResponse.data === 'object') {
                    userPreferences = preferencesResponse.data;
                    logger.info(`[Telegram EXEC /${commandName}] Found user preferences for '${tool.displayName}': ${JSON.stringify(userPreferences)}`);
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    logger.info(`[Telegram EXEC /${commandName}] No preferences found for '${tool.displayName}'. Using defaults.`);
                } else {
                    logger.warn(`[Telegram EXEC /${commandName}] Could not fetch user preferences for '${tool.displayName}': ${error.message}`);
                }
            }

            // 2. Build inputs payload, prioritizing command inputs over user preferences
            let inputs = { ...userPreferences }; // Start with preferences

            // Command prompt overrides saved prompt
            if (textInputKey && promptText) {
                inputs[textInputKey] = promptText.trim();
            }

            // BEGIN LORA RESOLUTION
            if (tool.metadata.hasLoraLoader && textInputKey && inputs[textInputKey]) {
                if (loraResolutionService) {
                    logger.info(`[Telegram EXEC /${commandName}] LoRA loader detected, resolving triggers for tool '${tool.displayName}'.`);
                    const originalPrompt = inputs[textInputKey];
                    const { modifiedPrompt, appliedLoras, warnings } = await loraResolutionService.resolveLoraTriggers(
                        originalPrompt,
                        masterAccountId,
                        tool.metadata.baseModel,
                        dependencies 
                    );
                    
                    inputs[textInputKey] = modifiedPrompt;
                    
                    if (warnings && warnings.length > 0) {
                        logger.warn(`[Telegram EXEC /${commandName}] LoRA resolution warnings for user ${masterAccountId}: ${JSON.stringify(warnings)}`);
                    }
                    if (appliedLoras && appliedLoras.length > 0) {
                        logger.info(`[Telegram EXEC /${commandName}] Applied ${appliedLoras.length} LoRAs for user ${masterAccountId}: ${JSON.stringify(appliedLoras.map(l => l.slug))}`);
                        
                        internal.client.put(`/internal/v1/data/generations/${generationRecord._id}`, {
                            'metadata.appliedLoras': appliedLoras,
                            'metadata.rawPrompt': originalPrompt,
                        }).catch(updateErr => logger.error(`[Telegram EXEC /${commandName}] Failed to update generation record with LoRA info: ${updateErr.message}`));
                    }
                } else {
                    logger.warn(`[Telegram EXEC /${commandName}] Tool '${tool.displayName}' has a LoRA loader, but loraResolutionService is not available. Skipping trigger resolution.`);
                }
            }
            // END LORA RESOLUTION

            // Attached/replied-to image overrides saved image
            if (imageInputKey) {
                const fileUrl = await getTelegramFileUrl(bot, msg);
                if (fileUrl) {
                    inputs[imageInputKey] = fileUrl;
                } else if (tool.inputSchema[imageInputKey]?.required && !inputs[imageInputKey]) {
                    // If required, but not in command and not in prefs, then fail.
                    logger.warn(`[Telegram EXEC /${commandName}] Required image not found in message or preferences.`);
                    await bot.sendMessage(chatId, `This command requires an image. Please use the command with an image, reply to a message with one, or set a default image in settings.`, { reply_to_message_id: msg.message_id });
                    await setReaction(bot, chatId, msg.message_id, '😨');
                    return; // Stop execution
                }
            }

            logger.info(`[Telegram EXEC /${commandName}] Final inputs for submission: ${JSON.stringify(inputs)}`);
            
            // Step 4: Submit job to ComfyUI
            const runId = await comfyuiService.submitRequest({
                deploymentId: tool.metadata.deploymentId,
                inputs: inputs,
            });

            // Step 5: IMPORTANT - Update generation record with the run_id and final inputs
            await internal.client.put(`/internal/v1/data/generations/${generationRecord._id}`, {
                'metadata.run_id': runId,
                'requestPayload': inputs, 
            });

            logger.info(`[Telegram EXEC /${commandName}] ComfyUI job submitted. Run ID: ${runId}`);
            await setReaction(bot, chatId, msg.message_id, '👌');

        } catch (err) {
            const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
            logger.error(`[Telegram EXEC /${commandName}] An error occurred during job submission: ${errorMessage}`, { stack: err.stack });
            
            // Update the generation record to failed status
            await internal.client.put(`/internal/v1/data/generations/${generationRecord._id}`, {
                status: 'failed',
                responsePayload: { error: errorMessage },
            }).catch(updateErr => logger.error(`[Telegram EXEC /${commandName}] Failed to update generation status to FAILED after submission error: ${updateErr.message}`));

            await bot.sendMessage(msg.chat.id, `Sorry, something went wrong while starting the task: ${err.message}`, { reply_to_message_id: msg.message_id });
            await setReaction(bot, chatId, msg.message_id, '😨');
        }
      };

      // Register with the registry instead of bot.onText
      const regex = new RegExp(`^/${commandName}(?:@\\w+)?(?:\\s+(.*))?$`, 'is');
      commandRegistry.register(commandName, regex, commandHandler);

      registeredCommandsList.push({ command: commandName, description: tool.description?.split('\\n')[0] || `Runs the ${tool.displayName} tool.` });
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