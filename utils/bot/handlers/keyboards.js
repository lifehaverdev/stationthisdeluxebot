const { lobby } = require('../bot')
const { compactSerialize, sendMessage, editMessage, makeBaseData, gated } = require('../../utils')
const { getPromptMenu, getCheckpointMenu, getVoiceMenu } = require('../../models/userKeyboards')

function setMenu(message) {
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
                //{ text: 'checkpoint', callback_data: 'checkpointmenu' },
                //{ text: 'baseprompt', callback_data: 'basepromptmenu' }
            ],
            [
                { text: 'cancel', callback_data: 'cancel' }
            ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
      if(lobby[message.from.id] && lobby[message.from.id].balance >= 100000){
        options.reply_markup.inline_keyboard[4].push(
            { text: 'baseprompt', callback_data: 'basepromptmenu' }
        )
      }
      if(lobby[message.from.id] && lobby[message.from.id].balance >= 600000){
        options.reply_markup.inline_keyboard[4].push(
            { text: 'checkpoint', callback_data: 'checkpointmenu' },
        )
      }
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Settings', options);
}



// Look good?

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
            // [
            //     { text: 'sd3 txt2img', callback_data: 'make3' },
            // ],
            // [   
            //     { text: 'txt2img style transfer', callback_data: 'make_style' },
            // ],
            // [   
            //     { text: 'txt2img controlnet', callback_data: 'make_control' },
            // ],
            // [   
            //     { text: 'txt2img controlnet + style transfer', callback_data: 'make_control_style' },
            // ],
            // [
            //     { text: 'assist', callback_data: 'assist'},
            //     { text: 'interrogate', callback_data: 'interrogate'},
            // ],
            // [
            //     { text: 'cancel', callback_data: 'cancel' }
            // ]
        ]
    }
    let controlstyle = false;
    let sd3 = false;
    if(lobby[message.from.id] && lobby[message.from.id].balance >= 400000){
        const newButtons = [
            [   
                { text: 'txt2img style transfer', callback_data: 'make_style' },
            ],
            [   
                { text: 'txt2img controlnet', callback_data: 'make_control' },
            ],
            [   
                { text: 'txt2img controlnet + style transfer', callback_data: 'make_control_style' },
            ],
        ];
    
        // Define the index where you want to insert the new buttons
        const insertIndex = 2;
    
        // Insert each new button array individually at the specified index
        for (let i = 0; i < newButtons.length; i++) {
            reply_markup.inline_keyboard.splice(insertIndex + i, 0, newButtons[i]);
        }
        controlstyle = true;
    }
    if(lobby[message.from.id] && lobby[message.from.id].balance >= 500000){
        reply_markup.inline_keyboard.splice(1,0,
            [
                { text: 'sd3 txt2img', callback_data: 'make3' },
            ],
        )
        sd3 = true;
    }
    if(lobby[message.from.id] && lobby[message.from.id].balance >= 300000){
        let index;
        sd3 && controlstyle ? index = 5 : controlstyle ? index = 4 : index = 1
        reply_markup.inline_keyboard.push(
            [
                { text: 'assist', callback_data: 'assist'},
                { text: 'interrogate', callback_data: 'interrogate'},
            ],
        )
    }
    reply_markup.inline_keyboard.push(
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
    )
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
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: 'image2image', callback_data: 'ms2' },
                //{ text: 'autoi2i', callback_data: 'pfp' },
            ],
            // [
            //     { text: 'image2image style transfer', callback_data: 'ms2_style' },
            //     { text: 'autoi2i style transfer', callback_data: 'pfp_style' },
            // ],
            // [
            //     { text: 'image2image controlnet', callback_data: 'ms2_control'},
            //     { text: 'autoi2i controlnet', callback_data: 'pfp_control'}
            // ],
            // [
            //     { text: 'image2image controlnet + style transfer', callback_data: 'ms2_control_style'},
            //     { text: 'autoi2i controlnet + style transfer', callback_data: 'pfp_control_style'}
            // ],
            // [
            //     { text: 'cancel', callback_data: 'cancel' }
            // ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

    };
    if(lobby[message.from.id] && lobby[message.from.id].balance >= 300000){
        options.reply_markup.inline_keyboard[0] = 
        [   
            { text: 'image2image', callback_data: 'ms2' },
            { text: 'autoi2i', callback_data: 'pfp' },
        ];
    }
    if(lobby[message.from.id] && lobby[message.from.id].balance >= 400000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: 'image2image style transfer', callback_data: 'ms2_style' },
                { text: 'autoi2i style transfer', callback_data: 'pfp_style' },
            ]
        )
        options.reply_markup.inline_keyboard.push(
            [
                { text: 'image2image controlnet', callback_data: 'ms2_control'},
                { text: 'autoi2i controlnet', callback_data: 'pfp_control'}
            ]
        )
        options.reply_markup.inline_keyboard.push(
            [
                { text: 'image2image controlnet + style transfer', callback_data: 'ms2_control_style'},
                { text: 'autoi2i controlnet + style transfer', callback_data: 'pfp_control_style'}
            ]
        )
        options.reply_markup.inline_keyboard.push(
            [
                { text: 'inpaint', callback_data: 'inpaint'},
            ]
        )
    }
    options.reply_markup.inline_keyboard.push(
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
    )
      // Sending an empty message to set the keyboard
    sendMessage(message,'Effect', options);
}



function handleAnimate(message) {
    const options = {
        reply_markup: {
          inline_keyboard: [
            // [   
            //     { text: 'img2video', callback_data: 'ms3' },
            // ],
            // [
            //     { text: 'txt2speech', callback_data: 'speak' }  
            // ],
            // [
            //     { text: 'cancel', callback_data: 'cancel' }
            // ]
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
      if(lobby[message.from.id] && lobby[message.from.id].balance >= 500000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: 'txt2speech', callback_data: 'speak' }  
            ]
        )
      }
      if(lobby[message.from.id] && lobby[message.from.id].balance >= 600000){
        options.reply_markup.inline_keyboard.push(
            [   
                { text: 'img2video', callback_data: 'ms3' },
            ]
        )
      }
      options.reply_markup.inline_keyboard.push(
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
      )
    if(lobby[message.from.id] && lobby[message.from.id].balance < 600000){
        gated(message);
        return;
    } else {
          // Sending an empty message to set the keyboard
        sendMessage(message,'Animate', options);
    }
    
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