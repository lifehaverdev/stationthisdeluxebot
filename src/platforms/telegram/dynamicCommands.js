const { sanitizeCommandName } = require('../../utils/stringUtils');

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

      bot.onText(new RegExp(`^/${commandName}(?:@\\w+)?\\b(.*)`, 'i'), async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        
        // Log the received message text and the full match object for debugging
        logger.info(`[Telegram EXEC /${commandName}] Raw msg.text: "${msg.text}"`);
        logger.info(`[Telegram EXEC /${commandName}] Full match array: ${JSON.stringify(match)}`);

        const prompt = match && match[1] ? match[1].trim() : ''; // Ensure match itself is not null

        logger.info(`[Telegram EXEC /${commandName}] Handler triggered. User: ${userId}, Prompt: "${prompt}"`);

        if (!prompt) {
          logger.info(`[Telegram EXEC /${commandName}] No prompt. Replying to user.`);
          bot.sendMessage(chatId, `Please provide a prompt after the command. Usage: /${commandName} your prompt here`, { reply_to_message_id: msg.message_id });
          return;
        }

        try {
          logger.info(`[Telegram EXEC /${commandName}] Getting deployment IDs for workflow: ${workflow.name}`);
          const deploymentIds = await workflowsService.getDeploymentIdsByName(workflow.name);
          logger.info(`[Telegram EXEC /${commandName}] Deployment IDs: ${JSON.stringify(deploymentIds)}`);

          if (!deploymentIds || deploymentIds.length === 0) {
            logger.error(`[Telegram EXEC /${commandName}] No deployment ID found for workflow: ${workflow.name}`);
            bot.sendMessage(chatId, `Sorry, I couldn't find a deployment for the workflow '${workflow.name}'.`, { reply_to_message_id: msg.message_id });
            return;
          }
          const deploymentId = deploymentIds[0];
          logger.info(`[Telegram EXEC /${commandName}] Using Deployment ID: ${deploymentId}`);

          const inputs = { input_prompt: prompt }; 

          logger.info(`[Telegram EXEC /${commandName}] Submitting to ComfyUI. Workflow: '${workflow.name}', DeploymentID: ${deploymentId}, Inputs: ${JSON.stringify(inputs)}`);

          const submissionResult = await comfyuiService.submitRequest({
            deploymentId: deploymentId,
            inputs: inputs,
            workflowName: workflow.name
          });
          logger.info(`[Telegram EXEC /${commandName}] Submission result: ${JSON.stringify(submissionResult)}`);

          // Handle if submissionResult is a string (run_id) or an object with run_id/error
          if (typeof submissionResult === 'string' && submissionResult.length > 0) {
            const runId = submissionResult; // It's the run_id itself
            logger.info(`[Telegram EXEC /${commandName}] Workflow '${workflow.name}' submitted successfully. Run ID: ${runId}`);
            bot.sendMessage(chatId, `Your request for '${workflow.name}' has been queued! Run ID: ${runId}`, { reply_to_message_id: msg.message_id });
          } else if (submissionResult && submissionResult.run_id) { // It's an object with a run_id property
            logger.info(`[Telegram EXEC /${commandName}] Workflow '${workflow.name}' submitted successfully. Run ID: ${submissionResult.run_id}`);
            bot.sendMessage(chatId, `Your request for '${workflow.name}' has been queued! Run ID: ${submissionResult.run_id}`, { reply_to_message_id: msg.message_id });
          } else if (submissionResult && submissionResult.error) { // It's an object with an error property
            logger.error(`[Telegram EXEC /${commandName}] Error submitting workflow '${workflow.name}':`, submissionResult.error);
            const errorMessage = typeof submissionResult.error === 'string' ? submissionResult.error : (submissionResult.error.message || 'Unknown error from service');
            bot.sendMessage(chatId, `Sorry, there was an issue submitting your request for '${workflow.name}'. ${errorMessage}`, { reply_to_message_id: msg.message_id });
          } else {
            logger.error(`[Telegram EXEC /${commandName}] Failed to submit workflow '${workflow.name}'. Unexpected Result:`, submissionResult);
            bot.sendMessage(chatId, `Sorry, there was an issue submitting your request for '${workflow.name}'. Unexpected result from service.`, { reply_to_message_id: msg.message_id });
          }

        } catch (error) {
          logger.error(`[Telegram] Error executing workflow /${commandName} (Workflow ID: ${workflow.id}):`, error);
          bot.sendMessage(chatId, `Sorry, an unexpected error occurred while processing your request for '${workflow.name}'.`, { reply_to_message_id: msg.message_id });
        }
      });
      registeredCommands.push({ command: commandName, description: `Run ${workflow.name}` });
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
}

module.exports = { setupDynamicCommands };