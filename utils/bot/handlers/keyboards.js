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
                { text: 'prompt', callback_data: compactSerialize({ ...baseData, action: 'setprompt' }) },
                { text: 'negprompt', callback_data: compactSerialize({ ...baseData, action: 'setnegprompt' })  },
                { text: 'userprompt', callback_data: compactSerialize({ ...baseData, action: 'setuserprompt' })  },
            ],
            [
                { text: 'batch', callback_data: compactSerialize({ ...baseData, action: 'setbatch' })  },
                { text: 'size', callback_data: compactSerialize({ ...baseData, action: 'setsize' })  },
                { text: 'steps', callback_data: compactSerialize({ ...baseData, action: 'setsteps' }) },
            ],
            [
                { text: 'photo', callback_data: compactSerialize({ ...baseData, action: 'setphoto' }) },
                { text: 'style', callback_data: compactSerialize({ ...baseData, action: 'setstyle' }) },
                { text: 'control', callback_data: compactSerialize({ ...baseData, action: 'setcontrol' }) }
            ],
            [
                { text: 'cfg', callback_data: compactSerialize({ ...baseData, action: 'setcfg' }) },
                { text: 'strength', callback_data: compactSerialize({ ...baseData, action: 'setstrength' })  },
                { text: 'seed', callback_data: compactSerialize({ ...baseData, action: 'setseed' })  },
            ],
            [
                { text: 'checkpoint', callback_data: compactSerialize({ ...baseData, action: 'checkpointmenu', user: message.from.id })},
                { text: 'baseprompt', callback_data: compactSerialize({ ...baseData, action: 'basepromptmenu', user: message.from.id })}
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
                { text: '💬➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'make' }) },
                { text: '💬➡️3️⃣🖼️', callback_data: compactSerialize({ ...baseData, action: 'make3' }) },
            ],
            // [
            //     { text: 'sd3 💬➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'make3' }) },
            // ],
            [   
                { text: '💃🏼💬➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'make_style' }) },
                { text: '🩻💬➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'make_control' }) },
            ],
            // [   
                
            // ],
            [   
                { text: '💃🏼💬➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'make_style' }) },
                { text: '🩻💃🏼💬➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'make_control_style' }) },
            ],
            [
                { text: '💬➡️🗯️', callback_data: compactSerialize({ ...baseData, action: 'assist' })},
                { text: '🖼️➡️💬', callback_data: compactSerialize({ ...baseData, action: 'interrogate' })},
            ],
            [
                { text: '💬➡️🗣️', callback_data: compactSerialize({...baseData, action: 'speak'})}
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
                { text: '🖼️➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'ms2' }) },
                { text: '🖼️👾➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'pfp' }) },
            ],
            [
                { text: '💃🏼🖼️➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'ms2_style' }) },
                { text: '💃🏼🖼️👾➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'pfp_style' }) },
            ],
            [
                { text: '🩻🖼️➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'ms2_control' })},
                { text: '🩻🖼️👾➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'pfp_control' })}
            ],
            [
                { text: '🩻💃🏼🖼️➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'ms2_control_style' })},
                { text: '🩻💃🏼🖼️👾➡️🖼️', callback_data: compactSerialize({ ...baseData, action: 'pfp_control_style' })}
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
                { text: '🖼️➡️🎞️', callback_data: compactSerialize({ ...baseData, action: 'ms3' }) },
            ],
            // [
                
            // ]
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