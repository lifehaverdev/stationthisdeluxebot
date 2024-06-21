const { compactSerialize, sendMessage } = require('../../utils')

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
                { text: '/setsteps', callback_data: compactSerialize({ ...baseData, action: 'setsteps' }) },
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
                { text: 'gptprompt assist', callback_data: compactSerialize({ ...baseData, action: 'assist' })},
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
          inline_keyboard: [[   
                { text: 'image2image', callback_data: compactSerialize({ ...baseData, action: 'ms2' }) },
            ],
            [
                { text: 'image2image style transfer', callback_data: compactSerialize({ ...baseData, action: 'ms2_style' }) },
            ],
            [
                { text: 'image2image controlnet', callback_data: compactSerialize({ ...baseData, action: 'ms2_control' })}
            ],
            [
                { text: 'image2image controlnet + style transfer', callback_data: compactSerialize({ ...baseData, action: 'ms2_control_style' })}
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

module.exports = {
    handleCreate,
    setMenu,
    handleEffect,
    handleAnimate
}