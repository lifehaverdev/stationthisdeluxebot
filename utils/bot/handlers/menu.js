

function displayBasePromptSettingsMenu(callbackQuery) {
    // Create account settings menu keyboard
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    //const promptsObject = require('./utils/basePrompts.js');  // Update the path to your prompts object file
    
    // Transform the prompts object into keyboard buttons
    let promptSettingsKeyboard = basepromptmenu.map(prompt => [{
        text: `${lobby[userId].basePrompt == prompt.name ? '✅ '+prompt.name : prompt.name} - ${prompt.description}`,
        callback_data: `setBasePrompt_${prompt.name}`,
    }]);

    // Send account settings menu
    bot.sendMessage(chatId, 'Base Prompt Menu:', {
        reply_markup: {
            inline_keyboard: promptSettingsKeyboard
        }
    });
}
function displayCheckpointSettingsMenu(callbackQuery) {
    // Create account settings menu keyboard
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    //const promptsObject = require('./utils/basePrompts.js');  // Update the path to your prompts object file
    
    // Transform the prompts object into keyboard buttons
    let promptSettingsKeyboard = checkpointmenu.map(checkpoint => [{
        text: `${lobby[userId].checkpoint == checkpoint.name ? '✅ '+checkpoint.name : checkpoint.name} - ${checkpoint.description}`,
        callback_data: `setCheckpoint_${checkpoint.name}`,
    }]);

    // Send account settings menu
    bot.sendMessage(chatId, 'Checkpoint Menu:', {
        reply_markup: {
            inline_keyboard: promptSettingsKeyboard
        }
    });
}


function parseCallbackData(data) {
    if (data.includes('|')) {
        // Assume it's the compact serialized form
        const parts = data.split('|');
        message = {
            message_id: parts[6], // You might not have a real message ID to use
            from: {
                id: parseInt(parts[1]),
                is_bot: false,
                first_name: parts[4],
                // Add other necessary user fields if required
            },
            chat: {
                id: parseInt(parts[3]),
                //type: 'private', // Adjust based on actual usage or data available
                // Add other necessary chat fields if required
            },
            date: Math.floor(Date.now() / 1000), // Use the current timestamp
            text: 'k', // Since you don't have the original text, leave this empty or use placeholder
            message_thread_id: parts[4] === '0' ? null : parseInt(parts[4], 10) // Handling for no thread ID
        };
        return {
            action: parts[0],
            message: message
        };
    } else {
        // Simple command
        return { action: data };
    }
}
module.exports = function(bot) {
    bot.on('callback_query', (callbackQuery) => {
        if (ignoreQueue) {
            console.log("Skipping logic because 'true' was passed as a command line argument.");
            return true; // Skip further processing
        }
        //console.log(callbackQuery.data);
        try {
            const chatId = callbackQuery.message.chat.id;
            const userId = callbackQuery.from.id;
            //console.log('callbackquerey',callbackQuery);
                        // Function to check and parse the callback data
            const {action, message} = parseCallbackData(callbackQuery.data);
            //console.log(message);
            //console.log(callbackQuery.message);
            //console.log(simulatedMessage);
        
            let messageTitle;
            
            switch (action) {
                case 'regen':
                    // Handle regeneration logic here
                    safeExecute(message,handleRegen);
                    bot.answerCallbackQuery(callbackQuery.id, { text: "Regenerating" });
                    break;
        
                case 'setcfg':
                case 'setprompt':
                    message.text = `/${action}`
                    safeExecute(message,startSet)
                    break;
                case 'toggleAdvancedUser':
                    bot.answerCallbackQuery(callbackQuery.id, { text: `Advanced User setting updated to ${!lobby[userId].advancedUser ? 'enabled' : 'disabled'}.` });
                    lobby[userId].advancedUser = !lobby[userId].advancedUser;
                    messageTitle = `Advanced User setting updated to ${lobby[userId].advancedUser ? 'enabled' : 'disabled'}.`
                    break;
        
                case 'toggleWaterMark':
                    if(lobby[userId].balance > 1000000){
                        lobby[userId].waterMark = !lobby[userId].waterMark
                        bot.answerCallbackQuery(callbackQuery.id, { text: `WaterMark option updated to ${lobby[userId].waterMark ? 'ON' : 'OFF'}`});
                        messageTitle = `WaterMark option updated to ${lobby[userId].waterMark ? 'ON' : 'OFF'}`
                    }
                    break;
        
                case 'toggleBasePrompt':
                    if(lobby[userId].balance > 1000000){
                        messageTitle = `switching base prompt`
                        displayBasePromptSettingsMenu(callbackQuery);
                    }
                    break;
                case 'toggleCheckpoint':
                    messageTitle = 'switching checkpoint'
                    displayCheckpointSettingsMenu(callbackQuery);
                    break;
        
                default:
                    if (callbackQuery.data.startsWith('setBasePrompt_')) {
                        console.log('setting prompt');
                        const selectedName = callbackQuery.data.split('_')[1];
                        const basePrompt = getBasePromptByName(selectedName);
                        if (basePrompt !== undefined) { // Check explicitly for undefined to allow empty string as valid
                            lobby[userId].basePrompt = selectedName;
                            bot.answerCallbackQuery(callbackQuery.id, { text: `Base prompt set to: ${selectedName}`});
                            messageTitle = `Base prompt set to: ${selectedName}`
                        } else {
                            bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Base prompt not found'});
                            messageTitle = `Base prompt not set to: ${selectedName}`
                        }
                    } else if (callbackQuery.data.startsWith('setCheckpoint_')){
                        console.log('setting checkpoint');
                        const selectedName = callbackQuery.data.split('_').slice(1).join('_');
                        //lobby[userId].checkpoint = selectedName;
                        
                        // Function to check if a checkpoint description contains "SDXL" or "SD1.5"
                        function isSDXL(description) {
                            return description.includes("SDXL");
                        }
                        function isSD15(description) {
                            return description.includes("SD1.5");
                        }
                        // Iterate through the checkpointmenu array
                        for (const checkpoint of checkpointmenu) {
                            if (checkpoint.name === selectedName) {
                                if (isSDXL(checkpoint.description)) {
                                    // Checkpoint description contains "SDXL"
                                    console.log(`${selectedName} is an SDXL checkpoint.`);
                                    lobby[userId] = {
                                        ...lobby[userId],
                                        photoStats: {
                                            height: 1024,
                                            width: 1024
                                        },
                                        basePrompt: "MS2.2",
                                        checkpoint: selectedName
                                    }
                                    // Perform actions for SDXL checkpoint
                                } else if (isSD15(checkpoint.description)) {
                                    // Checkpoint description contains "SD1.5"
                                    console.log(`${selectedName} is an SD1.5 checkpoint.`);
                                    // Perform actions for SD1.5 checkpoint
                                    lobby[userId] = {
                                        ...lobby[userId],
                                        photoStats: {
                                            height: 512,
                                            width: 512
                                        },
                                        basePrompt: "MS2.1.5",
                                        checkpoint: selectedName
                                    }
                                } else {
                                    // Checkpoint description does not match any known pattern
                                    console.log(`${selectedName} does not have a recognized description.`);
                                    // Handle accordingly
                                }
                                
                                break; // Break out of the loop since we found the matching checkpoint
                            }
                            
                        }
                        bot.answerCallbackQuery(callbackQuery.id, { text: `Base prompt set to: ${selectedName}`});
                        messageTitle = `Checkpoint set to: ${selectedName}`
                    }
                    break;
                    
            }
            if(!callbackQuery.message.reply_to_message){
                bot.editMessageText(messageTitle, {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    //reply_markup: opts.reply_markup
                });
            }
            
        } catch (error) {
            console.error("Error during callback query handling:", {
                errorMessage: error.message,
                requestData: {
                    chatId: callbackQuery.message.chat.id,
                    userId: callbackQuery.from.id,
                    data: callbackQuery.data
                }
            });
        }
    });
}