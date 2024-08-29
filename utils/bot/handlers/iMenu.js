const { lobby } = require('../bot')
const { basepromptmenu } = require('../../models/basepromptmenu')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { voiceModels } = require('../../models/voiceModelMenu')
const { watermarkmenu } = require('../../models/watermarks')
const { compactSerialize, sendMessage, editMessage, makeBaseData, gated } = require('../../utils')
//const { getPromptMenu, getCheckpointMenu, getVoiceMenu, getWatermarkMenu } = require('../../../models/userKeyboards')
const {getGroup} = require('./iGroup')

function setMenu(message) {
    const group = getGroup(message);
    //console.log('group',group.name)
    let settings;
    if(group){
        console.log('yes to group')
        settings = group.settings
    } else {
        settings = lobby[message.from.id]
    }
    //settings = lobby[message.from.id]
    const options = {
        reply_markup: {
            inline_keyboard: [[
                { text: 'prompt', callback_data: 'setprompt' },
                { text: 'negprompt', callback_data: 'setnegprompt' },
                { text: settings.userPrompt != "-1" ? 'userprompt ✅' : 'userprompt ❌', callback_data: 'setuserprompt' },
            ],
            [
                { text: 'batch '+settings.batchMax, callback_data: 'setbatch' },
                { text: 'size', callback_data: 'setsize' },
                { text: 'steps '+settings.steps, callback_data: 'setsteps'},
            ],
            [
                { text: settings.photo ? 'photo ✅' : 'photo ❌', callback_data: 'setphoto'},
                { text: settings.style ? 'style ✅' : 'style ❌', callback_data: 'setstyle'},
                { text: settings.control ? 'control ✅' : 'control ❌', callback_data: 'setcontrol'}
            ],
            [
                { text: 'cfg '+settings.cfg, callback_data: 'setcfg'},
                { text: 'strength '+settings.strength, callback_data: 'setstrength' },
                { text: 'seed '+settings.seed, callback_data: 'setseed' },
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
      if((lobby[message.from.id] && lobby[message.from.id].balance >= 100000)
        || (group)){
        options.reply_markup.inline_keyboard[4].push(
            { text: settings.basePrompt+' ✅', callback_data: 'basepromptmenu' },
            { text: settings.checkpoint+' ✅', callback_data: 'checkpointmenu' },
        )
      }
    //   if(lobby[message.from.id] && lobby[message.from.id].balance >= 600000){
    //     options.reply_markup.inline_keyboard[4].push(
    //         { text: 'checkpoint', callback_data: 'checkpointmenu' },
    //     )
    //   }
    
      // Sending an empty message to set the keyboard
    sendMessage(message,'Settings', options);
}

// Look good?
async function handleCreate(message) {
    const group = getGroup(message);
    let settings;
    let balance;
    if(group){
        settings = group.settings;
        balance = group.applied;
    }else{
        settings = lobby[message.from.id]
        balance = settings.balance
    }
    //const settings = lobby[message.from.id]
    const sent = await sendMessage(message, `what shall I create for you, @${message.from.username} ?`);
    //console.log('message in help status',message)
    //console.log('sent message in help status',sent)
    //const baseData = makeBaseData(sent,message.from.id);
    //const callbackData = compactSerialize({ ...baseData, action: `refresh`});
    //console.log(baseData);
    //console.log(compactSerialize({ ...baseData, action: 'make' }))
    const chat_id = sent.chat.id;
    const message_id = sent.message_id;
    
    const reply_markup = 
    {
          inline_keyboard: [
            [   
                { text: settings.advancedUser ? '💬➡️🖼️' : 'txt2img', callback_data: 'make'},
            ],
        ]
    }
    let controlstyle = false;
    let sd3 = false;
    if(lobby[message.from.id] && balance >= 400000){
        const newButtons = [
            [   
                { text: settings.advancedUser ? '💬💃🏼➡️🖼️' : 'txt2img style transfer', callback_data: 'make_style' },
            ],
            [   
                { text: settings.advancedUser ? '💬🩻➡️🖼️' : 'txt2img controlnet', callback_data: 'make_control' },
            ],
            [   
                { text: settings.advancedUser ? '💬💃🏼🩻➡️🖼️' : 'txt2img controlnet + style transfer', callback_data: 'make_control_style' },
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
    if(lobby[message.from.id] && balance >= 500000){
        reply_markup.inline_keyboard.splice(1,0,
            [
                { text: settings.advancedUser ? '💬3➡️🖼️' : 'sd3 txt2img', callback_data: 'make3' },
            ],
        )
        sd3 = true;
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
function handleUtils(message) {
    const group = getGroup(message);
    let settings;
    let balance;
    if(group){
        settings = group.settings;
        balance = group.applied;
    }else{
        settings = lobby[message.from.id]
        balance = settings.balance
    }
    const options = {
        reply_markup: {
          inline_keyboard: [
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
      if(lobby[message.from.id] && balance >= 200000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '🖼️➡️📈🖼️' : 'upscale', callback_data: 'upscale' },
                { text: settings.advancedUser ? '🖼️➡️🌞' : 'remove background', callback_data: 'rmbg' },
            ],
            [
                { text: settings.advancedUser ? '🖼️✍️' : 'watermark', callback_data: 'watermark'},
                { text: settings.advancedUser ? '🖼️➡️💽' : 'disc', callback_data: 'disc'}
            ]
        )
      }
      if(lobby[message.from.id] && balance >= 300000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '💬➡️📜' : 'assist', callback_data: 'assist'},
                { text: settings.advancedUser ? '🖼️➡️💬' : 'interrogate', callback_data: 'interrogate'},
            ],
        )
      }
      options.reply_markup.inline_keyboard.push(
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
      )
    if(lobby[message.from.id] && balance < 200000){
        gated(message);
        return;
    } else {
          // Sending an empty message to set the keyboard
        sendMessage(message,'Utils', options);
    }
}
function handleEffect(message) {
    const group = getGroup(message);
    let settings;
    let balance;
    if(group){
        settings = group.settings;
        balance = group.applied;
    }else{
        settings = lobby[message.from.id]
        balance = settings.balance
    }
    const options = {
        reply_markup: {
          inline_keyboard: [
            [   
                { text: settings.advancedUser ? '🖼️➡️🖼️' : 'image2image', callback_data: 'ms2' },
            ],
        ],
          resize_keyboard: true,
          one_time_keyboard: true
        }

    };
    if(lobby[message.from.id] && balance >= 300000){
        options.reply_markup.inline_keyboard[0] = 
        [   
            { text: settings.advancedUser ? '🖼️➡️🖼️' : 'image2image', callback_data: 'ms2' },
            { text: settings.advancedUser ? '🖼️👾➡️🖼️' : 'autoi2i', callback_data: 'pfp' },
        ];
    }
    if(lobby[message.from.id] && balance >= 400000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '🖼️💃🏼➡️🖼️' : 'image2image style transfer', callback_data: 'ms2_style' },
                { text: settings.advancedUser ? '🖼️💃🏼👾➡️🖼️' : 'autoi2i style transfer', callback_data: 'pfp_style' },
            ]
        )
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '🖼️🩻➡️🖼️' : 'image2image controlnet', callback_data: 'ms2_control'},
                { text: settings.advancedUser ? '🖼️🩻👾➡️🖼️' : 'autoi2i controlnet', callback_data: 'pfp_control'}
            ]
        )
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '🖼️💃🏼🩻➡️🖼️' : 'image2image controlnet + style transfer', callback_data: 'ms2_control_style'},
                { text: settings.advancedUser ? '🖼️💃🏼🩻👾➡️🖼️' : 'autoi2i controlnet + style transfer', callback_data: 'pfp_control_style'}
            ]
        )
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '🖼️🔍➡️🎨🖼️' : 'inpaint', callback_data: 'inpaint'},
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
    const group = getGroup(message);
    let settings;
    let balance;
    if(group){
        settings = group.settings;
        balance = group.applied;
    }else{
        settings = lobby[message.from.id]
        balance = settings.balance
    }
    const options = {
        reply_markup: {
          inline_keyboard: [],
          resize_keyboard: true,
          one_time_keyboard: true
        }

      };
      if(lobby[message.from.id] && balance >= 500000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '💬➡️🗣️' : 'txt2speech', callback_data: 'speak' }  
            ]
        )
      }
      if(lobby[message.from.id] && balance >= 600000){
        options.reply_markup.inline_keyboard.push(
            [   
                { text: settings.advancedUser ? '🖼️➡️🎞️' : 'img2video', callback_data: 'ms3' },
            ]
        )
      }
      options.reply_markup.inline_keyboard.push(
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
      )
    if(lobby[message.from.id] && balance < 600000){
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
async function handleWatermarkMenu(message,user) {
    if(user){
        const reply_markup = getWatermarkMenu(user, message);
        editMessage(
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Watermark Menu:',
                reply_markup
            }
        )
    } else {
        const botMessage = await sendMessage(message, 'Watermark Menu:');
        const chat_id = botMessage.chat.id;
        const message_id = botMessage.message_id;
        const reply_markup = getWatermarkMenu(user, botMessage);
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


const home =  {
    reply_markup: {
        keyboard: [
            [{ text: '/create' },{ text: '/effect' },{ text: '/animate' }],
            [{ text: '/set' },{text: '/utils'},{text: '/regen' },{ text: '/status'}],
            [{ text: '/accountsettings' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

const justSet = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '/regen', callback_data: 'regen'},{text: '/set', callback_data: 'set'}]
        ],
        //resize_keyboard: true,
        //one_time_keyboard: true
    }
}

const signedOut = {
    reply_markup: {
        keyboard: [
            [{ text: '/signin' }],
            [{ text: '/help' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

function isValidCallbackData(callbackData) {
    // Maximum length for callback_data is 64 bytes
    const maxLength = 64;

    // Valid characters include letters, digits, underscores, and dashes
    const validCharacters = /^[a-zA-Z0-9_$|.<-]*$/;

    // Check length
    if (callbackData.length > maxLength) {
        return false;
    }

    // Check valid characters
    if (!validCharacters.test(callbackData)) {
        return false;
    }

    return true;
}

function getPromptMenu(userId, message) {
    const group = getGroup(message)
    let settings;
    if(group){
        settings = group.settings;
    }else{
        settings = lobby[userId]
    }
    const baseData = makeBaseData(message, userId);
    if (!lobby[userId]) {
        console.error('User not found in lobby:', userId);
        return null;
    }
    const promptSettingsKeyboard = basepromptmenu.map(prompt => {
        const callbackData = compactSerialize({ ...baseData, action: `sbp_${prompt.name}` });
        if (isValidCallbackData(callbackData)) {
            return [{
                text: `${settings.basePrompt === prompt.name ? '✅ ' + prompt.name : prompt.name} - ${prompt.description}`,
                callback_data: callbackData
            }];
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${prompt.name} - ${prompt.description}`,
            //     callback_data: 'invalid_callback_data'
            // }];
        }
    });

    return {
        inline_keyboard: promptSettingsKeyboard
    };
}

function getCheckpointMenu(userId, message) {
    const group = getGroup(message)
    let settings;
    if(group){
        settings = group.settings;
    }else{
        settings = lobby[userId]
    }
    const baseData = makeBaseData(message, userId);
    if (!lobby[userId]) {
        console.error('User not found in lobby:', userId);
        return null;
    }

    const checkpoints = checkpointmenu.map(checkpoint => {
        const callbackData = compactSerialize({ ...baseData, action: `scp_${checkpoint.name}` });
        if (isValidCallbackData(callbackData)) {
            return [{
                text: `${settings.checkpoint == checkpoint.name ? '✅ '+checkpoint.name : checkpoint.name} - ${checkpoint.description}`,
                callback_data: callbackData,
            }];
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${checkpoint.name} - ${checkpoint.description}`,
            //     callback_data: 'invalid_callback_data'
            // }];
        }
    });

    return {
        inline_keyboard: checkpoints
    };
}

function getVoiceMenu(userId, message) {
    const group = getGroup(message)
    let settings;
    if(group){
        settings = group.settings;
    }else{
        settings = lobby[userId]
    }
    const baseData = makeBaseData(message,userId);
    if(!lobby[userId]) {
        console.log('User not in the lobby', userId);
        return null;
    }

    const voices = voiceModels.map(voice => {
        const callbackData = compactSerialize({ ...baseData, action: `sv_${voice.name}`});
        if(isValidCallbackData(callbackData)) {
            return [{
                    text: `${settings.voiceModel == voice.modelId ? '✅ '+voice.name : voice.name}`,
                    callback_data: callbackData,
            }]
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${voice.name} - Not Available`,
            //     callback_data: 'invalid_callback_data'
            // }]
        }
    })

    return {
        inline_keyboard: voices
    };
}

function getWatermarkMenu(userId, message) {
    const group = getGroup(message)
    let settings;
    if(group){
        settings = group.settings;
    }else{
        settings = lobby[userId]
    }
    const baseData = makeBaseData(message,userId);
    if(!lobby[userId]) {
        console.log('User not in the lobby', userId);
        return null;
    }

    const watermarkKeyboard = watermarkmenu.map(watermark => {
        const callbackData = compactSerialize({ ...baseData, action: `swm_${watermark.name}`});
        if(isValidCallbackData(callbackData)) {
            return [{
                    text: `${settings.waterMark == watermark.name ? '✅ '+watermark.name : watermark.name}`,
                    callback_data: callbackData,
            }]
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${voice.name} - Not Available`,
            //     callback_data: 'invalid_callback_data'
            // }]
        }
    })

    return {
        inline_keyboard: watermarkKeyboard
    };
}



module.exports = {
    home,
    justSet,
    signedOut,
    getPromptMenu,
    getCheckpointMenu,
    getVoiceMenu,
    getWatermarkMenu,
    handleCreate,
    setMenu,
    handleEffect,
    handleAnimate,
    handleUtils,
    handleCheckpointMenu,
    handleBasePromptMenu,
    handleVoiceMenu,
    handleWatermarkMenu
}