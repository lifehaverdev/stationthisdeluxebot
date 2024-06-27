const { compactSerialize, sendMessage, editMessage, makeBaseData } = require('../../utils')
const { getPromptMenu, getCheckpointMenu, getVoiceMenu } = require('../../models/userKeyboards')

function setMenu(message) {
    const baseData = {
        text: 'k',
        id: message.message_id,
        fromId: message.from.id,
        chatId: message.chat.id,
        firstName: message.from.first_name.slice(0,10),
        threadId: message.message_thread_id || null
    };
    const options = {
        reply_markup: {
            inline_keyboard: [[
                { text: 'prompt', callback_data: 'setprompt' },
                { text: 'negprompt', callback_data: 'setnegprompt' },
                { text: 'userprompt', callback_data: 'setuserprompt' },
            ],
            [
                { text: 'batch', callback_data: 'setbatch' },
                { text: 'size', callback_data: 'setsize' },
                { text: 'steps', callback_data: 'setsteps'},
            ],
            [
                { text: 'photo', callback_data: 'setphoto'},
                { text: 'style', callback_data: 'setstyle'},
                { text: 'control', callback_data: 'setcontrol'}
            ],
            [
                { text: 'cfg', callback_data: 'setcfg'},
                { text: 'strength', callback_data: 'setstrength' },
                { text: 'seed', callback_data: 'setseed' },
            ],
            [
                { text: 'checkpoint', callback_data: 'checkpointmenu' },
                { text: 'baseprompt', callback_data: 'basepromptmenu' }
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Settings', options);
}

async function handleCreate(message) {
    const sent = await sendMessage(message, `what shall I create for you, @${message.from.username} ?`);
    console.log('message in help status',message)
    console.log('sent message in help status',sent)
    const baseData = makeBaseData(sent,message.from.id);
    //const callbackData = compactSerialize({ ...baseData, action: `refresh`});
    console.log(baseData);
    console.log(compactSerialize({ ...baseData, action: 'make' }))
    const chat_id = sent.chat.id;
    const message_id = sent.message_id;
    
    const reply_markup = 
    {
          inline_keyboard: [
            [   
                { text: 'txt2img', callback_data: 'make'},
            ],
            [
                { text: 'sd3 txt2img', callback_data: 'make3' },
            ],
            [   
                { text: 'txt2img style transfer', callback_data: 'make_style' },
            ],
            [   
                { text: 'txt2img controlnet', callback_data: 'make_control' },
            ],
            [   
                { text: 'txt2img controlnet + style transfer', callback_data: 'make_control_style' },
            ],
            [
                { text: 'assist', callback_data: 'assist'},
                { text: 'interrogate', callback_data: 'interrogate'},
            ]
        ]
        }
    try { editMessage(
        {
            reply_markup,
            chat_id,
            message_id
        }
        ) } catch (error) {
        console.error(`Sendmessage error:`, {
            message: error.message ? error.message : '',
            name: error.name ? error.name : '',
            code: error.code ? error.code : '',
        });
    }
}
function handleEffect(message) {
    const baseData = {
        text: 'k',
        id: message.message_id,
        fromId: message.from.id,
        chatId: message.chat.id,
        firstName: message.from.first_name.slice(0, 10), // Limit length of the name to avoid exceeding limit
        threadId: message.message_thread_id || null // Use 0 if thread ID is not available
    };
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: 'image2image', callback_data: 'ms2' },
                { text: 'autoi2i', callback_data: 'pfp' },
            ],
            [
                { text: 'image2image style transfer', callback_data: 'ms2_style' },
                { text: 'autoi2i style transfer', callback_data: 'pfp_style' },
            ],
            [
                { text: 'image2image controlnet', callback_data: 'ms2_control'},
                { text: 'autoi2i controlnet', callback_data: 'pfp_control'}
            ],
            [
                { text: 'image2image controlnet + style transfer', callback_data: 'ms2_control_style'},
                { text: 'autoi2i controlnet + style transfer', callback_data: 'pfp_control_style'}
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
        threadId: message.message_thread_id || null // Use 0 if thread ID is not available
    };
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: 'img2video', callback_data: 'ms3' },
            ],
            [
                { text: 'txt2speech', callback_data: 'speak' }  
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Animate', options);
}

async function handleCheckpointMenu(message,user) {
    if(user){
        const reply_markup = getCheckpointMenu(user, message);
        editMessage(
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Checkpoint Menu:',
                reply_markup
            }
        )
    } else {
        const botMessage = await sendMessage(message, 'Checkpoint Menu:');
        const chat_id = botMessage.chat.id;
        const message_id = botMessage.message_id;
        const reply_markup = getCheckpointMenu(user, botMessage);
        editMessage(
            {
                reply_markup,
                chat_id,
                message_id
            }
        );
    }
            
}

async function handleBasePromptMenu(message,user) {
    if(user){
        const reply_markup = getPromptMenu(user, message);
        editMessage(
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Base Prompt Menu:',
                reply_markup
            }
        )
    } else {
        const botMessage = await sendMessage(message, 'Base Prompt Menu:');
        const chat_id = botMessage.chat.id;
        const message_id = botMessage.message_id;
        const reply_markup = getPromptMenu(user, botMessage);
        editMessage(
            {
                reply_markup,
                chat_id,
                message_id
            }
        );
    }

}

async function handleVoiceMenu(message,user) {
    if(user){
        const reply_markup = getVoiceMenu(user, message);
        editMessage(
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Voice Menu:',
                reply_markup
            }
        )
    } else {
        const botMessage = await sendMessage(message, 'Voice Menu:');
        const chat_id = botMessage.chat.id;
        const message_id = botMessage.message_id;
        const reply_markup = getVoiceMenu(user, botMessage);
        editMessage(
            {
                reply_markup,
                chat_id,
                message_id
            }
        );
    }
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