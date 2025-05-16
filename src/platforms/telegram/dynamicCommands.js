const { sanitizeCommandName } = require('../../utils/stringUtils');
const internalApiClient = require('./utils/internalApiClient'); // Import the API client

async function getTelegramFileUrl(bot, message) {
  let fileId;
  const targetMessage = message.reply_to_message || message;

  if (targetMessage.photo) {
    fileId = targetMessage.photo[targetMessage.photo.length - 1].file_id;
  } else if (targetMessage.document && targetMessage.document.mime_type && targetMessage.document.mime_type.startsWith('image/')) {
    // Also allow documents if they are images
    fileId = targetMessage.document.file_id;
  } else {
    return null;
  }

  try {
    // Assuming bot.telegram.getFileLink() or equivalent exists and returns a direct URL string
    // Or, if we need to construct it manually using bot.getFile():
    const fileInfo = await bot.getFile(fileId);
    if (fileInfo.file_path) {
      // Construct the URL. Ensure process.env.TELEGRAM_BOT_TOKEN is accessible here
      // This might require passing the token or having it in a shared config.
      // For now, assuming direct access or a pre-configured bot instance.
      // This is a common way to construct it:
      return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    }
    return null; // Fallback if file_path isn't available
  } catch (error) {
    console.error("[Telegram] Error fetching file URL:", error);
    return null;
  }
}

async function setupDynamicCommands(bot, services) {
  const workflowsService = services.workflows;
  const comfyuiService = services.comfyui;
  const logger = services.logger || console;
  const toolRegistry = services.toolRegistry; // Assuming toolRegistry is added to services

  logger.info('[Telegram] Setting up dynamic commands...');

  try {
    if (!workflowsService || typeof workflowsService.getWorkflows !== 'function') {
      logger.warn('[Telegram] WorkflowsService not available or getWorkflows method is missing. Skipping dynamic command generation.');
      return;
    }
    if (!comfyuiService || typeof comfyuiService.submitRequest !== 'function') {
      logger.warn('[Telegram] ComfyUIService not available or submitRequest method is missing. Skipping dynamic command generation.');
      return;
    }
    if (!toolRegistry) {
      logger.warn('[Telegram] ToolRegistry not available in services. Skipping dynamic command generation.');
      return;
    }

    const allTools = await workflowsService.getWorkflows();
    
    if (!allTools || allTools.length === 0) {
      logger.warn('[Telegram] No tools found to process for dynamic commands.');
      return;
    }
    logger.info(`[Telegram] Found ${allTools.length} total tools from WorkflowsService.`);

    // Refactored tool filtering and classification
    const commandableTools = allTools.reduce((acc, tool) => {
      if (!tool || !tool.toolId || !tool.displayName || tool.service !== 'comfyui') {
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

        const fieldType = inputField.type || 'unknown'; // Get type, default to 'unknown'
        const fieldTypeLower = typeof fieldType === 'string' ? fieldType.toLowerCase() : 'unknown';
        
        const isPromptCandidateByName = (inputName === 'input_prompt' || inputName === 'prompt' || inputName.toLowerCase().includes('text'));
        const isImageCandidateByName = (inputName === 'input_image' || inputName === 'image' || inputName.toLowerCase().includes('image'));
        const isVideoCandidateByName = (inputName === 'input_video' || inputName === 'video' || inputName.toLowerCase().includes('video'));
        
        if ((fieldTypeLower === 'string' || fieldTypeLower === 'text') && isPromptCandidateByName) {
          if (!textInputKey) textInputKey = inputName; // Prefer specific names first
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
      
      // Fallback: if no specifically named prompt, and primaryHint is 'text', take the first string input.
      if (!textInputKey && primaryHint === 'text') {
        logger.info(`[Telegram Filter Debug] Tool '${tool.displayName}' (ID: ${tool.toolId}) is text-primary but no specific prompt key found yet. Scanning all string inputs...`);
        for (const inputName in tool.inputSchema) {
          const inputField = tool.inputSchema[inputName];
          const currentFieldTypeLower = inputField?.type?.toLowerCase?.();
          if (inputField && (currentFieldTypeLower === 'string' || currentFieldTypeLower === 'text')) {
            logger.info(`[Telegram Filter Debug]   Found potential string/text input: '${inputName}' (type: ${inputField.type}). Assigning as textInputKey.`);
            textInputKey = inputName;
            if (inputField.required) hasRequiredText = true;
            break; 
          } else if (inputField) {
            logger.info(`[Telegram Filter Debug]   Skipping input '${inputName}' (type: ${inputField.type || 'undefined'}) during text fallback.`);
          }
        }
      }

      // Fallback for image/video if not specifically named (less critical if primaryHint guides us)
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
        // Text is primary, but image/video might be optional or also accepted.
        // For Telegram, if an image/video is *required*, it changes the interaction model.
        if (hasRequiredImage) handlerType = 'image_required_with_text';
        else if (hasRequiredVideo) handlerType = 'video_required_with_text';
        else handlerType = 'text_primary_media_optional'; // User provides text, can optionally reply to media
      } else if (primaryHint === 'image' && imageInputKey) {
        handlerType = textInputKey ? 'image_primary_with_text' : 'image_only';
      } else if (primaryHint === 'video' && videoInputKey) {
        handlerType = textInputKey ? 'video_primary_with_text' : 'video_only';
      } else if (textInputKey && !imageInputKey && !videoInputKey) { // Fallback if no clear primaryHint but has text
         handlerType = 'text_only';
      } else if (imageInputKey && !textInputKey && !videoInputKey) { // Fallback for image only
         handlerType = 'image_only';
      } else if (videoInputKey && !textInputKey && !imageInputKey) { // Fallback for video only
         handlerType = 'video_only';
      }

      if (handlerType) {
        tool.metadata.telegramHandlerType = handlerType;
        tool.metadata.telegramPromptInputKey = textInputKey;
        tool.metadata.telegramImageInputKey = imageInputKey;
        tool.metadata.telegramVideoInputKey = videoInputKey;
        logger.info(`[Telegram Filter] Classified tool '${tool.displayName}' (ID: ${tool.toolId}) as '${handlerType}'. PromptKey: ${textInputKey}, ImgKey: ${imageInputKey}, VidKey: ${videoInputKey}`);
        acc.push(tool);
      } else {
        const inputKeys = Object.keys(tool.inputSchema || {}).join(', ');
        let typeDebug = '';
        if (primaryHint === 'text' && !textInputKey) {
            Object.entries(tool.inputSchema || {}).forEach(([key, val]) => {
                if (key === 'input_prompt' || key === 'prompt' || key.toLowerCase().includes('text')) {
                    typeDebug += ` Field '${key}' has type: ${val?.type || 'undefined'}.`;
                }
            });
        }
        logger.warn(`[Telegram Filter] Tool '${tool.displayName}' (ID: ${tool.toolId}) could not be classified for a Telegram handler. Skipping. PrimaryHint: ${primaryHint}, TextKey: ${textInputKey}, ImgKey: ${imageInputKey}, VidKey: ${videoInputKey}, ReqImg: ${hasRequiredImage}, ReqVid: ${hasRequiredVideo}, InputSchemaKeys: [${inputKeys}].${typeDebug}`);
      }
      return acc;
    }, []);

    logger.info(`[Telegram] Found ${commandableTools.length} tools classified for dynamic command registration.`);

    if (commandableTools.length === 0) {
      logger.info('[Telegram] No suitable tools found to register as dynamic commands after classification.');
      return;
    }

    const registeredCommands = [];

    for (const tool of commandableTools) {
      const commandName = sanitizeCommandName(tool.displayName);
      if (!commandName) {
        logger.warn(`[Telegram] Skipping tool with invalid or empty sanitized name: ${tool.displayName} (ID: ${tool.toolId})`);
        continue;
      }

      logger.info(`[Telegram] Registering command: /${commandName} for tool ID: ${tool.toolId}`);
      registeredCommands.push({ command: commandName, description: `Run ${tool.displayName}` });

      bot.onText(new RegExp(`^/${commandName}(?:@\\w+)?(?:\\s+(.*))?$`, 'i'), async (msg, match) => {
        const chatId = msg.chat.id;
        const telegramUserId = msg.from.id;
        const platformIdStr = telegramUserId.toString();
        const platform = 'telegram';
        const promptText = match && match[1] ? match[1].trim() : '';
        
        const currentTool = tool;
        const currentToolId = currentTool.toolId;
        const currentDisplayName = currentTool.displayName;
        const handlerType = currentTool.metadata?.telegramHandlerType;
        const currentPromptInputKey = currentTool.metadata?.telegramPromptInputKey;
        const currentImageInputKey = currentTool.metadata?.telegramImageInputKey;
        const currentVideoInputKey = currentTool.metadata?.telegramVideoInputKey;

        let imageUrl = null;
        let videoUrl = null; // For future video handling

        // Prepare user inputs, starting with text
        const userInputsForTool = {};
        if (currentPromptInputKey && promptText) {
          userInputsForTool[currentPromptInputKey] = promptText;
        } else if (currentPromptInputKey && !promptText && !tool.inputSchema[currentPromptInputKey]?.required) {
          // Optional prompt, not provided.
        } else if (!currentPromptInputKey && promptText) {
            logger.warn(`[Telegram EXEC /${commandName}] Prompt text provided but no promptInputKey defined for tool ${currentToolId}. Ignoring prompt text.`);
        }

        // Handle image inputs
        if (handlerType === 'image_primary_with_text' || handlerType === 'image_only' || handlerType === 'image_required_with_text') {
          if (!msg.reply_to_message || (!msg.reply_to_message.photo && !(msg.reply_to_message.document && msg.reply_to_message.document.mime_type && msg.reply_to_message.document.mime_type.startsWith('image/')))) {
            bot.sendMessage(chatId, `The /${commandName} command requires you to reply to an image. Please send an image and then reply to it with the command.`, { reply_to_message_id: msg.message_id });
            return;
          }
          imageUrl = await getTelegramFileUrl(bot, msg); // msg here, as getTelegramFileUrl checks msg.reply_to_message
          if (!imageUrl) {
            logger.warn(`[Telegram EXEC /${commandName}] Could not retrieve image URL for replied message.`);
            bot.sendMessage(chatId, `Sorry, I couldn't retrieve the image from your replied message. Please try again.`, { reply_to_message_id: msg.message_id });
            return;
          }
          if (currentImageInputKey) {
            userInputsForTool[currentImageInputKey] = imageUrl;
            logger.info(`[Telegram EXEC /${commandName}] Using image URL: ${imageUrl} for input key: ${currentImageInputKey}`);
          } else {
            logger.warn(`[Telegram EXEC /${commandName}] Image provided but no imageInputKey defined for tool ${currentToolId}. Ignoring image.`);
          }
        }
        
        // Placeholder for other handler types that aren't text-only or primarily image-based
        // This ensures that if a tool is classified but doesn't match the image handling above,
        // and isn't text_only or text_primary_media_optional, it gives a coming soon message.
        else if (handlerType !== 'text_only' && handlerType !== 'text_primary_media_optional') {
            logger.warn(`[Telegram EXEC /${commandName}] Tool handler type '${handlerType}' not yet fully supported for command interaction. Tool: ${currentDisplayName}`);
            bot.sendMessage(chatId, `The /${commandName} command has a configuration not yet fully supported for direct text interaction (Type: ${handlerType}). Coming soon!`, { reply_to_message_id: msg.message_id });
            return;
        }

        if (currentPromptInputKey && !promptText && tool.inputSchema[currentPromptInputKey]?.required && !userInputsForTool[currentPromptInputKey]) {
          // Check if prompt is required and not already satisfied (e.g. by an image for an image_only tool if prompt was misconfigured as required)
          // This condition might need refinement based on how "required" interacts with multi-modal inputs.
          // For now, if a text prompt key exists and is required, and no text was given, ask for it.
          logger.info(`[Telegram EXEC /${commandName}] Required prompt not provided for key '${currentPromptInputKey}'. Replying to user.`);
          bot.sendMessage(chatId, `Please provide a prompt after the command. Usage: /${commandName} your prompt here`, { reply_to_message_id: msg.message_id });
          return;
        }

        let masterAccountId;
        let sessionId;
        let eventId;
        let generationId;

        try {
          logger.debug(`[Telegram EXEC /${commandName}] Entering User/Session/Event Handling block...`);
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: platformIdStr,
            platformContext: { firstName: msg.from.first_name, username: msg.from.username }
          });
          masterAccountId = findOrCreateResponse.data.masterAccountId;

          const activeSessionsResponse = await internalApiClient.get(`/users/${masterAccountId}/sessions/active?platform=${platform}`);
          if (activeSessionsResponse.data && activeSessionsResponse.data.length > 0) {
            sessionId = activeSessionsResponse.data[0]._id;
          } else {
            const newSessionResponse = await internalApiClient.post('/sessions', { masterAccountId, platform, userAgent: 'Telegram Bot Command' });
            sessionId = newSessionResponse.data._id;
            internalApiClient.post('/events', { masterAccountId, sessionId, eventType: 'session_started', sourcePlatform: platform, eventData: { platform, startMethod: 'command_interaction' } })
              .catch(err => logger.error(`[Telegram EXEC /${commandName}] Failed to log session_started event: ${err.message}`));
          }
          
          const eventPayload = {
              masterAccountId: masterAccountId,
              sessionId: sessionId,
              eventType: 'user_command_triggered',
              sourcePlatform: platform,
              eventData: { 
                command: `/${commandName}`,
                chatId: chatId,
                userId: platformIdStr,
                prompt: promptText,
                toolId: currentToolId
              }
          };
          const eventResponse = await internalApiClient.post('/events', eventPayload);
          eventId = eventResponse.data._id;
          internalApiClient.put(`/sessions/${sessionId}/activity`, {}).catch(err => logger.error(`[Telegram EXEC /${commandName}] Failed to update activity: ${err.message}`));
          logger.debug(`[Telegram EXEC /${commandName}] Activity update requested (async).`);
          logger.debug(`[Telegram EXEC /${commandName}] Got/Created SID: ${sessionId}`);
          logger.debug(`[Telegram EXEC /${commandName}] Logged Event: ${eventId}`);

          logger.info(`[Telegram EXEC /${commandName}] Preparing to run tool: ${currentDisplayName} (ID: ${currentToolId})...`);
          
          let deploymentId = tool.metadata?.deploymentId;
          if (deploymentId && deploymentId.startsWith('comfy-')) {
            deploymentId = deploymentId.substring(6);
          }

          if (!deploymentId) {
             logger.error(`[Telegram EXEC /${commandName}] No ComfyUI deployment_id found in metadata for tool: ${currentDisplayName} (ID: ${currentToolId})`);
             throw new Error(`Configuration error: Deployment ID not found for tool: ${currentDisplayName}`);
          }
          logger.info(`[Telegram EXEC /${commandName}] Using Deployment ID: ${deploymentId}`);

          let costRateInfo = null;
          try {
            logger.debug(`[Telegram EXEC /${commandName}] Fetching cost rate for deployment ${deploymentId}...`);
            costRateInfo = await comfyuiService.getCostRateForDeployment(deploymentId);
            if (!costRateInfo) {
              logger.warn(`[Telegram EXEC /${commandName}] Could not determine cost rate for deployment ${deploymentId}. Proceeding without cost info.`);
              costRateInfo = { error: 'Rate unknown' };
            } else {
              logger.info(`[Telegram EXEC /${commandName}] Determined cost rate: ${JSON.stringify(costRateInfo)}`);
            }
          } catch (costError) {
            logger.error(`[Telegram EXEC /${commandName}] Error fetching cost rate for deployment ${deploymentId}: ${costError.message}. Proceeding without cost info.`);
            costRateInfo = { error: 'Rate lookup failed' };
          }

          logger.debug(`[Telegram EXEC /${commandName}] User inputs for tool: ${JSON.stringify(userInputsForTool)}`);

          const preparedResult = await workflowsService.prepareToolRunPayload(currentToolId, userInputsForTool);
          if (!preparedResult) {
            logger.error(`[Telegram EXEC /${commandName}] prepareToolRunPayload failed for tool ${currentToolId}. Check WorkflowsService logs.`);
            throw new Error(`Failed to prepare payload for tool '${currentDisplayName}'.`);
          }
          const finalInputs = preparedResult;
          logger.debug(`[Telegram EXEC /${commandName}] Final inputs for ComfyUI: ${JSON.stringify(finalInputs)}`);

          const generationPayload = {
            masterAccountId: masterAccountId,
            sessionId: sessionId,
            initiatingEventId: eventId,
            serviceName: currentDisplayName,
            toolId: currentToolId,
            requestPayload: finalInputs,
            notificationPlatform: 'telegram',
            deliveryStatus: 'pending',
            metadata: { 
              deploymentId: deploymentId, 
              costRate: costRateInfo,
              notificationContext: {
                chatId: chatId,
                userId: platformIdStr,
                messageId: msg.message_id 
              }
            }
          };
          logger.debug(`[Telegram EXEC /${commandName}] Logging generation start with payload: ${JSON.stringify(generationPayload)}`);
          const generationResponse = await internalApiClient.post('/generations', generationPayload);
          generationId = generationResponse.data._id;
          logger.info(`[Telegram EXEC /${commandName}] Generation logged: ${generationId}`);

          logger.info(`[Telegram EXEC /${commandName}] Submitting to ComfyUI: DeploymentID=${deploymentId}, GenID=${generationId}...`);
          const submissionResult = await comfyuiService.submitRequest({
            deploymentId: deploymentId,
            inputs: finalInputs,
          });

          const run_id = (typeof submissionResult === 'string') ? submissionResult : submissionResult?.run_id;

          if (run_id) {
            logger.info(`[Telegram EXEC /${commandName}] ComfyUI submission successful. Run ID: ${run_id}. Linking to GenID: ${generationId}...`);
            await internalApiClient.put(`/generations/${generationId}`, { "metadata.run_id": run_id });
            await bot.sendMessage(chatId, `Your request for '${currentDisplayName}' is running! Ref: ${generationId}`, { reply_to_message_id: msg.message_id });
          } else { 
            const errorMessage = submissionResult?.error ? (typeof submissionResult.error === 'string' ? submissionResult.error : submissionResult.error.message) : 'Unknown error during ComfyUI submission';
            logger.error(`[Telegram EXEC /${commandName}] ComfyUI submission failed for GenID ${generationId}: ${errorMessage}`);
            await internalApiClient.put(`/generations/${generationId}`, { status: 'failed', statusReason: `ComfyUI submission failed: ${errorMessage}` }).catch(e => logger.error("Failed to update generation status to failed", e));
            throw new Error(`ComfyUI submission failed: ${errorMessage}`);
          }

        } catch (error) {
          logger.error(`[Telegram EXEC /${commandName}] Error during execution (MAID: ${masterAccountId}, SID: ${sessionId}, GenID: ${generationId}):`, error.response ? error.response.data : error.message, error.stack);
          await bot.sendMessage(chatId, `Sorry, an unexpected error occurred while processing '/${commandName}'. Ref: ${generationId || 'N/A'}`, { reply_to_message_id: msg.message_id });
        }
      });
    }

    if (registeredCommands.length > 0) {
      try {
        logger.info(`[Telegram Commands] Attempting to get existing bot commands.`);
        const existingCommands = await bot.getMyCommands();
        logger.info(`[Telegram Commands] Existing commands: ${JSON.stringify(existingCommands)}`);
        logger.info(`[Telegram Commands] Dynamically registered commands to add: ${JSON.stringify(registeredCommands)}`);

        const newCommandList = [...existingCommands, ...registeredCommands].reduce((acc, current) => {
            if (!acc.find(item => item.command === current.command)) {
                acc.push(current);
            }
            return acc;
        }, []);
        logger.info(`[Telegram Commands] New command list to set: ${JSON.stringify(newCommandList)}`);
        
        if (newCommandList.length > 0) { 
            await bot.setMyCommands(newCommandList);
            logger.info('[Telegram Commands] Successfully updated bot command list with dynamic workflow commands.');
        } else {
            logger.info('[Telegram Commands] New command list is empty after merge, or no dynamic commands registered. Skipping update.');
        }
      } catch (error) {
        logger.error('[Telegram Commands] Failed to update bot command list:', error);
      }
    } else {
        logger.info('[Telegram Commands] No dynamic commands were registered, skipping command list update.');
    }

    logger.info('[Telegram] Dynamic commands setup process completed.');

  } catch (error) {
    logger.error('[Telegram] Critical error during dynamic commands setup:', error);
  }

  try {
    logger.info('[Telegram] Registering command: /noemainfome');
    bot.onText(new RegExp(`^/noemainfome(?:@\w+)?(?:\s+([\w-]+))?`, 'i'), async (msg, match) => {
      const chatId = msg.chat.id;
      const requesterTelegramId = msg.from.id.toString();
      const targetTelegramId = match && match[1] && /^[\d]+$/.test(match[1].trim()) ? match[1].trim() : requesterTelegramId;

      logger.info(`[Telegram EXEC /noemainfome] Handler triggered. Requester: ${requesterTelegramId}, Target Platform ID: ${targetTelegramId}`);

      try {
        logger.debug(`[Telegram EXEC /noemainfome] Fetching user core data via API for platform ID: ${targetTelegramId}...`);
        const response = await internalApiClient.get(`/users/by-platform/telegram/${targetTelegramId}`);
        const userCoreDoc = response.data;

        logger.info(`[Telegram EXEC /noemainfome] UserCore Document Found via API for ${targetTelegramId}`);
        
        let messageText = 'UserCore Document Found:\n```json\n' +
                         JSON.stringify(userCoreDoc, (key, value) => {
                           if (value && value._bsontype === 'ObjectId') return value.toString();
                           if (value && value.$numberDecimal) return parseFloat(value.$numberDecimal);
                           return value;
                         }, 2) +
                         '\n```';
        if (messageText.length > 4096) {
          messageText = messageText.substring(0, 4090) + '\n... (truncated)';
        }
        await bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' });

      } catch (apiError) {
        if (apiError.response && apiError.response.status === 404) {
          logger.info(`[Telegram EXEC /noemainfome] No UserCore document found via API for Telegram User ID: ${targetTelegramId}`);
          await bot.sendMessage(chatId, `No Noema userCore data found for Telegram ID: ${targetTelegramId}.`, { reply_to_message_id: msg.message_id });
        } else {
          logger.error(`[Telegram EXEC /noemainfome] Error fetching user data via API for ${targetTelegramId}:`, apiError.response ? apiError.response.data : apiError.message);
          await bot.sendMessage(chatId, `Sorry, an API error occurred while fetching user data for ${targetTelegramId}.`, { reply_to_message_id: msg.message_id });
        }
      }
    });

  } catch (error) {
    logger.error('[Telegram] Error setting up /noemainfome command:', error);
  }
}

module.exports = { setupDynamicCommands };