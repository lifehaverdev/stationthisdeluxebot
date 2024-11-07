const { STATES, lobby, rooms, flows, makeSeed } = require('../bot')
const { sendMessage, react, setUserState, editMessage, gated } = require('../../utils')
const { enqueueTask } = require('../queue')
//const { writeUserData } = require('../../../db/mongodb')
//const { checkLobby } = require('../gatekeep')
const { getGroup } = require('./iGroup')

function checkAndSetType(type, settings, message, group, userId) {

    // Define required files based on settings
    const requiredFiles = [];
    
    if (settings.styleTransfer) requiredFiles.push({ name: 'input_style_image', message: 'You need to set a style image.' });
    if (settings.controlNet) requiredFiles.push({ name: 'input_control_image', message: 'You need to set a control image.' });
    if (settings.openPose) requiredFiles.push({ name: 'input_pose_image', message: 'You need to set a pose image.' });
    if (requiredFiles.length > 0 && tokenGate(group, userId, message)) return // Early return for token gate if needed
    
    // Check if any required files are missing
    for (let file of requiredFiles) {
        if (!settings[file.name]) {
            sendMessage(message, `${file.message} use /set menu or turn it off in /create or /effect menu`);
            return;
        }
    }

    // Dynamically build the type
    if (settings.controlNet && settings.input_control_image) type += '_CANNY';
    if (settings.styleTransfer && settings.input_style_image) type += '_STYLE';
    if (settings.openPose && settings.input_pose_image) type += '_POSE';
    return type;
}

function tokenGate(group, userId, message) {
    if(!group && lobby[userId] && lobby[userId].balance < 400000) {
        gated(message)
        return true
    }
    if(group && group.applied < 400000){
        gated(message)
        return true
    }
}

// async function startMake(message, user = null) {
//     console.log('start make from iMake')
//     if(user){
//         message.from.id = user;
//         await editMessage({
//             text: 'What prompt for your txt2img?',
//             chat_id: message.chat.id,
//             message_id: message.message_id
//         })
//     } else {
//         sendMessage(message, 'What prompt for your txt2img?')
//     }
//     //await sendMessage(message,'What prompt for your txt2img?')
//     //console.log('user in start make',message.from.id);
//     //console.log('message in start make',message);
//     setUserState(message,STATES.MAKE)
// }
// async function startMake3(message,user) {
//     if(user){
//         message.from.id = user;
//         await editMessage({
//             text: 'What prompt for your txt2img sd3',
//             chat_id: message.chat.id,
//             message_id: message.message_id
//         })
//     } else {
//         if(lobby[message.from.id] && lobby[message.from.id].balance <= 500000){
//             gated(message)
//             return
//         }
//         sendMessage(message, 'What prompt for your txt2img sd3')
//     }
//     //await sendMessage(message,'What prompt for your txt2img sd3');
//     setUserState(message,STATES.MAKE3)
// }
// async function startMog(message,user) {
//         if(user){
//             message.from.id = user;
//             await editMessage({
//                 text: 'What prompt for your txt2img mogflux',
//                 chat_id: message.chat.id,
//                 message_id: message.message_id
//             })
//         } else {
//             // if(lobby[message.from.id] && lobby[message.from.id].balance <= 100000){
//             //     gated(message)
//             //     return
//             // }
//             sendMessage(message, 'What prompt for your txt2img mogflux')
//         }
//         //await sendMessage(message,'What prompt for your txt2img sd3');
//         setUserState(message,STATES.MOG)
// }

async function startTaskPrompt(message, taskType, state, user = null, balanceCheck = null) {
    const promptText = `What is the prompt for your ${taskType.toLowerCase()} creation?`;

    if (user) {
        message.from.id = user;
        await editMessage({
            text: promptText,
            chat_id: message.chat.id,
            message_id: message.message_id
        });
    } else {
        // Handle balance check if provided
        if (balanceCheck && lobby[message.from.id] && lobby[message.from.id].balance <= balanceCheck) {
            gated(message);
            return;
        }
        sendMessage(message, promptText);
    }

    // Set the user state
    setUserState(message, state);
}

function buildPromptObjFromWorkflow(workflow, userContext, message) {
    // Start by creating a promptObj with direct mappings from userContext based on workflow input names
    const promptObj = {};
    promptObj.type = userContext.type;
    promptObj.userPrompt = userContext.userPrompt;
    promptObj.basePrompt = userContext.basePrompt;
    promptObj.timeRequested = Date.now();
    promptObj.prompt = userContext.prompt;
    promptObj.forcelogo = userContext.forcelogo || false;
    promptObj.advancedUser = userContext.advancedUser;
    promptObj.balance = userContext.balance;
    promptObj.userId = userContext.userId;

    // Loop through workflow inputs and populate promptObj from userContext
    workflow.inputs.forEach((input) => {
        if (userContext.hasOwnProperty(input)) {
            promptObj[input] = userContext[input];
        }
    });
    //if(promptObj.input_checkpoint) promptObj.input_checkpoint += '.safetensors'
    // Derived fields based on internal logic
    if (userContext.styleTransfer) {
        promptObj.input_style_image = userContext.input_style_image;
    } else {
        delete promptObj.input_style_image;
    }
    if (userContext.openPose) {
        promptObj.input_pose_image = userContext.input_pose_image;
    } else {
        delete promptObj.input_pose_image
    }
    if (userContext.controlNet) {
        promptObj.input_control_image = userContext.input_control_image;
    } else {
        delete promptObj.input_control_image
    }
    const fluxTypes = ['FLUX','FLUXI2I','LOSER']
    if (fluxTypes.includes(userContext.type)) {
        promptObj.input_checkpoint = 'flux-schnell'
        delete promptObj.basePrompt;
    }
    if (userContext.type.includes('MAKE')) {
        console.log('we are taking out strneght')
        delete promptObj.input_image
        promptObj.input_strength = 1;
    }

    // Include message details for tracking and additional context
    promptObj.username = message.from?.username;

    return promptObj;
}

async function handleTask(message, taskType, defaultState, needsTypeCheck = false, minTokenAmount = null) {
    console.log(`HANDLING TASK: ${taskType}`);

    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);

    // Unified settings: get group settings or user settings from lobby
    const settings = group ? group.settings : lobby[userId];

    // Token gate check if minTokenAmount is provided
    if (minTokenAmount && tokenGate(group, userId, message, minTokenAmount)) {
        console.log(`Token gate failed for task ${taskType}, user lacks sufficient tokens.`);
        react(message,'👎')
        return;
    }

    // Optional: State check to ensure the user is in the correct state
    if (!group && settings.state.state !== STATES.IDLE && settings.state.state !== defaultState) {
        return;
    }


    // Check if the message text is empty, trigger the start prompt
    if (message.text === '') {
        await startTaskPrompt(message, taskType, defaultState, null, minTokenAmount);  // Use the generalized start function
        return;
    }

    // Clean the message text
    message.text = message.text.replace(`/${taskType.toLowerCase()}`, '').replace(`@${process.env.BOT_NAME}`, '');

    const thisSeed = makeSeed(userId);

    // If this is a special case (e.g., MAKE) and needs a type check
    let finalType = taskType;
    if (needsTypeCheck) {
        finalType = checkAndSetType(taskType, settings, message, group, userId);
        if (!finalType) {
            // If the type could not be set (e.g., missing required files), stop the task
            console.log('Task type could not be set due to missing files or settings.',taskType,settings,message,group,userId);
            //return 'MAKE';
            finalType = 'MAKE'
        }
    }

    // Update user settings in the lobby
    Object.assign(lobby[userId], {
        prompt: message.text,
        type: finalType,  // Use the modified type
        lastSeed: thisSeed
    });

    // Prevent batch requests in group chats
    const batch = chatId < 0 ? 1 : settings.input_batch;

    // Use the workflow reader to dynamically build the promptObj based on the workflow's required inputs
    const workflow = flows.find(flow => flow.name === finalType);
    //console.log(workflow)
    const promptObj = buildPromptObjFromWorkflow(workflow, {
        ...settings,
        prompt: message.text,
        input_seed: thisSeed,
        input_batch: batch
    }, message);

    try {
        await react(message);  // Acknowledge the command
        enqueueTask({ message, promptObj });
        setUserState(message, STATES.IDLE);
    } catch (error) {
        console.error(`Error generating and sending task for ${taskType}:`, error);
    }
}

async function handleMake(message) {
    await handleTask(message, 'MAKE', STATES.MAKE, true, null);
}

async function handleMake3(message) {
    await handleTask(message, 'MAKE3', STATES.MAKE3, false, 400000)
}

async function handleMog(message) {
    await handleTask(message, 'MOG', STATES.MOG, false, 0)
}

async function handleDegod(message) {
    console.log('DEGODDING SOMETHING')
    await handleTask(message, 'DEGOD', STATES.DEGOD, false, 0)
}

async function handleMilady(message) {
    console.log('milady')
    await handleTask(message, 'MILADY', STATES.MILADY, false, 0)
}

async function handleChud(message) {
    console.log('chud')
    await handleTask(message, 'CHUD', STATES.CHUD, false, 0)
}

async function handleLoser(message) {
    console.log('loser')
    await handleTask(message, 'LOSER', STATES.LOSER, false, 0)
}

async function handleRadbro(message) {
    console.log('radbro')
    await handleTask(message, 'RADBRO', STATES.RADBRO, false, 0)
}

async function handleFlux(message) {
    console.log('flux')
    handleTask(message,'FLUX',STATES.FLUX,false,0)
}

async function handleRegen(message, user = null) {
    const userId = message.from.id || user;

    // Check if the user exists in the lobby
    if (!lobby[userId]) {
        await sendMessage(message, "It looks like you don't have any generations to regenerate.");
        return;
    }

    const userRuns = lobby[userId].runs;

    // If no runs are available, inform the user
    if (!userRuns || userRuns.length === 0) {
        await sendMessage(message, "You don't have any previous generations to regenerate. Try generating something first!");
        return;
    }

    // Create a button for current settings
    const buttons = [
        [{ text: '🔫 raw regen', callback_data: 'regen_current_settings' }]
    ];

    // Create menu options for each run, displaying the time since the gen was requested and the type
    userRuns.forEach((run, index) => {
        const timeSinceRequest = Math.floor((Date.now() - run.timeRequested) / (1000 * 60)); // Time in minutes
        const runType = run.type || 'Unknown Type'; // Fallback to 'Unknown Type' if type is missing
        const promptSnippet = run.input_prompt ? run.input_prompt.substring(0, 10) : '';

        buttons.push([{
            text: `${runType} ${promptSnippet} ${timeSinceRequest}m`,
            callback_data: `regen_run_${index}`
        }]);
    });

    buttons.push([{ text: 'cancel', callback_data: 'cancel' }]);

    // Send the menu to the user with the list of generations to regenerate
    const options = {
        reply_markup: {
            inline_keyboard: buttons
        }
    };

    await sendMessage(message, "Choose which generation you'd like to regenerate:", options);
}

async function handleHipFire(message, user) {
    
    const userId = user;

    const thisSeed = makeSeed(userId);
    const chatId = message.chat.id;
    // If this is a special case (e.g., MAKE) and needs a type check
    const settings = lobby[userId]
    const group = getGroup(message)
    let finalType = lobby[userId].type;
    const needsTypeCheck = finalType.startsWith('MAKE') || finalType.startsWith('I2I')
    if (needsTypeCheck) {
        finalType = checkAndSetType(finalType, settings, message, group, userId);
        if (!finalType) {
            // If the type could not be set (e.g., missing required files), stop the task
            console.log('Task type could not be set due to missing files or settings.',taskType,settings,message,group,userId);
            //return 'MAKE';
            finalType = 'MAKE'
        }
    }

    // Update user settings in the lobby
    Object.assign(lobby[userId], {
        type: finalType,  // Use the modified type
        lastSeed: thisSeed
    });

    // Prevent batch requests in group chats
    const batch = chatId < 0 ? 1 : settings.input_batch;

    // Use the workflow reader to dynamically build the promptObj based on the workflow's required inputs
    const workflow = flows.find(flow => flow.name === finalType);
    //console.log(workflow)
    const promptObj = buildPromptObjFromWorkflow(workflow, {
        ...settings,
        input_seed: thisSeed,
        input_batch: batch
    }, message);

    try {
        const messageId = message.message_id;
        enqueueTask({ message, promptObj });
        setUserState(message, STATES.IDLE);
        await editMessage({
            reply_markup: {inline_keyboard: [[{}]]},
            message_id: messageId,
            chat_id: chatId,
            text: 'k'
        })
        await react(message);  // Acknowledge the command
    } catch (error) {
        console.error(`Error generating and sending task for ${taskType}:`, error);
    }
}



async function handleMs2Prompt(message) {
    // Use handleTask with 'I2I' as the taskType and STATES.I2I as the state
    await handleTask(message, 'I2I', STATES.MS2PROMPT, true, null);
}

async function handleFluxPrompt(message) {
    // Use handleTask with 'I2I' as the taskType and STATES.I2I as the state
    await handleTask(message, 'FLUXI2I', STATES.FLUXPROMPT, null, null);
}

async function handleInpaintPrompt(message) {
    // Use handleTask with 'INPAINT' as the taskType and STATES.INPAINT as the state
    await handleTask(message, 'INPAINT', STATES.INPAINTPROMPT, true, null);
}


async function handleInpaintTarget(message) {
    const userId = message.from.id;
    let userInput = message.text;
    userInput == '' ? userInput = '' : null;

    lobby[userId] = {
        ...lobby[userId],
        inpaintTarget: userInput,
        type: 'INPAINT'
    }
    await sendMessage(message, 'What do you want instead of what you described.');
    setUserState(message,STATES.INPAINTPROMPT);
}

module.exports = { 
    // startMake, 
    // startMake3, 
    //handleDexMake, 
    //handlePromptCatch,
    //startMog, 
    buildPromptObjFromWorkflow,
    handleRegen, 
    handleHipFire,
    handleMake, 
    handleMake3, 
    handleMs2Prompt,
    handleFluxPrompt,
    handleInpaintPrompt,
    handleInpaintTarget,
    handleMog, 
    handleDegod, handleMilady, handleChud, handleRadbro, handleLoser,
    handleFlux
}