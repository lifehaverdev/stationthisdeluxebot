const { lobby } = require('../bot')
const { basepromptmenu } = require('../../models/basepromptmenu')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { voiceModels } = require('../../models/voiceModelMenu')
const { watermarkmenu } = require('../../models/watermarks')
const { compactSerialize, sendMessage, editMessage, makeBaseData, gated } = require('../../utils')
//const { getPromptMenu, getCheckpointMenu, getVoiceMenu, getWatermarkMenu } = require('../../../models/userKeyboards')
const {getGroup} = require('./iGroup')

function setMenu(message) {
    const settings = getSettings(message);
    const group = getGroup(message);
    const userBalance = lobby[message.from.id] ? lobby[message.from.id].balance : 0;

    const options = buildSetMenu(settings,group,userBalance)

    // Sending an empty message to set the keyboard
    sendMessage(message, 'Settings', options);
}

function buildSetMenu(settings, group, userBalance) {
    const inlineKeyboard = [
        createPromptOption(settings),
        [
            { text: `batch ${settings.input_batch}`, callback_data: 'setbatch' },
            { text: 'size', callback_data: 'setsize' },
            { text: `steps ${settings.input_steps}`, callback_data: 'setsteps' }
        ],
        [
            { text: `control ${getStatusIcon(settings.controlNet, settings.input_control_image)}`, callback_data: 'setcontrol' },
            { text: `style ${getStatusIcon(settings.styleTransfer, settings.input_style_image)}`, callback_data: 'setstyle' },
            { text: `pose ${getStatusIcon(settings.openPose, settings.input_pose_image)}`, callback_data: 'setpose' }
        ],
        [
            { text: `cfg ${settings.input_cfg}`, callback_data: 'setcfg' },
            { text: `strength ${settings.input_strength}`, callback_data: 'setstrength' },
            { text: `seed ${settings.input_seed}`, callback_data: 'setseed' }
        ],
        [],
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
    ];

    if (userBalance >= 100000 || group) {
        inlineKeyboard[4] = inlineKeyboard[4] || [];
        inlineKeyboard[4].push(
            { text: `${settings.basePrompt} ✅`, callback_data: 'basepromptmenu' },
            { text: `${settings.input_checkpoint} ✅`, callback_data: 'checkpointmenu' }
        );
    }

    return {
        reply_markup: {
            inline_keyboard: inlineKeyboard,
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
}


function getStatusIcon(setting, imageSet) {
    if (setting && imageSet) return '✅';
    if (setting && !imageSet) return '🆘';
    return '❌';
}

function getSettings(message) {
    const group = getGroup(message);
    if (group) {
        console.log('yes to group');
        return group.settings;
    } else {
        return lobby[message.from.id];
    }
}

function createPromptOption(settings) {
    //console.log(settings.userPrompt)
    return [
        { text: 'prompt', callback_data: 'setprompt' },
        { text: settings.input_negative != '-1' && settings.input_negativve ? 'negprompt ✅' : 'negprompt', callback_data: 'setnegprompt' },
        { text: settings.userPrompt != "-1" && settings.userPrompt ? 'userprompt ✅' : 'userprompt', callback_data: 'setuserprompt' }
    ];
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
                {
                    text: 
                        settings.controlNet && settings.input_control_image ? 
                        'control ✅' : 
                        settings.controlNet && !settings.input_control_image ? 
                        'control 🆘' : 'control ❌',
                    callback_data: 'toggleControlCreate',
                },
                {
                    text:
                        settings.styleTransfer && settings.input_style_image ?
                        'style ✅' : 
                        settings.styleTransfer && !settings.input_style_image ?
                        'style 🆘' : 'style ❌',
                    callback_data: 'toggleStyleCreate',
                },
                {
                    text:
                        settings.openPose && settings.input_pose_image ? 
                        'pose ✅' : 
                        settings.openPose && !settings.input_pose_image ?
                        'pose 🆘' : 'pose ❌',
                    callback_data: 'togglePoseCreate'
                }
                // { text: settings.poseFileUrl ? 'pose ✅' : 'pose ❌', callback_data: 'setpose'},
                // { text: settings.styleFileUrl ? 'style ✅' : 'style ❌', callback_data: 'setstyle'},
                // { text: settings.controlFileUrl ? 'control ✅' : 'control ❌', callback_data: 'setcontrol'}
            ],
            // [   
            //     { text: settings.advancedUser ? '💬💃🏼➡️🖼️' : 'txt2img style transfer', callback_data: 'make_style' },
            // ],
            // [   
            //     { text: settings.advancedUser ? '💬🩻➡️🖼️' : 'txt2img controlnet', callback_data: 'make_control' },
            // ],
            // [   
            //     { text: settings.advancedUser ? '💬💃🏼🩻➡️🖼️' : 'txt2img controlnet + style transfer', callback_data: 'make_control_style' },
            // ],
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
            [
                { text: settings.advancedUser ? '💬➡️FLUX🖼️' : 'FLUX txt2img', callback_data: 'flux' },
            ]
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
                //{ text: settings.advancedUser ? '🖼️➡️💽' : 'disc', callback_data: 'disc'}
            ]
        )
      }
      if(lobby[message.from.id] && balance >= 300000){
        options.reply_markup.inline_keyboard.push(
            [
                { text: settings.advancedUser ? '💬➡️📜' : 'assist', callback_data: 'assistMenu'},
                { text: settings.advancedUser ? '🖼️➡️💬' : 'interrogate', callback_data: 'interMenu'},
            ],
            // [
            //     { text: settings.advancedUser ? '🖼️➡️FLUX💬' : 'Flux inter', callback_data: 'finterrogate'},
            // ]
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
    options.reply_markup.inline_keyboard.push(
        [
            { text: settings.advancedUser ? '🖼️➡️FLUX🖼️' : 'image2fluximage', callback_data: 'fluxi2i' },
        ]
    )
    if(lobby[message.from.id] && balance >= 400000){
        options.reply_markup.inline_keyboard.unshift(
            [
                {
                    text: 
                        settings.controlNet && settings.input_control_image ? 
                        'control ✅' : 
                        settings.controlNet && !settings.input_control_image ? 
                        'control ♻️' : 'control ❌',
                    callback_data: 'toggleControlEffect',
                },
                {
                    text:
                        settings.styleTransfer && settings.input_style_image ?
                        'style ✅' : 
                        settings.styleTransfer && !settings.input_style_image ?
                        'style ♻️' : 'style ❌',
                    callback_data: 'toggleStyleEffect',
                },
                {
                    text:
                        settings.openPose && settings.input_pose_image ? 
                        'pose ✅' : 
                        settings.openPose && !settings.input_pose_image ?
                        'pose ♻️' : 'pose ❌',
                    callback_data: 'togglePoseEffect'
                }
                // { text: settings.poseFileUrl ? 'pose ✅' : 'pose ❌', callback_data: 'setpose'},
                // { text: settings.styleFileUrl ? 'style ✅' : 'style ❌', callback_data: 'setstyle'},
                // { text: settings.controlFileUrl ? 'control ✅' : 'control ❌', callback_data: 'setcontrol'}
            ],
        )
        // options.reply_markup.inline_keyboard.push(
        //     [
        //         { text: settings.advancedUser ? '🖼️💃🏼➡️🖼️' : 'image2image style transfer', callback_data: 'ms2_style' },
        //         { text: settings.advancedUser ? '🖼️💃🏼👾➡️🖼️' : 'autoi2i style transfer', callback_data: 'pfp_style' },
        //     ]
        // )
        // options.reply_markup.inline_keyboard.push(
        //     [
        //         { text: settings.advancedUser ? '🖼️🩻➡️🖼️' : 'image2image controlnet', callback_data: 'ms2_control'},
        //         { text: settings.advancedUser ? '🖼️🩻👾➡️🖼️' : 'autoi2i controlnet', callback_data: 'pfp_control'}
        //     ]
        // )
        // options.reply_markup.inline_keyboard.push(
        //     [
        //         { text: settings.advancedUser ? '🖼️💃🏼🩻➡️🖼️' : 'image2image controlnet + style transfer', callback_data: 'ms2_control_style'},
        //         { text: settings.advancedUser ? '🖼️💃🏼🩻👾➡️🖼️' : 'autoi2i controlnet + style transfer', callback_data: 'pfp_control_style'}
        //     ]
        // )
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
            ],
            [
                { text: settings.advancedUser ? '🖼️➡️🎞️V2' : 'img2videoV2', callback_data: 'ms3.2' },
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
            [{ text: '/account' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
        selective: true,
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

function getInterrogateMenu() {

    const interrogateKeyboard = [
        [{text: 'SDXL', callback_data: 'interrogate'}],
        [{text: 'FLUX', callback_data: 'finterrogate'}]
    ]

    return {
        inline_keyboard: interrogateKeyboard
    };
}

function getAssistMenu() {

    const interrogateKeyboard = [
        [{text: 'SDXL', callback_data: 'assist'}],
        [{text: 'FLUX', callback_data: 'flassist'}]
    ]

    return {
        inline_keyboard: interrogateKeyboard
    };
}

async function handleInterrogateMenu(message,user) {
    const reply_markup = getInterrogateMenu();
    if(user){
        console.log('we have user')
        editMessage(
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Which prompt format?',
                reply_markup
            }
        )
    } else {
        console.log('no user i guess')
        const botMessage = await sendMessage(message, 'Which prompt format?');
        const chat_id = botMessage.chat.id;
        const message_id = botMessage.message_id;
        editMessage(
            {
                reply_markup,
                chat_id,
                message_id
            }
        );
    }
            
}

async function handleAssistMenu(message,user) {
    const reply_markup = getAssistMenu();
    if(user){
        console.log('we have user')
        editMessage(
            {
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Which prompt format?',
                reply_markup
            }
        )
    } else {
        console.log('no user i guess')
        const botMessage = await sendMessage(message, 'Which prompt format?');
        const chat_id = botMessage.chat.id;
        const message_id = botMessage.message_id;
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
    home,
    justSet,
    signedOut,
    getPromptMenu,
    getCheckpointMenu,
    getVoiceMenu,
    getWatermarkMenu,
    handleCreate,
    setMenu, buildSetMenu,
    handleEffect,
    handleAnimate,
    handleUtils,
    handleCheckpointMenu,
    handleBasePromptMenu,
    handleVoiceMenu,
    handleWatermarkMenu,
    handleInterrogateMenu,
    handleAssistMenu, 
}