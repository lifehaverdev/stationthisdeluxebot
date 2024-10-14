const { STATES, lobby, rooms, flows, makeSeed } = require('../bot')
const { sendMessage, react, setUserState, editMessage, gated } = require('../../utils')
const { enqueueTask } = require('../queue')
const { writeUserData } = require('../../../db/mongodb')
const { checkLobby } = require('../gatekeep')
const { getGroup } = require('./iGroup')

async function handlePromptCatch(message, match) {
    const slot = parseInt(match[1]); // Ensure it's an integer
    const userId = message.from.id
    if (slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }
    const userSettings = lobby[userId];
    if (!userSettings) {
        sendMessage(message, "User settings not found.");
        return;
    }
    const prompt = userSettings.prompt;
    userSettings.promptdex[slot - 1] = prompt;
    writeUserData(userId,userSettings);
    sendMessage(message, `Prompt saved to slot ${slot} and settings saved`);
}

async function handleDexMake(message, match) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);
    if (!await checkLobby(message)) {
        return;
    }
    const slot = parseInt(match[1], 10);
    if (isNaN(slot) || slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }
    let settings;
    if(group) {
        settings = group.settings
    } else {
        settings = lobby[userId]
    }
    const userSettings = lobby[userId];
    if (!settings) {
        sendMessage(message, "User settings not found.");
        return;
    }
    
    const prompt = userSettings.promptdex[slot - 1];
    if (!prompt) {
        sendMessage(message, `No prompt saved in slot ${slot}.`);
        return;
    }

    const thisSeed = makeSeed(userId);
    lobby[userId].lastSeed = thisSeed;

    let batch;
    if (chatId < 0) {
        batch = 1;
    } else {
        batch = userSettings.batchMax;
    }

    settings.prompt = prompt; // Update prompt with selected slot
    userSettings.type = 'MAKE';
    userSettings.lastSeed = thisSeed;

    const promptObj = {
        ...settings,
        strength: 1,
        seed: thisSeed,
        batchMax: batch,
        prompt: prompt
    };
    
    try {
        await react(message);
        enqueueTask({ message, promptObj });
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}

function checkAndSetType(type, settings, message, group, userId) {

    // Define required files based on settings
    const requiredFiles = [];
    
    if (settings.styleTransfer) requiredFiles.push({ name: 'styleFileUrl', message: 'You need to set a style image.' });
    if (settings.controlNet) requiredFiles.push({ name: 'controlFileUrl', message: 'You need to set a control image.' });
    if (settings.openPose) requiredFiles.push({ name: 'poseFileUrl', message: 'You need to set a pose image.' });
    if (requiredFiles.length > 0 && tokenGate(group, userId, message)) return // Early return for token gate if needed
    
    // Check if any required files are missing
    for (let file of requiredFiles) {
        if (!settings[file.name]) {
            sendMessage(message, `${file.message} use /set menu or turn it off in /create or /effect menu`);
            return;
        }
    }

    // Dynamically build the type
    if (settings.controlNet && settings.controlFileUrl) type += '_CANNY';
    if (settings.styleTransfer && settings.styleFileUrl) type += '_STYLE';
    if (settings.openPose && settings.poseFileUrl) type += '_POSE';
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

async function startMake(message, user = null) {
    console.log('start make from iMake')
    if(user){
        message.from.id = user;
        await editMessage({
            text: 'What prompt for your txt2img?',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        sendMessage(message, 'What prompt for your txt2img?')
    }
    //await sendMessage(message,'What prompt for your txt2img?')
    //console.log('user in start make',message.from.id);
    //console.log('message in start make',message);
    setUserState(message,STATES.MAKE)
}
async function startMake3(message,user) {
    if(user){
        message.from.id = user;
        await editMessage({
            text: 'What prompt for your txt2img sd3',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        if(lobby[message.from.id] && lobby[message.from.id].balance <= 500000){
            gated(message)
            return
        }
        sendMessage(message, 'What prompt for your txt2img sd3')
    }
    //await sendMessage(message,'What prompt for your txt2img sd3');
    setUserState(message,STATES.MAKE3)
}
async function startMog(message,user) {
        if(user){
            message.from.id = user;
            await editMessage({
                text: 'What prompt for your txt2img mogflux',
                chat_id: message.chat.id,
                message_id: message.message_id
            })
        } else {
            // if(lobby[message.from.id] && lobby[message.from.id].balance <= 100000){
            //     gated(message)
            //     return
            // }
            sendMessage(message, 'What prompt for your txt2img mogflux')
        }
        //await sendMessage(message,'What prompt for your txt2img sd3');
        setUserState(message,STATES.MOG)
}

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

// Helper function to build the prompt object dynamically based on the workflow
function buildPromptObjFromWorkflow(workflow, userContext, message) {
    const promptObj = {};
    //console.log('user context given',userContext)
    // Always include type from userContext and add username from the message
    promptObj.type = userContext.type || workflow.name;
    promptObj.username = message.from.username || 'unknown_user';
    promptObj.balance = userContext.balance
    promptObj.userId = userContext.userId
    promptObj.photoStats = { height: 1024, width: 1024}
    promptObj.forcelogo = userContext.forcelogo || false
    // Set required inputs based on the workflow type
    if (workflow.name.startsWith('MAKE')) {
        // Handle MAKE workflows and their variations
        // FIX THESE LATER WHEN WE WANT TO TUCK IN
        promptObj.batchMax = userContext.batchMax || 1;
        promptObj.checkpoint = userContext.checkpoint || 'zavychromaxl_v60';
        promptObj.basePrompt = userContext.basePrompt
        promptObj.cfg = userContext.cfg || 7;
        promptObj.steps = userContext.steps || 50;
        promptObj.prompt = userContext.prompt || 'default prompt';
        promptObj.negativePrompt = userContext.negativePrompt || '';
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.strength = 1.0;

        // Add additional images for MAKE_CANNY, MAKE_STYLE, MAKE_POSE, etc.
        if (userContext.styleTransfer) {
            promptObj.styleFileUrl = userContext.styleFileUrl;
        }
        if (userContext.controlNet) {
            promptObj.controlFileUrl = userContext.controlFileUrl;
        }
        if (userContext.openPose) {
            promptObj.poseFileUrl = userContext.poseFileUrl;
        }
    } 
    else if (workflow.name === 'I2I') {
        // Handle I2I workflow
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.fileUrl = userContext.fileUrl;
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.prompt = userContext.prompt || 'default I2I prompt';
        promptObj.negativePrompt = userContext.negativePrompt || '';

        // Optional images for I2I CANNY, STYLE, POSE, etc.
        if (workflow.name.includes('STYLE')) {
            promptObj.styleFileUrl = userContext.styleFileUrl || userContext.fileUrl;
        }
        if (workflow.name.includes('CANNY')) {
            promptObj.cannyImageUrl = userContext.cannyImageUrl || userContext.fileUrl;
        }
        if (workflow.name.includes('POSE')) {
            promptObj.poseFileUrl = userContext.poseFileUrl || userContext.fileUrl;
        }
    } 
    else if (workflow.name === 'INPAINT') {
        // Handle INPAINT workflow
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.fileUrl = userContext.fileUrl;
        promptObj.maskUrl = userContext.maskUrl;  // INPAINT requires a mask
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.prompt = userContext.prompt || 'default INPAINT prompt';
        promptObj.negativePrompt = userContext.negativePrompt || '';
        promptObj.strength = userContext.strength || 1.0;
    }
    else if (workflow.name.startsWith('MAKE3')) {
        // Handle MAKE3 workflow (simplest workflow)
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.prompt = userContext.prompt || 'default MAKE3 prompt';
        promptObj.negativePrompt = userContext.negativePrompt || '';
    }
    else if (workflow.name.startsWith('FLUX')) {
        // Handle FLUX workflows and derivatives (MOG, DEGOD, CHUD, MILADY, RADBRO)
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
        promptObj.prompt = userContext.prompt || 'default FLUX prompt';
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
    }

    // Add additional common properties such as prompt, seed, and batchMax
    promptObj.prompt = userContext.prompt;
    promptObj.seed = userContext.lastSeed;
    promptObj.userBasePrompt = userContext.userBasePrompt
    //promptObj.userBasePrompt = userContext.basePrompt
    promptObj.userId = message.from.id
    promptObj.timeRequested = Date.now()
    //promptObj.batchMax = userContext.batchMax;

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

    // Clean the message text
    message.text = message.text.replace(`/${taskType.toLowerCase()}`, '').replace(`@${process.env.BOT_NAME}`, '');

    // Check if the message text is empty, trigger the start prompt
    if (message.text === '') {
        await startTaskPrompt(message, taskType, defaultState, null, minTokenAmount);  // Use the generalized start function
        return;
    }

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
    const batch = chatId < 0 ? 1 : settings.batchMax;

    // Use the workflow reader to dynamically build the promptObj based on the workflow's required inputs
    const workflow = flows.find(flow => flow.name === finalType);
    //console.log(workflow)
    const promptObj = buildPromptObjFromWorkflow(workflow, {
        ...settings,
        prompt: message.text,
        seed: thisSeed,
        batchMax: batch
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


async function handleRadbro(message) {
    console.log('radbro')
    await handleTask(message, 'RADBRO', STATES.RADBRO, false, 0)
}

async function handleFlux(message) {
    console.log('flux')
    handleTask(message,'FLUX',STATES.FLUX,false,0)
}

// async function handleRegen(message) {
//     const userId = message.from.id;
//     const thisSeed = makeSeed(userId);
//     const group = getGroup(message);
//     let settings;
//     if(group){
//         settings = group.settings
//     } else {
//         settings = lobby[userId]
//     }
//     lobby[userId].lastSeed = thisSeed;
//     let batch;
//     if(message.chat.id < 0){
//         batch = 1;
//         //batch = lobby[userId].batchMax
//     } else {
//         //lobby[userId] ? batch = lobby[userId.batchMax] : batch = 1
//         batch = lobby[userId].batchMax;
//     }
//     let strength;
//     // if(settings.type.startsWith('MAKE')){
//     //     strength = 1;
//     // } else {
//     //     strength = settings.strength
//     // }
//     const promptObj = {
//         ...settings,
//         strength: strength,
//         prompt: lobby[userId].prompt,
//         seed: thisSeed,
//         batchMax: batch
//     }
//     if(promptObj.type == 'FLUX'){
//         promptObj.checkpoint = 'flux-schnell'
//     }
//     react(message, '👍');
//     enqueueTask({message, promptObj})
//     setUserState(message, STATES.IDLE);
// }
async function handleRegen(message, user = null) {
    //console.log(JSON.stringify(lobby[message.from.id]))
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

    // Create menu options for each run, displaying the time since the gen was requested and the type
    const buttons = userRuns.map((run, index) => {
        const timeSinceRequest = Math.floor((Date.now() - run.timeRequested) / (1000 * 60)); // Time in minutes
        const runType = run.type || 'Unknown Type'; // Fallback to 'Unknown Type' if type is missing

        return [{
            text: `${runType} ${run.seed} ${timeSinceRequest}m`,
            callback_data: `regen_run_${index}`
        }];
    });

    buttons.push([{text: 'cancel',callback_data: 'cancel'}])

    // Send the menu to the user with the list of generations to regenerate
    const options = {
        reply_markup: {
            inline_keyboard: buttons
        }
    };

    await sendMessage(message, "Choose which generation you'd like to regenerate:", options);
}

async function handleMs2Prompt(message) {
    // Use handleTask with 'I2I' as the taskType and STATES.I2I as the state
    await handleTask(message, 'I2I', STATES.MS2PROMPT, true, null);
}

// async function handleInpaintPrompt(message) {
//     const userId = message.from.id;
//     let userInput = message.text;
//     //const group = getGroup(message);
//     userInput == '' ? userInput = '' : null;

//     lobby[userId] = {
//         ...lobby[userId],
//         prompt: userInput,
//         type: 'INPAINT'
//     }
//     await sendMessage(message, 'pls wait i will make in 1 second');
//     const promptObj = {
//         ...lobby[userId],
//         seed: lobby[userId].lastSeed,
//         photoStats: lobby[userId].tempSize
//     }
//     //return await shakeMs2(message,promptObj);
//     enqueueTask({message,promptObj})
//     setUserState(message,STATES.IDLE);
// }
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
    startMake, 
    startMake3, 
    handleMake, 
    handleRegen, 
    handleMake3, 
    handleDexMake, 
    handlePromptCatch,
    handleMs2Prompt,
    handleInpaintPrompt,
    handleInpaintTarget,
    handleMog, startMog, handleDegod, handleMilady, handleChud, handleRadbro,
    handleFlux
}