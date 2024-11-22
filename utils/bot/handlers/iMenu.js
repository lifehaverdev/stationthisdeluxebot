const { lobby, rooms, STATES,
    workspace,
    actionMap,
    prefixHandlers,
    getPhotoUrl,
} = require('../bot')
const {
    cleanPrompt
} = require('../../utils')
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
        { text: settings.createSwitch === 'FLUX' ? '🔘FLUX' : '⚪️FLUX', callback_data: `createswitch_FLUX_${context}` },
    ]);

    // Extras for SDXL with sufficient balance
    if (settings.createSwitch === 'SDXL' && balance >= 400000) {
        const sdxlButtons = [
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
                    : settings.openPose
                    ? settings.advancedUser ? '❗️🤾🏼‍♀️' : '❗️pose'
                    : settings.advancedUser ? '⚪️🤾🏼‍♀️' : '⚪️pose',
                callback_data: `togplus_${context}_openPose`,
            },
        ];

        // Add the auto prompt option for the "effect" context
        if (context === 'effect') {
            sdxlButtons.push({
                text: settings.autoPrompt
                    ? settings.advancedUser ? '✅🤖🗯️' : '✅auto prompt'
                    : settings.advancedUser ? '⚪️🤖🗯️' : '⚪️auto prompt',
                callback_data: `togplus_${context}_autoPrompt`,
            });
        }

        // Add the buttons to the main array
        buttons.push(sdxlButtons);
    }

    // Extras for FLUX (currently commented out)
    // if (settings.createSwitch === 'FLUX' && balance >= 400000) {
    //     buttons.push([
    //         {
    //             text: settings.controlNet && settings.input_control_image
    //                 ? settings.advancedUser ? '✅🩻' : '✅control'
    //                 : settings.controlNet
    //                 ? settings.advancedUser ? '❗️🩻' : '❗️control'
    //                 : settings.advancedUser ? '⚪️🩻' : '⚪️control',
    //             callback_data: `togplus_${context}_controlNet`,
    //         },
    //     ]);
    // }

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

    // Special handling for `autoPrompt`
    if (target === 'autoPrompt') {
        console.log(`AutoPrompt toggled: ${lobby[user][target]}`);
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
    if (['FLUX', 'SD1.5', 'SDXL', 'SD3'].includes(target) && settings.createSwitch != target) {
        settings.createSwitch = target;
        console.log(`createSwitch updated to: ${target}`);
    } else if(settings.createSwitch == target) {
        return
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
            handleEffect(message, '', user);
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

async function handleEffect(message, prompt = '', user = null) {
    const isCallback = user !== null; // Check if this is a callback context
    const targetUserId = isCallback ? user : message.from.id;
    const group = getGroup(message);
    const settings = group ? group.settings : lobby[targetUserId];
    const balance = group ? group.applied : settings.balance;

    // If createSwitch is missing, set it to SDXL by default
    if (!settings.createSwitch) {
        settings.createSwitch = 'SDXL';
    }

    // Initialize workspace tracking
    if (!workspace[targetUserId]) {
        workspace[targetUserId] = {
            message: null,
            context: 'effect',
            prompt: '',
            imageUrl: '',
            stamp: Date.now(),
        };
    }

    // Check for attached image or reply to an image
    const attachedImage = await getPhotoUrl(message);
    const isReply = message.reply_to_message && await getPhotoUrl(message.reply_to_message);
    const image = attachedImage || isReply;

    // Route based on provided prompt and image
    if (prompt && image) {
        // If both prompt and image are provided, route directly to the workflow
        return await routeEffectWorkflow(prompt, image, settings, message);
    } else if (image && settings.autoPrompt) {
        // If image is provided and autoPrompt is enabled
        console.log('Auto prompt enabled: proceeding to auto image task.');
        workspace[targetUserId].imageUrl = image; // Update workspace with image
        return await iMedia.handleImageTask(message, 'I2I_AUTO', STATES.PFP, true, 400000);
    } else if (prompt && !image) {
        // Update workspace and settings with the prompt
        settings.prompt = prompt;
        workspace[targetUserId].prompt = prompt;

        // Set the state based on createSwitch
        switch (settings.createSwitch) {
            case 'FLUX':
                setUserState(message, STATES.FLUX2IMG);
                break;
            case 'SD1.5':
            case 'SDXL':
            case 'SD3':
                setUserState(message, STATES.IMG2IMG);
                break;
            default:
                console.error(`Unknown createSwitch value: ${settings.createSwitch}`);
                await sendMessage(message, `Sorry, something went wrong. Please try again.`);
                return;
        }

        // Edit or prompt for the missing image
        const sent = await sendMessage(message, `Please send an image to apply the effect.`);
        workspace[targetUserId].message = sent;
    } else if (!prompt && image) {
        // Update workspace with the image
        workspace[targetUserId].imageUrl = image;

        // Send to handleMs2ImgFile to process the image
        await iMedia.handleMs2ImgFile(message, image, null);
    } else {
        // If neither prompt nor image is provided, show the effect menu
        setUserState(message, STATES.EFFECTHANG); // Set the new state
        const reply_markup = generateFeatureMenu(settings, balance, 'effect');

        if (isCallback) {
            try {
                const sent = await editMessage({
                    text: `What effect shall I apply for you?`,
                    reply_markup,
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                });
                workspace[targetUserId].message = sent;
            } catch (error) {
                console.error(`Edit message error:`, error);
            }
        } else {
            const sent = await sendMessage(message, `What effect shall I apply for you, @${message.from.username}?`, { reply_markup });
            workspace[targetUserId].message = sent;
            console.log('workspace after empty effect', workspace);
        }
    }
}
async function routeEffectWorkflow(prompt, image, settings, message) {
    // Determine the task based on createSwitch
    switch (settings.createSwitch) {
        case 'SD1.5':
        case 'SDXL':
            // If autoPrompt is enabled, redirect to handleImageTask
            if (settings.autoPrompt) {
                return await iMedia.handleImageTask(message, 'I2I_AUTO', STATES.PFP, true, 400000);
            }
            return await iMedia.handleMs2ImgFile(message, image, prompt);
        case 'FLUX':
            return await iMedia.handleFluxImgFile(message, image, prompt);
        default:
            console.error(`Unknown createSwitch value: ${settings.createSwitch}`);
            return await sendMessage(message, 'Sorry, something went wrong with your model type.');
    }
}

async function handleFullCase(message, settings, image, prompt) {
    console.log('Effect Hang: Handling full case');
    // Route directly to the workflow based on createSwitch
    await routeEffectWorkflow(prompt, image, settings, message);
}

async function handleMissingImageCase(message, settings, workspaceEntry, prompt) {
    console.log('Effect Hang: Handling missing image case');
    // Update workspace and settings with the prompt
    workspaceEntry.prompt = prompt;
    settings.prompt = prompt;

    // Set the state based on createSwitch
    const state = determineState(settings.createSwitch, STATES.IMG2IMG, STATES.FLUX2IMG);
    if (!state) {
        await sendMessage(message, `Sorry, something went wrong. Please try again.`);
        return;
    }
    setUserState(message, state);

    // Prompt for the missing image
    const promptText = `Got your prompt! Now, send an image to proceed.`;
    if (workspaceEntry.message) {
        await editMessage({
            text: promptText,
            chat_id: workspaceEntry.message.chat.id,
            message_id: workspaceEntry.message.message_id,
        });
    } else {
        const sent = await sendMessage(message, promptText);
        workspace[message.from.id].message = sent;
    }
}

async function handleMissingPromptCase(message, settings, image) {
    console.log('Effect Hang: Handling missing prompt case');
    // Update workspace with the image
    workspace[message.from.id].imageUrl = image;

    // Route to the correct image handler
    switch (settings.createSwitch) {
        case 'SD1.5':
        case 'SDXL':
            await iMedia.handleMs2ImgFile(message, image, null);
            break;
        case 'FLUX':
            await iMedia.handleFluxImgFile(message, image, null);
            break;
        default:
            console.error(`Unknown createSwitch value: ${settings.createSwitch}`);
            await sendMessage(message, 'Sorry, something went wrong with your model type.');
    }
}
async function handleEffectHang(message) {
    const userId = message.from.id;
    const settings = lobby[userId];
    const workspaceEntry = workspace[userId] || {};
    console.log('Workspace entry:', workspaceEntry);

    // Check for image (from message, reply, or workspace)
    const replyImage = message.reply_to_message && await getPhotoUrl(message.reply_to_message);
    const image = await getPhotoUrl(message) || replyImage || workspaceEntry.imageUrl;

    // Check for prompt (from message or workspace)
    const prompt = cleanPrompt(message.text || message.caption || workspaceEntry.prompt || '');

    // Determine next steps based on available inputs
    if (prompt && image) {
        console.log('Effect Hang: Full case (prompt and image)');
        
        // Set state based on createSwitch
        const state = determineState(settings.createSwitch, STATES.IMG2IMG, STATES.FLUX2IMG);
        if (!state) {
            await sendMessage(message, `Sorry, something went wrong. Please try again.`);
            return;
        }
        setUserState(message, state);

        // Route to the appropriate handler
        await routeEffectWorkflow(prompt, image, settings, message);
    } else if (!prompt && image && settings.autoPrompt && settings.createSwitch === 'SDXL') {
        console.log('Effect Hang: AutoPrompt with image');
        setUserState(message, STATES.PFP);
        workspaceEntry.imageUrl = image;
        await iMedia.handleImageTask(message, 'I2I_AUTO', STATES.PFP, true, 400000);
    } else if (prompt && !image) {
        console.log('Effect Hang: Missing image');
        await handleMissingImageCase(message, settings, workspaceEntry, prompt);
    } else if (!prompt && image) {
        console.log('Effect Hang: Missing prompt');
        await handleMissingPromptCase(message, settings, image);
    } else {
        console.log('Effect Hang: Missing both inputs');
        await sendMessage(message, `Please provide a prompt or an image to continue.`);
    }

    console.log('User state after handleEffectHang:', settings.state);
}


function determineState(createSwitch, defaultState, fluxState) {
    switch (createSwitch) {
        case 'FLUX':
            return fluxState;
        case 'SD1.5':
        case 'SDXL':
        case 'SD3':
            return defaultState;
        default:
            console.error(`Unknown createSwitch value: ${createSwitch}`);
            return null;
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
    handleEffect, handleEffectHang,
    handleAnimate,
    handleUtils,
    handleCheckpointMenu,
    handleBasePromptMenu,
    handleVoiceMenu,
    handleWatermarkMenu,
    handleInterrogateMenu,
    handleAssistMenu, 
}