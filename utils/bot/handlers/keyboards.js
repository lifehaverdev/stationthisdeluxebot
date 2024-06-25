const { compactSerialize, sendMessage, editReply } = require('../../utils')
const { getPromptMenu, getCheckpointMenu, getVoiceMenu } = require('../../models/userKeyboards')

function setMenu(message) {
    const baseData = {
        text: 'k',
        id: message.message_id,
        fromId: message.from.id,
        chatId: message.chat.id,
        firstName: message.from.first_name.slice(0,10),
        threadId: message.message_thread_id || 0
    };
    const options = {
        reply_markup: {
            inline_keyboard: [[
                { text: '/setprompt', callback_data: compactSerialize({ ...baseData, action: 'setprompt' }) },
                { text: '/setnegprompt', callback_data: compactSerialize({ ...baseData, action: 'setnegprompt' })  },
                { text: '/setuserprompt', callback_data: compactSerialize({ ...baseData, action: 'setuserprompt' })  },
            ],
            [
                { text: '/setbatch', callback_data: compactSerialize({ ...baseData, action: 'setbatch' })  },
                { text: '/setsize', callback_data: compactSerialize({ ...baseData, action: 'setsize' })  },
                { text: '/setsteps', callback_data: compactSerialize({ ...baseData, action: 'setsteps' }) },
            ],
            [
                { text: '/setphoto', callback_data: compactSerialize({ ...baseData, action: 'setphoto' }) },
                { text: '/setstyle', callback_data: compactSerialize({ ...baseData, action: 'setstyle' }) },
                { text: '/setcontrol', callback_data: compactSerialize({ ...baseData, action: 'setcontrol' }) }
            ],
            [
                { text: '/setcfg', callback_data: compactSerialize({ ...baseData, action: 'setcfg' }) },
                { text: '/setstrength', callback_data: compactSerialize({ ...baseData, action: 'setstrength' })  },
                { text: '/setseed', callback_data: compactSerialize({ ...baseData, action: 'setseed' })  },
            ],
            [
                { text: '/setcheckpoint', callback_data: compactSerialize({ ...baseData, action: 'checkpointmenu', user: message.from.id })},
                { text: '/setbaseprompt', callback_data: compactSerialize({ ...baseData, action: 'basepromptmenu', user: message.from.id })}
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Settings', options);
}

function handleCreate(message) {
    //console.log('ok i am trying to send create pallette')
    //console.log(message);
    const baseData = {
        text: 'k',
        id: message.message_id,
        fromId: message.from.id,
        chatId: message.chat.id,
        firstName: message.from.first_name.slice(0, 10), // Limit length of the name to avoid exceeding limit
        threadId: message.message_thread_id ? message.message_thread_id : 0 // Use 0 if thread ID is not available
    };
    //console.log(baseData);
    //console.log(compactSerialize({ ...baseData, action: 'regen' }))
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: 'txt2img', callback_data: compactSerialize({ ...baseData, action: 'make' }) },
            ],
            [
                { text: 'sd3 txt2img', callback_data: compactSerialize({ ...baseData, action: 'make3' }) },
            ],
            [   
                { text: 'txt2img style transfer', callback_data: compactSerialize({ ...baseData, action: 'make_style' }) },
            ],
            [   
                { text: 'txt2img controlnet', callback_data: compactSerialize({ ...baseData, action: 'make_control' }) },
            ],
            [   
                { text: 'txt2img controlnet + style transfer', callback_data: compactSerialize({ ...baseData, action: 'make_control_style' }) },
            ],
            [
                { text: 'assist', callback_data: compactSerialize({ ...baseData, action: 'assist' })},
                { text: 'interrogate', callback_data: compactSerialize({ ...baseData, action: 'interrogate' })},
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Create', options);
}
function handleEffect(message) {
    const baseData = {
        text: 'k',
        id: message.message_id,
        fromId: message.from.id,
        chatId: message.chat.id,
        firstName: message.from.first_name.slice(0, 10), // Limit length of the name to avoid exceeding limit
        threadId: message.message_thread_id || 0 // Use 0 if thread ID is not available
    };
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: 'image2image', callback_data: compactSerialize({ ...baseData, action: 'ms2' }) },
                { text: 'autoi2i', callback_data: compactSerialize({ ...baseData, action: 'pfp' }) },
            ],
            [
                { text: 'image2image style transfer', callback_data: compactSerialize({ ...baseData, action: 'ms2_style' }) },
                { text: 'autoi2i style transfer', callback_data: compactSerialize({ ...baseData, action: 'pfp_style' }) },
            ],
            [
                { text: 'image2image controlnet', callback_data: compactSerialize({ ...baseData, action: 'ms2_control' })},
                { text: 'autoi2i controlnet', callback_data: compactSerialize({ ...baseData, action: 'pfp_control' })}
            ],
            [
                { text: 'image2image controlnet + style transfer', callback_data: compactSerialize({ ...baseData, action: 'ms2_control_style' })},
                { text: 'autoi2i controlnet + style transfer', callback_data: compactSerialize({ ...baseData, action: 'pfp_control_style' })}
            ],
            [
                //{ text: 'image2image promptless', callback_data: compactSerialize({ ...baseData, action: 'pfp' })},
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Effect', options);
}

function handleAnimate(message) {
    const baseData = {
        text: 'k',
        id: message.message_id,
        fromId: message.from.id,
        chatId: message.chat.id,
        firstName: message.from.first_name.slice(0, 10), // Limit length of the name to avoid exceeding limit
        threadId: message.message_thread_id || 0 // Use 0 if thread ID is not available
    };
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: 'img2video', callback_data: compactSerialize({ ...baseData, action: 'ms3' }) },
            ],
            [
                { text: 'txt2speech', callback_data: compactSerialize({...baseData, action: 'speak'})}
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Animate', options);
}

async function handleCheckpointMenu(message) {
            const botMessage = await sendMessage(message, 'Checkpoint Menu:');
            const chat_id = botMessage.chat.id;
            const message_id = botMessage.message_id;
            const reply_markup = getCheckpointMenu(message.from.id, botMessage);
            editReply(reply_markup,chat_id,message_id);
            // bot.editMessageReplyMarkup(
            //     reply_markup,
            //     {
            //         chat_id, 
            //         message_id,
            //     }
            // );
        
}

async function handleBasePromptMenu(message) {
    const botMessage = await sendMessage(message, 'Base Prompt Menu:');
    const chat_id = botMessage.chat.id;
    const message_id = botMessage.message_id;
    const reply_markup = getPromptMenu(message.from.id, botMessage);
    editReply(reply_markup,chat_id,message_id)
    // bot.editMessageReplyMarkup(
    //     reply_markup,
    //     {
    //         chat_id, 
    //         message_id,
    //     }
    // );

}

async function handleVoiceMenu(message) {
    const botMessage = await sendMessage(message, 'Voice Menu:');
    const chat_id = botMessage.chat.id;
    const message_id = botMessage.message_id;
    const reply_markup = getVoiceMenu(message.from.id, botMessage);
    editReply(reply_markup,chat_id,message_id)
}

module.exports = {
    handleCreate,
    setMenu,
    handleEffect,
    handleAnimate,
    handleCheckpointMenu,
    handleBasePromptMenu,
    handleVoiceMenu
}