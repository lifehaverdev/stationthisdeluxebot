/**
 * Make Command Integration
 * 
 * This module connects our new make command implementation
 * with the legacy Telegram bot system
 */

// Import feature flags system
const featureFlags = require('../../config/featureFlags');

// Import our adapter
const telegramAdapter = require('./adapters/commandAdapter');
const { makeTelegramAdapter } = require('./adapters/generationAdapter');

// Core dependencies from the legacy system required for integration
const { sendMessage, sendPhoto } = require('../../../utils/bot/utils');
const { setUserState, STATES } = require('../../../utils/bot/state');
const { enqueueTask } = require('../../../utils/bot/queue/queue');
const { lobby } = require('../../../utils/bot/bot');

/**
 * Replacement handler for the /make and /flux commands
 * 
 * @param {Object} message - Telegram message object
 * @returns {Promise<void>}
 */
async function handleMake(message) {
  console.log(`Handling /make command for user ${message.from.id}`);
  
  try {
    if (featureFlags.isEnabled('useNewMakeCommand')) {
      console.log('Using new implementation for make command');
      
      // Check if there's already a prompt in the message
      const hasPrompt = message.text.trim().length > 5; // more than "/make"
      
      if (hasPrompt) {
        // Extract prompt from message
        const prompt = message.text.substring(message.text.indexOf(' ') + 1).trim();
        
        // Execute the command through our adapter
        const response = await telegramAdapter.executeCommand('make', message, { prompt });
        
        // Send acknowledgment using the legacy system
        await sendMessage(message, `🖼 Generating image with prompt: "${prompt}"`, {
          parse_mode: 'Markdown'
        });
        
        console.log('Make command with prompt successfully handled with new implementation');
      } else {
        // No prompt provided, start the workflow
        const workflow = await telegramAdapter.executeWorkflow('make', message);
        
        // Set state using legacy system for compatibility
        setUserState(message, STATES.MAKEPROMPT);
        
        // Send prompt request using the legacy system
        await sendMessage(message, 'What would you like to generate?');
        
        console.log('Make workflow started with new implementation');
      }
    } else {
      console.log('Using legacy implementation for make command');
      
      // Import and call the legacy handler directly
      // Note: We do this inside the function to avoid circular dependencies
      const { handleFlux } = require('../../../utils/bot/handlers/iMake');
      await handleFlux(message);
    }
  } catch (error) {
    console.error('Error handling make command:', error);
    await sendMessage(message, '❌ An error occurred while processing your generation request');
  }
}

/**
 * Handle prompt input for the make workflow
 * 
 * @param {Object} message - Telegram message object
 * @returns {Promise<void>}
 */
async function handleMakePrompt(message) {
  console.log(`Handling make prompt for user ${message.from.id}`);
  
  try {
    if (featureFlags.isEnabled('useNewMakeCommand')) {
      console.log('Using new implementation for make prompt');
      
      // Get the prompt from the message
      const prompt = message.text.trim();
      
      // Continue the workflow
      const userId = message.from.id;
      
      // Get workflow ID from session
      const workflowId = lobby[userId]?.workflowId;
      
      if (workflowId) {
        // Continue existing workflow
        const result = await telegramAdapter.continueWorkflow('make', message, {
          input: prompt,
          workflowId
        });
        
        if (result.complete) {
          // Workflow is complete, generate image
          const response = await telegramAdapter.executeCommand('make', message, {
            prompt: result.data.prompt,
            settings: result.data.settings
          });
          
          // Send acknowledgment
          await sendMessage(message, `🖼 Generating image with prompt: "${prompt}"`, {
            parse_mode: 'Markdown'
          });
          
          // Reset state
          setUserState(message, STATES.IDLE);
        } else {
          // Handle next step in workflow
          // This could be settings configuration
          await sendMessage(message, result.currentStep.description, {
            reply_markup: makeTelegramAdapter.createSettingsKeyboard(result.currentStep)
          });
        }
      } else {
        // No workflow found, just generate with the prompt
        const response = await telegramAdapter.executeCommand('make', message, { prompt });
        
        // Send acknowledgment
        await sendMessage(message, `🖼 Generating image with prompt: "${prompt}"`, {
          parse_mode: 'Markdown'
        });
        
        // Reset state
        setUserState(message, STATES.IDLE);
      }
      
      console.log('Make prompt handled with new implementation');
    } else {
      console.log('Using legacy implementation for make prompt');
      
      // Import and call the legacy handler directly
      const { handleFluxPrompt } = require('../../../utils/bot/handlers/iMake');
      await handleFluxPrompt(message);
    }
  } catch (error) {
    console.error('Error handling make prompt:', error);
    await sendMessage(message, '❌ An error occurred while processing your prompt');
    
    // Reset state on error
    setUserState(message, STATES.IDLE);
  }
}

/**
 * Integrates the new make command with the legacy command registry
 * 
 * @param {Object} commandRegistry - The legacy command registry
 * @param {Object} stateHandlers - The legacy state handlers
 */
function integrateMakeCommand(commandRegistry, stateHandlers) {
  // Replace the /make and /flux commands in the registry
  commandRegistry['/make'] = {
    handler: handleMake,
    description: 'Generate an image with AI'
  };
  
  commandRegistry['/flux'] = {
    handler: handleMake,
    description: 'Generate an image with FLUX model'
  };
  
  // Replace the prompt handler in state handlers
  if (stateHandlers && stateHandlers[STATES.MAKEPROMPT]) {
    stateHandlers[STATES.MAKEPROMPT] = handleMakePrompt;
  }
  
  console.log('Make command integrated with new implementation');
}

module.exports = {
  handleMake,
  handleMakePrompt,
  integrateMakeCommand
}; 