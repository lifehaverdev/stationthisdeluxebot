const { sanitizeCommandName } = require('../../utils/stringUtils');
const internalApiClient = require('./utils/internalApiClient'); // Import the API client

async function setupDynamicCommands(bot, services) {
  const workflowsService = services.workflows;
  const comfyuiService = services.comfyui;
  const logger = services.logger || console;

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

    const allWorkflows = await workflowsService.getWorkflows();
    
    if (!allWorkflows || allWorkflows.length === 0) {
      logger.warn('[Telegram] No workflows found to process for dynamic commands.');
      return;
    }
    logger.info(`[Telegram] Found ${allWorkflows.length} total workflows.`);

    // Filter for text-only workflows (must have input_prompt, no input_image)
    // Also ensure workflow.name and workflow.id exist.
    const textOnlyWorkflows = allWorkflows.filter(workflow => {
      if (!workflow || !workflow.name || !workflow.id) {
        // logger.warn(`[Telegram Filter] Skipping workflow due to missing name or id: ${JSON.stringify(workflow)}`); // Keep if still useful, or remove for cleaner logs
        return false;
      }
      const inputs = workflow.inputs || {};
      // Removed: logger.info(`[Telegram Filter] Evaluating workflow: '${workflow.name}', Inputs: ${JSON.stringify(inputs, null, 2)}`);

      let hasTextPrompt = false;
      let hasImageInput = false;

      if (Array.isArray(inputs)) {
        // Handle cases where inputs is an array of strings (input names)
        hasTextPrompt = inputs.includes('input_prompt') || inputs.includes('prompt');
        hasImageInput = inputs.includes('input_image') || inputs.includes('image');
      } else if (typeof inputs === 'object' && inputs !== null) {
        // Handle cases where inputs is an object (as originally assumed)
        hasTextPrompt = Object.values(inputs).some(input => input && typeof input.type === 'string' && input.type.toUpperCase() === 'STRING' && (input.name === 'input_prompt' || input.name === 'prompt'));
        hasImageInput = Object.values(inputs).some(input => input && typeof input.type === 'string' && input.type.toUpperCase() === 'IMAGE' && (input.name === 'input_image' || input.name === 'image'));
      } else {
        logger.warn(`[Telegram Filter] Workflow '${workflow.name}' has unexpected inputs format: ${typeof inputs}`);
      }

      // Removed: logger.info(`[Telegram Filter] Workflow: '${workflow.name}', HasTextPrompt: ${hasTextPrompt}, HasImageInput: ${hasImageInput}`);
      
      return hasTextPrompt && !hasImageInput;
    });

    logger.info(`[Telegram] Found ${textOnlyWorkflows.length} text-only workflows to register as commands.`);

    if (textOnlyWorkflows.length === 0) {
      logger.info('[Telegram] No suitable text-only workflows found to register as dynamic commands.');
      return;
    }

    const registeredCommands = [];

    for (const workflow of textOnlyWorkflows) {
      const commandName = sanitizeCommandName(workflow.name);
      if (!commandName) {
        logger.warn(`[Telegram] Skipping workflow with invalid or empty sanitized name: ${workflow.name}`);
        continue;
      }

      logger.info(`[Telegram] Registering command: /${commandName} for workflow ID: ${workflow.id}`);

      bot.onText(new RegExp(`^/${commandName}(?:@\\w+)?(?:\\s+(.*))?$`, 'i'), async (msg, match) => {
        // --- Add extra debugging --- 
        logger.debug(`[Telegram EXEC /${commandName}] Handler triggered! msg.text: "${msg.text}"`);
        // ---------------------------
        const chatId = msg.chat.id;
        const telegramUserId = msg.from.id;
        const platformIdStr = telegramUserId.toString();
        const platform = 'telegram';
        const prompt = match && match[1] ? match[1].trim() : ''; 
        
        // --- Add extra debugging --- 
        logger.debug(`[Telegram EXEC /${commandName}] Parsed - User: ${platformIdStr}, Prompt: "${prompt}"`);
        // ---------------------------

        if (!prompt) {
          logger.info(`[Telegram EXEC /${commandName}] No prompt provided. Replying to user.`);
          bot.sendMessage(chatId, `Please provide a prompt after the command. Usage: /${commandName} your prompt here`, { reply_to_message_id: msg.message_id });
          return;
        }

        let masterAccountId;
        let sessionId;
        let eventId;
        let generationId;

        try {
          // --- Start: User/Session/Event Handling --- 
          // --- Add extra debugging --- 
          logger.debug(`[Telegram EXEC /${commandName}] Entering User/Session/Event Handling block...`);
          // ---------------------------
          // 1. Get Master Account ID
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: platformIdStr,
            platformContext: { firstName: msg.from.first_name, username: msg.from.username }
          });
          masterAccountId = findOrCreateResponse.data.masterAccountId;
          logger.debug(`[Telegram EXEC /${commandName}] Got MAID: ${masterAccountId}`); // More specific log

          // 2. Get/Create Session
          const activeSessionsResponse = await internalApiClient.get(`/users/${masterAccountId}/sessions/active?platform=${platform}`);
          if (activeSessionsResponse.data && activeSessionsResponse.data.length > 0) {
            sessionId = activeSessionsResponse.data[0]._id;
          } else {
            const newSessionResponse = await internalApiClient.post('/sessions', { masterAccountId, platform, userAgent: 'Telegram Bot Command' });
            sessionId = newSessionResponse.data._id;
            // Log session_started event (fire and forget, don't block command)
            internalApiClient.post('/events', { masterAccountId, sessionId, eventType: 'session_started', sourcePlatform: platform, eventData: { platform, startMethod: 'command_interaction' } })
              .catch(err => logger.error(`[Telegram EXEC /${commandName}] Failed to log session_started event: ${err.message}`));
          }
          logger.debug(`[Telegram EXEC /${commandName}] Got/Created SID: ${sessionId}`); // More specific log
          
          // 3. Log Command Triggered Event
          const eventPayload = {
              masterAccountId: masterAccountId,
              sessionId: sessionId,
              eventType: 'user_command_triggered',
              sourcePlatform: platform,
              eventData: { 
                command: `/${commandName}`,
                chatId: chatId,
                userId: platformIdStr,
                prompt: prompt // Log the prompt within the event
              }
          };
          const eventResponse = await internalApiClient.post('/events', eventPayload);
          eventId = eventResponse.data._id; // Capture eventId to link generation
          logger.debug(`[Telegram EXEC /${commandName}] Logged Event: ${eventId}`); // More specific log

          // 4. Update Session Activity (Fire and forget)
          internalApiClient.put(`/sessions/${sessionId}/activity`, {}).catch(err => logger.error(`[Telegram EXEC /${commandName}] Failed to update activity: ${err.message}`));
          logger.debug(`[Telegram EXEC /${commandName}] Activity update requested (async).`); // More specific log
          // --- End: User/Session/Event Handling ---

          // --- Start: Workflow Submission --- 
          logger.info(`[Telegram EXEC /${commandName}] Getting deployment info for workflow: ${workflow.name}...`);
          const deploymentIds = await workflowsService.getDeploymentIdsByName(workflow.name);
          // TODO: Fetch cost rate info here as well - DONE
          // const costRateInfo = { amount: 0.01, currency: "USD", unit: "minute" }; // Placeholder REMOVED

          if (!deploymentIds || deploymentIds.length === 0) {
             logger.error(`[Telegram EXEC /${commandName}] No deployment ID found for workflow: ${workflow.name}`);
             throw new Error(`No deployment ID found for workflow: ${workflow.name}`);
          }
          const deploymentId = deploymentIds[0]; // Use the first deployment ID
          logger.info(`[Telegram EXEC /${commandName}] Using Deployment ID: ${deploymentId}`);

          // Fetch the actual cost rate using the new service method
          let costRateInfo = null;
          try {
            logger.debug(`[Telegram EXEC /${commandName}] Fetching cost rate for deployment ${deploymentId}...`);
            costRateInfo = await comfyuiService.getCostRateForDeployment(deploymentId);
            if (!costRateInfo) {
              logger.warn(`[Telegram EXEC /${commandName}] Could not determine cost rate for deployment ${deploymentId}. Proceeding without cost info.`);
              // Decide if we should block execution or proceed without cost info
              // For now, proceeding but cost calculation will fail later.
              costRateInfo = { error: 'Rate unknown' }; // Indicate missing rate in metadata
            } else {
              logger.info(`[Telegram EXEC /${commandName}] Determined cost rate: ${JSON.stringify(costRateInfo)}`);
            }
          } catch (costError) {
            logger.error(`[Telegram EXEC /${commandName}] Error fetching cost rate for deployment ${deploymentId}: ${costError.message}. Proceeding without cost info.`);
            costRateInfo = { error: 'Rate lookup failed' }; // Indicate error in metadata
          }

          // 5. Log Generation Start
          const generationPayload = {
            masterAccountId: masterAccountId,
            sessionId: sessionId,
            initiatingEventId: eventId, // Link to the command event
            serviceName: workflow.name,
            requestPayload: { input_prompt: prompt },
            metadata: { 
              deploymentId: deploymentId, 
              costRate: costRateInfo, // Store ACTUAL cost rate (or error indicator)
              telegramChatId: chatId, // Store chat ID for potential webhook responses
              telegramUserId: platformIdStr
            }
          };
          logger.debug(`[Telegram EXEC /${commandName}] Logging generation start...`);
          const generationResponse = await internalApiClient.post('/generations', generationPayload);
          generationId = generationResponse.data._id;
          logger.info(`[Telegram EXEC /${commandName}] Generation logged: ${generationId}`);

          // 6. Submit to ComfyUI
          const inputs = { input_prompt: prompt }; 
          logger.info(`[Telegram EXEC /${commandName}] Submitting to ComfyUI: DeploymentID=${deploymentId}, GenID=${generationId}...`);
          const submissionResult = await comfyuiService.submitRequest({
            deploymentId: deploymentId,
            inputs: inputs,
            workflowName: workflow.name
          });

          // Handle potential string or object response for run_id
          const run_id = (typeof submissionResult === 'string') ? submissionResult : submissionResult?.run_id;

          if (run_id) {
            logger.info(`[Telegram EXEC /${commandName}] ComfyUI submission successful. Run ID: ${run_id}. Linking to GenID: ${generationId}...`);
            // 7. Link run_id to Generation Record
            try {
              // Attempt to merge run_id into existing metadata
              // NOTE: Assumes PUT /generations supports partial metadata updates or merging.
              // If it overwrites, we'd need to GET generation, merge metadata, then PUT.
              await internalApiClient.put(`/generations/${generationId}`, { 
                metadata: { run_id: run_id } 
              });
               logger.info(`[Telegram EXEC /${commandName}] Successfully linked RunID ${run_id} to Generation ${generationId}`);
            } catch (linkError) {
              logger.error(`[Telegram EXEC /${commandName}] Failed to link RunID ${run_id} to Generation ${generationId}: ${linkError.message}`);
              // Continue to notify user, but log the linking failure
            }
            await bot.sendMessage(chatId, `Your request for '${workflow.name}' is running! Ref: ${generationId}`, { reply_to_message_id: msg.message_id }); // Inform user with Generation ID

          } else { // Handle ComfyUI submission error
            const errorMessage = submissionResult?.error ? (typeof submissionResult.error === 'string' ? submissionResult.error : submissionResult.error.message) : 'Unknown error during ComfyUI submission';
            logger.error(`[Telegram EXEC /${commandName}] ComfyUI submission failed for GenID ${generationId}: ${errorMessage}`);
            // Optionally update Generation record status to failed here via PUT /generations
            await internalApiClient.put(`/generations/${generationId}`, { status: 'failed', statusReason: `ComfyUI submission failed: ${errorMessage}` }).catch(e => logger.error("Failed to update generation status to failed", e));
            throw new Error(`ComfyUI submission failed: ${errorMessage}`); // Throw to trigger generic error message to user
          }
          // --- End: Workflow Submission --- 

        } catch (error) {
          logger.error(`[Telegram EXEC /${commandName}] Error during execution (MAID: ${masterAccountId}, SID: ${sessionId}, GenID: ${generationId}):`, error.response ? error.response.data : error.message, error.stack);
          // Send generic error message
          await bot.sendMessage(chatId, `Sorry, an unexpected error occurred while processing '/${commandName}'. Ref: ${generationId || 'N/A'}`, { reply_to_message_id: msg.message_id });
        }
        registeredCommands.push({ command: commandName, description: `Run ${workflow.name}` });
      });
    }

    // Update Telegram bot commands list if any commands were registered
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
    // Do not re-throw here if you want the bot to attempt to continue running with static commands
  }

  // ---- Add /noemainfome command ----
  try {
    logger.info('[Telegram] Registering command: /noemainfome');
    bot.onText(new RegExp(`^/noemainfome(?:@\w+)?(?:\s+([\w-]+))?`, 'i'), async (msg, match) => {
      const chatId = msg.chat.id;
      const requesterTelegramId = msg.from.id.toString();
      // Use provided ID if present and valid, otherwise default to requester's ID
      const targetTelegramId = match && match[1] && /^[\d]+$/.test(match[1].trim()) ? match[1].trim() : requesterTelegramId;

      logger.info(`[Telegram EXEC /noemainfome] Handler triggered. Requester: ${requesterTelegramId}, Target Platform ID: ${targetTelegramId}`);

      try {
        // Replace DB call with Internal API call
        logger.debug(`[Telegram EXEC /noemainfome] Fetching user core data via API for platform ID: ${targetTelegramId}...`);
        const response = await internalApiClient.get(`/users/by-platform/telegram/${targetTelegramId}`);
        const userCoreDoc = response.data; // API returns the document directly on success

        // No need to check if userCoreDoc exists here, as a 404 error would be thrown by axios if not found
        logger.info(`[Telegram EXEC /noemainfome] UserCore Document Found via API for ${targetTelegramId}`);
        
        // Sanitize and pretty print the JSON
        let messageText = 'UserCore Document Found:\n```json\n' +
                         JSON.stringify(userCoreDoc, (key, value) => {
                           if (value && value._bsontype === 'ObjectId') return value.toString();
                           if (value && value.$numberDecimal) return parseFloat(value.$numberDecimal); // Nicer display for decimals
                           return value;
                         }, 2) +
                         '\n```';
        if (messageText.length > 4096) {
          messageText = messageText.substring(0, 4090) + '\n... (truncated)';
        }
        // Use MarkdownV2 carefully, ensure no reserved characters are unescaped in the JSON string itself
        // For simplicity, consider removing parse_mode or using HTML if MarkdownV2 causes issues with JSON content.
        await bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' }); // Changed to Markdown for less strict parsing

      } catch (apiError) {
        if (apiError.response && apiError.response.status === 404) {
          logger.info(`[Telegram EXEC /noemainfome] No UserCore document found via API for Telegram User ID: ${targetTelegramId}`);
          await bot.sendMessage(chatId, `No Noema userCore data found for Telegram ID: ${targetTelegramId}.`, { reply_to_message_id: msg.message_id });
        } else {
          // Log the more detailed axios error
          logger.error(`[Telegram EXEC /noemainfome] Error fetching user data via API for ${targetTelegramId}:`, apiError.response ? apiError.response.data : apiError.message);
          await bot.sendMessage(chatId, `Sorry, an API error occurred while fetching user data for ${targetTelegramId}.`, { reply_to_message_id: msg.message_id });
        }
      }
    });
    // Add to the list of commands for /help
    const commandToAdd = { command: 'noemainfome', description: 'Fetches your Noema user core data. Admins can specify another Telegram ID.' };
    // We'll add this to the bot's command list later along with other dynamic commands

  } catch (error) {
    logger.error('[Telegram] Error setting up /noemainfome command:', error);
  }
  // ---- End of /noemainfome command ----
}

module.exports = { setupDynamicCommands };