const { lobby, rooms, STATES,
    workspace,
    actionMap,
    prefixHandlers,
    getPhotoUrl,
} = require('../bot')
const { basepromptmenu } = require('../../models/basepromptmenu')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { voiceModels } = require('../../models/voiceModelMenu')
const { watermarkmenu } = require('../../models/watermarks')
const { compactSerialize, sendMessage, editMessage, makeBaseData, gated, setUserState } = require('../../utils')
//const { getPromptMenu, getCheckpointMenu, getVoiceMenu, getWatermarkMenu } = require('../../../models/userKeyboards')
const iMake = require('./iMake')
const iMedia = require('./iMedia')
function getGroup(message) {
    const group = rooms.find(group => group.chat.id == message.chat.id)
    return group;
}

function setMenu(message) {
    const settings = getSettings(message);
    
    const group = getGroup(message);
    const userBalance = lobby[message.from.id] ? lobby[message.from.id].balance : 0;

    const options = buildSetMenu(settings,group,userBalance)

    // Sending an empty message to set the keyboard
    sendMessage(message, group ? `${group.title} Settings` : 'Settings', options);
}

async function backToSet(message,user) {
    //console.log(message)
    message.from.id = user
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const group = getGroup(message)
    const settings = getSettings(message);
    //console.log(settings)
    const userBalance = lobby[user] ? lobby[user].balance : 0;
    const options = buildSetMenu(settings,group,userBalance)
    setUserState(message,STATES.IDLE);
    await editMessage({
        ...options,
        chat_id: chatId,
        message_id: messageId,
        text: group ? `${group.title} Settings` : 'Settings'
    })
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
    if (!setting && imageSet) return '💤';
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
        { text: settings.input_negative != '-1' && settings.input_negative ? 'negprompt ✅' : 'negprompt', callback_data: 'setnegprompt' },
        { text: settings.userPrompt != "-1" && settings.userPrompt ? 'userprompt ✅' : 'userprompt', callback_data: 'setuserprompt' }
    ];
}

// Look good?
async function handleCreate(message, prompt = '', user = null) {
    let userId = message.from.id
    let isCallback = false
    if(user !== null){
        userId = user;
        isCallback = true
    }
    const targetUserId = isCallback ? user : message.from.id;
    const group = getGroup(message);
    const settings = group ? group.settings : lobby[targetUserId];
    const balance = group ? group.applied : settings.balance;
    // If createSwitch is missing, set it to SDXL by default
    if (!settings.createSwitch) {
        settings.createSwitch = 'SDXL';
    }

    // Router logic based on createSwitch
    const routeToHandler = async () => {
        switch (settings.createSwitch) {
            case 'SD1.5':
            case 'SDXL':
                return await iMake.handleMake(message, prompt, targetUserId); // No state needed if prompt exists
            case 'FLUX':
                return await iMake.handleFlux(message, prompt, targetUserId); // No state needed if prompt exists
            case 'SD3':
                return await iMake.handleMake3(message, prompt, targetUserId); // No state needed if prompt exists
            default:
                console.error(`Unknown createSwitch value: ${settings.createSwitch}`);
                return await sendMessage(message, 'Sorry, something went wrong with your model type.');
        }
    };

    // If a prompt is provided, route immediately without setting state
    if (prompt && prompt.trim()) {
        return await routeToHandler();
    }

    // Set user state based on createSwitch if no prompt is provided
    switch (settings.createSwitch) {
        case 'SD1.5':
        case 'SDXL':
            setUserState(message, STATES.MAKE); // SDXL and SD1.5 use MAKE state
            break;
        case 'FLUX':
            setUserState(message, STATES.FLUX);
            break;
        case 'SD3':
            setUserState(message, STATES.MAKE3);
            break;
        default:
            console.error(`Unknown createSwitch value: ${settings.createSwitch}`);
            return await sendMessage(message, 'Sorry, something went wrong with your model type.');
    }

    // Generate reply_markup for the feature menu
    const reply_markup = generateFeatureMenu(settings, balance, 'create');

    // If in a callback context, use editMessage
    if (isCallback) {
        try {
            await editMessage({
                text: `What shall I create for you?`,
                reply_markup,
                chat_id: message.chat.id,
                message_id: message.message_id,
            });
        } catch (error) {
            console.error(`Edit message error:`, {
                message: error.message || '',
                name: error.name || '',
                code: error.code || '',
            });
        }
    } else {
        // Otherwise, send a new message
        const sent = await sendMessage(message, `What shall I create for you, @${message.from.username}?`,{reply_markup});
        workspace[userId] = {message: sent, 'context': 'create'}
    }
}


// Helper to extract prompt from message text
function extractPromptFromMessage(message) {
    const commandLength = '/create'.length;
    const text = message.text || '';
    return text.length > commandLength ? text.slice(commandLength).trim() : null;
}

// Generate feature menu
function generateFeatureMenu(settings, balance, context) {
    const buttons = [];

    // Model switch buttons
    buttons.push([
        { text: settings.createSwitch === 'SD1.5' ? '🔘SD1.5' : '⚪️SD1.5', callback_data: `createswitch_SD1.5_${context}` },
        { text: settings.createSwitch === 'SDXL' ? '🔘SDXL' : '⚪️SDXL', callback_data: `createswitch_SDXL_${context}` },
        { text: settings.createSwitch === 'SD3' ? '🔘SD3' : '⚪️SD3', callback_data: `createswitch_SD3_${context}` },
        { text: settings.createSwitch === 'FLUX' ? '🔘FLUX' : '⚪️FLUX', callback_data: `createswitch_FLUX_${context}` },
    ]);

    // Extras for SDXL with sufficient balance
    if (settings.createSwitch === 'SDXL' && balance >= 400000) {
        buttons.push([
            {
                text: settings.styleTransfer && settings.input_style_image
                    ? settings.advancedUser ? '✅💃🏼' : '✅style'
                    : settings.styleTransfer
                    ? settings.advancedUser ? '❗️💃🏼' : '❗️style'
                    : settings.advancedUser ? '⚪️💃🏼' : '⚪️style',
                callback_data: `togplus_${context}_styleTransfer`,
            },
            {
                text: settings.controlNet && settings.input_control_image
                    ? settings.advancedUser ? '✅🩻' : '✅control'
                    : settings.controlNet
                    ? settings.advancedUser ? '❗️🩻' : '❗️control'
                    : settings.advancedUser ? '⚪️🩻' : '⚪️control',
                callback_data: `togplus_${context}_controlNet`,
            },
            {
                text: settings.openPose && settings.input_pose_image
                    ? settings.advancedUser ? '✅🤾🏼‍♀️' : '✅pose'
                    : settings.controlNet
                    ? settings.advancedUser ? '❗️🤾🏼‍♀️' : '❗️pose'
                    : settings.advancedUser ? '⚪️🤾🏼‍♀️' : '⚪️pose',
                callback_data: `togplus_${context}_openPose`,
            },
        ]);
    }

    // Extras for FLUX (currently commented out)
    if (settings.createSwitch === 'FLUX' && balance >= 400000) {
        buttons.push([
            {
                text: settings.controlNet && settings.input_control_image
                    ? settings.advancedUser ? '✅🩻' : '✅control'
                    : settings.controlNet
                    ? settings.advancedUser ? '❗️🩻' : '❗️control'
                    : settings.advancedUser ? '⚪️🩻' : '⚪️control',
                callback_data: `togplus_${context}_controlNet`,
            },
        ]);
    }

    // Insufficient balance (only Cancel button)
    if (balance < 400000) {
        buttons.length = 0; // Clear existing buttons
    }

    // Add Cancel button
    buttons.push([{ text: 'nvm', callback_data: 'cancel' }]);

    return { inline_keyboard: buttons };
}

actionMap['toggleFeature'] = async (message, user, context, target) => {
    if (!lobby.hasOwnProperty(user)) {
        console.log('toggle feature callback couldn’t find user in lobby');
        return;
    }

    // Toggle the specified feature in the user's lobby
    lobby[user][target] = !lobby[user][target];

    // Check if the toggled feature requires a value
    const featureToLobbyParam = {
        styleTransfer: 'input_style_image',
        controlNet: 'input_control_image',
        openPose: 'input_pose_image',
    };

    if (lobby[user][target] && featureToLobbyParam.hasOwnProperty(target)) {
        const lobbyParam = featureToLobbyParam[target]; // e.g., 'input_style_image'
        // Check if the corresponding value is missing
        if (!lobby[user][lobbyParam]) {
            const feature = target === 'styleTransfer' ? 'style' :
                            target === 'controlNet' ? 'control' : 'pose';
            return promptForFeatureValue(feature, message, user); // Prompt for missing value
        }
    }

    // Update the message.from.id to reflect the user
    message.from.id = user;

    // Call the appropriate handler based on the context
    switch (context) {
        case 'create':
            handleCreate(message, '', user);
            break;
        case 'effect':
            handleEffect(message, '', user);
            break;
        case 'set':
            handleSet(message, '', user); // Placeholder for 'set' context
            break;
        default:
            console.error(`Unknown context: ${context}`);
    }
};


async function promptForFeatureValue(feature, message, user) {
    // Mapping from feature to prompts and states
    const featureConfig = {
        style: {
            promptText: 'Send in a photo to apply style transfer on',
            state: STATES.SETSTYLE, // Corresponds to STATES.SETSTYLE
        },
        control: {
            promptText: 'Send in a photo to apply controlnet from',
            state: STATES.SETCONTROL, // Corresponds to STATES.SETCONTROL
        },
        pose: {
            promptText: 'Send in a photo to apply openPose on',
            state: STATES.SETPOSE, // Corresponds to STATES.SETPOSE
        },
    };

    const config = featureConfig[feature];
    if (!config) {
        console.error(`Unknown feature: ${feature}`);
        return;
    }

    const { promptText, state } = config;

    // Build optional inline keyboard
    const reply_markup = {
        inline_keyboard: [[{ text: '↖︎', callback_data: 'backToSet' }]],
    };

    // Add the context flag to the workspace
    workspace[user] = {
        chat_id: message.chat.id,
        message_id: message.message_id,
        context: 'create', // Add context flag for navigation
    };

    console.log(`Workspace updated for user ${user}:`, workspace[user]);

    // Set user state and prompt for input
    setUserState({ ...message, from: { id: user } }, state); // Use the correct state from mapping
    console.log(`User state set to: ${state}`);

    // Edit the current message to display the prompt
    await editMessage({
        text: promptText,
        reply_markup,
        chat_id: message.chat.id,
        message_id: message.message_id,
        options: { parse_mode: 'Markdown' },
    });
}

prefixHandlers['togplus_'] = (action, message, user) => {
    // Extract context and target from the action
    const parts = action.split('_');
    const context = parts[1]; // e.g., "create", "effect", "set"
    const target = parts[2];  // e.g., "style", "control", "pose"

    // Ensure the action map uses the toggleFeature function
    actionMap['toggleFeature'](message, user, context, target);
};

prefixHandlers['createswitch_'] = (action, message, user) => {
    // Extract context and target from the action
    const parts = action.split('_');
    const target = parts[1];  // e.g., "FLUX", "SD1.5", "SDXL"
    const context = parts[2]; // e.g., "create", "effect", "set"

    // Ensure the action map uses the toggleFeature function
    actionMap['switchModel'](message, user, context, target);
};

actionMap['switchModel'] = (message, user, context, target) => {
    creationSwitch(message, user, context, target);
};

function creationSwitch(message, user, context, target) {
    // Ensure the user exists in the lobby
    if (!lobby.hasOwnProperty(user)) {
        console.log('creationSwitch callback couldn’t find user in lobby');
        return;
    }

    // Update the createSwitch value in the user's settings
    const settings = lobby[user];
    if (['FLUX', 'SD1.5', 'SDXL', 'SD3'].includes(target)) {
        settings.createSwitch = target;
        console.log(`createSwitch updated to: ${target}`);
    } else {
        console.error(`Invalid target for createSwitch: ${target}`);
        return;
    }

    // Navigate back to the appropriate menu based on context
    switch (context) {
        case 'create':
            handleCreate(message,'', user);
            break;
        case 'effect':
            effectMenu(settings, user, { chat_id: message.chat.id, message_id: message.message_id });
            break;
        case 'set':
            // Call setMenu or any other relevant menu for 'set' context
            const setMenu = iMenu.buildSetMenu(settings, null, settings.balance);
            editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: 'Set menu updated.',
                ...setMenu,
            });
            break;
        default:
            console.error(`Unknown context: ${context}`);
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
                { text: settings.advancedUser ? '🌠➡️⭐️' : 'remove background', callback_data: 'rmbg' },
            ],
            [
                { text: settings.advancedUser ? '🖼️💦✍️' : 'watermark', callback_data: 'watermark'},
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
// function handleEffect(message) {
//     const group = getGroup(message);
//     let settings;
//     let balance;
//     if(group){
//         settings = group.settings;
//         balance = group.applied;
//     }else{
//         settings = lobby[message.from.id]
//         balance = settings.balance
//     }
//     const options = {
//         reply_markup: {
//           inline_keyboard: [
//             [   
//                 { text: settings.advancedUser ? '🖼️➡️🖼️' : 'image2image', callback_data: 'ms2' },
//             ],

//         ],
//           resize_keyboard: true,
//           one_time_keyboard: true
//         }

//     };
//     if(lobby[message.from.id] && balance >= 300000){
//         options.reply_markup.inline_keyboard[0] = 
//         [   
//             { text: settings.advancedUser ? '🖼️➡️🖼️' : 'image2image', callback_data: 'ms2' },
//             { text: settings.advancedUser ? '🖼️👾➡️🖼️' : 'autoi2i', callback_data: 'pfp' },
//         ];
//     }
//     options.reply_markup.inline_keyboard.push(
//         [
//             { text: settings.advancedUser ? '🖼️➡️FLUX🖼️' : 'image2fluximage', callback_data: 'fluxi2i' },
//         ]
//     )
//     if(lobby[message.from.id] && balance >= 400000){
//         options.reply_markup.inline_keyboard.unshift(
//             [
//                 {
//                     text: 
//                         settings.controlNet && settings.input_control_image ? 
//                         'control ✅' : 
//                         settings.controlNet && !settings.input_control_image ? 
//                         'control ♻️' : 'control ❌',
//                     callback_data: 'toggleControlEffect',
//                 },
//                 {
//                     text:
//                         settings.styleTransfer && settings.input_style_image ?
//                         'style ✅' : 
//                         settings.styleTransfer && !settings.input_style_image ?
//                         'style ♻️' : 'style ❌',
//                     callback_data: 'toggleStyleEffect',
//                 },
//                 {
//                     text:
//                         settings.openPose && settings.input_pose_image ? 
//                         'pose ✅' : 
//                         settings.openPose && !settings.input_pose_image ?
//                         'pose ♻️' : 'pose ❌',
//                     callback_data: 'togglePoseEffect'
//                 }
//                 // { text: settings.poseFileUrl ? 'pose ✅' : 'pose ❌', callback_data: 'setpose'},
//                 // { text: settings.styleFileUrl ? 'style ✅' : 'style ❌', callback_data: 'setstyle'},
//                 // { text: settings.controlFileUrl ? 'control ✅' : 'control ❌', callback_data: 'setcontrol'}
//             ],
//         )
//         // options.reply_markup.inline_keyboard.push(
//         //     [
//         //         { text: settings.advancedUser ? '🖼️💃🏼➡️🖼️' : 'image2image style transfer', callback_data: 'ms2_style' },
//         //         { text: settings.advancedUser ? '🖼️💃🏼👾➡️🖼️' : 'autoi2i style transfer', callback_data: 'pfp_style' },
//         //     ]
//         // )
//         // options.reply_markup.inline_keyboard.push(
//         //     [
//         //         { text: settings.advancedUser ? '🖼️🩻➡️🖼️' : 'image2image controlnet', callback_data: 'ms2_control'},
//         //         { text: settings.advancedUser ? '🖼️🩻👾➡️🖼️' : 'autoi2i controlnet', callback_data: 'pfp_control'}
//         //     ]
//         // )
//         // options.reply_markup.inline_keyboard.push(
//         //     [
//         //         { text: settings.advancedUser ? '🖼️💃🏼🩻➡️🖼️' : 'image2image controlnet + style transfer', callback_data: 'ms2_control_style'},
//         //         { text: settings.advancedUser ? '🖼️💃🏼🩻👾➡️🖼️' : 'autoi2i controlnet + style transfer', callback_data: 'pfp_control_style'}
//         //     ]
//         // )
//         options.reply_markup.inline_keyboard.push(
//             [
//                 { text: settings.advancedUser ? '🖼️🔍➡️🎨🖼️' : 'inpaint', callback_data: 'inpaint'},
//             ]
//         )
//     }
//     options.reply_markup.inline_keyboard.push(
//         [
//             { text: 'cancel', callback_data: 'cancel' }
//         ]
//     )
//       // Sending an empty message to set the keyboard
//     sendMessage(message,'Effect', options);
// }


async function handleEffect(message, prompt = '', user = null) {
    const isCallback = user !== null; // Check if this is a callback context
    const targetUserId = isCallback ? user : message.from.id;
    const group = getGroup(message);
    const settings = group ? group.settings : lobby[targetUserId];
    const balance = group ? group.applied : settings.balance;

    // If createSwitch is missing, set it to SDXL by default
    if (!settings.createSwitch) {
        settings.createSwitch = 'SDXL';
        // if (!isCallback) {
        //     await sendMessage(message, `Your model type has been set to SDXL by default. You can change it later if needed.`);
        // }
    }

    // Check for attached image or reply to an image
    const attachedImage = getPhotoUrl(message);
    const isReply = message.reply_to_message && getPhotoUrl(message.reply_to_message);
    const image = attachedImage || isReply;

    // If a prompt and image are provided, route directly
    if (prompt && image) {
        return await routeEffectWorkflow(prompt, image, settings, message);
    }

    // If only a prompt is provided, prompt for the image
    if (prompt && !image) {
        setUserState(message, STATES.WAITING_FOR_IMAGE);
        return await sendMessage(message, `Please send an image to apply the effect.`);
    }

    // If no prompt or image, show the effect menu
    const reply_markup = generateFeatureMenu(settings, balance, 'effect');
    if (isCallback) {
        try {
            await editMessage({
                text: `What effect shall I apply for you?`,
                reply_markup,
                chat_id: message.chat.id,
                message_id: message.message_id,
            });
        } catch (error) {
            console.error(`Edit message error:`, error);
        }
    } else {
        await sendMessage(message, `What effect shall I apply for you, @${message.from.username}?`, { reply_markup });
    }
}

function getImageFromMessage(message) {
    if (!message || !message.photo) return null;

    const fileUrl = getPhotoUrl(message)
    return fileUrl // Return the highest resolution image
}

async function routeEffectWorkflow(message,image,prompt) {
    switch (settings.createSwitch) {
        case 'SD1.5':
        case 'SDXL':
            return await iMedia.handleMs2ImgFile(message, image, prompt);
        case 'FLUX':
            return await handleImg2ImgFlux(message, image, prompt);
        // case 'SD3':
        //     return await handleImg2ImgSD3(message, prompt, image, settings);
        default:
            console.error(`Unknown createSwitch value: ${settings.createSwitch}`);
            return await sendMessage(message, 'Sorry, something went wrong with your model type.');
    }
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
    setMenu, buildSetMenu, backToSet,
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