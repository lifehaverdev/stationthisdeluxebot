/**
 * Telegram Workflow Adapter
 * 
 * Provides utilities for rendering workflow UI components in Telegram.
 * Handles the translation of platform-agnostic UI definitions to
 * Telegram-specific message formats.
 */

/**
 * Render a workflow step in Telegram format
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Telegram chat ID
 * @param {Object} step - WorkflowStep instance
 * @param {Object} workflowState - Current workflow state
 * @returns {Promise<Object>} The sent message
 */
async function renderStep(bot, chatId, step, workflowState) {
  if (!step || !step.ui) {
    throw new Error('Invalid step or missing UI configuration');
  }
  
  // Default message options
  const messageOptions = {
    parse_mode: 'HTML',
    reply_markup: undefined
  };
  
  // Basic message text
  let messageText = `<b>${step.name}</b>\n\n`;
  
  if (step.ui.text) {
    messageText += `${step.ui.text}\n\n`;
  }
  
  // Process template variables in text
  if (workflowState && workflowState.data) {
    Object.keys(workflowState.data).forEach(key => {
      const value = workflowState.data[key];
      messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });
  }
  
  // Render based on UI type
  switch (step.ui.type) {
    case 'text_input':
      // For text input, just send the prompt
      if (step.ui.placeholder) {
        messageText += `<i>${step.ui.placeholder}</i>\n`;
      }
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    case 'options':
      // For options, add inline keyboard with buttons
      const keyboard = [];
      const row = [];
      
      if (step.ui.options && Array.isArray(step.ui.options)) {
        step.ui.options.forEach(option => {
          row.push({
            text: option.label,
            callback_data: `wf_action:${workflowState.id}:${step.id}:selection:${option.value}`
          });
        });
        keyboard.push(row);
      }
      
      messageOptions.reply_markup = {
        inline_keyboard: keyboard
      };
      
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    case 'image_upload':
      // For image uploads, show a message with instructions
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    case 'caption_editor':
      // For caption editing
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    case 'progress':
      // For progress indicators
      if (workflowState.context && workflowState.context[step.ui.progressKey]) {
        const progress = workflowState.context[step.ui.progressKey];
        messageText += `Progress: ${progress}%\n`;
      }
      
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    case 'confirmation':
      // For confirmation steps
      const confirmKeyboard = [
        [
          {
            text: step.ui.confirmLabel || 'Confirm',
            callback_data: `wf_action:${workflowState.id}:${step.id}:confirm:true`
          },
          {
            text: step.ui.cancelLabel || 'Cancel',
            callback_data: `wf_action:${workflowState.id}:${step.id}:confirm:false`
          }
        ]
      ];
      
      messageOptions.reply_markup = {
        inline_keyboard: confirmKeyboard
      };
      
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    case 'result':
      // For results display
      return bot.sendMessage(chatId, messageText, messageOptions);
      
    default:
      // Default case, just show the message
      return bot.sendMessage(chatId, messageText, messageOptions);
  }
}

/**
 * Process a Telegram callback query for a workflow
 * @param {Object} bot - Telegram bot instance
 * @param {Object} callbackQuery - Telegram callback query
 * @param {Object} workflowState - Current workflow state
 * @returns {Promise<Object>} Processing result
 */
async function processCallbackQuery(bot, callbackQuery, workflowState) {
  if (!callbackQuery || !callbackQuery.data || !workflowState) {
    throw new Error('Invalid callback query or workflow state');
  }
  
  const data = callbackQuery.data;
  
  // Check if this is a workflow action
  if (!data.startsWith('wf_action:')) {
    return { handled: false };
  }
  
  // Parse the callback data (format: wf_action:workflowId:stepId:action:value)
  const parts = data.split(':');
  if (parts.length < 5) {
    return { handled: false };
  }
  
  const workflowId = parts[1];
  const stepId = parts[2];
  const action = parts[3];
  const value = parts[4];
  
  // Only process if the workflow ID matches
  if (workflowId !== workflowState.id) {
    return { handled: false };
  }
  
  // Process input based on action type
  let processed = false;
  
  if (action === 'selection') {
    // Store the selected option
    workflowState.data[stepId] = value;
    processed = true;
  } else if (action === 'confirm') {
    // Store the confirmation result (true/false)
    workflowState.data[stepId] = value === 'true';
    processed = true;
  }
  
  if (processed) {
    // Remove the inline keyboard
    await bot.editMessageReplyMarkup({
      inline_keyboard: []
    }, {
      chat_id: callbackQuery.message.chat.id,
      message_id: callbackQuery.message.message_id
    });
    
    // Move to the next step if processing was successful
    workflowState.moveToNextStep();
    
    // Return success
    return { 
      handled: true,
      input: workflowState.data[stepId]
    };
  }
  
  return { handled: false };
}

/**
 * Process a Telegram message for a workflow
 * @param {Object} bot - Telegram bot instance
 * @param {Object} message - Telegram message
 * @param {Object} workflowState - Current workflow state
 * @returns {Promise<Object>} Processing result
 */
async function processMessage(bot, message, workflowState) {
  if (!message || !workflowState) {
    throw new Error('Invalid message or workflow state');
  }
  
  const step = workflowState.getCurrentStep();
  if (!step) {
    return { 
      handled: false,
      error: 'No current step in workflow'
    };
  }
  
  const chatId = message.chat.id;
  let input;
  let processed = false;
  
  // Check if this message type matches what the current step expects
  if (step.ui.type === 'text_input' && message.text) {
    // Validate the input if needed
    const validationResult = step.validate(message.text);
    
    if (!validationResult.valid) {
      // Send error message
      await bot.sendMessage(chatId, `Error: ${validationResult.error}`, {
        parse_mode: 'HTML'
      });
      
      return {
        handled: true,
        error: validationResult.error
      };
    }
    
    // Store the valid input
    input = validationResult.value || message.text;
    workflowState.data[step.id] = input;
    processed = true;
  } 
  else if (step.ui.type === 'image_upload' && message.photo) {
    // Get the largest photo
    const photo = message.photo[message.photo.length - 1];
    
    // Store the file ID
    input = photo.file_id;
    workflowState.data[step.id] = input;
    processed = true;
  }
  else if (step.ui.type === 'caption_editor' && message.text) {
    // Store the caption
    input = message.text;
    workflowState.data[step.id] = input;
    processed = true;
  }
  
  if (processed) {
    // Move to the next step
    workflowState.moveToNextStep();
    
    // Return success
    return {
      handled: true,
      input
    };
  }
  
  // Message doesn't match what we expect
  return {
    handled: false,
    error: `Message type doesn't match current step (${step.ui.type})`
  };
}

module.exports = {
  renderStep,
  processCallbackQuery,
  processMessage
}; 