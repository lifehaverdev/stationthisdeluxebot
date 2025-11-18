const { sanitizeCommandName } = require('../../utils/stringUtils');
const { ExecutionError } = require('../../utils/ExecutionClient');
const { getDiscordFileUrl } = require('./utils/discordUtils');

/**
 * A registry to hold dynamic command definitions and their handlers for Discord.
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
     * @param {Function} handler - The async function to handle the command.
     */
    register(commandName, handler) {
        if (this.commands.has(commandName)) {
            this.logger.warn(`[CommandRegistry] Command '/${commandName}' is already registered. Overwriting.`);
        }
        this.commands.set(commandName, { handler });
        this.logger.info(`[CommandRegistry] Registered command: /${commandName}`);
    }

    /**
     * Finds a handler for a given command name.
     * @param {string} commandName - The command name to match.
     * @returns {object|null} - An object with the handler, or null if no match.
     */
    findHandler(commandName) {
        const command = this.commands.get(commandName);
        if (command) {
            this.logger.debug(`[CommandRegistry] Matched command '/${commandName}'`);
            return { handler: command.handler };
        }
        return null;
    }

    /**
     * Gets all registered commands.
     * @returns {Array<string>} - An array of command names.
     */
    getAllCommandNames() {
        return Array.from(this.commands.keys());
    }
}

/**
 * Sets up dynamic commands by populating a CommandRegistry and registering with Discord API.
 * @param {CommandRegistry} commandRegistry - The registry to populate.
 * @param {object} dependencies - The canonical dependencies object.
 * @param {object} client - Discord client instance.
 * @param {string} token - Discord bot token.
 * @returns {Promise<Array<object>>} - A promise that resolves to the list of commands for API registration.
 */
async function setupDynamicCommands(commandRegistry, dependencies, client, token) {
  const { workflows, comfyUI, logger, toolRegistry, userSettingsService, openaiService, loraResolutionService, disabledFeatures = {} } = dependencies;
  
  // Backwards compatibility for services structure if needed, but prefer flat dependencies.
  const workflowsService = dependencies.workflowsService || workflows;
  const comfyuiService = dependencies.comfyuiService || comfyUI;

  logger.info('[Discord] Setting up dynamic commands...');

  try {
    if (!workflowsService || typeof workflowsService.getWorkflows !== 'function') {
      logger.warn('[Discord] WorkflowsService not available or getWorkflows method is missing. Skipping dynamic command generation.');
      return [];
    }
    if (!comfyuiService || typeof comfyuiService.submitRequest !== 'function') {
      logger.warn('[Discord] ComfyUIService not available or submitRequest method is missing. Skipping dynamic command generation.');
      return [];
    }
    if (!toolRegistry) {
      logger.warn('[Discord] ToolRegistry not available in services. Skipping dynamic command generation.');
      return [];
    }
    if (!userSettingsService) {
        logger.error('[Discord] userSettingsService is missing from dependencies. Cannot set up dynamic commands.');
        return [];
    }

    const allTools = toolRegistry.getAllTools();
    
    if (!allTools || allTools.length === 0) {
      logger.warn('[Discord] No tools found in the registry to process for dynamic commands.');
      return [];
    }
    logger.info(`[Discord] Found ${allTools.length} total tools from ToolRegistry.`);

    const commandableTools = allTools.reduce((acc, tool) => {
      if (!tool || !tool.toolId || !tool.displayName) { 
        return acc;
      }
      if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Object.keys(tool.inputSchema).length === 0) {
        logger.warn(`[Discord Filter] Tool '${tool.displayName}' (ID: ${tool.toolId}) has no valid or empty inputSchema. Skipping.`);
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
        tool.metadata.discordHandlerType = handlerType;
        tool.metadata.discordPromptInputKey = textInputKey;
        tool.metadata.discordImageInputKey = imageInputKey;
        tool.metadata.discordVideoInputKey = videoInputKey;
        acc.push(tool);
      } else {
        logger.warn(`[Discord Filter] Tool '${tool.displayName}' (ID: ${tool.toolId}) could not be classified for a Discord handler. Skipping.`);
      }
      return acc;
    }, []);

    logger.info(`[Discord] Found ${commandableTools.length} tools classified for dynamic command registration.`);

    if (commandableTools.length === 0) {
      logger.info('[Discord] No suitable tools found to register as dynamic commands after classification.');
      return [];
    }

    const registeredCommandsList = [];

    for (const tool of commandableTools) {
      if (disabledFeatures.cook && (tool.displayName.toLowerCase().includes('cook') || tool.toolId?.toLowerCase?.().includes('cook'))) {
        logger.info(`[Discord] Skipping dynamic command for tool '${tool.displayName}' due to cook feature toggle.`);
        continue;
      }
      const commandName = sanitizeCommandName(tool.displayName);
      if (!commandName) {
        logger.warn(`[Discord] Skipping tool with invalid or empty sanitized name: ${tool.displayName} (ID: ${tool.toolId})`);
        continue;
      }

      // Build Discord slash command options
      const commandOptions = [];
      
      // Add text/prompt option if available
      if (tool.metadata.discordPromptInputKey) {
        const promptDesc = tool.description 
          ? (tool.description.substring(0, 100) || 'Text input for this tool') 
          : 'Text input for this tool';
        commandOptions.push({
          name: 'prompt',
          description: promptDesc.length > 100 ? promptDesc.substring(0, 97) + '...' : promptDesc,
          type: 3, // STRING
          required: false // Make it optional since user might provide it later
        });
      }
      
      // Add image attachment option if available
      if (tool.metadata.discordImageInputKey) {
        commandOptions.push({
          name: 'image',
          description: 'Image attachment for this tool',
          type: 11, // ATTACHMENT
          required: false
        });
      }
      
      // Add video attachment option if available
      if (tool.metadata.discordVideoInputKey) {
        commandOptions.push({
          name: 'video',
          description: 'Video attachment for this tool',
          type: 11, // ATTACHMENT
          required: false
        });
      }

      // The handler is now a standalone async function for Discord interactions.
      const commandHandler = async (client, interaction, dependencies) => {
        const { logger } = dependencies;
        const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
        if (!apiClient) {
            throw new Error('[Discord dynamicCommands] internalApiClient dependency missing');
        }

        // Acknowledge interaction immediately (Discord requires response within 3 seconds)
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 }); // Ephemeral
        }

        let masterAccountId;
        let initiatingEventId;

        try {
          // Step 1: Find or create user to get masterAccountId
          const userResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
            platform: 'discord',
            platformId: interaction.user.id.toString(),
            platformContext: {
              username: interaction.user.username,
              discriminator: interaction.user.discriminator,
              globalName: interaction.user.globalName,
            },
          });
          masterAccountId = userResponse.data.masterAccountId;

          // Step 2: Create the initiating event record
          const eventResponse = await apiClient.post('/internal/v1/data/events', {
            masterAccountId,
            eventType: 'command_used',
            sourcePlatform: 'discord',
            eventData: {
              command: commandName,
              toolId: tool.toolId,
            }
          });
          initiatingEventId = eventResponse.data._id;

        } catch (err) {
            const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
            logger.error(`[Discord EXEC /${commandName}] An error occurred during initial record creation: ${errorMessage}`, { stack: err.stack });
            await interaction.editReply({ 
              content: 'An error occurred while preparing your request. Please try again.',
              embeds: []
            });
            return;
        }

        try {
            const textInputKey = tool.metadata.discordPromptInputKey;
            const imageInputKey = tool.metadata.discordImageInputKey;
            const videoInputKey = tool.metadata.discordVideoInputKey;

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
                    logger.warn(`[Discord EXEC /${commandName}] Could not fetch user preferences for '${tool.displayName}': ${error.message}`);
                }
            }

            // 2. Build inputs payload, prioritizing command inputs over user preferences
            let inputs = { ...userPreferences };
            
            // Extract prompt from interaction options
            if (textInputKey) {
              const promptOption = interaction.options?.getString('prompt');
              if (promptOption) {
                inputs[textInputKey] = promptOption.trim();
              }
            }

            // Handle image inputs from Discord attachments
            if (imageInputKey) {
              // First check for explicit image attachment in command options
              const imageAttachment = interaction.options?.getAttachment('image');
              if (imageAttachment && imageAttachment.contentType?.startsWith('image/')) {
                inputs[imageInputKey] = imageAttachment.url;
                logger.info(`[Discord EXEC /${commandName}] Using explicit image attachment: ${imageAttachment.url}`);
              } else {
                // If no explicit attachment, check if user replied to a message with an image
                // This checks recent messages to find if the user replied to a message with an image
                logger.info(`[Discord EXEC /${commandName}] No explicit image attachment, checking for replied message...`);
                const repliedFileUrl = await getDiscordFileUrl(interaction, client);
                if (repliedFileUrl) {
                  // Check if it's an image by checking the URL or making a HEAD request
                  // For now, we'll accept any URL from getDiscordFileUrl as it already filters for images/videos
                  // The function returns URLs from image attachments or image embeds
                  inputs[imageInputKey] = repliedFileUrl;
                  logger.info(`[Discord EXEC /${commandName}] ✅ Extracted image from replied message: ${repliedFileUrl}`);
                } else {
                  logger.info(`[Discord EXEC /${commandName}] No image found in replied messages`);
                }
              }
            }

            // Handle video inputs from Discord attachments
            if (videoInputKey) {
              // First check for explicit video attachment in command options
              const videoAttachment = interaction.options?.getAttachment('video');
              if (videoAttachment && (videoAttachment.contentType?.startsWith('video/') || videoAttachment.contentType?.startsWith('application/'))) {
                inputs[videoInputKey] = videoAttachment.url;
              } else if (!inputs[imageInputKey]) {
                // Only check for video if we didn't already use the image
                // Check if user replied to a message with a video
                const repliedFileUrl = await getDiscordFileUrl(interaction, client);
                if (repliedFileUrl) {
                  // getDiscordFileUrl can return videos too, but we need to distinguish
                  // For now, if imageInputKey wasn't set, we can use this for video
                  // In practice, getDiscordFileUrl prioritizes images, so this is a fallback
                  inputs[videoInputKey] = repliedFileUrl;
                  logger.info(`[Discord EXEC /${commandName}] Extracted video from replied message: ${repliedFileUrl}`);
                }
              }
            }

            // Evaluate all required fields
            const missingRequiredKeys = [];
            for (const [key, def] of Object.entries(tool.inputSchema)) {
              if (def.required && !inputs[key]) {
                missingRequiredKeys.push(key);
              }
            }

            // For Discord, we'll use a follow-up message to collect missing inputs
            // This is simpler than the Telegram InputCollector pattern
            if (missingRequiredKeys.length > 0) {
              const missingFields = missingRequiredKeys.map(key => {
                const field = tool.inputSchema[key];
                const fieldType = field?.type?.toLowerCase() || 'unknown';
                return `- ${key} (${fieldType})`;
              }).join('\n');
              
              await interaction.editReply({
                content: `❌ **Missing Required Inputs**\n\nThis tool requires the following inputs:\n${missingFields}\n\nPlease use the command again with all required inputs, or use \`/settings\` to configure default values.`,
                embeds: []
              });
              return;
            }

            logger.info(`[Discord EXEC /${commandName}] Final inputs for submission: ${JSON.stringify(inputs)}`);
            
            // 3. Construct the payload for the new centralized execution endpoint
            const executionPayload = {
              toolId: tool.toolId,
              inputs: inputs,
              user: {
                masterAccountId: masterAccountId,
                platform: 'discord',
                platformId: interaction.user.id.toString(),
                platformContext: {
                  username: interaction.user.username,
                  discriminator: interaction.user.discriminator,
                  globalName: interaction.user.globalName,
                  channelId: interaction.channel?.id,
                  guildId: interaction.guild?.id,
                },
              },
              eventId: initiatingEventId,
              metadata: {
                platform: 'discord',
                // Pass notification context for the dispatcher to use upon completion
                notificationContext: {
                  channelId: interaction.channel?.id,
                  messageId: interaction.message?.id, // Store message ID if available (for follow-ups)
                  userId: interaction.user.id.toString(),
                  interactionId: interaction.id,
                }
              }
            };

            // 4. Execute via central ExecutionClient (wraps internal endpoint)
            const execRes = await apiClient.post('/internal/v1/data/execute', executionPayload);
            const execResult = execRes.data || {};

            if (execResult.status === 'completed' && execResult.generationId) {
              // Delivery will arrive via notifier; just acknowledge.
              await interaction.editReply({
                content: '✅ Task completed! Results will be delivered shortly.',
                embeds: []
              });
              return;
            }

            // Non-immediate tools – respond with a quick acknowledgement
            logger.info(`[Discord EXEC /${commandName}] Job submitted via execution service. Gen ID: ${execResult.generationId}`);
            await interaction.editReply({
              content: '✅ Task submitted! You will be notified when it completes.',
              embeds: []
            });

        } catch (err) {
            let userMessage = 'Sorry, something went wrong while starting the task.';
            // Provide more specific feedback for common credit-related issues
            if (err instanceof ExecutionError && err.payload && err.payload.error) {
              const { code, message } = err.payload.error;
              switch (code) {
                case 'INSUFFICIENT_FUNDS':
                  userMessage = 'You do not have enough points to run this. Purchase more with `/buypoints` or view your balance with `/account`.';
                  break;
                case 'WALLET_NOT_FOUND':
                  userMessage = 'You need to connect a wallet before running this. Link your wallet using `/account`, then purchase points with `/buypoints`.';
                  break;
                default:
                  userMessage = message || userMessage;
              }
            }

            const errorLog = err.payload ? JSON.stringify(err.payload.error || err.payload) : err.message;
            logger.error(`[Discord EXEC /${commandName}] Job submission error: ${errorLog}`, { stack: err.stack });

            await interaction.editReply({
              content: userMessage,
              embeds: []
            });
        }
      };

      // Register with the registry
      commandRegistry.register(commandName, commandHandler);

      // Discord limits: command description max 100 chars, option description max 100 chars
      const rawDesc = tool.description?.split('\n')[0] || `Runs the ${tool.displayName} tool.`;
      const trimmedDesc = rawDesc.length > 100 ? rawDesc.slice(0, 97) + '...' : rawDesc;
      
      // Ensure all option descriptions are also within limits
      const validatedOptions = commandOptions.map(opt => ({
        ...opt,
        description: opt.description && opt.description.length > 100 
          ? opt.description.substring(0, 97) + '...' 
          : (opt.description || '')
      }));
      
      registeredCommandsList.push({
        name: commandName,
        description: trimmedDesc,
        type: 1, // CHAT_INPUT
        options: validatedOptions
      });
    }

    logger.info(`[Discord] Successfully registered ${registeredCommandsList.length} dynamic commands in the registry.`);
    
    // Note: Commands are NOT registered with Discord API here.
    // The caller (bot.js) will merge these with static commands and register them all together.
    
    return registeredCommandsList;

  } catch (error) {
    logger.error('[Discord] A critical error occurred during dynamic command setup:', error);
    return []; // Return empty array on critical failure
  }
}

module.exports = {
  setupDynamicCommands,
  CommandRegistry
};

